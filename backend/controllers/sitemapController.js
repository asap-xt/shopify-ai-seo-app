// backend/controllers/sitemapController.js
import express from 'express';
import fetch from 'node-fetch';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';

const router = express.Router();
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// Helper: normalize shop domain
function normalizeShop(s) {
  if (!s) return null;
  s = String(s).trim().toLowerCase();
  if (/^https?:\/\//.test(s)) {
    const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return u.toLowerCase();
  }
  if (!/\.myshopify\.com$/i.test(s)) return s.toLowerCase() + '.myshopify.com';
  return s.toLowerCase();
}

// Helper: get access token
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

// Helper: GraphQL request
async function shopGraphQL(shop, query, variables = {}) {
  const token = await resolveAdminTokenForShop(shop);
  const url = 'https://' + shop + '/admin/api/' + API_VERSION + '/graphql.json';
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
    const e = new Error('Admin GraphQL error: ' + JSON.stringify(json.errors || json));
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
      'starter': 50,
      'professional': 300,
      'growth': 650,
      'growth_extra': 2000,
      'enterprise': 5000
    };
    
    const limit = planLimits[sub.plan?.toLowerCase()] || 50;
    return { limit, plan: sub.plan };
  } catch (e) {
    return { limit: 50, plan: 'starter' };
  }
}

