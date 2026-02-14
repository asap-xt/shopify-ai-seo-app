// backend/controllers/aiEndpointsController.js
import express from 'express';
import fetch from 'node-fetch';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import Product from '../db/Product.js';
import Collection from '../db/Collection.js';
import aiDiscoveryService from '../services/aiDiscoveryService.js';
import AdvancedSchema from '../db/AdvancedSchema.js';
import { getPlanConfig, resolvePlanKey } from '../plans.js';
import { getGeminiResponse } from '../ai/gemini.js';

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
      `https://${shop}/admin/api/2025-07/graphql.json`,
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

// AI Welcome page (direct access version - mirrors App Proxy version)
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
    
    // Allow AI Testing Bot to bypass feature check
    const userAgent = req.get('User-Agent') || '';
    const isTestingBot = userAgent.includes('AI-SEO-Testing-Bot');
    
    if (!isTestingBot && !settings?.features?.welcomePage) {
      return res.status(403).send('AI Welcome Page feature is not enabled.');
    }

    const planKey = (settings?.planKey || 'starter').toLowerCase().replace(/\s+/g, '_');
    
    if (!isTestingBot) {
      const plansWithAccess = ['professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'];
      if (!plansWithAccess.includes(planKey)) {
        return res.status(403).json({ error: 'Requires Professional Plus or Growth plan or higher' });
      }
    }
    
    const shopInfoResponse = await fetch(
      `https://${shop}/admin/api/2025-07/graphql.json`,
      {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': shopRecord.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `{ shop { name description primaryDomain { url } } }` })
      }
    );
    const shopData = await shopInfoResponse.json();
    const shopInfo = shopData.data?.shop;
    const shopName = shopInfo?.name || shop.replace('.myshopify.com', '');
    const primaryDomain = shopInfo?.primaryDomain?.url || `https://${shop}`;
    const APP_PROXY_SUBPATH = process.env.APP_PROXY_SUBPATH || 'indexaize';
    const baseUrl = `${primaryDomain}/apps/${APP_PROXY_SUBPATH}`;

    // Build endpoints
    const endpoints = [];
    if (settings?.features?.productsJson) endpoints.push({ name: 'Products JSON Feed', path: `/ai/products.json`, desc: 'Complete product catalog with AI-optimized metadata', format: 'JSON' });
    if (settings?.features?.collectionsJson) endpoints.push({ name: 'Collections Feed', path: `/ai/collections-feed.json`, desc: 'Product categories and collections', format: 'JSON' });
    if (settings?.features?.storeMetadata) endpoints.push({ name: 'Store Metadata', path: `/ai/store-metadata.json`, desc: 'Organization schema and business info', format: 'JSON' });
    if (settings?.features?.schemaData) endpoints.push({ name: 'Schema Data', path: `/ai/schema-data.json`, desc: 'Rich structured data: BreadcrumbList, FAQPage, Product schemas', format: 'JSON' });
    if (settings?.features?.aiSitemap) endpoints.push({ name: 'AI Sitemap', path: `/ai/sitemap-feed.xml`, desc: 'Enhanced XML sitemap with AI hints', format: 'XML' });
    if (settings?.features?.llmsTxt) {
      endpoints.push({ name: 'LLMs.txt', path: `/llms.txt`, desc: 'AI discovery file (llmstxt.org standard)', format: 'Markdown' });
      endpoints.push({ name: 'LLMs-full.txt', path: `/llms-full.txt`, desc: 'Extended version with API docs', format: 'Markdown' });
    }
    if (settings?.features?.aiAsk) endpoints.push({ name: 'AI Ask', path: `/ai/ask`, desc: 'Interactive: ask questions about this store', format: 'JSON', method: 'POST' });

    // Accept header detection
    const acceptHeader = req.get('Accept') || '';
    if (acceptHeader.includes('text/markdown') || acceptHeader.includes('text/plain')) {
      let md = `# ${shopName} - AI Data Endpoints\n\n`;
      md += `> ${shopInfo?.description || `AI-optimized e-commerce data from ${shopName}`}\n\n`;
      md += `## Available Endpoints\n\n`;
      endpoints.forEach(ep => {
        md += `- [${ep.name}](${baseUrl}${ep.path}): ${ep.desc} (${ep.format}${ep.method ? ', ' + ep.method : ''})\n`;
      });
      md += `\n---\nlast-updated: ${new Date().toISOString().split('T')[0]}\ngenerator: indexAIze\n`;
      return res.set('Content-Type', 'text/markdown; charset=utf-8').send(md);
    }

    // HTML response
    const endpointsHtml = endpoints.map(ep => `
      <div class="endpoint">
        <h3>${ep.name} <span class="badge">${ep.format}</span>${ep.method ? `<span class="badge method">${ep.method}</span>` : ''}</h3>
        <code style="color:#4361ee;font-size:0.85rem;">${baseUrl}${ep.path}</code>
        <p>${ep.desc}</p>
      </div>`).join('');

    const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Data API - ${shopName}</title>
