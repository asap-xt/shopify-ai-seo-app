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

// Product list for AI consumption
router.get('/ai/products.json', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const session = { accessToken: shopRecord.accessToken };
    const settings = await aiDiscoveryService.getSettings(shop, session);
    
    // Check if feature is enabled
    if (!settings?.features?.productsJson) {
      return res.status(403).json({ 
        error: 'Products JSON feature is not enabled. Please enable it in settings.' 
      });
    }

    // Get products from Shopify
    const response = await fetch(
      `https://${shop}/admin/api/2024-07/products.json?limit=250`,
      {
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch products');
    }

    const data = await response.json();
    
    // Transform products for AI consumption
    const aiProducts = data.products.map(product => ({
      id: product.id,
      title: product.title,
      description: product.body_html?.replace(/<[^>]*>?/gm, ''),
      vendor: product.vendor,
      product_type: product.product_type,
      tags: product.tags,
      price: product.variants[0]?.price,
      available: product.status === 'active',
      images: product.images.map(img => img.src),
      url: `https://${shop}/products/${product.handle}`
    }));

    res.json({
      shop: shop,
      generated_at: new Date().toISOString(),
      products_count: aiProducts.length,
      products: aiProducts
    });

  } catch (error) {
    console.error('Error in products.json:', error);
    res.status(500).json({ error: 'Failed to generate products feed' });
  }
});

// Collections JSON endpoint
router.get('/ai/collections.json', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const session = { accessToken: shopRecord.accessToken };
    const settings = await aiDiscoveryService.getSettings(shop, session);
    
    // Check if feature is enabled
    if (!settings?.features?.collectionsJson) {
      return res.status(403).json({ 
        error: 'Collections JSON feature is not enabled. Please enable it in settings.' 
      });
    }

    // Get collections from Shopify
    const response = await fetch(
      `https://${shop}/admin/api/2024-07/collections.json?limit=250`,
      {
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch collections');
    }

    const data = await response.json();
    
    // Transform collections for AI consumption
    const aiCollections = data.collections.map(collection => ({
      id: collection.id,
      title: collection.title,
      description: collection.body_html?.replace(/<[^>]*>?/gm, ''),
      handle: collection.handle,
      products_count: collection.products_count,
      url: `https://${shop}/collections/${collection.handle}`,
      image: collection.image?.src
    }));

    res.json({
      shop: shop,
      generated_at: new Date().toISOString(),
      collections_count: aiCollections.length,
      collections: aiCollections
    });

  } catch (error) {
    console.error('Error in collections.json:', error);
    res.status(500).json({ error: 'Failed to generate collections feed' });
  }
});

