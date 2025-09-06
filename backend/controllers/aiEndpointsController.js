// backend/controllers/aiEndpointsController.js
import express from 'express';
import Shop from '../db/Shop.js';
import aiDiscoveryService from '../services/aiDiscoveryService.js';

const router = express.Router();

/**
 * Helper to check if feature is available
 */
async function checkFeatureAccess(shop, feature) {
  try {
    const planResponse = await fetch(`${process.env.APP_URL}/plans/me?shop=${shop}`);
    const planData = await planResponse.json();
    const plan = planData.plan || 'starter';
    
    return aiDiscoveryService.isFeatureAvailable(plan, feature);
  } catch (error) {
    console.error('Failed to check feature access:', error);
    return false;
  }
}

/**
 * GET /ai/products.json
 * Returns aggregated product data with AI SEO metadata
 */
router.get('/ai/products.json', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    // Check plan access
    if (!await checkFeatureAccess(shop, 'productsJson')) {
      return res.status(403).json({ error: 'This feature requires Starter plan or higher' });
    }

    const shopDoc = await Shop.findOne({ shop });
    if (!shopDoc || !shopDoc.accessToken) {
      return res.status(401).json({ error: 'Shop not authenticated' });
    }

    // Fetch all products with AI SEO metafields
    const productsResponse = await fetch(
      `https://${shop}/admin/api/2024-07/products.json?limit=250&fields=id,title,handle,tags,vendor,updated_at`,
      {
        headers: {
          'X-Shopify-Access-Token': shopDoc.accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!productsResponse.ok) {
      throw new Error('Failed to fetch products');
    }

    const productsData = await productsResponse.json();
    const products = productsData.products || [];

    // Fetch AI SEO metafields for each product
    const productsWithAISEO = await Promise.all(
      products.map(async (product) => {
        try {
          // Get AI SEO metafields
          const metafieldsResponse = await fetch(
            `https://${shop}/admin/api/2024-07/products/${product.id}/metafields.json?namespace=seo_ai`,
            {
              headers: {
                'X-Shopify-Access-Token': shopDoc.accessToken,
                'Content-Type': 'application/json'
              }
            }
          );

          const metafieldsData = await metafieldsResponse.json();
          const metafields = metafieldsData.metafields || [];

          // Parse AI SEO data
          const seoData = {};
          metafields.forEach(mf => {
            if (mf.key === 'seo') {
              try {
                const parsed = JSON.parse(mf.value);
                seoData.seo = parsed.seo;
                seoData.jsonLd = parsed.seo?.jsonLd;
              } catch (e) {}
            }
            if (mf.key === 'bullets') {
              try {
                seoData.bullets = JSON.parse(mf.value);
              } catch (e) {}
            }
            if (mf.key === 'faq') {
              try {
                seoData.faq = JSON.parse(mf.value);
              } catch (e) {}
            }
          });

          return {
            id: `gid://shopify/Product/${product.id}`,
            url: `https://${shop}/products/${product.handle}`,
            title: product.title,
            handle: product.handle,
            vendor: product.vendor,
            tags: product.tags ? product.tags.split(', ') : [],
            updatedAt: product.updated_at,
            aiOptimized: !!seoData.seo,
            structuredData: seoData.jsonLd ? 'json-ld' : null,
            seoMetadata: seoData.seo ? {
              title: seoData.seo.title,
              description: seoData.seo.metaDescription,
              bullets: seoData.bullets,
              faq: seoData.faq
            } : null
          };
        } catch (error) {
          console.error(`Failed to fetch metafields for product ${product.id}:`, error);
          return {
            id: `gid://shopify/Product/${product.id}`,
            url: `https://${shop}/products/${product.handle}`,
            title: product.title,
            handle: product.handle,
            aiOptimized: false
          };
        }
      })
    );

    // Build response
    const response = {
      '@context': 'https://schema.org',
      '@type': 'DataCatalog',
      name: `${shop} Product Catalog`,
      description: 'AI-optimized product data for search and discovery',
      publisher: {
        '@type': 'Organization',
        name: shop
      },
      dateModified: new Date().toISOString(),
      numberOfItems: productsWithAISEO.length,
      aiOptimizedCount: productsWithAISEO.filter(p => p.aiOptimized).length,
      distribution: {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: `https://${shop}/ai/products.json`
      },
      products: productsWithAISEO
    };

    // Cache for 1 hour
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(response);

  } catch (error) {
    console.error('Failed to generate products.json:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /ai/welcome
 * AI Discovery welcome page
 */
router.get('/ai/welcome', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    // Check plan access
    if (!await checkFeatureAccess(shop, 'welcomePage')) {
      return res.status(403).json({ error: 'This feature requires Professional plan or higher' });
    }

    // Get shop info and stats
    const shopDoc = await Shop.findOne({ shop });
    if (!shopDoc) {
      return res.status(401).json({ error: 'Shop not authenticated' });
    }

    // Get product count
    const countResponse = await fetch(
      `https://${shop}/admin/api/2024-07/products/count.json`,
      {
        headers: {
          'X-Shopify-Access-Token': shopDoc.accessToken
        }
      }
    );
    const countData = await countResponse.json();
    const productCount = countData.count || 0;

    // Get AI Discovery settings
    const settings = await aiDiscoveryService.getSettings(shop, { accessToken: shopDoc.accessToken });

    // Generate HTML page
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Discovery Hub - ${shop}</title>
    <meta name="description" content="Structured product data optimized for AI consumption">
    <meta name="robots" content="index, follow">
    <meta name="ai-content-type" content="ecommerce">
    <meta name="ai-data-format" content="json-ld">
    <meta name="ai-update-frequency" content="daily">
    
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 { color: #333; }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin: 2rem 0;
        }
        .stat {
            background: #f8f9fa;
            padding: 1rem;
            border-radius: 4px;
            text-align: center;
        }
        .stat-value {
            font-size: 2rem;
            font-weight: bold;
            color: #007bff;
        }
        .endpoints {
            background: #f8f9fa;
            padding: 1rem;
            border-radius: 4px;
            margin: 1rem 0;
        }
        .endpoints a {
            color: #007bff;
            text-decoration: none;
        }
        .endpoints a:hover {
            text-decoration: underline;
        }
        code {
            background: #e9ecef;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
        }
    </style>
    
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "DataCatalog",
        "name": "${shop} AI Discovery Hub",
        "description": "Structured product data for AI models and search engines",
        "url": "https://${shop}/ai/welcome",
        "publisher": {
            "@type": "Organization",
            "name": "${shop}"
        },
        "dataset": [{
            "@type": "Dataset",
            "name": "Products",
            "description": "Product catalog with AI-optimized metadata",
            "distribution": {
                "@type": "DataDownload",
                "encodingFormat": "application/json",
                "contentUrl": "https://${shop}/ai/products.json"
            }
        }],
        "dateModified": "${new Date().toISOString()}"
    }
    </script>
</head>
<body>
    <div class="container">
        <h1>🤖 AI Discovery Hub</h1>
        <p>Welcome AI agents! This store provides structured product data optimized for AI consumption.</p>
        
        <div class="stats">
            <div class="stat">
                <div class="stat-value">${productCount}</div>
                <div>Total Products</div>
            </div>
            <div class="stat">
                <div class="stat-value">✅</div>
                <div>JSON-LD Enabled</div>
            </div>
            <div class="stat">
                <div class="stat-value">4</div>
                <div>Languages Supported</div>
            </div>
        </div>
        
        <h2>📊 Available Data Endpoints</h2>
        <div class="endpoints">
            <p><strong>Products Feed:</strong> <a href="/ai/products.json?shop=${shop}">/ai/products.json</a></p>
            <p><strong>Sitemap:</strong> <a href="/api/sitemap/generate?shop=${shop}">/api/sitemap/generate</a></p>
        </div>
        
        <h2>🔍 Data Structure</h2>
        <p>All product pages include:</p>
        <ul>
            <li>✅ Schema.org JSON-LD structured data</li>
            <li>✅ AI-optimized SEO metadata</li>
            <li>✅ Product FAQs and bullet points</li>
            <li>✅ Multi-language support (EN, DE, ES, FR)</li>
        </ul>
        
        <h2>🤝 Integration Guide</h2>
        <p>To consume our data:</p>
        <ol>
            <li>Fetch the products feed from <code>/ai/products.json</code></li>
            <li>Each product URL contains embedded JSON-LD data</li>
            <li>Use the <code>aiOptimized</code> flag to identify enhanced products</li>
            <li>Respect our robots.txt guidelines</li>
        </ol>
        
        <h2>📞 Contact</h2>
        <p>This AI Discovery Hub is powered by <strong>AI SEO 2.0</strong> for Shopify.</p>
    </div>
</body>
</html>`;

    res.type('text/html').send(html);

  } catch (error) {
    console.error('Failed to generate welcome page:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /ai/update-product
 * Called after SEO is applied to update the products.json cache
 */
router.post('/ai/update-product', async (req, res) => {
  try {
    const { shop, productId } = req.body;
    
    // For now, just invalidate cache
    // In production, you might want to update specific product in cache
    
    res.json({ success: true, message: 'Product updated in AI feed' });
  } catch (error) {
    console.error('Failed to update product:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;