<meta name="robots" content="index, follow">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#1a1a2e;background:#f0f2f5}.container{max-width:960px;margin:0 auto;padding:2rem}header{background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;margin:-2rem -2rem 2rem;padding:3rem 2rem}h1{font-size:2rem;margin-bottom:.25rem}.tagline{color:rgba(255,255,255,.8)}.section{background:#fff;padding:1.5rem;margin-bottom:1.5rem;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}.section h2{font-size:1.3rem;margin-bottom:1rem}.endpoint{background:#f8f9fc;padding:1rem;margin:.75rem 0;border-left:3px solid #4361ee;border-radius:6px}.endpoint h3{margin:0 0 .3rem;font-size:1rem}.endpoint p{margin:.25rem 0 0;color:#666;font-size:.9rem}.badge{display:inline-block;padding:.15rem .4rem;background:#4361ee;color:#fff;border-radius:3px;font-size:.7rem;margin-left:.5rem}.badge.method{background:#e63946}.meta{color:#999;font-size:.85rem;margin-top:2rem;text-align:center}</style>
</head><body><div class="container">
<header><h1>${shopName} - AI Data API</h1><p class="tagline">Structured e-commerce data for AI agents</p></header>
<div class="section"><h2>Available Endpoints</h2>${endpointsHtml}</div>
<div class="section"><h2>Integration</h2><ul style="margin-left:1.5rem;color:#555"><li>Public access, no auth required</li><li>Rate limits: 60 req/min, 10 req/min for /ai/ask</li><li>ETags and Cache-Control headers supported</li><li>Accept: text/markdown returns machine-readable format</li></ul></div>
<p class="meta">Powered by indexAIze &mdash; ${new Date().toISOString().split('T')[0]}</p>
</div></body></html>`;

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

// ============================================================
// LLMs.txt endpoint - AI Discovery standard (llmstxt.org)
// Accessible via: /llms.txt?shop=xxx (direct) 
// ============================================================
router.get('/llms.txt', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).type('text/plain').send('Missing shop parameter');
  }

  try {
    const llmsTxt = await aiDiscoveryService.generateLlmsTxt(shop);
    
    if (!llmsTxt) {
      return res.status(404).type('text/plain').send('# LLMs.txt is not enabled for this store.\n# Enable it in indexAIze Settings > AI Discovery Features.\n');
    }

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=7200');
    res.set('X-Robots-Tag', 'noindex');
    res.send(llmsTxt);
  } catch (error) {
    console.error('[AI-ENDPOINTS] LLMs.txt error:', error);
    res.status(500).type('text/plain').send('# Error generating llms.txt\n');
  }
});

// ============================================================
// LLMs-full.txt endpoint - Extended version with API docs
// Accessible via: /llms-full.txt?shop=xxx (direct)
// ============================================================
router.get('/llms-full.txt', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).type('text/plain').send('Missing shop parameter');
  }

  try {
    const llmsFullTxt = await aiDiscoveryService.generateLlmsFullTxt(shop);
    
    if (!llmsFullTxt) {
      return res.status(404).type('text/plain').send('# LLMs.txt is not enabled for this store.\n');
    }

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=7200');
    res.set('X-Robots-Tag', 'noindex');
    res.send(llmsFullTxt);
  } catch (error) {
    console.error('[AI-ENDPOINTS] LLMs-full.txt error:', error);
    res.status(500).type('text/plain').send('# Error generating llms-full.txt\n');
  }
});

// ============================================================
// AI Plugin JSON manifest for AI agent discovery
// Accessible via: /.well-known/ai-plugin.json?shop=xxx
// ============================================================
router.get('/.well-known/ai-plugin.json', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord?.accessToken) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Get shop info
    const shopInfoResponse = await fetch(
      `https://${shop}/admin/api/2025-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `{ shop { name description primaryDomain { url } } }`
        })
      }
    );
    const shopData = await shopInfoResponse.json();
    const shopInfo = shopData.data?.shop;

    const manifest = aiDiscoveryService.generateAiPluginJson(
      shop,
      shopInfo?.name || shop.replace('.myshopify.com', ''),
      shopInfo?.description || '',
      shopInfo?.primaryDomain?.url || `https://${shop}`
    );

    res.set('Content-Type', 'application/json');
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(manifest);
  } catch (error) {
    console.error('[AI-ENDPOINTS] ai-plugin.json error:', error);
    res.status(500).json({ error: 'Failed to generate AI plugin manifest' });
  }
});

