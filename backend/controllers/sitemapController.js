// backend/controllers/sitemapController.js
import express from 'express';
import fetch from 'node-fetch';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// Progress tracking (in-memory for simplicity, could use Redis in production)
const progressStore = new Map();

// Helper: normalize shop domain
function normalizeShop(s) {
  if (!s) return null;
  s = String(s).trim().toLowerCase();
  if (/^https?:\/\//.test(s)) {
    const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return u.toLowerCase();
  }
  if (!/\.myshopify\.com$/i.test(s)) return `${s.toLowerCase()}.myshopify.com`;
  return s.toLowerCase();
}

// Helper: get access token from Shop model
async function resolveAdminTokenForShop(shop) {
  try {
    const doc = await Shop.findOne({ shop }).lean().exec();
    const tok = doc?.accessToken || doc?.token || doc?.access_token;
    if (tok && String(tok).trim()) return String(tok).trim();
  } catch (e) { /* ignore */ }

  const err = new Error('No Admin API token available for this shop');
  err.status = 400;
  throw err;
}

// Helper: make GraphQL request
async function shopGraphQL(shop, query, variables = {}) {
  const token = await resolveAdminTokenForShop(shop);
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const rsp = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await rsp.json().catch(() => ({}));
  if (!rsp.ok || json.errors) {
    const e = new Error(`Admin GraphQL error: ${JSON.stringify(json.errors || json)}`);
    e.status = rsp.status || 500;
    throw e;
  }
  return json.data;
}

// Helper: get plan limits
async function getPlanLimits(shop) {
  try {
    const sub = await Subscription.findOne({ shop }).lean().exec();
    if (!sub) return { limit: 50, plan: 'starter' };
    
    const planLimits = {
      'free': 50,
      'starter': 50,
      'professional': 100,
      'growth': 500,
    };
    
    const limit = planLimits[sub.plan?.toLowerCase()] || 50;
    return { limit, plan: sub.plan };
  } catch (e) {
    return { limit: 50, plan: 'starter' };
  }
}