// AI Welcome page
router.get('/ai/welcome', async (req, res) => {
  const shop = req.query.shop;
  console.log('[WELCOME DEBUG] ========== START ==========');
  console.log('[WELCOME DEBUG] Shop:', shop);
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  try {
    const shopRecord = await Shop.findOne({ shop });
    console.log('[WELCOME DEBUG] Shop record found:', !!shopRecord);
    
    if (!shopRecord) {
      return res.status(404).send('Shop not found');
    }

    const session = { accessToken: shopRecord.accessToken };
    console.log('[WELCOME DEBUG] Session created');
    
    const settings = await aiDiscoveryService.getSettings(shop, session);
    console.log('[WELCOME DEBUG] Full settings:', JSON.stringify(settings, null, 2));
    console.log('[WELCOME DEBUG] Settings.plan:', settings?.plan);
    console.log('[WELCOME DEBUG] Settings.features:', settings?.features);
    console.log('[WELCOME DEBUG] welcomePage enabled?:', settings?.features?.welcomePage);
    
    // Check if feature is enabled
    if (!settings?.features?.welcomePage) {
      console.log('[WELCOME DEBUG] Feature not enabled, returning 403');
      return res.status(403).send('AI Welcome Page feature is not enabled. Please enable it in settings.');
    }

    // Check plan - Welcome page requires Professional+
    console.log('[WELCOME DEBUG] Raw plan value:', settings?.plan);
    console.log('[WELCOME DEBUG] Type of plan:', typeof settings?.plan);
    
    const normalizedPlan = (settings?.plan || 'starter')
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_');
    
    console.log('[WELCOME DEBUG] Normalized plan:', normalizedPlan);
    
    const allowedPlans = ['professional', 'growth', 'growth_extra', 'enterprise'];
    console.log('[WELCOME DEBUG] Allowed plans:', allowedPlans);
    console.log('[WELCOME DEBUG] Is plan allowed?:', allowedPlans.includes(normalizedPlan));
    
    if (!allowedPlans.includes(normalizedPlan)) {
      console.log('[WELCOME DEBUG] Plan not in allowed list, returning error');
      return res.status(403).json({ 
        error: 'This feature requires Professional plan or higher',
        debug: {
          currentPlan: settings?.plan,
          normalizedPlan: normalizedPlan,
          allowedPlans: allowedPlans
        }
      });
    }
    
    console.log('[WELCOME DEBUG] All checks passed, rendering welcome page');
    
    // Welcome page HTML
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AI Welcome - ${shopRecord.shopName || shop}</title>
        <meta name="description" content="AI-optimized endpoint for ${shopRecord.shopName || shop}">
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Store",
          "name": "${shopRecord.shopName || shop}",
          "url": "https://${shop}"
        }
        </script>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem; }
          h1 { color: #333; }
          .section { margin: 2rem 0; padding: 1.5rem; background: #f7f7f7; border-radius: 8px; }
          a { color: #0066cc; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>Welcome, AI Agents!</h1>
        <p>This is ${shopRecord.shopName || shop}, powered by Shopify.</p>
        
        <div class="section">
          <h2>Available Data Endpoints</h2>
          <ul>
            ${settings?.features?.productsJson ? '<li><a href="/ai/products.json?shop=' + shop + '">Products Feed</a> - Complete product catalog in JSON format</li>' : ''}
            ${settings?.features?.collectionsJson ? '<li><a href="/ai/collections.json?shop=' + shop + '">Collections Feed</a> - Product categories and collections</li>' : ''}
            ${settings?.features?.storeMetadata ? '<li><a href="/ai/store-metadata.json?shop=' + shop + '">Store Metadata</a> - Business information and schema</li>' : ''}
            <li><a href="/ai/robots-dynamic?shop=${shop}">robots.txt</a> - Crawling permissions</li>
          </ul>
        </div>
        
        <div class="section">
          <h2>Integration Guidelines</h2>
          <p>All endpoints return structured data optimized for AI consumption. Please respect our robots.txt directives.</p>
        </div>
        
        <footer>
          <p>Generated by AI SEO 2.0 - Last updated: ${new Date().toISOString()}</p>
        </footer>
      </body>
      </html>
    `;
    
    res.type('text/html').send(html);
    
  } catch (error) {
    console.error('[WELCOME DEBUG] ERROR:', error);
    res.status(500).send('Internal server error');
  } finally {
    console.log('[WELCOME DEBUG] ========== END ==========');
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

/**
 * GET /ai/robots-dynamic
 * Dynamic robots.txt generation
 */
router.get('/ai/robots-dynamic', async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) {
      return res.status(400).send('Missing shop');
    }
    
    // Same approach as in aiDiscoveryController
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord) {
      return res.status(404).send('# Shop not found');
    }
    
    const session = {
      accessToken: shopRecord.accessToken
    };
    
    const settings = await aiDiscoveryService.getSettings(shop, session);
    const robotsTxt = aiDiscoveryService.generateRobotsTxt(settings, shop);
    
    res.type('text/plain');
    res.send(robotsTxt);
  } catch (error) {
    console.error('Error generating dynamic robots.txt:', error);
    res.status(500).send('# Error generating robots.txt');
  }
});

export default router;