// backend/controllers/aiEndpointsController.js
import express from 'express';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import Product from '../db/Product.js';
import aiDiscoveryService from '../services/aiDiscoveryService.js';
import AdvancedSchema from '../db/AdvancedSchema.js';
import { getPlanConfig, resolvePlanKey } from '../plans.js';

const router = express.Router();

/**
 * Helper to get plan product limit for a shop
 */
async function getPlanProductLimit(shop) {
  try {
    const subscription = await Subscription.findOne({ shop });
    const planKey = resolvePlanKey(subscription?.plan) || 'starter';
    const planConfig = getPlanConfig(planKey);
    return planConfig?.productLimit || 70; // Default to starter limit
  } catch (error) {
    console.error('[AI-FEED] Error getting plan limit:', error);
    return 70; // Default to starter limit
  }
}


/**
 * Helper to check if feature is available
 */
async function checkFeatureAccess(shop, feature) {
  try {
    const Q = `
      query PlansMe($shop:String!) {
        plansMe(shop:$shop) {
          plan
        }
      }
    `;
    const planResponse = await fetch(`${process.env.APP_URL}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: Q, variables: { shop } }),
    });
    const res = await planResponse.json();
    if (res?.errors?.length) throw new Error(res.errors[0]?.message || 'GraphQL error');
    const planData = res?.data?.plansMe;
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
    
    // Allow AI Testing Bot to bypass feature check (for testing purposes)
    const userAgent = req.get('User-Agent') || '';
    const isTestingBot = userAgent.includes('AI-SEO-Testing-Bot');
    
    if (!isTestingBot && !settings?.features?.productsJson) {
      return res.status(403).json({ 
        error: 'Products JSON feature is not enabled. Please enable it in settings.' 
      });
    }

    // Fetch ALL products with pagination
    const allProducts = [];
    let cursor = null;
    let hasMore = true;
    
    while (hasMore && allProducts.length < 1000) { // Safety limit
    const query = `
        query($cursor: String) {
          products(first: 250, after: $cursor, query: "status:active") {
          edges {
            node {
              id
              title
              handle
              description
              productType
              vendor
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
              featuredImage {
                url
                altText
              }
              metafields(namespace: "seo_ai", first: 100) {
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

    const response = await fetch(
        `https://${shop}/admin/api/2025-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        },
          body: JSON.stringify({ query, variables: { cursor } })
      }
    );

    const data = await response.json();
      
      if (!data?.data?.products?.edges) {
        break;
      }
      
      allProducts.push(...data.data.products.edges);
      hasMore = data.data.products.pageInfo?.hasNextPage || false;
      cursor = data.data.products.edges[data.data.products.edges.length - 1]?.cursor;
    }

    const optimizedProducts = [];
    const totalProducts = allProducts.length;
    
    let productsWithMetafields = 0;
    
    // Извличаме само продуктите с metafields
    allProducts.forEach(({ node: product }) => {
      if (product.metafields.edges.length > 0) {
        productsWithMetafields++;
        
        // Първо парсваме всички metafields
        const parsedMetafields = {};
        product.metafields.edges.forEach(({ node: metafield }) => {
          try {
            parsedMetafields[metafield.key] = JSON.parse(metafield.value);
          } catch {
            parsedMetafields[metafield.key] = metafield.value;
          }
        });
        
        // Търсим AI-генериран imageAlt в някой от SEO metafields
        // Priority: AI-generated > Shopify altText > product title
        let aiImageAlt = null;
        for (const key of Object.keys(parsedMetafields)) {
          const seoData = parsedMetafields[key];
          if (seoData && typeof seoData === 'object' && seoData.imageAlt) {
            aiImageAlt = seoData.imageAlt;
            break; // Взимаме първия намерен
          }
        }
        
        const productData = {
          id: product.id,
          title: product.title,
          handle: product.handle,
          description: product.description || null,
          productType: product.productType || null,
          vendor: product.vendor || null,
          price: product.priceRangeV2?.minVariantPrice?.amount || null,
          currency: product.priceRangeV2?.minVariantPrice?.currencyCode || 'USD',
          url: `https://${shop}/products/${product.handle}`,
          image: product.featuredImage ? {
            url: product.featuredImage.url,
            // Priority: AI-generated imageAlt > Shopify altText > product title
            alt: aiImageAlt || product.featuredImage.altText || product.title
          } : null,
          metafields: parsedMetafields
        };
        
        optimizedProducts.push(productData);
      }
    });

    if (optimizedProducts.length === 0) {
      return res.json({
        shop,
        products: [],
        products_count: 0,
        products_total: totalProducts,
        warning: 'No optimized products found',
        action_required: {
          message: 'Please optimize your products first',
          link: `/ai-seo?shop=${shop}#products`
        }
      });
    }

    // Apply plan limit - only include up to the plan's product limit
    const planLimit = await getPlanProductLimit(shop);
    const limitedProducts = optimizedProducts.slice(0, planLimit);

    res.json({
      shop,
      generated_at: new Date().toISOString(),
      products_count: limitedProducts.length,
      products_total: totalProducts,
      plan_limit: planLimit,
      products: limitedProducts
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to generate products feed' });
  }
});

// Collections Feed endpoint - опростен
router.get('/ai/collections-feed.json', async (req, res) => {
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
    
    // Allow AI Testing Bot to bypass feature check (for testing purposes)
    const userAgent = req.get('User-Agent') || '';
    const isTestingBot = userAgent.includes('AI-SEO-Testing-Bot');
    
    if (!isTestingBot && !settings?.features?.collectionsJson) {
      return res.status(403).json({ 
        error: 'Collections JSON feature is not enabled. Please enable it in settings.' 
      });
    }

    // Check plan access (skip for AI Testing Bot)
    // NOTE: Collections JSON is static content - NO AI tokens required!
    if (!isTestingBot) {
      const planKey = (settings?.planKey || '').toLowerCase().replace(/\s+/g, '_');
      // All Plus and Growth plans have access (no tokens needed - it's static content)
      const plansWithAccess = ['professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'];
      
      if (!plansWithAccess.includes(planKey)) {
          return res.status(403).json({ 
          error: 'Collections JSON requires Professional Plus or Growth plan or higher',
          upgradeRequired: true,
          currentPlan: planKey
        });
      }
    }

    // Просто вземаме ВСИЧКИ metafields от namespace seo_ai за collections
    const query = `
      query {
        collections(first: 250) {
          edges {
            node {
              id
              title
              handle
              description
              image {
                url
                altText
              }
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
    const optimizedCollections = [];
    const totalCollections = data.data.collections.edges.length;
    
    // Извличаме само колекциите с metafields
    data.data.collections.edges.forEach(({ node: collection }) => {
      if (collection.metafields.edges.length > 0) {
        const collectionData = {
          id: collection.id,
          title: collection.title,
          handle: collection.handle,
          description: collection.description || null,
          image: collection.image ? {
            url: collection.image.url,
            alt: collection.image.altText || collection.title
          } : null,
          url: `https://${shop}/collections/${collection.handle}`,
          metafields: {}
        };
        
        // Просто парсваме всички metafields
        collection.metafields.edges.forEach(({ node: metafield }) => {
          try {
            collectionData.metafields[metafield.key] = JSON.parse(metafield.value);
          } catch {
            collectionData.metafields[metafield.key] = metafield.value;
          }
        });
        
        optimizedCollections.push(collectionData);
      }
    });

    if (optimizedCollections.length === 0) {
      return res.json({
        shop,
        collections: [],
        collections_total: totalCollections,
        warning: 'No optimized collections found',
        action_required: {
          message: 'Please optimize your collections first',
          link: `/ai-seo?shop=${shop}#collections`,
          link_text: 'Go to AI SEO Collections'
        }
      });
    }

    res.json({
      shop,
      generated_at: new Date().toISOString(),
      collections_count: optimizedCollections.length,
      collections_total: totalCollections,
      collections: optimizedCollections
    });

  } catch (error) {
    console.error('Error:', error);
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
    
    // Allow AI Testing Bot to bypass feature check (for testing purposes)
    const userAgent = req.get('User-Agent') || '';
    const isTestingBot = userAgent.includes('AI-SEO-Testing-Bot');
    
    // Check if feature is enabled
    if (!isTestingBot && !settings?.features?.welcomePage) {
      return res.status(403).send('AI Welcome Page feature is not enabled. Please enable it in settings.');
    }

    // Get planKey for both access check and HTML template
    const planKey = (settings?.planKey || 'starter').toLowerCase().replace(/\s+/g, '_');
    
    // Check plan access for AI Welcome Page (skip for AI Testing Bot)
    // NOTE: Welcome Page is a static HTML template - NO AI tokens required!
    if (!isTestingBot) {
      const subscription = await Subscription.findOne({ shop });
      // All Plus and Growth plans have access (no tokens needed - it's static HTML)
      const plansWithAccess = ['professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'];
      
      if (!plansWithAccess.includes(planKey)) {
          return res.status(403).json({ 
          error: 'AI Welcome Page requires Professional Plus or Growth plan or higher',
          upgradeRequired: true,
          currentPlan: planKey
        });
      }
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
        <a href="/ai/collections-feed.json?shop=${shop}" target="_blank">/ai/collections-feed.json?shop=${shop}</a>
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
        <li>Data freshness: Updated every ${planKey === 'enterprise' ? '2 hours' : planKey === 'growth_extra' ? '12 hours' : '24 hours'}</li>
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
      Generated by indexAIze - Unlock AI Search • Last updated: ${new Date().toISOString()} • 
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
    const { shop, productId, aiEnhanced } = req.body;
    
    // Update product's aiEnhanced flag in MongoDB if provided
    if (aiEnhanced !== undefined && productId) {
      await Product.findOneAndUpdate(
        { shop, productId },
        { 'seoStatus.aiEnhanced': aiEnhanced },
        { new: true }
      );
    }
    
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
    const robotsTxt = await aiDiscoveryService.generateRobotsTxt(shop);
    
    res.type('text/plain');
    res.send(robotsTxt);
  } catch (error) {
    console.error('Error generating dynamic robots.txt:', error);
    res.status(500).send('# Error generating robots.txt');
  }
});

