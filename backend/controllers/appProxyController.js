// backend/controllers/appProxyController.js
// App Proxy Controller for Sitemap

import express from 'express';
import fetch from 'node-fetch';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import Sitemap from '../db/Sitemap.js';
import { resolveShopToken } from '../utils/tokenResolver.js';
import { appProxyAuth } from '../utils/appProxyValidator.js';
import aiDiscoveryService from '../services/aiDiscoveryService.js';

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

// Helper: get access token using centralized resolver
async function resolveAdminTokenForShop(shop) {
  try {
    const token = await resolveShopToken(shop);
    return token;
  } catch (err) {
    console.error('[APP_PROXY] Token resolution failed:', err.message);
    const error = new Error(`No access token found for shop: ${shop} - ${err.message}`);
    error.status = 400;
    throw error;
  }
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
    console.error('[APP_PROXY] GraphQL errors:', json.errors || json);
    const e = new Error('Admin GraphQL error: ' + JSON.stringify(json.errors || json));
    e.status = rsp.status || 500;
    throw e;
  }
  
  return json.data;
}

// Helper: Check which languages have SEO optimization for a product
async function checkProductSEOLanguages(shop, productId) {
  try {
    const query = `
      query GetProductSEOLanguages($id: ID!) {
        product(id: $id) {
          metafields(namespace: "seo_ai", first: 20) {
            edges {
              node {
                key
                value
              }
            }
          }
        }
      }
    `;
    
    const data = await shopGraphQL(shop, query, { id: productId });
    const metafields = data?.product?.metafields?.edges || [];
    
    // Extract languages from metafield keys (seo__en, seo__bg, seo__fr, etc.)
    const languages = metafields
      .map(edge => edge.node.key)
      .filter(key => key.startsWith('seo__'))
      .map(key => key.replace('seo__', ''))
      .filter(lang => lang.length > 0);
    
    // Always include 'en' as default if no languages found
    const result = languages.length > 0 ? [...new Set(['en', ...languages])] : ['en'];
    return result;
  } catch (error) {
    console.error('[APP_PROXY] Error checking SEO languages for product:', productId, error);
    return ['en']; // Fallback to English only
  }
}

// Helper: get plan limits
async function getPlanLimits(shop) {
  try {
    const sub = await Subscription.findOne({ shop }).lean().exec();
    
    if (!sub) return { limit: 70, plan: 'starter' };
    
    const planLimits = {
      'starter': 70,
      'professional': 70,
      'professional_plus': 200,
      'professional plus': 200,
      'growth': 450,
      'growth_plus': 450,
      'growth plus': 450,
      'growth_extra': 750,
      'growth extra': 750,
      'enterprise': 1200
    };
    
    const limit = planLimits[sub.plan?.toLowerCase()] || 100;
    const result = { limit, plan: sub.plan };
    return result;
  } catch (e) {
    console.error('[APP_PROXY] Error getting plan limits:', e.message);
    return { limit: 70, plan: 'starter' };
  }
}