// Helper: format file size
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// GET /api/sitemap/info
router.get('/info', async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter required' });
    }

    // Check if sitemap exists
    const sitemapPath = path.join(__dirname, '..', 'public', 'sitemaps', `${shop}-sitemap.xml`);
    
    try {
      const stats = await fs.stat(sitemapPath);
      const content = await fs.readFile(sitemapPath, 'utf-8');
      const urlCount = (content.match(/<url>/g) || []).length;
      
      const countData = await shopGraphQL(shop, `
        query {
          productsCount {
            count
          }
        }
      `);

      res.json({
        exists: true,
        lastModified: stats.mtime,
        fileSize: formatFileSize(stats.size),
        urlCount,
        productCount: countData.productsCount?.count || 0,
        url: `https://${shop}/sitemap.xml`,
      });
    } catch (error) {
      // Sitemap doesn't exist
      const countData = await shopGraphQL(shop, `
        query {
          productsCount {
            count
          }
        }
      `);

      res.json({
        exists: false,
        productCount: countData.productsCount?.count || 0,
        url: `https://${shop}/sitemap.xml`,
      });
    }
  } catch (error) {
    console.error('Error getting sitemap info:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sitemap/generate
router.post('/generate', async (req, res) => {
  try {
    const shop = normalizeShop(req.body.shop);
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter required' });
    }

    const { limit, plan } = await getPlanLimits(shop);
    progressStore.set(shop, { status: 'processing', progress: 0 });
    
    res.json({ status: 'started', message: 'Sitemap generation started' });
    
    // Generate sitemap asynchronously
    generateSitemapAsync(shop, limit);

  } catch (error) {
    console.error('Error starting sitemap generation:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sitemap/progress
router.get('/progress', async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter required' });
    }

    const progress = progressStore.get(shop) || { status: 'idle', progress: 0 };
    res.json(progress);

  } catch (error) {
    console.error('Error getting progress:', error);
    res.status(500).json({ error: error.message });
  }
});

// Async sitemap generation
async function generateSitemapAsync(shop, limit) {
  try {
    const shopInfoData = await shopGraphQL(shop, `
      query {
        shop {
          primaryDomain {
            url
          }
        }
        shopLocales {
          locale
          primary
        }
      }
    `);

    const primaryDomain = shopInfoData.shop.primaryDomain.url;
    const locales = shopInfoData.shopLocales || [{ locale: 'en', primary: true }];
    const primaryLocale = locales.find(l => l.primary)?.locale || 'en';

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';

    // Homepage
    xml += '  <url>\n';
    xml += `    <loc>${primaryDomain}</loc>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';

    // Products
    let hasNextPage = true;
    let cursor = null;
    let totalProcessed = 0;

    while (hasNextPage && totalProcessed < limit) {
      const productsData = await shopGraphQL(shop, `
        query($cursor: String, $first: Int!) {
          products(first: $first, after: $cursor, query: "status:ACTIVE") {
            edges {
              node {
                handle
                updatedAt
                publishedAt
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `, {
        first: Math.min(50, limit - totalProcessed),
        cursor
      });

      const products = productsData.products;
      
      for (const edge of products.edges) {
        const product = edge.node;
        if (!product.publishedAt) continue;

        const lastmod = new Date(product.updatedAt).toISOString().split('T')[0];
        
        for (const locale of locales) {
          const localePrefix = locale.locale === primaryLocale ? '' : `/${locale.locale}`;
          
          xml += '  <url>\n';
          xml += `    <loc>${primaryDomain}${localePrefix}/products/${product.handle}</loc>\n`;
          xml += `    <lastmod>${lastmod}</lastmod>\n';
          xml += '    <changefreq>weekly</changefreq>\n';
          xml += '    <priority>0.8</priority>\n';
          
          if (locales.length > 1) {
            for (const altLocale of locales) {
              const altPrefix = altLocale.locale === primaryLocale ? '' : `/${altLocale.locale}`;
              xml += `    <xhtml:link rel="alternate" hreflang="${altLocale.locale}" href="${primaryDomain}${altPrefix}/products/${product.handle}"/>\n`;
            }
          }
          
          xml += '  </url>\n';
        }
      }
      
      hasNextPage = products.pageInfo.hasNextPage;
      cursor = products.edges[products.edges.length - 1]?.cursor;
      totalProcessed += products.edges.length;

      progressStore.set(shop, { 
        status: 'processing', 
        progress: Math.round((totalProcessed / limit) * 100) 
      });
    }

    // Collections
    const collectionsData = await shopGraphQL(shop, `
      query {
        collections(first: 20, query: "published_status:published") {
          edges {
            node {
              handle
              updatedAt
            }
          }
        }
      }
    `);

    for (const edge of collectionsData.collections?.edges || []) {
      const collection = edge.node;
      xml += '  <url>\n';
      xml += `    <loc>${primaryDomain}/collections/${collection.handle}</loc>\n';
      xml += `    <lastmod>${new Date(collection.updatedAt).toISOString().split('T')[0]}</lastmod>\n';
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.7</priority>\n';
      xml += '  </url>\n';
    }

    // Standard pages
    const standardPages = ['about-us', 'contact', 'privacy-policy', 'terms-of-service'];
    for (const page of standardPages) {
      xml += '  <url>\n';
      xml += `    <loc>${primaryDomain}/pages/${page}</loc>\n';
      xml += '    <changefreq>monthly</changefreq>\n';
      xml += '    <priority>0.5</priority>\n';
      xml += '  </url>\n';
    }

    xml += '</urlset>';

    // Save
    const sitemapsDir = path.join(__dirname, '..', 'public', 'sitemaps');
    await fs.mkdir(sitemapsDir, { recursive: true });
    await fs.writeFile(path.join(sitemapsDir, `${shop}-sitemap.xml`), xml);

    progressStore.set(shop, { status: 'completed', progress: 100 });
    
    setTimeout(() => progressStore.delete(shop), 5 * 60 * 1000);

  } catch (error) {
    console.error('Error generating sitemap:', error);
    progressStore.set(shop, { 
      status: 'error', 
      progress: 0, 
      error: error.message 
    });
  }
}

// Export for server.js compatibility
export const sitemapController = {
  getInfo(req, res) {
    return router.handle(req, res);
  },
  generate(req, res) {
    return router.handle(req, res);
  },
  getProgress(req, res) {
    return router.handle(req, res);
  },
  serve(req, res) {
    const shop = normalizeShop(req.params.shop || req.query.shop || req.headers.host?.replace('.myshopify.com', ''));
    if (!shop) {
      return res.status(404).send('Sitemap not found');
    }
    
    const sitemapPath = path.join(__dirname, '..', 'public', 'sitemaps', `${shop}-sitemap.xml`);
    
    fs.access(sitemapPath)
      .then(() => fs.readFile(sitemapPath, 'utf-8'))
      .then(content => {
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(content);
      })
      .catch(() => res.status(404).send('Sitemap not found'));
  }
};

export default router;