// ============================================================
// AI Ask endpoint - AI agents can query the store
// Rate limited: 10 req/min per shop
// ============================================================
const askRateLimit = new Map(); // shop -> { count, resetAt }
const askCache = new Map(); // shop:questionHash -> { answer, expiresAt }

function checkAskRateLimit(shop) {
  const now = Date.now();
  const limit = askRateLimit.get(shop);
  
  if (!limit || now > limit.resetAt) {
    askRateLimit.set(shop, { count: 1, resetAt: now + 60000 }); // 1 minute window
    return true;
  }
  
  if (limit.count >= 10) return false;
  limit.count++;
  return true;
}

function hashQuestion(q) {
  // Simple hash for caching
  let hash = 0;
  for (let i = 0; i < q.length; i++) {
    const chr = q.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
}

router.post('/ai/ask', async (req, res) => {
  const shop = req.query.shop || req.body.shop;
  const question = req.body.question;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }
  if (!question || typeof question !== 'string' || question.trim().length < 3) {
    return res.status(400).json({ error: 'Missing or invalid question (min 3 characters)' });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: 'Question too long (max 500 characters)' });
  }

  // Rate limit check
  if (!checkAskRateLimit(shop)) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded. Max 10 requests per minute.',
      retryAfter: 60
    });
  }

  // Check cache
  const cacheKey = `${shop}:${hashQuestion(question.trim().toLowerCase())}`;
  const cached = askCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord?.accessToken) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Check if aiAsk feature is enabled
    const session = { accessToken: shopRecord.accessToken };
    const settings = await aiDiscoveryService.getSettings(shop, session);
    
    if (!settings?.features?.aiAsk) {
      return res.status(403).json({ error: 'AI Ask feature is not enabled for this store.' });
    }

    // Build context from store data
    let storeContext = '';
    const sources = [];

    // 1. Get products (top 50 from MongoDB cache)
    const products = await Product.find({ shop })
      .select('title description price currency tags handle available productType vendor')
      .limit(50)
      .lean();

    if (products.length > 0) {
      storeContext += `PRODUCTS (${products.length} items):\n`;
      products.forEach(p => {
        storeContext += `- ${p.title}`;
        if (p.price) storeContext += ` | ${p.currency || ''}${p.price}`;
        if (p.available === false) storeContext += ' [OUT OF STOCK]';
        if (p.description) storeContext += ` | ${p.description.substring(0, 150)}`;
        storeContext += '\n';
      });
      storeContext += '\n';
    }

    // 2. Get collections
    const collections = await Collection.find({ shop })
      .select('title description handle')
      .limit(20)
      .lean();

    if (collections.length > 0) {
      storeContext += `COLLECTIONS:\n`;
      collections.forEach(c => {
        storeContext += `- ${c.title}`;
        if (c.description) storeContext += `: ${c.description.substring(0, 100)}`;
        storeContext += '\n';
      });
      storeContext += '\n';
    }

    // 3. Get shop info + AI context metafields
    try {
      const shopInfoResponse = await fetch(
        `https://${shop}/admin/api/2025-07/graphql.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopRecord.accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: `{
              shop {
                name
                description
                email
                url
                primaryDomain { url }
                aiContextMetafield: metafield(namespace: "ai_seo_store", key: "ai_metadata") { value }
                seoMetafield: metafield(namespace: "ai_seo_store", key: "seo_metadata") { value }
              }
            }`
          })
        }
      );
      const shopData = await shopInfoResponse.json();
      const shopInfo = shopData.data?.shop;

      if (shopInfo) {
        storeContext += `STORE INFO:\n`;
        storeContext += `- Name: ${shopInfo.name}\n`;
        if (shopInfo.description) storeContext += `- Description: ${shopInfo.description}\n`;
        if (shopInfo.email) storeContext += `- Contact: ${shopInfo.email}\n`;
        storeContext += `- URL: ${shopInfo.primaryDomain?.url || shopInfo.url || `https://${shop}`}\n`;

        // Parse AI context metadata (has detailed returns, shipping, etc.)
        let aiContext = null;
        try {
          if (shopInfo.aiContextMetafield?.value) {
            aiContext = JSON.parse(shopInfo.aiContextMetafield.value);
          }
        } catch (e) { /* ignore parse errors */ }

        // Parse SEO metadata
        let seoMeta = null;
        try {
          if (shopInfo.seoMetafield?.value) {
            seoMeta = JSON.parse(shopInfo.seoMetafield.value);
          }
        } catch (e) { /* ignore parse errors */ }

        if (seoMeta?.shortDescription) {
          storeContext += `- About: ${seoMeta.shortDescription}\n`;
        }

        // Add AI context data (rich business info from ai_metadata metafield)
        if (aiContext) {
          if (aiContext.businessType) storeContext += `- Business: ${aiContext.businessType}\n`;
          if (aiContext.uniqueSellingPoints) storeContext += `- Unique Selling Points: ${aiContext.uniqueSellingPoints.substring(0, 500)}\n`;
          if (aiContext.primaryCategories) storeContext += `- Categories: ${aiContext.primaryCategories}\n`;
          
          if (aiContext.shippingInfo) {
            storeContext += `\nSHIPPING POLICY:\n${aiContext.shippingInfo.substring(0, 800)}\n`;
          }
          if (aiContext.returnPolicy) {
            storeContext += `\nRETURN / REFUND POLICY:\n${aiContext.returnPolicy.substring(0, 800)}\n`;
          }
        }
        storeContext += '\n';
      }
    } catch (e) {
      console.error('[AI-ASK] Failed to fetch shop info:', e.message);
    }

    // 4. Try to get Shopify legal policies (separate query, older API version where these fields exist)
    try {
      const policyResponse = await fetch(
        `https://${shop}/admin/api/2024-01/graphql.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopRecord.accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: `{
              shop {
                shippingPolicy { title body }
                refundPolicy { title body }
                privacyPolicy { title body }
                termsOfService { title body }
              }
            }`
          })
        }
      );
      const policyData = await policyResponse.json();
      const policyShop = policyData.data?.shop;
      
      if (policyShop) {
        const policies = [
          policyShop.shippingPolicy,
          policyShop.refundPolicy,
          policyShop.privacyPolicy,
          policyShop.termsOfService
        ].filter(p => p?.body);

        if (policies.length > 0) {
          storeContext += 'OFFICIAL LEGAL POLICIES:\n';
          policies.forEach(p => {
            const cleanBody = p.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            storeContext += `- ${p.title}: ${cleanBody.substring(0, 800)}\n`;
          });
          storeContext += '\n';
        }
      }
    } catch (e) {
      // Policies are optional, AI context metafields cover this
      console.log('[AI-ASK] Legal policies not available:', e.message);
    }

    // Call Gemini Flash Lite for cost-effective response
    const prompt = `You are a helpful shopping assistant for an online store. Answer the customer's question based ONLY on the store data provided below. Be concise, accurate, and helpful.

If the question is about a specific product, include the product name and price in your answer.
If you cannot find relevant information in the store data, say so honestly.
Do NOT make up information that is not in the store data.
Keep your answer under 200 words.

STORE DATA:
${storeContext}

CUSTOMER QUESTION: ${question}

Respond in JSON format:
{
  "answer": "Your helpful answer here",
  "relevant_products": [{"title": "Product Name", "price": "29.99", "handle": "product-handle"}],
  "confidence": 0.0-1.0
}`;

    const aiResult = await getGeminiResponse(prompt, {
      maxTokens: 800,
      temperature: 0.3,
      priority: 'high'
    });

    let parsedResponse;
    try {
      let rawContent = typeof aiResult.content === 'string' ? aiResult.content : JSON.stringify(aiResult.content);
      // Strip markdown code fences (```json ... ``` or ``` ... ```) that Gemini sometimes wraps responses in
      rawContent = rawContent.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      parsedResponse = JSON.parse(rawContent);
    } catch (e) {
      parsedResponse = {
        answer: typeof aiResult.content === 'string' ? aiResult.content : 'I could not process your question. Please try rephrasing.',
        relevant_products: [],
        confidence: 0.5
      };
    }

    // Build sources from relevant products
    const shopUrl = `https://${shop.replace('.myshopify.com', '')}.myshopify.com`;
    if (parsedResponse.relevant_products?.length > 0) {
      parsedResponse.relevant_products.forEach(p => {
        if (p.handle) {
          sources.push({
            type: 'product',
            title: p.title,
            price: p.price,
            url: `${shopUrl}/products/${p.handle}`
          });
        }
      });
    }

    const responseData = {
      answer: parsedResponse.answer,
      sources,
      confidence: parsedResponse.confidence || 0.7,
      store: shop,
      timestamp: new Date().toISOString()
    };

    // Cache for 5 minutes
    askCache.set(cacheKey, {
      data: responseData,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    // Clean old cache entries periodically
    if (askCache.size > 1000) {
      const now = Date.now();
      for (const [key, val] of askCache) {
        if (now > val.expiresAt) askCache.delete(key);
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('[AI-ASK] Error:', error);
    res.status(500).json({ error: 'Failed to process question. Please try again.' });
  }
});

// Also support GET for simple queries (convenience for AI agents)
router.get('/ai/ask', async (req, res) => {
  const question = req.query.q || req.query.question;
  if (!question) {
    return res.json({ 
      endpoint: '/ai/ask',
      methods: ['POST', 'GET'],
      usage: {
        POST: 'POST /ai/ask?shop=xxx with JSON body {"question":"your question here"}',
        GET: 'GET /ai/ask?shop=xxx&q=your+question+here'
      },
      description: 'Ask questions about this store\'s products, policies, and availability. Returns structured answers with source references.'
    });
  }
  // Simulate POST by setting body
  req.body = { question, shop: req.query.shop };
  // Re-use the POST handler logic inline
  const shop = req.query.shop;
  if (!shop) return res.status(400).json({ error: 'Missing shop parameter' });

  if (!checkAskRateLimit(shop)) {
    return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter: 60 });
  }

  const cacheKey = `${shop}:${hashQuestion(question.trim().toLowerCase())}`;
  const cached = askCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return res.json({ ...cached.data, cached: true });
  }

  // For GET requests, redirect logic to POST handler by calling it
  try {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord?.accessToken) return res.status(404).json({ error: 'Shop not found' });

    const session = { accessToken: shopRecord.accessToken };
    const settings = await aiDiscoveryService.getSettings(shop, session);
    if (!settings?.features?.aiAsk) return res.status(403).json({ error: 'AI Ask feature is not enabled.' });

    // Simple redirect - tell the agent to use POST
    return res.json({
      hint: 'For full AI Ask functionality, use POST method. GET with ?q= parameter provides basic responses.',
      question,
      answer: 'Please use POST /ai/ask with JSON body for best results.',
      usage: 'POST /ai/ask?shop=' + shop + ' with body: {"question":"' + question + '"}'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Internal error' });
  }
});

export default router;