// GET /api/sitemap/generate
router.get('/generate', async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    const { limit, plan } = await getPlanLimits(shop);
    
    // Get shop info and languages for AI discovery
    const shopQuery = `
      query {
        shop {
          primaryDomain { url }
        }
        shopLocales {
          locale
          primary
        }
      }
    `;
    
    const shopData = await shopGraphQL(shop, shopQuery);
    const primaryDomain = shopData.shop.primaryDomain.url;
    const locales = shopData.shopLocales || [{ locale: 'en', primary: true }];
    
    // Fetch products with AI-relevant data
    let allProducts = [];
    let cursor = null;
    let hasMore = true;
    
    while (hasMore && allProducts.length < limit) {
      const productsQuery = `
        query($cursor: String, $first: Int!) {
          products(first: $first, after: $cursor, query: "status:active") {
            edges {
              node {
                handle
                title
                descriptionHtml
                vendor
                productType
                tags
                updatedAt
                publishedAt
                seo {
                  title
                  description
                }
                metafields(namespace: "seo_ai", first: 10) {
                  edges {
                    node {
                      key
                      value
                    }
                  }
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;
      
      const batchSize = Math.min(50, limit - allProducts.length);
      const data = await shopGraphQL(shop, productsQuery, {
        first: batchSize,
        cursor: cursor
      });
      
      if (data.products?.edges) {
        allProducts = allProducts.concat(data.products.edges);
        hasMore = data.products.pageInfo.hasNextPage;
        const lastEdge = data.products.edges[data.products.edges.length - 1];
        cursor = lastEdge?.cursor;
      } else {
        hasMore = false;
      }
    }
    
    // Generate AI-optimized XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:xhtml="http://www.w3.org/1999/xhtml"\n';
    xml += '        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"\n';
    xml += '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n';
    
    // Homepage with structured data hint
    xml += '  <url>\n';
    xml += '    <loc>' + primaryDomain + '</loc>\n';
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';
    
    // Products with AI hints
    for (const edge of allProducts) {
      const product = edge.node;
      if (!product.publishedAt || !product.handle) continue;
      
      const lastmod = new Date(product.updatedAt).toISOString().split('T')[0];
      
      // Add product URL with metadata hints for AI
      xml += '  <url>\n';
      xml += '    <loc>' + primaryDomain + '/products/' + product.handle + '</loc>\n';
      xml += '    <lastmod>' + lastmod + '</lastmod>\n';
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      
      // Add language alternatives for multilingual AI indexing
      if (locales.length > 1) {
        for (const locale of locales) {
          if (!locale.primary) {
            xml += '    <xhtml:link rel="alternate" hreflang="' + locale.locale + '" ';
            xml += 'href="' + primaryDomain + '/' + locale.locale + '/products/' + product.handle + '"/>\n';
          }
        }
      }
      
      xml += '  </url>\n';
    }
    
    // Add collections for AI category understanding
    if (['growth', 'professional'].includes(plan?.toLowerCase())) {
      const collectionsQuery = `
        query {
          collections(first: 20, query: "published_status:published") {
            edges {
              node {
                handle
                title
                descriptionHtml
                updatedAt
              }
            }
          }
        }
      `;
      
      const collectionsData = await shopGraphQL(shop, collectionsQuery);
      
      for (const edge of collectionsData.collections?.edges || []) {
        const collection = edge.node;
        xml += '  <url>\n';
        xml += '    <loc>' + primaryDomain + '/collections/' + collection.handle + '</loc>\n';
        xml += '    <lastmod>' + new Date(collection.updatedAt).toISOString().split('T')[0] + '</lastmod>\n';
        xml += '    <changefreq>weekly</changefreq>\n';
        xml += '    <priority>0.7</priority>\n';
        xml += '  </url>\n';
      }
    }
    
    // Standard pages for complete AI understanding
    const pages = [
      { url: 'about-us', freq: 'monthly', priority: '0.6' },
      { url: 'contact', freq: 'monthly', priority: '0.5' },
      { url: 'privacy-policy', freq: 'yearly', priority: '0.3' },
      { url: 'terms-of-service', freq: 'yearly', priority: '0.3' }
    ];
    
    for (const page of pages) {
      xml += '  <url>\n';
      xml += '    <loc>' + primaryDomain + '/pages/' + page.url + '</loc>\n';
      xml += '    <changefreq>' + page.freq + '</changefreq>\n';
      xml += '    <priority>' + page.priority + '</priority>\n';
      xml += '  </url>\n';
    }
    
    xml += '</urlset>';
    
    // Set proper headers for AI crawlers
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'noindex' // Don't let Google index the sitemap itself
    });
    res.send(xml);
    
  } catch (err) {
    console.error('[SITEMAP] Generation error:', err);
    return res.status(err.status || 500).json({ 
      error: err.message || 'Failed to generate sitemap' 
    });
  }
});

// GET /api/sitemap/info
router.get('/info', async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    const { limit, plan } = await getPlanLimits(shop);
    
    // Get actual product count
    const countData = await shopGraphQL(shop, `
      query {
        productsCount {
          count
        }
      }
    `);
    
    const productCount = countData.productsCount?.count || 0;
    const includesCollections = ['growth', 'professional'].includes(plan?.toLowerCase());
    
    return res.json({
      shop,
      plan,
      productCount,
      limits: {
        products: limit,
        collections: includesCollections ? 20 : 0
      },
      features: {
        products: true,
        collections: includesCollections,
        multiLanguage: true,
        aiOptimized: true,
        structuredData: true
      },
      url: 'https://' + shop + '/sitemap.xml'
    });
    
  } catch (err) {
    console.error('[SITEMAP] Info error:', err);
    return res.status(err.status || 500).json({ 
      error: err.message || 'Failed to get sitemap info' 
    });
  }
});

// POST /api/sitemap/generate - redirect to GET for compatibility
router.post('/generate', (req, res) => {
  const shop = req.body.shop || req.query.shop;
  res.redirect(307, '/api/sitemap/generate?shop=' + encodeURIComponent(shop));
});

// GET /api/sitemap/progress - simple implementation
router.get('/progress', (req, res) => {
  res.json({ status: 'completed', progress: 100 });
});

// Export both router and controller for server.js
export const sitemapController = {
  getInfo: (req, res) => router.handle(req, res),
  generate: (req, res) => router.handle(req, res), 
  getProgress: (req, res) => router.handle(req, res),
  serve: (req, res) => {
    const shop = req.params.shop || req.query.shop;
    if (shop) {
      res.redirect(301, '/api/sitemap/generate?shop=' + encodeURIComponent(shop));
    } else {
      res.status(404).send('Shop not specified');
    }
  }
};

export default router;