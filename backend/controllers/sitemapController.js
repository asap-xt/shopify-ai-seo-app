// backend/controllers/sitemapController.js
import { shopifyApi } from '../lib/shopify-api.js';
import { ensureShopAuth } from '../middleware/auth.js';
import { Plan } from '../models/Plan.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Plan limits for sitemap URLs
const PLAN_LIMITS = {
  Free: 50,
  Starter: 50,
  Professional: 100,
  Growth: 500,
};

// Progress tracking (in-memory for simplicity, could use Redis in production)
const progressStore = new Map();

export const sitemapController = {
  // GET /api/sitemap/info
  async getInfo(req, res) {
    try {
      const { shop } = req.query;
      if (!shop) {
        return res.status(400).json({ error: 'Shop parameter required' });
      }

      const session = await ensureShopAuth(req, res);
      if (!session) return;

      // Check if sitemap exists
      const sitemapPath = path.join(__dirname, '..', 'public', 'sitemaps', `${shop}-sitemap.xml`);
      
      try {
        const stats = await fs.stat(sitemapPath);
        const content = await fs.readFile(sitemapPath, 'utf-8');
        const urlCount = (content.match(/<url>/g) || []).length;
        
        // Get product count
        const client = new shopifyApi.clients.Graphql({ session });
        const countResponse = await client.query({
          data: `query {
            productsCount {
              count
            }
          }`
        });

        res.json({
          exists: true,
          lastModified: stats.mtime,
          fileSize: formatFileSize(stats.size),
          urlCount,
          productCount: countResponse.body.data.productsCount.count,
          url: `https://${shop}/sitemap.xml`,
        });
      } catch (error) {
        // Sitemap doesn't exist
        const client = new shopifyApi.clients.Graphql({ session });
        const countResponse = await client.query({
          data: `query {
            productsCount {
              count
            }
          }`
        });

        res.json({
          exists: false,
          productCount: countResponse.body.data.productsCount.count,
          url: `https://${shop}/sitemap.xml`,
        });
      }
    } catch (error) {
      console.error('Error getting sitemap info:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/sitemap/generate
  async generate(req, res) {
    try {
      const { shop } = req.body;
      if (!shop) {
        return res.status(400).json({ error: 'Shop parameter required' });
      }

      const session = await ensureShopAuth(req, res);
      if (!session) return;

      // Get plan limit
      const plan = await Plan.findOne({ shop });
      const limit = PLAN_LIMITS[plan?.plan || 'Free'];

      // Start generation in background
      progressStore.set(shop, { status: 'processing', progress: 0 });
      
      // Respond immediately
      res.json({ status: 'started', message: 'Sitemap generation started' });

      // Generate sitemap asynchronously
      generateSitemapAsync(session, shop, limit);

    } catch (error) {
      console.error('Error starting sitemap generation:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/sitemap/progress
  async getProgress(req, res) {
    try {
      const { shop } = req.query;
      if (!shop) {
        return res.status(400).json({ error: 'Shop parameter required' });
      }

      const progress = progressStore.get(shop) || { status: 'idle', progress: 0 };
      res.json(progress);

    } catch (error) {
      console.error('Error getting progress:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/sitemap/serve/:shop
  async serve(req, res) {
    try {
      const { shop } = req.params;
      const sitemapPath = path.join(__dirname, '..', 'public', 'sitemaps', `${shop}-sitemap.xml`);
      
      // Check if file exists
      await fs.access(sitemapPath);
      
      // Set proper headers
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      
      // Stream the file
      const content = await fs.readFile(sitemapPath, 'utf-8');
      res.send(content);
      
    } catch (error) {
      res.status(404).send('Sitemap not found');
    }
  }
};

// Async sitemap generation function
async function generateSitemapAsync(session, shop, limit) {
  const client = new shopifyApi.clients.Graphql({ session });
  
  try {
    // Get shop's primary domain and languages
    const shopInfoResponse = await client.query({
      data: `query {
        shop {
          primaryDomain {
            url
          }
          enabledPresentmentCurrencies
        }
        shopLocales {
          locale
          primary
        }
      }`
    });

    const shopInfo = shopInfoResponse.body.data;
    const primaryDomain = shopInfo.shop.primaryDomain.url;
    const locales = shopInfo.shopLocales || [{ locale: 'en', primary: true }];
    const primaryLocale = locales.find(l => l.primary)?.locale || 'en';

    // Start XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';

    // Add homepage
    xml += '  <url>\n';
    xml += `    <loc>${primaryDomain}</loc>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';

    // Fetch products with pagination
    let hasNextPage = true;
    let cursor = null;
    let totalProcessed = 0;
    const productsToInclude = [];

    while (hasNextPage && totalProcessed < limit) {
      const productsResponse = await client.query({
        data: `query($cursor: String, $first: Int!) {
          products(first: $first, after: $cursor, query: "status:ACTIVE") {
            edges {
              node {
                id
                handle
                updatedAt
                status
                publishedAt
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }`,
        variables: {
          first: Math.min(50, limit - totalProcessed),
          cursor
        }
      });

      const products = productsResponse.body.data.products;
      productsToInclude.push(...products.edges.map(e => e.node));
      
      hasNextPage = products.pageInfo.hasNextPage;
      cursor = products.edges[products.edges.length - 1]?.cursor;
      totalProcessed += products.edges.length;

      // Update progress
      const progress = Math.round((totalProcessed / limit) * 100);
      progressStore.set(shop, { status: 'processing', progress });
    }

    // Add products to sitemap
    for (const product of productsToInclude) {
      // Skip unpublished products
      if (!product.publishedAt) continue;

      const lastmod = new Date(product.updatedAt).toISOString().split('T')[0];
      
      // Add URL for each locale
      for (const locale of locales) {
        const localePrefix = locale.locale === primaryLocale ? '' : `/${locale.locale}`;
        
        xml += '  <url>\n';
        xml += `    <loc>${primaryDomain}${localePrefix}/products/${product.handle}</loc>\n`;
        xml += `    <lastmod>${lastmod}</lastmod>\n`;
        xml += '    <changefreq>weekly</changefreq>\n';
        xml += '    <priority>0.8</priority>\n';
        
        // Add alternate language links
        if (locales.length > 1) {
          for (const altLocale of locales) {
            const altPrefix = altLocale.locale === primaryLocale ? '' : `/${altLocale.locale}`;
            xml += `    <xhtml:link rel="alternate" hreflang="${altLocale.locale}" href="${primaryDomain}${altPrefix}/products/${product.handle}"/>\n`;
          }
        }
        
        xml += '  </url>\n';
      }
    }

    // Add collections
    const collectionsResponse = await client.query({
      data: `query {
        collections(first: 20, query: "published_status:published") {
          edges {
            node {
              handle
              updatedAt
            }
          }
        }
      }`
    });

    for (const collection of collectionsResponse.body.data.collections.edges) {
      xml += '  <url>\n';
      xml += `    <loc>${primaryDomain}/collections/${collection.node.handle}</loc>\n`;
      xml += `    <lastmod>${new Date(collection.node.updatedAt).toISOString().split('T')[0]}</lastmod>\n`;
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.7</priority>\n';
      xml += '  </url>\n';
    }

    // Add standard pages
    const standardPages = ['about-us', 'contact', 'privacy-policy', 'terms-of-service'];
    for (const page of standardPages) {
      xml += '  <url>\n';
      xml += `    <loc>${primaryDomain}/pages/${page}</loc>\n`;
      xml += '    <changefreq>monthly</changefreq>\n';
      xml += '    <priority>0.5</priority>\n';
      xml += '  </url>\n';
    }

    xml += '</urlset>';

    // Save sitemap
    const sitemapsDir = path.join(__dirname, '..', 'public', 'sitemaps');
    await fs.mkdir(sitemapsDir, { recursive: true });
    await fs.writeFile(path.join(sitemapsDir, `${shop}-sitemap.xml`), xml);

    // Update progress
    progressStore.set(shop, { status: 'completed', progress: 100 });

    // Save sitemap URL and generation date in metafields
    try {
      // Get shop GID
      const shopResponse = await client.query({
        data: `query {
          shop {
            id
          }
        }`
      });
      
      const shopGid = shopResponse.body.data.shop.id;
      
      // Save metafields
      await client.query({
        data: `mutation {
          metafieldsSet(metafields: [{
            ownerId: "${shopGid}",
            namespace: "seo_ai",
            key: "sitemap_url",
            type: "single_line_text_field",
            value: "https://${shop}/apps/ai-seo/sitemap.xml"
          }, {
            ownerId: "${shopGid}",
            namespace: "seo_ai", 
            key: "sitemap_generated_at",
            type: "date_time",
            value: "${new Date().toISOString()}"
          }, {
            ownerId: "${shopGid}",
            namespace: "seo_ai",
            key: "sitemap_product_count",
            type: "number_integer",
            value: "${totalProcessed}"
          }]) {
            metafields {
              id
              value
            }
            userErrors {
              field
              message
            }
          }
        }`
      });
    } catch (metafieldError) {
      console.error('Failed to save sitemap metafield:', metafieldError);
      // Don't fail the whole process - sitemap is already generated
    }

    // Clean up progress after 5 minutes
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

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}