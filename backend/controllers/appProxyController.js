// backend/controllers/appProxyController.js
// App Proxy Controller for Sitemap

import express from 'express';
import fetch from 'node-fetch';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import Sitemap from '../db/Sitemap.js';
import Product from '../db/Product.js';
import Collection from '../db/Collection.js';
import { resolveShopToken } from '../utils/tokenResolver.js';
import { appProxyAuth } from '../utils/appProxyValidator.js';
import aiDiscoveryService from '../services/aiDiscoveryService.js';
import { getGeminiResponse } from '../ai/gemini.js';
import { createAIAnalyticsMiddleware } from '../middleware/aiAnalytics.js';

const router = express.Router();
const aiAnalytics = createAIAnalyticsMiddleware('app_proxy');
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';
const APP_PROXY_SUBPATH = process.env.APP_PROXY_SUBPATH || 'indexaize';

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
    
    // AI Discovery Endpoints - include enabled AI data endpoints in sitemap
    try {
      const shopRecord = await Shop.findOne({ shop }).lean();
      if (shopRecord?.accessToken) {
        const session = { accessToken: shopRecord.accessToken };
        const aiSettings = await aiDiscoveryService.getSettings(shop, session);
        const today = new Date().toISOString().split('T')[0];
        const proxyBase = primaryDomain + '/apps/' + APP_PROXY_SUBPATH;
        
        if (aiSettings?.features?.llmsTxt) {
          xml += '  <url>\n';
          xml += '    <loc>' + proxyBase + '/llms.txt</loc>\n';
          xml += '    <lastmod>' + today + '</lastmod>\n';
          xml += '    <changefreq>weekly</changefreq>\n';
          xml += '    <priority>0.8</priority>\n';
          xml += '  </url>\n';
        }
        if (aiSettings?.features?.productsJson) {
          xml += '  <url>\n';
          xml += '    <loc>' + proxyBase + '/ai/products.json</loc>\n';
          xml += '    <lastmod>' + today + '</lastmod>\n';
          xml += '    <changefreq>daily</changefreq>\n';
          xml += '    <priority>0.9</priority>\n';
          xml += '  </url>\n';
        }
        if (aiSettings?.features?.collectionsJson) {
          xml += '  <url>\n';
          xml += '    <loc>' + proxyBase + '/ai/collections-feed.json</loc>\n';
          xml += '    <lastmod>' + today + '</lastmod>\n';
          xml += '    <changefreq>weekly</changefreq>\n';
          xml += '    <priority>0.7</priority>\n';
          xml += '  </url>\n';
        }
        if (aiSettings?.features?.storeMetadata) {
          xml += '  <url>\n';
          xml += '    <loc>' + proxyBase + '/ai/store-metadata.json</loc>\n';
          xml += '    <lastmod>' + today + '</lastmod>\n';
          xml += '    <changefreq>weekly</changefreq>\n';
          xml += '    <priority>0.7</priority>\n';
          xml += '  </url>\n';
        }
        if (aiSettings?.features?.welcomePage) {
          xml += '  <url>\n';
          xml += '    <loc>' + proxyBase + '/ai/welcome</loc>\n';
          xml += '    <lastmod>' + today + '</lastmod>\n';
          xml += '    <changefreq>weekly</changefreq>\n';
          xml += '    <priority>0.8</priority>\n';
          xml += '  </url>\n';
        }
      }
    } catch (aiEndpointErr) {
      console.error('[APP_PROXY] Error adding AI endpoints to sitemap:', aiEndpointErr.message);
    }
    
    xml += '</urlset>';
    
    // Save to cache
    try {
      const sitemapDoc = await Sitemap.findOneAndUpdate(
        { shop },
        {
          shop,
          generatedAt: new Date(),
          url: `${primaryDomain}/apps/${APP_PROXY_SUBPATH}/sitemap.xml`,
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
// These will be accessible at: https://{shop}.myshopify.com/apps/{APP_PROXY_SUBPATH}/ai/*

// AI Welcome Page
router.get('/ai/welcome', appProxyAuth, aiAnalytics, async (req, res) => {
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
    const shopName = shopInfo?.name || shop.replace('.myshopify.com', '');
    const primaryDomain = shopInfo?.primaryDomain?.url || `https://${shop}`;
    const baseUrl = `${primaryDomain}/apps/${APP_PROXY_SUBPATH}`;
    const planKey = (settings?.planKey || 'starter').toLowerCase().replace(/\s+/g, '_');

    // Build endpoints list
    const endpoints = [];
    if (settings?.features?.productsJson) endpoints.push({ name: 'Products JSON Feed', path: `/ai/products.json`, desc: 'Complete product catalog with AI-optimized titles, descriptions, pricing, and availability', format: 'JSON' });
    if (settings?.features?.collectionsJson) endpoints.push({ name: 'Collections Feed', path: `/ai/collections-feed.json`, desc: 'Product categories and collections with SEO metadata', format: 'JSON' });
    if (settings?.features?.storeMetadata) endpoints.push({ name: 'Store Metadata', path: `/ai/store-metadata.json`, desc: 'Organization schema, business info, and policies', format: 'JSON' });
    if (settings?.features?.schemaData) endpoints.push({ name: 'Schema Data', path: `/ai/schema-data.json`, desc: 'Rich structured data: BreadcrumbList, FAQPage, Product schemas', format: 'JSON' });
    if (settings?.features?.aiSitemap) endpoints.push({ name: 'AI Sitemap', path: `/ai/sitemap-feed.xml`, desc: 'Enhanced XML sitemap with AI hints and priority scoring', format: 'XML' });
    if (settings?.features?.llmsTxt) {
      endpoints.push({ name: 'LLMs.txt', path: `/llms.txt`, desc: 'AI discovery file (llmstxt.org standard)', format: 'Markdown' });
      endpoints.push({ name: 'LLMs-full.txt', path: `/llms-full.txt`, desc: 'Extended version with API documentation', format: 'Markdown' });
    }
    if (settings?.features?.aiAsk) endpoints.push({ name: 'AI Ask (Interactive)', path: `/ai/ask`, desc: 'Ask questions about this store — POST with JSON body {"question":"..."}', format: 'JSON', method: 'POST' });

    // A1: Accept header detection — return Markdown for AI crawlers
    const acceptHeader = req.get('Accept') || '';
    const wantsMarkdown = acceptHeader.includes('text/markdown') || acceptHeader.includes('text/plain');

    if (wantsMarkdown) {
      // Return Markdown format for AI agents
      let md = `# ${shopName} - AI Data Endpoints\n\n`;
      md += `> ${shopInfo?.description || `AI-optimized e-commerce data from ${shopName}`}\n\n`;
      md += `## Available Endpoints\n\n`;
      endpoints.forEach(ep => {
        md += `- [${ep.name}](${baseUrl}${ep.path}): ${ep.desc} (${ep.format}${ep.method ? ', ' + ep.method : ''})\n`;
      });
      md += `\n## Integration\n\n`;
      md += `- Base URL: \`${baseUrl}\`\n`;
      md += `- Authentication: None (public access)\n`;
      md += `- Rate limits: 60 req/min per endpoint\n`;
      md += `- Caching: ETags supported\n`;
      if (settings?.features?.aiAsk) {
        md += `\n## Interactive Query\n\n`;
        md += `POST ${baseUrl}/ai/ask with JSON body: {"question": "your question"}\n`;
        md += `Returns structured answer with product references.\n`;
      }
      md += `\n---\n`;
      md += `last-updated: ${new Date().toISOString().split('T')[0]}\n`;
      md += `generator: indexAIze - Unlock AI Search\n`;

      res.set('Content-Type', 'text/markdown; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(md);
    }

    // A2: Enhanced JSON-LD with DataCatalog and Action endpoints
    const jsonLd = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebAPI",
          "name": `${shopName} AI Data API`,
          "description": `Structured e-commerce data endpoints for AI agents from ${shopName}`,
          "url": `${baseUrl}/ai/welcome`,
          "documentation": `${baseUrl}/llms-full.txt`,
          "provider": {
            "@type": "Organization",
            "name": shopName,
            "url": primaryDomain
          },
          "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
        },
        {
          "@type": "DataCatalog",
          "name": `${shopName} Product Catalog`,
          "url": `${baseUrl}/ai/products.json`,
          "description": "Complete product catalog with AI-optimized metadata",
          "provider": { "@type": "Organization", "name": shopName }
        },
        ...(settings?.features?.aiAsk ? [{
          "@type": "SearchAction",
          "target": {
            "@type": "EntryPoint",
            "urlTemplate": `${baseUrl}/ai/ask`,
            "httpMethod": "POST",
            "contentType": "application/json"
          },
          "name": "Ask about products",
          "description": "Query this store with natural language questions about products, policies, and availability"
        }] : [])
      ]
    };

    // Welcome page HTML
    const endpointsHtml = endpoints.map(ep => `
      <div class="endpoint">
        <div class="ep-header">
          <h3>${ep.name} <span class="badge">${ep.format}</span>${ep.method ? `<span class="badge method">${ep.method}</span>` : ''}</h3>
        </div>
        <code class="ep-url">${baseUrl}${ep.path}</code>
        <p>${ep.desc}</p>
      </div>
    `).join('');

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Data API - ${shopName}</title>
  <meta name="description" content="AI-optimized data endpoints for ${shopName}. Access structured product data, collections, and store information.">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="${shopName} - AI Data API">
  <meta property="og:description" content="Structured e-commerce data optimized for AI agents">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${baseUrl}/ai/welcome">
  <link rel="alternate" type="text/plain" href="${baseUrl}/llms.txt" title="LLMs.txt">
  <link rel="alternate" type="text/plain" href="${baseUrl}/llms-full.txt" title="LLMs-full.txt">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #1a1a2e; background: #f0f2f5; }
    .container { max-width: 960px; margin: 0 auto; padding: 2rem; }
    header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; margin: -2rem -2rem 2rem -2rem; padding: 3rem 2rem; }
    h1 { font-size: 2rem; margin-bottom: 0.25rem; }
    .tagline { color: rgba(255,255,255,0.8); font-size: 1.1rem; }
    .section { background: white; padding: 1.5rem; margin-bottom: 1.5rem; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .section h2 { font-size: 1.3rem; margin-bottom: 1rem; color: #1a1a2e; }
    .endpoint { background: #f8f9fc; padding: 1rem; margin: 0.75rem 0; border-left: 3px solid #4361ee; border-radius: 6px; }
    .endpoint h3 { margin: 0 0 0.3rem 0; font-size: 1rem; color: #333; }
    .ep-url { display: block; color: #4361ee; font-size: 0.85rem; word-break: break-all; margin: 0.25rem 0; }
    .endpoint p { margin: 0.25rem 0 0 0; color: #666; font-size: 0.9rem; }
    .badge { display: inline-block; padding: 0.15rem 0.4rem; background: #4361ee; color: white; border-radius: 3px; font-size: 0.7rem; margin-left: 0.5rem; font-weight: 500; }
    .badge.method { background: #e63946; }
    .code-block { background: #1a1a2e; color: #e0e0e0; padding: 1rem; border-radius: 6px; font-size: 0.85rem; overflow-x: auto; font-family: 'SF Mono', Monaco, monospace; }
    .code-block .comment { color: #6c757d; }
    .code-block .key { color: #82aaff; }
    .code-block .string { color: #c3e88d; }
    ul { margin-left: 1.5rem; color: #555; }
    ul li { margin: 0.25rem 0; }
    .meta { color: #999; font-size: 0.85rem; margin-top: 2rem; text-align: center; }
    .meta a { color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${shopName} - AI Data API</h1>
      <p class="tagline">Structured e-commerce data for AI agents and models</p>
    </header>
    
    <div class="section">
      <h2>Available Endpoints</h2>
      ${endpointsHtml}
    </div>
    
    ${settings?.features?.aiAsk ? `
    <div class="section">
      <h2>Interactive Query</h2>
      <p style="margin-bottom: 1rem; color: #555;">Ask questions about this store's products, policies, and availability:</p>
      <div class="code-block">
        <span class="comment">// POST ${baseUrl}/ai/ask</span><br>
        {<br>
        &nbsp;&nbsp;<span class="key">"question"</span>: <span class="string">"What products do you have under $100?"</span><br>
        }<br><br>
        <span class="comment">// Response:</span><br>
        {<br>
        &nbsp;&nbsp;<span class="key">"answer"</span>: <span class="string">"We have 5 products under $100..."</span>,<br>
        &nbsp;&nbsp;<span class="key">"sources"</span>: [{<span class="key">"type"</span>: <span class="string">"product"</span>, <span class="key">"title"</span>: <span class="string">"..."</span>}],<br>
        &nbsp;&nbsp;<span class="key">"confidence"</span>: 0.92<br>
        }
      </div>
    </div>
    ` : ''}

    <div class="section">
      <h2>Integration Guidelines</h2>
      <ul>
        <li>All data endpoints are publicly accessible (no auth required)</li>
        <li>Rate limits: 60 requests/min per endpoint, 10 req/min for /ai/ask</li>
        <li>ETags and Cache-Control headers for efficient caching</li>
        <li>Data freshness: Updated every ${planKey === 'enterprise' ? '2 hours' : planKey === 'growth_extra' ? '12 hours' : '24 hours'}</li>
        <li><code>Accept: text/markdown</code> on this page returns machine-readable Markdown</li>
      </ul>
    </div>
    
    <p class="meta">
      Powered by <strong>indexAIze</strong> &mdash; ${new Date().toISOString().split('T')[0]} &mdash; 
      <a href="${primaryDomain}">Visit Store</a>
    </p>
  </div>
</body>
</html>`;

    res.type('text/html').send(html);
  } catch (error) {
    console.error('[APP_PROXY] AI Welcome Page error:', error);
    res.status(500).send('Internal server error');
  }
});

// AI Products JSON Feed - Direct implementation (no redirect!)
router.get('/ai/products.json', appProxyAuth, aiAnalytics, async (req, res) => {
  // Try to get shop from multiple sources
  const shop = normalizeShop(req.query.shop || req.headers['x-shopify-shop-domain']);
  
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

    // Fetch ALL active products with pagination
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
                descriptionHtml
                productType
                vendor
                tags
                totalInventory
                publishedAt
                updatedAt
                priceRangeV2 {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                  maxVariantPrice {
                    amount
                    currencyCode
                  }
                }
                compareAtPriceRange {
                  minVariantPrice {
                    amount
                  }
                  maxVariantPrice {
                    amount
                  }
                }
                featuredImage {
                  url
                  altText
                }
                variants(first: 100) {
                  edges {
                    node {
                      title
                      sku
                      availableForSale
                      inventoryQuantity
                      selectedOptions {
                        name
                        value
                      }
                      price {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
                seo {
                  title
                  description
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
        `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
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
    
    if (allProducts.length === 0) {
      return res.status(500).json({ error: 'Failed to fetch products' });
    }
    
    const optimizedProducts = [];
    const totalProducts = allProducts.length;
    
    allProducts.forEach(({ node: product }) => {
      if (product.metafields.edges.length > 0) {
        const parsedMetafields = {};
        product.metafields.edges.forEach(({ node: metafield }) => {
          try {
            parsedMetafields[metafield.key] = JSON.parse(metafield.value);
          } catch {
            parsedMetafields[metafield.key] = metafield.value;
          }
        });
        
        // Get AI-optimized data from metafields (try different language keys)
        let aiTitle = null;
        let aiDescription = null;
        let aiImageAlt = null;
        let aiBullets = null;
        let aiFaq = null;
        
        for (const key of Object.keys(parsedMetafields)) {
          const seoData = parsedMetafields[key];
          if (seoData && typeof seoData === 'object') {
            if (!aiTitle && seoData.title) aiTitle = seoData.title;
            if (!aiDescription && seoData.metaDescription) aiDescription = seoData.metaDescription;
            if (!aiImageAlt && seoData.imageAlt) aiImageAlt = seoData.imageAlt;
            if (!aiBullets && seoData.bullets) aiBullets = seoData.bullets;
            if (!aiFaq && seoData.faq) aiFaq = seoData.faq;
          }
        }
        
        // Calculate availability status
        const totalInventory = product.totalInventory || 0;
        const hasAvailableVariants = product.variants?.edges?.some(v => v.node.availableForSale);
        let availability = 'out_of_stock';
        if (hasAvailableVariants && totalInventory > 10) {
          availability = 'in_stock';
        } else if (hasAvailableVariants && totalInventory > 0) {
          availability = 'limited_stock';
        } else if (hasAvailableVariants) {
          availability = 'available'; // Available but no inventory tracking
        }
        
        // Get SKU from first variant
        const primarySku = product.variants?.edges?.[0]?.node?.sku || null;
        
        // Check for sale price
        const minPrice = parseFloat(product.priceRangeV2?.minVariantPrice?.amount || 0);
        const maxPrice = parseFloat(product.priceRangeV2?.maxVariantPrice?.amount || 0);
        const compareAtMin = parseFloat(product.compareAtPriceRange?.minVariantPrice?.amount || 0);
        const isOnSale = compareAtMin > 0 && compareAtMin > minPrice;
        
        // Build variants with size/option info
        const variants = (product.variants?.edges || []).map(({ node: v }) => ({
          title: v.title,
          sku: v.sku || null,
          available: v.availableForSale,
          inventory: v.inventoryQuantity,
          options: (v.selectedOptions || []).reduce((acc, opt) => {
            acc[opt.name] = opt.value;
            return acc;
          }, {}),
          price: v.price ? parseFloat(v.price.amount).toFixed(2) : null
        }));

        // Extract unique option names and available values
        const optionSummary = {};
        for (const v of variants) {
          for (const [optName, optValue] of Object.entries(v.options)) {
            if (!optionSummary[optName]) optionSummary[optName] = { available: [], unavailable: [] };
            if (v.available) {
              if (!optionSummary[optName].available.includes(optValue)) {
                optionSummary[optName].available.push(optValue);
              }
            } else {
              if (!optionSummary[optName].unavailable.includes(optValue) && 
                  !optionSummary[optName].available.includes(optValue)) {
                optionSummary[optName].unavailable.push(optValue);
              }
            }
          }
        }

        optimizedProducts.push({
          id: product.id,
          sku: primarySku,
          title: aiTitle || product.seo?.title || product.title,
          originalTitle: product.title,
          handle: product.handle,
          description: aiDescription || product.seo?.description || product.description || null,
          fullDescription: product.description || null,
          productType: product.productType || null,
          vendor: product.vendor || null,
          tags: product.tags || [],
          availability: availability,
          inventoryStatus: {
            totalInventory: totalInventory,
            availableForSale: hasAvailableVariants || false
          },
          options: Object.keys(optionSummary).length > 0 ? optionSummary : null,
          variants: variants.length > 0 ? variants : null,
          pricing: {
            price: minPrice.toFixed(2),
            priceMax: maxPrice > minPrice ? maxPrice.toFixed(2) : null,
            compareAtPrice: isOnSale ? compareAtMin.toFixed(2) : null,
            currency: product.priceRangeV2?.minVariantPrice?.currencyCode || 'USD',
            isOnSale: isOnSale
          },
          url: `https://${shop}/products/${product.handle}`,
          image: product.featuredImage ? {
            url: product.featuredImage.url,
            alt: aiImageAlt || product.featuredImage.altText || product.title
          } : null,
          highlights: aiBullets || null,
          faq: aiFaq || null,
          dates: {
            published: product.publishedAt,
            updated: product.updatedAt
          },
          seoMetafields: parsedMetafields
        });
      }
    });

    if (optimizedProducts.length === 0) {
      return res.json({
        shop,
        products: [],
        products_count: 0,
        products_total: totalProducts,
        warning: 'No optimized products found'
      });
    }

    // Apply plan limit - only include up to the plan's product limit
    const { limit: planLimit, plan } = await getPlanLimits(shop);
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
    console.error('[APP_PROXY] AI Products JSON error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI Collections JSON Feed - Direct implementation (no redirect!)
router.get('/ai/collections-feed.json', appProxyAuth, aiAnalytics, async (req, res) => {
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

    // Fetch collections directly (same logic as aiEndpointsController)
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
      `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
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
    
    if (!data?.data?.collections?.edges) {
      return res.status(500).json({ error: 'Failed to fetch collections' });
    }
    
    const optimizedCollections = [];
    const totalCollections = data.data.collections.edges.length;
    
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
        warning: 'No optimized collections found'
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
    console.error('[APP_PROXY] AI Collections JSON error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI Sitemap Feed - Uses the existing sitemap handler
// Access is determined by whether ANY sitemap has been generated (standard or AI-enhanced)
router.get('/ai/sitemap-feed.xml', appProxyAuth, aiAnalytics, async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  try {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord) {
      return res.status(404).send('Shop not found');
    }

    // Check if ANY sitemap has been generated (standard or AI-enhanced)
    // Both standard and AI-enhanced sitemaps are served from the same endpoint
    // Note: 'content' field has select:false, so we check generatedAt + status instead
    const existingSitemap = await Sitemap.findOne({ shop }).select('generatedAt status').lean();
    
    if (!existingSitemap || !existingSitemap.generatedAt || existingSitemap.status === 'failed') {
      return res.status(403).send('Sitemap has not been generated yet. Please generate it from Store Optimization → Sitemap.');
    }

    // Call the sitemap handler directly by modifying request
    req.headers['x-shopify-shop-domain'] = shop;
    return handleSitemapProxy(req, res);
  } catch (error) {
    console.error('[APP_PROXY] AI Sitemap error:', error);
    res.status(500).send('Internal server error');
  }
});

// AI Store Metadata - Direct implementation (no redirect!)
router.get('/ai/store-metadata.json', appProxyAuth, aiAnalytics, async (req, res) => {
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
    
    if (!settings?.features?.storeMetadata) {
      return res.status(403).json({ error: 'Store Metadata feature is not enabled' });
    }

    // Fetch store metadata
    const shopQuery = `
      query {
        shop {
          name
          description
          email
          url
          primaryDomain { url }
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
      `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: shopQuery })
      }
    );

    const data = await response.json();
    const shopData = data?.data?.shop;
    
    if (!shopData) {
      return res.status(500).json({ error: 'Failed to fetch shop data' });
    }
    
    // Parse metafields
    let seoMetadata = null;
    let aiMetadata = null;
    let organizationSchema = null;
    
    if (shopData.seoMetafield?.value) {
      try { seoMetadata = JSON.parse(shopData.seoMetafield.value); } catch (e) {}
    }
    if (shopData.aiMetafield?.value) {
      try { aiMetadata = JSON.parse(shopData.aiMetafield.value); } catch (e) {}
    }
    if (shopData.organizationMetafield?.value) {
      try { organizationSchema = JSON.parse(shopData.organizationMetafield.value); } catch (e) {}
    }
    
    // Build response
    const storeMetadata = {
      shop: shop,
      generated_at: new Date().toISOString(),
      store: {
        name: shopData.name,
        url: shopData.primaryDomain?.url || shopData.url,
        email: shopData.email
      }
    };
    
    if (seoMetadata || shopData) {
      storeMetadata.seo = {
        title: seoMetadata?.storeName || shopData.name,
        shortDescription: seoMetadata?.shortDescription || null,
        fullDescription: seoMetadata?.fullDescription || shopData.description || null,
        keywords: seoMetadata?.keywords
      };
    }
    
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
    
    if (organizationSchema?.enabled) {
      storeMetadata.organization_schema = {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: organizationSchema.name || shopData.name,
        url: shopData.primaryDomain?.url || shopData.url,
        email: organizationSchema.email,
        telephone: organizationSchema.phone,
        logo: organizationSchema.logo,
        sameAs: organizationSchema.sameAs ? 
          organizationSchema.sameAs.split(',').map(s => s.trim()) : []
      };
    }
    
    res.json(storeMetadata);
  } catch (error) {
    console.error('[APP_PROXY] AI Store Metadata error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// LLMs.txt endpoint - AI Discovery standard (llmstxt.org)
// Accessible via: /apps/indexaize/llms.txt
// ============================================================
router.get('/llms.txt', appProxyAuth, aiAnalytics, async (req, res) => {
  try {
    const shop = normalizeShop(req.headers['x-shopify-shop-domain'] || req.query.shop);
    if (!shop) {
      return res.status(400).type('text/plain').send('Missing shop parameter');
    }

    const llmsTxt = await aiDiscoveryService.generateLlmsTxt(shop);
    
    if (!llmsTxt) {
      return res.status(404).type('text/plain').send('# LLMs.txt is not enabled for this store.\n# Enable it in indexAIze Settings > AI Discovery Features.\n');
    }

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=7200'); // 1h client, 2h CDN
    res.set('X-Robots-Tag', 'noindex'); // Don't index the file itself, it's for AI agents
    res.send(llmsTxt);
  } catch (error) {
    console.error('[APP_PROXY] LLMs.txt error:', error);
    res.status(500).type('text/plain').send('# Error generating llms.txt\n');
  }
});

// ============================================================
// LLMs-full.txt endpoint - Extended version with API docs
// Accessible via: /apps/indexaize/llms-full.txt
// ============================================================
router.get('/llms-full.txt', appProxyAuth, aiAnalytics, async (req, res) => {
  try {
    const shop = normalizeShop(req.headers['x-shopify-shop-domain'] || req.query.shop);
    if (!shop) {
      return res.status(400).type('text/plain').send('Missing shop parameter');
    }

    const llmsFullTxt = await aiDiscoveryService.generateLlmsFullTxt(shop);
    
    if (!llmsFullTxt) {
      return res.status(404).type('text/plain').send('# LLMs.txt is not enabled for this store.\n');
    }

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=7200');
    res.set('X-Robots-Tag', 'noindex');
    res.send(llmsFullTxt);
  } catch (error) {
    console.error('[APP_PROXY] LLMs-full.txt error:', error);
    res.status(500).type('text/plain').send('# Error generating llms-full.txt\n');
  }
});

// ============================================================
// AI Plugin JSON manifest - AI agent discovery
// Accessible via: /apps/indexaize/.well-known/ai-plugin.json
// ============================================================
router.get('/.well-known/ai-plugin.json', appProxyAuth, aiAnalytics, async (req, res) => {
  const shop = normalizeShop(req.headers['x-shopify-shop-domain'] || req.query.shop);
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  try {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord?.accessToken) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopInfoResponse = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
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
    console.error('[APP_PROXY] ai-plugin.json error:', error);
    res.status(500).json({ error: 'Failed to generate AI plugin manifest' });
  }
});

// ============================================================
// AI Ask endpoint - AI agents can query the store
// Accessible via: POST /apps/indexaize/ai/ask
// Rate limited: 10 req/min per shop
// ============================================================
const askRateLimit = new Map();
const askCache = new Map();

function checkAskRateLimit(shop) {
  const now = Date.now();
  const limit = askRateLimit.get(shop);
  if (!limit || now > limit.resetAt) {
    askRateLimit.set(shop, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (limit.count >= 10) return false;
  limit.count++;
  return true;
}

function hashQuestion(q) {
  let hash = 0;
  for (let i = 0; i < q.length; i++) {
    hash = ((hash << 5) - hash) + q.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

router.post('/ai/ask', appProxyAuth, aiAnalytics, async (req, res) => {
  const shop = normalizeShop(req.headers['x-shopify-shop-domain'] || req.query.shop || req.body?.shop);
  const question = req.body?.question;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }
  if (!question || typeof question !== 'string' || question.trim().length < 3) {
    return res.status(400).json({ error: 'Missing or invalid question (min 3 characters)' });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: 'Question too long (max 500 characters)' });
  }

  if (!checkAskRateLimit(shop)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 10 requests per minute.', retryAfter: 60 });
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

    // Build context
    let storeContext = '';

    // Products
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

    // Collections
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

    // Shop info + AI context metafields (separate from policies due to API version differences)
    try {
      const shopInfoResponse = await fetch(
        `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopRecord.accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: `{
              shop {
                name description email url primaryDomain { url }
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

        let aiContext = null;
        try {
          if (shopInfo.aiContextMetafield?.value) aiContext = JSON.parse(shopInfo.aiContextMetafield.value);
        } catch (e) { /* ignore */ }

        let seoMeta = null;
        try {
          if (shopInfo.seoMetafield?.value) seoMeta = JSON.parse(shopInfo.seoMetafield.value);
        } catch (e) { /* ignore */ }

        if (seoMeta?.shortDescription) storeContext += `- About: ${seoMeta.shortDescription}\n`;

        if (aiContext) {
          if (aiContext.businessType) storeContext += `- Business: ${aiContext.businessType}\n`;
          if (aiContext.uniqueSellingPoints) storeContext += `- Unique Selling Points: ${aiContext.uniqueSellingPoints.substring(0, 500)}\n`;
          if (aiContext.primaryCategories) storeContext += `- Categories: ${aiContext.primaryCategories}\n`;
          if (aiContext.shippingInfo) storeContext += `\nSHIPPING POLICY:\n${aiContext.shippingInfo.substring(0, 800)}\n`;
          if (aiContext.returnPolicy) storeContext += `\nRETURN / REFUND POLICY:\n${aiContext.returnPolicy.substring(0, 800)}\n`;
        }
        storeContext += '\n';
      }
    } catch (e) {
      console.error('[AI-ASK] Failed to fetch shop info:', e.message);
    }

    // Try Shopify legal policies (separate query, older API where policy fields exist)
    try {
      const policyResponse = await fetch(
        `https://${shop}/admin/api/2024-01/graphql.json`,
        {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': shopRecord.accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `{ shop { shippingPolicy { title body } refundPolicy { title body } privacyPolicy { title body } termsOfService { title body } } }` })
        }
      );
      const policyData = await policyResponse.json();
      const policyShop = policyData.data?.shop;
      if (policyShop) {
        const policies = [policyShop.shippingPolicy, policyShop.refundPolicy, policyShop.privacyPolicy, policyShop.termsOfService].filter(p => p?.body);
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
      console.log('[AI-ASK] Legal policies not available:', e.message);
    }

    // Call Gemini
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

    const sources = [];
    const shopUrl = `https://${shop.replace('.myshopify.com', '')}.myshopify.com`;
    if (parsedResponse.relevant_products?.length > 0) {
      parsedResponse.relevant_products.forEach(p => {
        if (p.handle) {
          sources.push({ type: 'product', title: p.title, price: p.price, url: `${shopUrl}/products/${p.handle}` });
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

    // Cache 5 min
    askCache.set(cacheKey, { data: responseData, expiresAt: Date.now() + 5 * 60 * 1000 });
    if (askCache.size > 1000) {
      const now = Date.now();
      for (const [key, val] of askCache) {
        if (now > val.expiresAt) askCache.delete(key);
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('[APP_PROXY] AI Ask error:', error);
    res.status(500).json({ error: 'Failed to process question. Please try again.' });
  }
});

export default router;
