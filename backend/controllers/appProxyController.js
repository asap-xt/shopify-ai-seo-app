// backend/controllers/appProxyController.js
// App Proxy Controller for Sitemap - Enhanced with extensive logging

console.log('[APP_PROXY_CONTROLLER] Loading App Proxy Controller...');

import express from 'express';
import fetch from 'node-fetch';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import Sitemap from '../db/Sitemap.js';
import { resolveShopToken } from '../utils/tokenResolver.js';
import { appProxyAuth } from '../utils/appProxyValidator.js';

const router = express.Router();
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// Helper: normalize shop domain
function normalizeShop(s) {
  console.log('[APP_PROXY] Normalizing shop:', s);
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
  console.log('[APP_PROXY] Resolving token for shop:', shop);
  try {
    const token = await resolveShopToken(shop);
    console.log('[APP_PROXY] Token resolved successfully');
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
  console.log('[APP_PROXY] GraphQL request for shop:', shop);
  console.log('[APP_PROXY] Query:', query.substring(0, 100) + '...');
  
  const token = await resolveAdminTokenForShop(shop);
  const url = 'https://' + shop + '/admin/api/' + API_VERSION + '/graphql.json';
  console.log('[APP_PROXY] GraphQL URL:', url);
  
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
  
  console.log('[APP_PROXY] GraphQL request successful');
  return json.data;
}

// Helper: Check which languages have SEO optimization for a product
async function checkProductSEOLanguages(shop, productId) {
  console.log('[APP_PROXY] Checking SEO languages for product:', productId);
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
    console.log('[APP_PROXY] SEO languages found:', result);
    return result;
  } catch (error) {
    console.error('[APP_PROXY] Error checking SEO languages for product:', productId, error);
    return ['en']; // Fallback to English only
  }
}

