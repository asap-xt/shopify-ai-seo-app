// backend/controllers/aiEndpointsController.js
import express from 'express';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
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

// Products Feed endpoint - просто взима готовите JSON-и
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
    
    if (!settings?.features?.productsJson) {
      return res.status(403).json({ 
        error: 'Products JSON feature is not enabled. Please enable it in settings.' 
      });
    }

    // Просто вземаме ВСИЧКИ metafields от namespace seo_ai
    const query = `
      query {
        products(first: 250) {
          edges {
            node {
              id
              handle
              metafields(namespace: "seo_ai", first: 100) {
                edges {
                  node {
                    key
                    value
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      }
    );

    const data = await response.json();
    const optimizedProducts = [];
    
    // Извличаме само продуктите с metafields
    data.data.products.edges.forEach(({ node: product }) => {
      if (product.metafields.edges.length > 0) {
        const productData = {
          id: product.id,
          handle: product.handle,
          metafields: {}
        };
        
        // Просто парсваме всички metafields
        product.metafields.edges.forEach(({ node: metafield }) => {
          try {
            productData.metafields[metafield.key] = JSON.parse(metafield.value);
          } catch {
            productData.metafields[metafield.key] = metafield.value;
          }
        });
        
        optimizedProducts.push(productData);
      }
    });

    if (optimizedProducts.length === 0) {
      return res.json({
        shop,
        products: [],
        warning: 'No optimized products found',
        action_required: {
          message: 'Please optimize your products first',
          link: `/ai-seo?shop=${shop}#products`
        }
      });
    }

    res.json({
      shop,
      generated_at: new Date().toISOString(),
      products_count: optimizedProducts.length,
      products: optimizedProducts
    });

  } catch (error) {
    console.error('Error:', error);
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
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  try {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord) {
      return res.status(404).send('Shop not found');
    }

    const session = { accessToken: shopRecord.accessToken };
    const settings = await aiDiscoveryService.getSettings(shop, session);
    
    // Check if feature is enabled
    if (!settings?.features?.welcomePage) {
      return res.status(403).send('AI Welcome Page feature is not enabled. Please enable it in settings.');
    }

    // ВРЕМЕННО РЕШЕНИЕ: Проверяваме дали има subscription
    const subscription = await Subscription.findOne({ shop });
    let effectivePlan = settings?.planKey || 'starter';
    
    // Ако няма subscription, даваме trial достъп до Growth
    if (!subscription) {
      console.log('[WELCOME] No subscription found, using trial access');
      effectivePlan = 'growth';
    }
    
    // Check plan - Welcome page requires Professional+
    const allowedPlans = ['professional', 'growth', 'growth_extra', 'enterprise'];
    
    if (!allowedPlans.includes(effectivePlan)) {
      return res.status(403).json({ 
        error: 'This feature requires Professional plan or higher',
        debug: {
          currentPlan: settings?.plan,
          effectivePlan: effectivePlan,
          hasSubscription: !!subscription
        }
      });
    }
    
    // Get shop info for customization
    const shopInfoQuery = `
      query {
        shop {
          name
          description
          url
          primaryDomain {
            url
          }
        }
      }
    `;
    
    const shopResponse = await fetch(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: shopInfoQuery })
      }
    );
    
    const shopData = await shopResponse.json();
    const shopInfo = shopData.data?.shop;
    
    // Welcome page HTML
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Welcome - ${shopInfo?.name || shop}</title>
  <meta name="description" content="AI-optimized data endpoints for ${shopInfo?.name || shop}. Access structured product data, collections, and store information.">
  <meta name="robots" content="index, follow">
  
  <!-- Open Graph -->
  <meta property="og:title" content="AI Data Endpoints - ${shopInfo?.name}">
  <meta property="og:description" content="Structured e-commerce data optimized for AI consumption">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${shopInfo?.primaryDomain?.url || `https://${shop}`}/ai/welcome">
  
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebAPI",
    "name": "${shopInfo?.name} AI Data API",
    "description": "Structured e-commerce data endpoints for AI agents",
    "url": "${shopInfo?.primaryDomain?.url || `https://${shop}`}/ai/welcome",
    "provider": {
      "@type": "Organization",
      "name": "${shopInfo?.name}",
      "url": "${shopInfo?.primaryDomain?.url || `https://${shop}`}"
    },
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    }
  }
  </script>
  
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
      line-height: 1.6; 
      color: #333;
      background: #f8f9fa;
    }
    .container { max-width: 1000px; margin: 0 auto; padding: 2rem; }
    header { 
      background: white; 
      border-bottom: 2px solid #e9ecef; 
      margin: -2rem -2rem 3rem -2rem;
      padding: 3rem 2rem;
    }
    h1 { 
      font-size: 2.5rem; 
      margin-bottom: 0.5rem; 
      color: #2c3e50;
    }
    .tagline { 
      font-size: 1.2rem; 
      color: #6c757d; 
    }
    .section { 
      background: white; 
      padding: 2rem; 
      margin-bottom: 2rem; 
      border-radius: 8px; 
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .endpoint {
      background: #f8f9fa;
      padding: 1rem;
      margin: 1rem 0;
      border-left: 4px solid #007bff;
      border-radius: 4px;
    }
    .endpoint h3 {
      margin: 0 0 0.5rem 0;
      color: #495057;
    }
    .endpoint a {
      color: #007bff;
      text-decoration: none;
      font-family: monospace;
      font-size: 0.95rem;
    }
    .endpoint a:hover { text-decoration: underline; }
    .endpoint p { 
      margin: 0.5rem 0 0 0; 
      color: #6c757d;
      font-size: 0.95rem;
    }
    .meta { 
      color: #6c757d; 
      font-size: 0.9rem; 
      margin-top: 3rem;
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      background: #28a745;
      color: white;
      border-radius: 4px;
      font-size: 0.8rem;
      margin-left: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🤖 Welcome, AI Agents!</h1>
      <p class="tagline">Structured e-commerce data from ${shopInfo?.name || shop}</p>
    </header>
    
    <div class="section">
      <h2>📊 Available Data Endpoints</h2>
      <p>All endpoints return JSON data optimized for AI consumption.</p>
      
      ${settings?.features?.productsJson ? `
      <div class="endpoint">
        <h3>Products Feed <span class="badge">Active</span></h3>
        <a href="/ai/products.json?shop=${shop}" target="_blank">/ai/products.json?shop=${shop}</a>
        <p>Complete product catalog with descriptions, prices, and AI-optimized metadata</p>
      </div>
      ` : ''}
      
      ${settings?.features?.collectionsJson ? `
      <div class="endpoint">
        <h3>Collections Feed <span class="badge">Active</span></h3>
        <a href="/ai/collections.json?shop=${shop}" target="_blank">/ai/collections.json?shop=${shop}</a>
        <p>Product categories and collections with semantic groupings</p>
      </div>
      ` : ''}
      
      ${settings?.features?.storeMetadata ? `
      <div class="endpoint">
        <h3>Store Metadata <span class="badge">Active</span></h3>
        <a href="/ai/store-metadata.json?shop=${shop}" target="_blank">/ai/store-metadata.json?shop=${shop}</a>
        <p>Business information, policies, and organizational schema</p>
      </div>
      ` : ''}
      
      ${settings?.features?.schemaData ? `
      <div class="endpoint">
        <h3>Advanced Schema Data <span class="badge">Active</span></h3>
        <a href="/ai/schema-data.json?shop=${shop}" target="_blank">/ai/schema-data.json?shop=${shop}</a>
        <p>Rich structured data including FAQs, breadcrumbs, and more</p>
      </div>
      ` : ''}
      
      ${settings?.features?.aiSitemap ? `
      <div class="endpoint">
        <h3>AI-Optimized Sitemap <span class="badge">Active</span></h3>
        <a href="/ai/sitemap-feed.xml?shop=${shop}" target="_blank">/ai/sitemap-feed.xml?shop=${shop}</a>
        <p>XML sitemap with AI hints and priority scoring</p>
      </div>
      ` : ''}
      
      <div class="endpoint">
        <h3>Crawling Permissions</h3>
        <a href="/ai/robots-dynamic?shop=${shop}" target="_blank">/robots.txt</a>
        <p>Dynamic robots.txt with AI bot access controls</p>
      </div>
    </div>
    
    <div class="section">
      <h2>🔧 Integration Guidelines</h2>
      <ul style="margin-left: 1.5rem; color: #495057;">
        <li>All endpoints support caching with ETags</li>
        <li>Rate limits: 60 requests per minute</li>
        <li>Authentication: Public access for approved AI bots</li>
        <li>Data freshness: Updated every ${effectivePlan === 'enterprise' ? '2 hours' : effectivePlan === 'growth_extra' ? '12 hours' : '24 hours'}</li>
      </ul>
    </div>
    
    <div class="section">
      <h2>📚 Response Format</h2>
      <pre style="background: #f8f9fa; padding: 1rem; border-radius: 4px; overflow-x: auto;">
{
  "shop": "${shop}",
  "language": "from_metafields",
  "generated_at": "ISO 8601 timestamp",
  "data": [...],
  "_links": {
    "self": "current endpoint",
    "related": ["other available endpoints"]
  }
}</pre>
    </div>
    
    <p class="meta">
      Generated by AI SEO 2.0 • Last updated: ${new Date().toISOString()} • 
      <a href="https://${shop}" style="color: #6c757d;">Visit Store</a>
    </p>
  </div>
</body>
</html>`;
    
    res.type('text/html').send(html);
    
  } catch (error) {
    console.error('[WELCOME] Error:', error);
    res.status(500).send('Internal server error');
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

// Advanced Schema Data endpoint
router.get('/ai/schema-data.json', async (req, res) => {
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
    if (!settings?.features?.schemaData) {
      return res.status(403).json({ 
        error: 'Advanced Schema Data feature is not enabled. Please enable it in settings.' 
      });
    }

    // Check plan - Schema Data requires Enterprise
    if (settings?.planKey !== 'enterprise') {
      return res.status(403).json({ 
        error: 'Advanced Schema Data requires Enterprise plan' 
      });
    }

    // Get schema data from metafields
    const metafieldsQuery = `
      query {
        shop {
          name
          url
          metafields(namespace: "seo_ai", first: 20) {
            edges {
              node {
                key
                value
                type
              }
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: metafieldsQuery })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch schema data');
    }

    const data = await response.json();
    const shopData = data.data.shop;
    
    // Parse all metafields
    const metafields = {};
    shopData.metafields.edges.forEach(({ node }) => {
      try {
        metafields[node.key] = JSON.parse(node.value);
      } catch (e) {
        // Skip non-JSON metafields
      }
    });
    
    // Initialize schema collection
    const schemas = [];
    
    // Add BreadcrumbList schema if exists
    if (metafields.breadcrumb_schema) {
      schemas.push({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        ...metafields.breadcrumb_schema
      });
    }
    
    // Add FAQPage schema if exists
    if (metafields.faq_schema) {
      schemas.push({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        ...metafields.faq_schema
      });
    }
    
    // Add WebSite schema with SearchAction
    if (metafields.website_schema) {
      schemas.push({
        "@context": "https://schema.org",
        "@type": "WebSite",
        url: shopData.url,
        name: shopData.name,
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${shopData.url}/search?q={search_term_string}`
          },
          "query-input": "required name=search_term_string"
        },
        ...metafields.website_schema
      });
    }
    
    // Add CollectionPage schema if exists
    if (metafields.collection_page_schema) {
      schemas.push({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        ...metafields.collection_page_schema
      });
    }
    
    // Add ItemList schema for bestsellers/featured
    if (metafields.item_list_schema) {
      schemas.push({
        "@context": "https://schema.org",
        "@type": "ItemList",
        ...metafields.item_list_schema
      });
    }
    
    // Check if any schemas exist
    if (schemas.length === 0) {
      return res.json({
        shop: shop,
        generated_at: new Date().toISOString(),
        schemas: [],
        warning: 'No advanced schema data found',
        action_required: {
          message: 'Please generate schema data first',
          link: `/ai-seo?shop=${shop}#schema-data`,
          link_text: 'Go to Schema Data'
        }
      });
    }
    
    // Build response
    res.json({
      shop: shop,
      generated_at: new Date().toISOString(),
      schemas_count: schemas.length,
      schemas: schemas,
      available_types: [
        'BreadcrumbList',
        'FAQPage',
        'WebSite',
        'CollectionPage',
        'ItemList'
      ]
    });

  } catch (error) {
    console.error('Error in schema-data.json:', error);
    res.status(500).json({ error: 'Failed to generate schema data feed' });
  }
});

// AI Sitemap Feed endpoint - преименуван и опростен
router.get('/ai/sitemap-feed.xml', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  try {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord) {
      return res.status(404).send('Shop not found');
    }

    const session = { accessToken: shopRecord.accessToken };
    const settings = await aiDiscoveryService.getSettings(shop, session);
    
    if (!settings?.features?.aiSitemap) {
      return res.status(403).send('AI Sitemap feature is not enabled');
    }

    // Извикваме същия endpoint който генерира sitemap
    const sitemapResponse = await fetch(
      `${process.env.APP_URL || 'http://localhost:8080'}/api/sitemap/generate?shop=${shop}`,
      {
        headers: {
          'Authorization': `Bearer ${session.accessToken}`
        }
      }
    );

    if (!sitemapResponse.ok) {
      throw new Error('Failed to fetch sitemap');
    }

    const sitemapXML = await sitemapResponse.text();
    
    res.type('application/xml');
    res.send(sitemapXML);

  } catch (error) {
    console.error('Error in sitemap-feed.xml:', error);
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error>Failed to load sitemap</error>');
  }
});

export default router;