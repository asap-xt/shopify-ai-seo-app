// backend/controllers/sitemapController.js - Enhanced version with debugging
// Key changes marked with // DEBUG: comments

import express from 'express';
import fetch from 'node-fetch';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import Sitemap from '../db/Sitemap.js';
import { resolveShopToken } from '../utils/tokenResolver.js';

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
  console.log('[SITEMAP] Resolving token for shop:', shop);
  try {
    const token = await resolveShopToken(shop);
    console.log('[SITEMAP] Token resolved successfully');
    return token;
  } catch (err) {
    console.error('[SITEMAP] Token resolution failed:', err.message);
    const error = new Error(`No access token found for shop: ${shop} - ${err.message}`);
    error.status = 400;
    throw error;
  }
}

// Helper: GraphQL request
async function shopGraphQL(shop, query, variables = {}) {
  const token = await resolveAdminTokenForShop(shop);
  const url = 'https://' + shop + '/admin/api/' + API_VERSION + '/graphql.json';
  console.log('[SITEMAP] GraphQL request to:', url);
  
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
    console.error('[SITEMAP] GraphQL errors:', json.errors || json);
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
    console.log('[SITEMAP] Subscription found:', !!sub, 'plan:', sub?.plan);
    
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
    console.error('[SITEMAP] Error getting plan limits:', e.message);
    return { limit: 50, plan: 'starter' };
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

// Handler functions
async function handleGenerate(req, res) {
  console.log('[SITEMAP] Generate called');
  console.log('[SITEMAP] Request body:', req.body);
  console.log('[SITEMAP] Request query:', req.query);
  
  try {
    const shop = normalizeShop(req.query.shop || req.body.shop);
    if (!shop) {
      console.error('[SITEMAP] Missing shop parameter');
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    console.log('[SITEMAP] Normalized shop:', shop);
    
    const { limit, plan } = await getPlanLimits(shop);
    console.log('[SITEMAP] Plan limits:', { limit, plan });
    
    // Get shop info and languages for AI discovery
    const shopQuery = `
      query {
        shop {
          primaryDomain { url }
        }
      }
    `;
    
    console.log('[SITEMAP] Fetching shop data...');
    const shopData = await shopGraphQL(shop, shopQuery);
    const primaryDomain = shopData.shop.primaryDomain.url;
    
    // Try to get locales, but fallback if no access
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
      console.log('[SITEMAP] Could not fetch locales (missing scope), using default:', locales);
    }
    
    console.log('[SITEMAP] Primary domain:', primaryDomain);
    console.log('[SITEMAP] Locales:', locales);
    
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
      console.log('[SITEMAP] Fetching products batch, size:', batchSize, 'cursor:', cursor);
      
      const data = await shopGraphQL(shop, productsQuery, {
        first: batchSize,
        cursor: cursor
      });
      
      if (data.products?.edges) {
        allProducts = allProducts.concat(data.products.edges);
        hasMore = data.products.pageInfo.hasNextPage;
        const lastEdge = data.products.edges[data.products.edges.length - 1];
        cursor = lastEdge?.cursor;
        console.log('[SITEMAP] Fetched', data.products.edges.length, 'products, total:', allProducts.length);
      } else {
        hasMore = false;
      }
    }
    
    console.log('[SITEMAP] Total products fetched:', allProducts.length);
    
    // DEBUG: Log first product's metafields to check data
    if (allProducts.length > 0) {
      const firstProduct = allProducts[0].node;
      console.log('[DEBUG] First product metafields:');
      console.log('  - ID:', firstProduct.id);
      console.log('  - Title:', firstProduct.title);
      console.log('  - Bullets metafield:', firstProduct.metafield_seo_ai_bullets);
      console.log('  - FAQ metafield:', firstProduct.metafield_seo_ai_faq);
    }
    
    // Generate AI-optimized XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:xhtml="http://www.w3.org/1999/xhtml"\n';
    xml += '        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"\n';
    xml += '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
    xml += '        xmlns:ai="http://www.aidata.org/schemas/sitemap/1.0">\n';
    
    // Homepage with structured data hint
    xml += '  <url>\n';
    xml += '    <loc>' + primaryDomain + '</loc>\n';
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';
    
    // Products with AI hints
    let debugProductCount = 0;
    let debugProductsWithBullets = 0;
    let debugProductsWithFaq = 0;
    
    for (const edge of allProducts) {
      const product = edge.node;
      if (!product.publishedAt || !product.handle) continue;
      
      debugProductCount++;
      const lastmod = new Date(product.updatedAt).toISOString().split('T')[0];
      
      // Parse AI metafields directly from aliased fields
      let bullets = null;
      let faq = null;
      
      // DEBUG: Enhanced parsing with logging
      if (product.metafield_seo_ai_bullets?.value) {
        try { 
          bullets = JSON.parse(product.metafield_seo_ai_bullets.value);
          if (bullets && bullets.length > 0) {
            debugProductsWithBullets++;
            console.log(`[DEBUG] Product ${product.id} has ${bullets.length} bullets`);
          }
        } catch (e) {
          console.error(`[DEBUG] Failed to parse bullets for product ${product.id}:`, e.message);
          console.error('  Raw value:', product.metafield_seo_ai_bullets.value);
        }
      }
      
      if (product.metafield_seo_ai_faq?.value) {
        try { 
          faq = JSON.parse(product.metafield_seo_ai_faq.value);
          if (faq && faq.length > 0) {
            debugProductsWithFaq++;
            console.log(`[DEBUG] Product ${product.id} has ${faq.length} FAQ items`);
          }
        } catch (e) {
          console.error(`[DEBUG] Failed to parse FAQ for product ${product.id}:`, e.message);
          console.error('  Raw value:', product.metafield_seo_ai_faq.value);
        }
      }
      
      // Add product URL with metadata hints for AI
      xml += '  <url>\n';
      xml += '    <loc>' + primaryDomain + '/products/' + product.handle + '</loc>\n';
      xml += '    <lastmod>' + lastmod + '</lastmod>\n';
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      
      // Add AI-optimized metadata
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
      
      // Add AI-generated bullets
      if (bullets && Array.isArray(bullets) && bullets.length > 0) {
        xml += '      <ai:features>\n';
        bullets.forEach(bullet => {
          if (bullet && bullet.trim()) { // Extra safety check
            xml += '        <ai:feature>' + escapeXml(bullet) + '</ai:feature>\n';
          }
        });
        xml += '      </ai:features>\n';
      }
      
      // Add AI-generated FAQ
      if (faq && Array.isArray(faq) && faq.length > 0) {
        xml += '      <ai:faq>\n';
        faq.forEach(item => {
          if (item && item.q && item.a) { // Extra safety check
            xml += '        <ai:qa>\n';
            xml += '          <ai:question>' + escapeXml(item.q) + '</ai:question>\n';
            xml += '          <ai:answer>' + escapeXml(item.a) + '</ai:answer>\n';
            xml += '        </ai:qa>\n';
          }
        });
        xml += '      </ai:faq>\n';
      }
      
      xml += '    </ai:product>\n';
      
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
    
    // DEBUG: Summary statistics
    console.log('[DEBUG] Sitemap generation summary:');
    console.log('  - Total products processed:', debugProductCount);
    console.log('  - Products with bullets:', debugProductsWithBullets);
    console.log('  - Products with FAQ:', debugProductsWithFaq);
    
    // Add collections for AI category understanding
    if (['growth', 'professional', 'growth_extra', 'enterprise'].includes(plan?.toLowerCase())) {
      console.log('[SITEMAP] Including collections for plan:', plan);
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
    
    // Save sitemap info to database
    try {
      console.log('[SITEMAP] Attempting to save sitemap...');
      console.log('[SITEMAP] XML size:', Buffer.byteLength(xml, 'utf8'), 'bytes');
      
      const sitemapDoc = await Sitemap.findOneAndUpdate(
        { shop },
        {
          shop,
          generatedAt: new Date(),
          url: `https://${shop}/sitemap.xml`,
          productCount: allProducts.length,
          size: Buffer.byteLength(xml, 'utf8'),
          plan: plan,
          status: 'completed',
          content: xml
        },
        { 
          upsert: true, 
          new: true,
          runValidators: false // Skip validation issues
        }
      );
      
      console.log('[SITEMAP] Save result:');
      console.log('  - Document ID:', sitemapDoc._id);
      console.log('  - Content saved:', !!sitemapDoc.content);
      
      // Verify that content is actually saved
      const verification = await Sitemap.findById(sitemapDoc._id).select('+content').lean();
      console.log('[SITEMAP] Verification - content exists:', !!verification?.content);
      console.log('[SITEMAP] Verification - content length:', verification?.content?.length || 0);
      
    } catch (saveErr) {
      console.error('[SITEMAP] Failed to save sitemap info:', saveErr);
      // Continue even if save fails
    }
    
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
}

async function handleInfo(req, res) {
  console.log('[SITEMAP] Info called, query:', req.query);
  
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    console.log('[SITEMAP] Getting info for shop:', shop);
    
    const { limit, plan } = await getPlanLimits(shop);
    
    // Check if sitemap exists
    const existingSitemap = await Sitemap.findOne({ shop }).select('-content').lean();
    console.log('[SITEMAP] Existing sitemap found:', !!existingSitemap);
    
    // Get actual product count
    const countData = await shopGraphQL(shop, `
      query {
        productsCount {
          count
        }
      }
    `);
    
    const productCount = countData.productsCount?.count || 0;
    const includesCollections = ['growth', 'professional', 'growth_extra', 'enterprise'].includes(plan?.toLowerCase());
    
    const response = {
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
        structuredData: true,
        bullets: true,
        faq: true
      },
      url: `https://${shop}/sitemap.xml`,
      generated: !!existingSitemap,
      generatedAt: existingSitemap?.generatedAt || null,
      lastProductCount: existingSitemap?.productCount || 0,
      size: existingSitemap?.size || 0
    };
    
    console.log('[SITEMAP] Returning info:', response);
    return res.json(response);
    
  } catch (err) {
    console.error('[SITEMAP] Info error:', err);
    return res.status(err.status || 500).json({ 
      error: err.message || 'Failed to get sitemap info' 
    });
  }
}

async function handleProgress(req, res) {
  // Simple implementation - sitemap generation is synchronous
  res.json({ status: 'completed', progress: 100 });
}

// Add new function to serve saved sitemap
async function serveSitemap(req, res) {
  console.log('[SITEMAP] Serve sitemap called, query:', req.query);
  
  try {
    const shop = normalizeShop(req.query.shop || req.params.shop);
    if (!shop) {
      console.error('[SITEMAP] Missing shop parameter');
      return res.status(400).send('Missing shop parameter');
    }
    
    console.log('[SITEMAP] Looking for sitemap for shop:', shop);
    
    // Get saved sitemap with content - use .lean() for better performance
    const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
    console.log('[SITEMAP] Found sitemap:', !!sitemapDoc);
    console.log('[SITEMAP] Has content:', !!(sitemapDoc?.content));
    console.log('[SITEMAP] Content length:', sitemapDoc?.content?.length || 0);
    
    if (!sitemapDoc || !sitemapDoc.content) {
      // Try to generate new one if none exists
      console.log('[SITEMAP] No saved sitemap, returning 404');
      return res.status(404).send('Sitemap not found. Please generate it first.');
    }
    
    // Serve the saved sitemap
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Last-Modified': new Date(sitemapDoc.generatedAt).toUTCString()
    });
    res.send(sitemapDoc.content);
    
  } catch (err) {
    console.error('[SITEMAP] Serve error:', err);
    res.status(500).send('Failed to serve sitemap');
  }
}

// Mount routes on router
router.get('/info', handleInfo);
router.get('/progress', handleProgress);
router.post('/generate', handleGenerate); // POST generates new sitemap
router.get('/generate', serveSitemap); // GET returns saved sitemap
router.get('/view', serveSitemap); // Alternative endpoint to view sitemap

// Export default router
export default router;