// Helper: get plan limits
async function getPlanLimits(shop) {
  console.log('[APP_PROXY] Getting plan limits for shop:', shop);
  try {
    const sub = await Subscription.findOne({ shop }).lean().exec();
    console.log('[APP_PROXY] Subscription found:', !!sub, 'plan:', sub?.plan);
    
    if (!sub) return { limit: 100, plan: 'starter' };
    
    const planLimits = {
      'starter': 100,
      'professional': 350,
      'growth': 1000,
      'growth_extra': 2500,
      'enterprise': 6000
    };
    
    const limit = planLimits[sub.plan?.toLowerCase()] || 100;
    const result = { limit, plan: sub.plan };
    console.log('[APP_PROXY] Plan limits:', result);
    return result;
  } catch (e) {
    console.error('[APP_PROXY] Error getting plan limits:', e.message);
    return { limit: 100, plan: 'starter' };
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
  console.log('[APP_PROXY] ===== SITEMAP PROXY REQUEST =====');
  console.log('[APP_PROXY] handleSitemapProxy function called!');
  console.log('[APP_PROXY] Request method:', req.method);
  console.log('[APP_PROXY] Request URL:', req.url);
  console.log('[APP_PROXY] Request headers:', req.headers);
  console.log('[APP_PROXY] Request query:', req.query);
  console.log('[APP_PROXY] Request body:', req.body);
  
  try {
    // Extract shop from Shopify App Proxy headers
    const shop = normalizeShop(req.headers['x-shopify-shop-domain'] || req.query.shop);
    console.log('[APP_PROXY] Extracted shop:', shop);
    
    if (!shop) {
      console.error('[APP_PROXY] Missing shop parameter in headers or query');
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    console.log('[APP_PROXY] Processing sitemap for shop:', shop);
    
    // Check if we have cached sitemap
    console.log('[APP_PROXY] Checking for cached sitemap...');
    const cachedSitemap = await Sitemap.findOne({ shop }).select('+content').lean().exec();
    
    if (cachedSitemap && cachedSitemap.content) {
      console.log('[APP_PROXY] Found cached sitemap:', {
        generatedAt: cachedSitemap.generatedAt,
        productCount: cachedSitemap.productCount,
        size: cachedSitemap.size,
        contentLength: cachedSitemap.content.length
      });
      
      // Check if cache is fresh (less than 1 hour old)
      const cacheAge = Date.now() - new Date(cachedSitemap.generatedAt).getTime();
      const oneHour = 60 * 60 * 1000;
      
      if (cacheAge < oneHour) {
        console.log('[APP_PROXY] Serving cached sitemap (age:', Math.round(cacheAge / 1000), 'seconds)');
        
        res.set({
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'Last-Modified': new Date(cachedSitemap.generatedAt).toUTCString(),
          'X-Sitemap-Cache': 'HIT',
          'X-Sitemap-Generated': cachedSitemap.generatedAt
        });
        return res.send(cachedSitemap.content);
      } else {
        console.log('[APP_PROXY] Cached sitemap is stale (age:', Math.round(cacheAge / 1000), 'seconds), regenerating...');
      }
    } else {
      console.log('[APP_PROXY] No cached sitemap found, generating new one...');
    }
    
    // Generate new sitemap
    console.log('[APP_PROXY] Starting sitemap generation...');
    const { limit, plan } = await getPlanLimits(shop);
    console.log('[APP_PROXY] Plan limits:', { limit, plan });
    
    // Get shop info
    const shopQuery = `
      query {
        shop {
          primaryDomain { url }
        }
      }
    `;
    
    console.log('[APP_PROXY] Fetching shop data...');
    const shopData = await shopGraphQL(shop, shopQuery);
    const primaryDomain = shopData.shop.primaryDomain.url;
    console.log('[APP_PROXY] Primary domain:', primaryDomain);
    
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
      console.log('[APP_PROXY] Locales found:', locales);
    } catch (localeErr) {
      console.log('[APP_PROXY] Could not fetch locales (missing scope), using default:', locales);
    }
    
    // Fetch products
    let allProducts = [];
    let cursor = null;
    let hasMore = true;
    let batchCount = 0;
    
    console.log('[APP_PROXY] Starting product fetching...');
    
    while (hasMore && allProducts.length < limit) {
      batchCount++;
      console.log('[APP_PROXY] Fetching batch #', batchCount, 'cursor:', cursor);
      
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
      console.log('[APP_PROXY] Batch size:', batchSize);
      
      const data = await shopGraphQL(shop, productsQuery, {
        first: batchSize,
        cursor: cursor
      });
      
      if (data.products?.edges) {
        allProducts = allProducts.concat(data.products.edges);
        hasMore = data.products.pageInfo.hasNextPage;
        const lastEdge = data.products.edges[data.products.edges.length - 1];
        cursor = lastEdge?.cursor;
        console.log('[APP_PROXY] Fetched', data.products.edges.length, 'products, total:', allProducts.length);
      } else {
        hasMore = false;
        console.log('[APP_PROXY] No more products found');
      }
    }
    
    console.log('[APP_PROXY] Total products fetched:', allProducts.length);
    
    // Generate XML
    console.log('[APP_PROXY] Generating XML sitemap...');
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
      console.log('[APP_PROXY] Adding collections for plan:', plan);
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
    
    console.log('[APP_PROXY] XML generation completed:', {
      processedProducts,
      productsWithBullets,
      productsWithFaq,
      xmlLength: xml.length
    });
    
    // Save to cache
    try {
      console.log('[APP_PROXY] Saving sitemap to cache...');
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
      
      console.log('[APP_PROXY] Sitemap cached successfully:', {
        id: sitemapDoc._id,
        contentSaved: !!sitemapDoc.content
      });
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
    
    console.log('[APP_PROXY] Sending sitemap response...');
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
  console.log('[APP_PROXY] Test endpoint called!');
  res.json({ 
    message: 'App Proxy controller is working!', 
    url: req.url,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });
});

// Mount App Proxy routes with HMAC verification
router.get('/sitemap.xml', appProxyAuth, handleSitemapProxy);
router.get('/sitemap', appProxyAuth, handleSitemapProxy);

export default router;