// Helper: escape XML special characters
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe).replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// Helper: clean HTML for XML
function cleanHtmlForXml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Main App Proxy handler for sitemap
async function handleSitemapProxy(req, res) {
  try {
    // Extract shop from Shopify App Proxy headers
    const shop = normalizeShop(req.headers['x-shopify-shop-domain'] || req.query.shop);
    
    if (!shop) {
      console.error('[APP_PROXY] Missing shop parameter in headers or query');
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    // Check if we have cached sitemap
    const cachedSitemap = await Sitemap.findOne({ shop }).select('+content').lean().exec();
    
    if (cachedSitemap && cachedSitemap.content) {
      // Check if cache is fresh (less than 1 hour old)
      const cacheAge = Date.now() - new Date(cachedSitemap.generatedAt).getTime();
      const oneHour = 60 * 60 * 1000;
      
      if (cacheAge < oneHour) {
        res.set({
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'Last-Modified': new Date(cachedSitemap.generatedAt).toUTCString(),
          'X-Sitemap-Cache': 'HIT',
          'X-Sitemap-Generated': cachedSitemap.generatedAt
        });
        return res.send(cachedSitemap.content);
      }
    }
    
    // Generate new sitemap
    const { limit, plan } = await getPlanLimits(shop);
    
    // Get shop info
    const shopQuery = `
      query {
        shop {
          primaryDomain { url }
        }
      }
    `;
    
    const shopData = await shopGraphQL(shop, shopQuery);
    const primaryDomain = shopData.shop.primaryDomain.url;
    
    // Try to get locales
    let locales = [{ locale: 'en', primary: true }];
    try {
      const localesQuery = `
        query {
          shopLocales {
            locale
            primary
          }
        }
      `;
      const localesData = await shopGraphQL(shop, localesQuery);
      if (localesData.shopLocales) {
        locales = localesData.shopLocales;
      }
    } catch (localeErr) {
      // Could not fetch locales, using default
    }
    
    // Fetch products
    let allProducts = [];
    let cursor = null;
    let hasMore = true;
    let batchCount = 0;
    
    while (hasMore && allProducts.length < limit) {
      batchCount++;
      
      const productsQuery = `
        query($cursor: String, $first: Int!) {
          products(first: $first, after: $cursor, query: "status:active") {
            edges {
              node {
                id
                handle
                title
                descriptionHtml
                vendor
                productType
                tags
                updatedAt
                publishedAt
                priceRangeV2 {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
                seo {
                  title
                  description
                }
                metafield_seo_ai_bullets: metafield(namespace: "seo_ai", key: "bullets") {
                  value
                  type
                }
                metafield_seo_ai_faq: metafield(namespace: "seo_ai", key: "faq") {
                  value
                  type
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
    
    // Generate XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:xhtml="http://www.w3.org/1999/xhtml"\n';
    xml += '        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"\n';
    xml += '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
    xml += '        xmlns:ai="http://www.aidata.org/schemas/sitemap/1.0">\n';
    
    // Homepage
    xml += '  <url>\n';
    xml += '    <loc>' + primaryDomain + '</loc>\n';
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';
    
    // Products
    let processedProducts = 0;
    let productsWithBullets = 0;
    let productsWithFaq = 0;
    
    for (const edge of allProducts) {
      const product = edge.node;
      if (!product.publishedAt || !product.handle) continue;
      
      processedProducts++;
      
      const lastmod = new Date(product.updatedAt).toISOString().split('T')[0];
      
      // Parse AI metafields
      let bullets = null;
      let faq = null;
      
      if (product.metafield_seo_ai_bullets?.value) {
        try { 
          bullets = JSON.parse(product.metafield_seo_ai_bullets.value);
          if (bullets && bullets.length > 0) {
            productsWithBullets++;
          }
        } catch (e) {
          console.error('[APP_PROXY] Failed to parse bullets for product', product.id, ':', e.message);
        }
      }
      
      if (product.metafield_seo_ai_faq?.value) {
        try { 
          faq = JSON.parse(product.metafield_seo_ai_faq.value);
          if (faq && faq.length > 0) {
            productsWithFaq++;
          }
        } catch (e) {
          console.error('[APP_PROXY] Failed to parse FAQ for product', product.id, ':', e.message);
        }
      }
      
      // Check multi-language SEO
      const hasMultiLanguageSEO = await checkProductSEOLanguages(shop, product.id);
      
      // Add product URL
      xml += '  <url>\n';
      xml += '    <loc>' + primaryDomain + '/products/' + product.handle + '</loc>\n';
      xml += '    <lastmod>' + lastmod + '</lastmod>\n';
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      
      // Add hreflang for multilingual SEO
      if (hasMultiLanguageSEO.length > 1) {
        for (const lang of hasMultiLanguageSEO) {
          const langCode = lang === 'en' ? '' : `/${lang}`;
          xml += `    <xhtml:link rel="alternate" hreflang="${lang}" href="${primaryDomain}${langCode}/products/${product.handle}" />\n`;
        }
      }
      
      // Add AI metadata
      xml += '    <ai:product>\n';
      xml += '      <ai:title>' + escapeXml(product.seo?.title || product.title) + '</ai:title>\n';
      xml += '      <ai:description><![CDATA[' + (product.seo?.description || cleanHtmlForXml(product.descriptionHtml)) + ']]></ai:description>\n';
      
      if (product.priceRangeV2?.minVariantPrice) {
        xml += '      <ai:price>' + product.priceRangeV2.minVariantPrice.amount + ' ' + product.priceRangeV2.minVariantPrice.currencyCode + '</ai:price>\n';
      }
      
      if (product.vendor) {
        xml += '      <ai:brand>' + escapeXml(product.vendor) + '</ai:brand>\n';
      }
      
      if (product.productType) {
        xml += '      <ai:category>' + escapeXml(product.productType) + '</ai:category>\n';
      }
      
      if (product.tags && product.tags.length > 0) {
        const tagArray = typeof product.tags === 'string' ? product.tags.split(',').map(t => t.trim()) : product.tags;
        xml += '      <ai:tags>' + escapeXml(tagArray.join(', ')) + '</ai:tags>\n';
      }
      
      // Add AI bullets
      if (bullets && Array.isArray(bullets) && bullets.length > 0) {
        xml += '      <ai:features>\n';
        bullets.forEach(bullet => {
          if (bullet && bullet.trim()) {
            xml += '        <ai:feature>' + escapeXml(bullet) + '</ai:feature>\n';
          }
        });
        xml += '      </ai:features>\n';
      }
      
      // Add AI FAQ
      if (faq && Array.isArray(faq) && faq.length > 0) {
        xml += '      <ai:faq>\n';
        faq.forEach(item => {
          if (item && item.q && item.a) {
            xml += '        <ai:qa>\n';
            xml += '          <ai:question>' + escapeXml(item.q) + '</ai:question>\n';
            xml += '          <ai:answer>' + escapeXml(item.a) + '</ai:answer>\n';
            xml += '        </ai:qa>\n';
          }
        });
        xml += '      </ai:faq>\n';
      }
      
      xml += '    </ai:product>\n';
      xml += '  </url>\n';
    }
    
    // Add collections if plan allows
    if (['growth', 'professional', 'growth_extra', 'enterprise'].includes(plan?.toLowerCase())) {
      try {
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
      } catch (collectionsErr) {
        console.error('[APP_PROXY] Error fetching collections:', collectionsErr.message);
      }
    }
    
    // Standard pages
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
    
    // Save to cache
    try {
      const sitemapDoc = await Sitemap.findOneAndUpdate(
        { shop },
        {
          shop,
          generatedAt: new Date(),
          url: `${primaryDomain}/apps/new-ai-seo/sitemap.xml`,
          productCount: allProducts.length,
          size: Buffer.byteLength(xml, 'utf8'),
          plan: plan,
          status: 'completed',
          content: xml
        },
        { 
          upsert: true, 
          new: true,
          runValidators: false
        }
      );
      
    } catch (saveErr) {
      console.error('[APP_PROXY] Failed to cache sitemap:', saveErr);
    }
    
    // Send response
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Sitemap-Cache': 'MISS',
      'X-Sitemap-Generated': new Date().toISOString(),
      'X-Sitemap-Products': allProducts.length.toString()
    });
    
    res.send(xml);
    
  } catch (err) {
    console.error('[APP_PROXY] Sitemap generation error:', err);
    res.status(err.status || 500).json({ 
      error: err.message || 'Failed to generate sitemap' 
    });
  }
}

// Test endpoint to verify controller is working
router.get('/test', (req, res) => {
  res.json({
    message: 'App Proxy controller is working!',
    url: req.url,
    query: req.query,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint to see what parameters we receive
router.get('/debug', (req, res) => {
  res.json({
    message: 'Debug endpoint - check server logs for full request details',
    url: req.url,
    query: req.query,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });
});

// Mount App Proxy routes with HMAC verification
router.get('/sitemap.xml', appProxyAuth, handleSitemapProxy);
router.get('/sitemap', appProxyAuth, handleSitemapProxy);

// Debug routes without HMAC verification
router.get('/debug-sitemap', (req, res) => {
  res.json({
    message: 'Debug sitemap endpoint - no HMAC verification',
    url: req.url,
    query: req.query,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });
});

// AI Discovery Endpoints via App Proxy
// These will be accessible at: https://{shop}.myshopify.com/apps/new-ai-seo/ai/*

// AI Welcome Page
router.get('/ai/welcome', appProxyAuth, async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  
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

    // Check plan - Welcome page requires Professional+
    const subscription = await Subscription.findOne({ shop });
    let effectivePlan = settings?.planKey || 'starter';
    
    if (!subscription) {
      effectivePlan = 'growth'; // Trial access
    }
    
    const allowedPlans = ['professional', 'growth', 'growth extra', 'enterprise'];
    
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
    
    const shopResponse = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shopRecord.accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: shopInfoQuery })
    });
    
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
  <meta property="og:url" content="${shopInfo?.primaryDomain?.url || `https://${shop}`}/apps/new-ai-seo/ai/welcome">
  
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebAPI",
    "name": "${shopInfo?.name} AI Data API",
    "description": "Structured e-commerce data endpoints for AI agents",
    "url": "${shopInfo?.primaryDomain?.url || `https://${shop}`}/apps/new-ai-seo/ai/welcome",
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
        <a href="/apps/new-ai-seo/ai/products.json?shop=${shop}" target="_blank">/apps/new-ai-seo/ai/products.json?shop=${shop}</a>
        <p>Complete product catalog with descriptions, prices, and AI-optimized metadata</p>
      </div>
      ` : ''}
      
      ${settings?.features?.collectionsJson ? `
      <div class="endpoint">
        <h3>Collections Feed <span class="badge">Active</span></h3>
        <a href="/apps/new-ai-seo/ai/collections-feed.json?shop=${shop}" target="_blank">/apps/new-ai-seo/ai/collections-feed.json?shop=${shop}</a>
        <p>Product categories and collections with semantic groupings</p>
      </div>
      ` : ''}
      
      ${settings?.features?.storeMetadata ? `
      <div class="endpoint">
        <h3>Store Metadata <span class="badge">Active</span></h3>
        <a href="/apps/new-ai-seo/ai/store-metadata.json?shop=${shop}" target="_blank">/apps/new-ai-seo/ai/store-metadata.json?shop=${shop}</a>
        <p>Organization and LocalBusiness schema data</p>
      </div>
      ` : ''}
      
      ${settings?.features?.aiSitemap ? `
      <div class="endpoint">
        <h3>AI Sitemap <span class="badge">Active</span></h3>
        <a href="/apps/new-ai-seo/ai/sitemap-feed.xml?shop=${shop}" target="_blank">/apps/new-ai-seo/ai/sitemap-feed.xml?shop=${shop}</a>
        <p>Enhanced sitemap with AI-optimized hints and metadata</p>
      </div>
      ` : ''}
      
      ${settings?.features?.schemaData ? `
      <div class="endpoint">
        <h3>Advanced Schema Data <span class="badge">Active</span></h3>
        <a href="/apps/new-ai-seo/ai/schema-sitemap.xml?shop=${shop}" target="_blank">/apps/new-ai-seo/ai/schema-sitemap.xml?shop=${shop}</a>
        <p>BreadcrumbList, FAQPage, and other advanced schema markup</p>
      </div>
      ` : ''}
    </div>
    
    <div class="meta">
      <p>Generated by indexAIze: Unlock AI Search • ${new Date().toISOString()}</p>
    </div>
  </div>
</body>
</html>`;

    res.type('text/html').send(html);
  } catch (error) {
    console.error('[APP_PROXY] AI Welcome Page error:', error);
    res.status(500).send('Internal server error');
  }
});

// AI Products JSON Feed
router.get('/ai/products.json', appProxyAuth, async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  
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
      return res.status(403).json({ error: 'Products JSON feature is not enabled' });
    }

    // Redirect to the main AI endpoints controller
    res.redirect(`/ai/products.json?shop=${shop}`);
  } catch (error) {
    console.error('[APP_PROXY] AI Products JSON error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI Collections JSON Feed
router.get('/ai/collections-feed.json', appProxyAuth, async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  
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
    
    if (!settings?.features?.collectionsJson) {
      return res.status(403).json({ error: 'Collections JSON feature is not enabled' });
    }

    // Redirect to the main AI endpoints controller
    res.redirect(`/ai/collections-feed.json?shop=${shop}`);
  } catch (error) {
    console.error('[APP_PROXY] AI Collections JSON error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI Sitemap Feed
router.get('/ai/sitemap-feed.xml', appProxyAuth, async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  
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
    
    if (!settings?.features?.aiSitemap) {
      return res.status(403).json({ error: 'AI Sitemap feature is not enabled' });
    }

    // Redirect to the main AI endpoints controller
    res.redirect(`/ai/sitemap-feed.xml?shop=${shop}`);
  } catch (error) {
    console.error('[APP_PROXY] AI Sitemap error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