// Advanced Schema Data endpoint - MOVED TO feedController.js

// Store Metadata endpoint
router.get('/ai/store-metadata.json', async (req, res) => {
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
    
    // Allow AI Testing Bot to bypass feature check (for testing purposes)
    const userAgent = req.get('User-Agent') || '';
    const isTestingBot = userAgent.includes('AI-SEO-Testing-Bot');
    
    // Check if feature is enabled
    if (!isTestingBot && !settings?.features?.storeMetadata) {
      return res.status(403).json({ 
        error: 'Store Metadata feature is not enabled. Please enable it in settings.' 
      });
    }

    // Check plan access (skip for AI Testing Bot)
    if (!isTestingBot) {
      const planKey = (settings?.planKey || '').toLowerCase().replace(/\s+/g, '_');
      const plansWithAccess = ['professional', 'professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'];
      
      // Store Metadata is included for Professional and above (no tokens required)
      if (!plansWithAccess.includes(planKey)) {
        return res.status(403).json({ 
          error: 'Store Metadata requires Professional plan or higher',
          upgradeRequired: true,
          currentPlan: planKey
        });
      }
    }

    // Use SAME query as GraphQL resolver (lines 829-845 in server.js)
    const shopQuery = `
      query {
        shop {
          name
          description
          email
          url
          seoMetafield: metafield(namespace: "ai_seo_store", key: "seo_metadata") {
            value
          }
          organizationMetafield: metafield(namespace: "ai_seo_store", key: "organization_schema") {
            value
          }
          aiMetafield: metafield(namespace: "ai_seo_store", key: "ai_metadata") {
            value
          }
        }
      }
    `;

    const response = await fetch(
      `https://${shop}/admin/api/2025-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: shopQuery })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch shop data');
    }

    const data = await response.json();
    const shopData = data.data.shop;
    
    // Parse metafields (same logic as GraphQL resolver)
    let seoMetadata = null;
    let aiMetadata = null;
    let organizationSchema = null;
    
    if (shopData.seoMetafield?.value) {
      try {
        seoMetadata = JSON.parse(shopData.seoMetafield.value);
      } catch (e) {
        console.error('[STORE-METADATA] Failed to parse seoMetadata');
      }
    }
    
    if (shopData.aiMetafield?.value) {
      try {
        aiMetadata = JSON.parse(shopData.aiMetafield.value);
      } catch (e) {
        console.error('[STORE-METADATA] Failed to parse aiMetadata');
      }
    }
    
    if (shopData.organizationMetafield?.value) {
      try {
        organizationSchema = JSON.parse(shopData.organizationMetafield.value);
      } catch (e) {
        console.error('[STORE-METADATA] Failed to parse organizationSchema');
      }
    }
    
    // Check if store metadata exists
    if (!seoMetadata && !organizationSchema && !aiMetadata) {
      return res.json({
        shop: shop,
        generated_at: new Date().toISOString(),
        metadata: null,
        warning: 'No store metadata found',
        action_required: {
          message: 'Please configure your store metadata first',
          link: `/ai-seo?shop=${shop}#store-metadata`,
          link_text: 'Go to Store Metadata'
        }
      });
    }
    
    // Build response
    const storeMetadata = {
      shop: shop,
      generated_at: new Date().toISOString(),
      store: {
        name: shopData.name,
        url: shopData.url,
        email: shopData.email
      }
    };
    
    // Add SEO metadata (with Shopify fallbacks)
    if (seoMetadata || shopData) {
      storeMetadata.seo = {
        title: seoMetadata?.storeName || shopData.name,
        shortDescription: seoMetadata?.shortDescription || null,
        fullDescription: seoMetadata?.fullDescription || shopData.description || null,
        keywords: seoMetadata?.keywords
      };
    }
    
    // Add AI metadata
    if (aiMetadata) {
      storeMetadata.ai_context = {
        business_type: aiMetadata.businessType,
        target_audience: aiMetadata.targetAudience,
        unique_selling_points: aiMetadata.uniqueSellingPoints,
        brand_voice: aiMetadata.brandVoice,
        categories: aiMetadata.primaryCategories,
        shipping: aiMetadata.shippingInfo,
        returns: aiMetadata.returnPolicy,
        languages: aiMetadata.languages,
        supported_currencies: aiMetadata.supportedCurrencies,
        shipping_regions: aiMetadata.shippingRegions,
        cultural_considerations: aiMetadata.culturalConsiderations
      };
    }
    
    // Add Organization Schema
    if (organizationSchema?.enabled) {
      storeMetadata.organization_schema = {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: organizationSchema.name || shopData.name,
        url: shopData.url,
        email: organizationSchema.email,
        telephone: organizationSchema.phone,
        logo: organizationSchema.logo,
        sameAs: organizationSchema.sameAs ? 
          organizationSchema.sameAs.split(',').map(s => s.trim()) : []
      };
    }
    
    res.json(storeMetadata);

  } catch (error) {
    console.error('Error in store-metadata.json:', error);
    res.status(500).json({ error: 'Failed to generate store metadata feed' });
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

// Advanced Schema Data endpoint (alias for /schema-data.json for consistency)
router.get('/ai/schema-data.json', async (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop required' });
  }
  
  try {
    // Check plan access: Enterprise/Growth Extra (included tokens) OR Plus plans (purchased tokens)
    const subscription = await Subscription.findOne({ shop });
    
    // Normalize plan name: "Professional Plus" → "professional_plus"
    const normalizePlan = (plan) => (plan || 'starter').toLowerCase().replace(/\s+/g, '_');
    const normalizedPlan = normalizePlan(subscription?.plan);
    
    // Plans with included tokens that have unlimited access
    const includedTokensPlans = ['enterprise', 'growth_extra'];
    
    // Plus plans that can access with purchased tokens
    const plusPlans = ['professional_plus', 'growth_plus', 'starter_plus'];
    
    // Check if plan has access
    const hasIncludedAccess = includedTokensPlans.includes(normalizedPlan);
    const isPlusPlan = plusPlans.includes(normalizedPlan);
    
    if (!hasIncludedAccess && !isPlusPlan) {
      return res.status(403).json({ 
        error: 'Advanced Schema Data requires Growth Extra, Enterprise, or Plus plans with tokens',
        current_plan: subscription?.plan || 'None',
        normalizedPlan
      });
    }
    
    // Fetch schema data from database
    const schemaData = await AdvancedSchema.findOne({ shop });
    
    if (!schemaData || !schemaData.schemas?.length) {
      return res.json({
        shop,
        generated_at: new Date(),
        schemas: [],
        warning: 'No advanced schema data found',
        action_required: {
          message: 'Please generate schema data first',
          link: `/ai-seo?shop=${shop}#schema-data`,
          link_text: 'Go to Schema Data'
        }
      });
    }
    
    res.json({
      shop,
      generated_at: schemaData.generatedAt,
      total_schemas: schemaData.schemas.length,
      schemas: schemaData.schemas,
      siteFAQ: schemaData.siteFAQ
    });
    
  } catch (error) {
    console.error('[AI-SCHEMA-DATA] Error:', error);
    res.status(500).json({ error: 'Failed to fetch schema data' });
  }
});

export default router;