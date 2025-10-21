// backend/controllers/sitemapController.js - Enhanced version with debugging
// Key changes marked with // DEBUG: comments

import express from 'express';
import fetch from 'node-fetch';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import Sitemap from '../db/Sitemap.js';
import { resolveShopToken } from '../utils/tokenResolver.js';
import { enhanceProductForSitemap } from '../services/aiSitemapEnhancer.js';

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
  
  console.log('[SITEMAP] Token prefix:', token ? token.substring(0, 20) + '...' : 'NO TOKEN');
  
  // Always use OAuth access token for GraphQL API calls
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token,
  };
  
  console.log('[SITEMAP] Using OAuth access token for GraphQL');
  
  const rsp = await fetch(url, {
    method: 'POST',
    headers,
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
    console.log('[SITEMAP] Product', productId, 'SEO languages:', result);
    return result;
  } catch (error) {
    console.error('[SITEMAP] Error checking SEO languages for product:', productId, error);
    return ['en']; // Fallback to English only
  }
}

// Helper: Get localized content for a product in a specific language
async function getProductLocalizedContent(shop, productId, language) {
  try {
    const metafieldKey = `seo__${language.toLowerCase()}`;
    const query = `
      query GetProductLocalizedContent($id: ID!) {
        product(id: $id) {
          metafield(namespace: "seo_ai", key: "${metafieldKey}") {
            value
            type
          }
        }
      }
    `;
    
    const data = await shopGraphQL(shop, query, { id: productId });
    const metafield = data?.product?.metafield;
    
    if (metafield?.value) {
      try {
        const seoData = JSON.parse(metafield.value);
        console.log(`[SITEMAP-CORE] Found localized content for ${language}:`, {
          title: seoData.title,
          metaDescription: seoData.metaDescription?.substring(0, 100) + '...'
        });
        return seoData;
      } catch (parseErr) {
        console.log(`[SITEMAP-CORE] Failed to parse localized content for ${language}:`, parseErr.message);
        return null;
      }
    }
    
    console.log(`[SITEMAP-CORE] No localized content found for ${language}`);
    return null;
  } catch (error) {
    console.log(`[SITEMAP-CORE] Error getting localized content for ${language}:`, error.message);
    return null;
  }
}

// Helper: get plan limits
async function getPlanLimits(shop) {
  try {
    const sub = await Subscription.findOne({ shop }).lean().exec();
    console.log('[SITEMAP] Subscription found:', !!sub, 'plan:', sub?.plan);
    
    if (!sub) return { limit: 100, plan: 'starter' };
    
    const planLimits = {
      'starter': 100,
      'professional': 350,
      'growth': 1000,
      'growth_extra': 2500,
      'enterprise': 6000
    };
    
    const limit = planLimits[sub.plan?.toLowerCase()] || 100;
    return { limit, plan: sub.plan };
  } catch (e) {
    console.error('[SITEMAP] Error getting plan limits:', e.message);
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

// Core sitemap generation function (without Express req/res dependencies)
async function generateSitemapCore(shop) {
  console.log('[SITEMAP-CORE] Starting sitemap generation for shop:', shop);
  
  try {
    const normalizedShop = normalizeShop(shop);
    if (!normalizedShop) {
      throw new Error('Invalid shop parameter');
    }
    
    console.log('[SITEMAP-CORE] Normalized shop:', normalizedShop);
    
    const { limit, plan } = await getPlanLimits(normalizedShop);
    console.log('[SITEMAP-CORE] Plan limits:', { limit, plan });
    
    // Check AI Discovery settings for AI-Optimized Sitemap
    let isAISitemapEnabled = false;
    try {
      const { default: aiDiscoveryService } = await import('../services/aiDiscoveryService.js');
      const { default: Shop } = await import('../db/Shop.js');
      
      const shopRecord = await Shop.findOne({ shop: normalizedShop });
      if (shopRecord?.accessToken) {
        const session = { accessToken: shopRecord.accessToken };
        const settings = await aiDiscoveryService.getSettings(normalizedShop, session);
        isAISitemapEnabled = settings?.features?.aiSitemap || false;
        console.log('[SITEMAP-CORE] AI Discovery settings:', { aiSitemap: isAISitemapEnabled });
      }
    } catch (error) {
      console.log('[SITEMAP-CORE] Could not fetch AI Discovery settings, using basic sitemap:', error.message);
    }
    
    // Get shop info and languages
    const shopQuery = `
      query {
        shop {
          primaryDomain { url }
        }
      }
    `;
    
    console.log('[SITEMAP-CORE] Fetching shop data...');
    const shopData = await shopGraphQL(normalizedShop, shopQuery);
    console.log('[SITEMAP-CORE] Shop data fetched successfully');
    const primaryDomain = shopData.shop.primaryDomain.url;
    console.log('[SITEMAP-CORE] Primary domain:', primaryDomain);
    
    // Try to get locales
    console.log('[SITEMAP-CORE] Fetching locales...');
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
      const localesData = await shopGraphQL(normalizedShop, localesQuery);
      console.log('[SITEMAP-CORE] Locales data fetched:', localesData);
      if (localesData.shopLocales) {
        locales = localesData.shopLocales;
        console.log('[SITEMAP-CORE] Using fetched locales:', locales);
      } else {
        console.log('[SITEMAP-CORE] No locales found, using default');
      }
    } catch (localeErr) {
      console.log('[SITEMAP-CORE] Could not fetch locales, using default:', localeErr.message);
    }
    
    console.log('[SITEMAP-CORE] Primary domain:', primaryDomain);
    console.log('[SITEMAP-CORE] Locales:', locales);
    
    // Fetch products with AI-relevant data
    console.log('[SITEMAP-CORE] Starting to fetch products...');
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
                metafield_seo_ai: metafield(namespace: "seo_ai", key: "seo__en") {
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
      console.log('[SITEMAP-CORE] Fetching products batch, size:', batchSize, 'cursor:', cursor);
      
      const data = await shopGraphQL(normalizedShop, productsQuery, { cursor, first: batchSize });
      const products = data?.products || { edges: [], pageInfo: {} };
      
      allProducts.push(...products.edges);
      hasMore = products.pageInfo.hasNextPage;
      cursor = products.edges[products.edges.length - 1]?.cursor;
      
      console.log('[SITEMAP-CORE] Fetched', products.edges.length, 'products, total:', allProducts.length);
    }
    
    console.log('[SITEMAP-CORE] Total products fetched:', allProducts.length);
    
    // Generate XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:xhtml="http://www.w3.org/1999/xhtml"';
    
    // Add AI namespace only if AI sitemap is enabled
    console.log('[SITEMAP-CORE] isAISitemapEnabled:', isAISitemapEnabled);
    if (isAISitemapEnabled) {
      xml += '\n        xmlns:ai="http://www.aidata.org/schemas/sitemap/1.0"';
      console.log('[SITEMAP-CORE] Added AI namespace to XML');
    } else {
      console.log('[SITEMAP-CORE] AI namespace NOT added to XML');
    }
    
    xml += '>\n';
    
    // Add products
    for (const edge of allProducts) {
      const product = edge.node;
      const lastmod = new Date(product.updatedAt).toISOString().split('T')[0];
      
      // Main product URL
      xml += '  <url>\n';
      xml += '    <loc>' + primaryDomain + '/products/' + product.handle + '</loc>\n';
      xml += '    <lastmod>' + lastmod + '</lastmod>\n';
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      
      // Add AI metadata ONLY if AI sitemap is enabled
      console.log('[SITEMAP-CORE] Product', product.handle, '- isAISitemapEnabled:', isAISitemapEnabled);
      if (isAISitemapEnabled) {
        console.log('[SITEMAP-CORE] Adding AI metadata for product:', product.handle);
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
          xml += '      <ai:tags>' + escapeXml(product.tags.join(', ')) + '</ai:tags>\n';
        }
        
        // Add AI-generated bullets from main SEO metafield
        let bullets = null;
        console.log('[SITEMAP-CORE] Checking bullets for', product.handle, ':', !!product.metafield_seo_ai?.value);
        if (product.metafield_seo_ai?.value) {
          try {
            const seoData = JSON.parse(product.metafield_seo_ai.value);
            bullets = seoData.bullets || null;
            console.log('[SITEMAP-CORE] Parsed bullets for', product.handle, ':', bullets?.length || 0, 'items');
          } catch (e) {
            console.log('[SITEMAP-CORE] Could not parse bullets for', product.handle, ':', e.message);
          }
        }
        
        if (bullets && Array.isArray(bullets) && bullets.length > 0) {
          xml += '      <ai:features>\n';
          bullets.forEach(bullet => {
            if (bullet && bullet.trim()) {
              xml += '        <ai:feature>' + escapeXml(bullet) + '</ai:feature>\n';
            }
          });
          xml += '      </ai:features>\n';
        }
        
        // Add AI-generated FAQ from main SEO metafield
        let faq = null;
        console.log('[SITEMAP-CORE] Checking FAQ for', product.handle, ':', !!product.metafield_seo_ai?.value);
        if (product.metafield_seo_ai?.value) {
          try {
            const seoData = JSON.parse(product.metafield_seo_ai.value);
            faq = seoData.faq || null;
            console.log('[SITEMAP-CORE] Parsed FAQ for', product.handle, ':', faq?.length || 0, 'items');
          } catch (e) {
            console.log('[SITEMAP-CORE] Could not parse FAQ for', product.handle, ':', e.message);
          }
        }
        
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
        
        // ===== NEW: AI-ENHANCED METADATA =====
        try {
          console.log('[SITEMAP-CORE] Generating AI enhancements for', product.handle);
          
          // Prepare product data for AI enhancement
          const productForAI = {
            id: product.id,
            title: product.title,
            description: cleanHtmlForXml(product.descriptionHtml),
            productType: product.productType,
            tags: product.tags,
            vendor: product.vendor,
            price: product.priceRangeV2?.minVariantPrice?.amount
          };
          
          // Generate AI enhancements (with timeout)
          // Uses Gemini 2.5 Flash (Lite) for fast, cost-effective generation
          const enhancementPromise = enhanceProductForSitemap(productForAI, allProducts, {
            enableSummary: true,
            enableSemanticTags: true,
            enableContextHints: true,
            enableQA: true,
            enableSentiment: true,
            enableRelated: true
          });
          
          // Set timeout to avoid blocking
          const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
          const aiEnhancements = await Promise.race([enhancementPromise, timeoutPromise]);
          
          if (aiEnhancements) {
            console.log('[SITEMAP-CORE] AI enhancements generated for', product.handle);
            
            // Add AI-generated summary
            if (aiEnhancements.summary) {
              xml += '      <ai:summary><![CDATA[' + aiEnhancements.summary + ']]></ai:summary>\n';
            }
            
            // Add semantic tags
            if (aiEnhancements.semanticTags) {
              xml += '      <ai:semantic_tags>\n';
              xml += '        <ai:category_hierarchy>' + escapeXml(aiEnhancements.semanticTags.categoryHierarchy) + '</ai:category_hierarchy>\n';
              xml += '        <ai:use_case>' + escapeXml(aiEnhancements.semanticTags.useCase) + '</ai:use_case>\n';
              xml += '        <ai:skill_level>' + escapeXml(aiEnhancements.semanticTags.skillLevel) + '</ai:skill_level>\n';
              xml += '        <ai:season>' + escapeXml(aiEnhancements.semanticTags.season) + '</ai:season>\n';
              xml += '      </ai:semantic_tags>\n';
            }
            
            // Add context hints
            if (aiEnhancements.contextHints) {
              xml += '      <ai:context>\n';
              xml += '        <ai:best_for>' + escapeXml(aiEnhancements.contextHints.bestFor) + '</ai:best_for>\n';
              xml += '        <ai:key_differentiator>' + escapeXml(aiEnhancements.contextHints.keyDifferentiator) + '</ai:key_differentiator>\n';
              xml += '        <ai:target_audience>' + escapeXml(aiEnhancements.contextHints.targetAudience) + '</ai:target_audience>\n';
              xml += '      </ai:context>\n';
            }
            
            // Add AI-generated Q&A
            if (aiEnhancements.qa && aiEnhancements.qa.length > 0) {
              xml += '      <ai:generated_faq>\n';
              aiEnhancements.qa.forEach(qa => {
                xml += '        <ai:qa>\n';
                xml += '          <ai:question>' + escapeXml(qa.question) + '</ai:question>\n';
                xml += '          <ai:answer><![CDATA[' + qa.answer + ']]></ai:answer>\n';
                xml += '        </ai:qa>\n';
              });
              xml += '      </ai:generated_faq>\n';
            }
            
            // Add sentiment/tone
            if (aiEnhancements.sentiment) {
              xml += '      <ai:tone>' + escapeXml(aiEnhancements.sentiment.tone) + '</ai:tone>\n';
              xml += '      <ai:target_emotion>' + escapeXml(aiEnhancements.sentiment.targetEmotion) + '</ai:target_emotion>\n';
            }
            
            // Add related products
            if (aiEnhancements.relatedProducts && aiEnhancements.relatedProducts.length > 0) {
              xml += '      <ai:related>\n';
              aiEnhancements.relatedProducts.forEach(related => {
                xml += '        <ai:product_link>' + primaryDomain + '/products/' + related.handle + '</ai:product_link>\n';
              });
              xml += '      </ai:related>\n';
            }
          } else {
            console.log('[SITEMAP-CORE] AI enhancement timeout or error for', product.handle);
          }
        } catch (aiError) {
          console.error('[SITEMAP-CORE] Error in AI enhancement for', product.handle, ':', aiError.message);
          // Continue without AI enhancements
        }
        // ===== END: AI-ENHANCED METADATA =====
        
        xml += '    </ai:product>\n';
      }
      
      xml += '  </url>\n';
      
      // Add multilingual URLs
      const hasMultiLanguageSEO = await checkProductSEOLanguages(normalizedShop, product.id);
      if (hasMultiLanguageSEO.length > 1) {
        for (const lang of hasMultiLanguageSEO) {
          if (lang === 'en') continue; // Skip English as it's the main URL
          
          const langUrl = primaryDomain + '/' + lang + '/products/' + product.handle;
          let langTitle = product.title;
          let langDescription = cleanHtmlForXml(product.descriptionHtml);
          
          // Try to get localized content
          try {
            const seo = await getProductLocalizedContent(normalizedShop, product.id, lang);
            if (seo) {
              langTitle = seo.title || langTitle;
              langDescription = seo.metaDescription || langDescription;
            }
          } catch (err) {
            console.log(`[SITEMAP-CORE] Could not get SEO for ${lang}:`, err.message);
          }
          
          xml += '  <url>\n';
          xml += '    <loc>' + langUrl + '</loc>\n';
          xml += '    <lastmod>' + lastmod + '</lastmod>\n';
          xml += '    <changefreq>weekly</changefreq>\n';
          xml += '    <priority>0.8</priority>\n';
          
          // Add AI metadata ONLY if AI sitemap is enabled
          if (isAISitemapEnabled) {
            console.log('[SITEMAP-CORE] Adding AI metadata for multilingual product:', product.handle, 'language:', lang);
            xml += '    <ai:product>\n';
            xml += '      <ai:title>' + escapeXml(langTitle) + '</ai:title>\n';
            xml += '      <ai:description><![CDATA[' + langDescription + ']]></ai:description>\n';
            xml += '      <ai:language>' + lang + '</ai:language>\n';
            
            // Add localized AI bullets and FAQ
            try {
              const localizedSeo = await getProductLocalizedContent(normalizedShop, product.id, lang);
              if (localizedSeo) {
                // Add localized bullets
                if (localizedSeo.bullets && Array.isArray(localizedSeo.bullets) && localizedSeo.bullets.length > 0) {
                  xml += '      <ai:features>\n';
                  localizedSeo.bullets.forEach(bullet => {
                    if (bullet && bullet.trim()) {
                      xml += '        <ai:feature>' + escapeXml(bullet) + '</ai:feature>\n';
                    }
                  });
                  xml += '      </ai:features>\n';
                }
                
                // Add localized FAQ
                if (localizedSeo.faq && Array.isArray(localizedSeo.faq) && localizedSeo.faq.length > 0) {
                  xml += '      <ai:faq>\n';
                  localizedSeo.faq.forEach(item => {
                    if (item && item.q && item.a) {
                      xml += '        <ai:qa>\n';
                      xml += '          <ai:question>' + escapeXml(item.q) + '</ai:question>\n';
                      xml += '          <ai:answer>' + escapeXml(item.a) + '</ai:answer>\n';
                      xml += '        </ai:qa>\n';
                    }
                  });
                  xml += '      </ai:faq>\n';
                }
              }
            } catch (err) {
              console.log(`[SITEMAP-CORE] Could not get localized AI content for ${lang}:`, err.message);
            }
            
            xml += '    </ai:product>\n';
          }
          
          xml += '  </url>\n';
        }
      }
    }
    
    // Add collections if plan supports it
    if (['growth', 'growth_extra', 'enterprise'].includes(plan)) {
      console.log('[SITEMAP-CORE] Including collections for plan:', plan);
      try {
        const collectionsQuery = `
          query {
            collections(first: 20) {
              edges {
                node {
                  id
                  handle
                  title
                  updatedAt
                }
              }
            }
          }
        `;
        
        const collectionsData = await shopGraphQL(normalizedShop, collectionsQuery);
        const collections = collectionsData?.collections?.edges || [];
        
        for (const edge of collections) {
          const collection = edge.node;
          const lastmod = new Date(collection.updatedAt).toISOString().split('T')[0];
          
          xml += '  <url>\n';
          xml += '    <loc>' + primaryDomain + '/collections/' + collection.handle + '</loc>\n';
          xml += '    <lastmod>' + lastmod + '</lastmod>\n';
          xml += '    <changefreq>weekly</changefreq>\n';
          xml += '    <priority>0.7</priority>\n';
          xml += '  </url>\n';
        }
        
        console.log('[SITEMAP-CORE] Added', collections.length, 'collections');
      } catch (collectionsErr) {
        console.log('[SITEMAP-CORE] Could not fetch collections:', collectionsErr.message);
      }
    }
    
    // Add pages
    try {
      const pagesQuery = `
        query {
          pages(first: 10) {
            edges {
              node {
                id
                handle
                title
                updatedAt
              }
            }
          }
        }
      `;
      
      const pagesData = await shopGraphQL(normalizedShop, pagesQuery);
      const pages = pagesData?.pages?.edges || [];
      
      for (const edge of pages) {
        const page = edge.node;
        const lastmod = new Date(page.updatedAt).toISOString().split('T')[0];
        
        xml += '  <url>\n';
        xml += '    <loc>' + primaryDomain + '/pages/' + page.handle + '</loc>\n';
        xml += '    <lastmod>' + lastmod + '</lastmod>\n';
        xml += '    <changefreq>monthly</changefreq>\n';
        xml += '    <priority>0.6</priority>\n';
        xml += '  </url>\n';
      }
      
      console.log('[SITEMAP-CORE] Added', pages.length, 'pages');
    } catch (pagesErr) {
      console.log('[SITEMAP-CORE] Could not fetch pages:', pagesErr.message);
    }
    
    xml += '</urlset>\n';
    
    // Save to database
    console.log('[SITEMAP-CORE] Attempting to save sitemap...');
    console.log('[SITEMAP-CORE] XML size:', xml.length, 'bytes');
    
    const { default: Sitemap } = await import('../db/Sitemap.js');
    const sitemapDoc = await Sitemap.findOneAndUpdate(
      { shop: normalizedShop },
      {
        shop: normalizedShop,
        generatedAt: new Date(),
        url: primaryDomain + '/sitemap.xml',
        productCount: allProducts.length,
        size: xml.length,
        plan: plan,
        status: 'completed',
        content: xml
      },
      { upsert: true, new: true }
    );
    
    console.log('[SITEMAP-CORE] Save result:');
    console.log('[SITEMAP-CORE]   - Document ID:', sitemapDoc._id);
    console.log('[SITEMAP-CORE]   - Content saved:', !!sitemapDoc.content);
    
    // Verify save
    const verification = await Sitemap.findOne({ shop: normalizedShop }).select('content');
    console.log('[SITEMAP-CORE] Verification - content exists:', !!verification?.content);
    console.log('[SITEMAP-CORE] Verification - content length:', verification?.content?.length || 0);
    
    console.log('[SITEMAP-CORE] Sitemap generation completed successfully');
    console.log('[SITEMAP-CORE] Final result:', {
      success: true,
      shop: normalizedShop,
      productCount: allProducts.length,
      size: xml.length,
      aiEnabled: isAISitemapEnabled
    });
    
    return {
      success: true,
      shop: normalizedShop,
      productCount: allProducts.length,
      size: xml.length,
      aiEnabled: isAISitemapEnabled
    };
    
  } catch (error) {
    console.error('[SITEMAP-CORE] Error:', error);
    throw error;
  }
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
    
    // Check AI Discovery settings for AI-Optimized Sitemap
    let isAISitemapEnabled = false;
    try {
      const { default: aiDiscoveryService } = await import('../services/aiDiscoveryService.js');
      const { default: Shop } = await import('../db/Shop.js');
      
      const shopRecord = await Shop.findOne({ shop });
      if (shopRecord?.accessToken) {
        const session = { accessToken: shopRecord.accessToken };
        const settings = await aiDiscoveryService.getSettings(shop, session);
        isAISitemapEnabled = settings?.features?.aiSitemap || false;
        console.log('[SITEMAP] AI Discovery settings:', { aiSitemap: isAISitemapEnabled });
      }
    } catch (error) {
      console.log('[SITEMAP] Could not fetch AI Discovery settings, using basic sitemap:', error.message);
    }
    
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
                metafield_seo_ai: metafield(namespace: "seo_ai", key: "seo__en") {
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
      console.log('  - SEO AI metafield:', firstProduct.metafield_seo_ai);
      console.log('  - SEO AI metafield value:', firstProduct.metafield_seo_ai?.value);
    }
    
    // Generate XML with conditional AI namespace
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:xhtml="http://www.w3.org/1999/xhtml"\n';
    xml += '        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"\n';
    xml += '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
    
    // Add AI namespace only if AI sitemap is enabled
    console.log('[SITEMAP] isAISitemapEnabled:', isAISitemapEnabled);
    if (isAISitemapEnabled) {
      xml += '\n        xmlns:ai="http://www.aidata.org/schemas/sitemap/1.0"';
      console.log('[SITEMAP] Added AI namespace to XML');
    } else {
      console.log('[SITEMAP] AI namespace NOT added to XML');
    }
    
    xml += '>\n';
    
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
      if (product.metafield_seo_ai?.value) {
        try { 
          const seoData = JSON.parse(product.metafield_seo_ai.value);
          bullets = seoData.bullets || null;
          faq = seoData.faq || null;
          
          if (bullets && bullets.length > 0) {
            debugProductsWithBullets++;
            console.log(`[DEBUG] Product ${product.id} has ${bullets.length} bullets`);
          }
          if (faq && faq.length > 0) {
            debugProductsWithFaq++;
            console.log(`[DEBUG] Product ${product.id} has ${faq.length} FAQ items`);
          }
        } catch (e) {
          console.error(`[DEBUG] Failed to parse SEO AI metafield for product ${product.id}:`, e.message);
          console.error('  Raw value:', product.metafield_seo_ai.value);
        }
      }
      
      // Check if product has SEO optimization for multiple languages
      const hasMultiLanguageSEO = await checkProductSEOLanguages(shop, product.id, locales);
      
      // Add default language URL
      xml += '  <url>\n';
      xml += '    <loc>' + primaryDomain + '/products/' + product.handle + '</loc>\n';
      xml += '    <lastmod>' + lastmod + '</lastmod>\n';
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      
      // Add hreflang for multilingual SEO if available
      if (hasMultiLanguageSEO.length > 1) {
        for (const lang of hasMultiLanguageSEO) {
          const langCode = lang === 'en' ? '' : `/${lang}`;
          xml += `    <xhtml:link rel="alternate" hreflang="${lang}" href="${primaryDomain}${langCode}/products/${product.handle}" />\n`;
        }
      }
      
      // Add AI-optimized metadata ONLY if AI sitemap is enabled
      console.log('[SITEMAP] Product', product.handle, '- isAISitemapEnabled:', isAISitemapEnabled);
      if (isAISitemapEnabled) {
        console.log('[SITEMAP] Adding AI metadata for product:', product.handle);
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
      }
      xml += '  </url>\n';
      
      // Add separate URLs for each language with SEO optimization
      for (const lang of hasMultiLanguageSEO) {
        if (lang !== 'en') { // Skip default language as it's already added
          const langUrl = `${primaryDomain}/${lang}/products/${product.handle}`;
          
          // Try to get SEO data for this language
          let langTitle = product.title;
          let langDescription = product.seo?.description || cleanHtmlForXml(product.descriptionHtml);
          
          try {
            const seoQuery = `
              query GetProductSEO($id: ID!) {
                product(id: $id) {
                  metafield(namespace: "seo_ai", key: "seo__${lang}") {
                    value
                  }
                }
              }
            `;
            
            const seoData = await shopGraphQL(shop, seoQuery, { id: product.id });
            if (seoData?.product?.metafield?.value) {
              const seo = JSON.parse(seoData.product.metafield.value);
              langTitle = seo.title || langTitle;
              langDescription = seo.metaDescription || langDescription;
            }
          } catch (err) {
            console.log(`[SITEMAP] Could not get SEO for ${lang}:`, err.message);
          }
          
          xml += '  <url>\n';
          xml += '    <loc>' + langUrl + '</loc>\n';
          xml += '    <lastmod>' + lastmod + '</lastmod>\n';
          xml += '    <changefreq>weekly</changefreq>\n';
          xml += '    <priority>0.8</priority>\n';
          
          // Add AI metadata ONLY if AI sitemap is enabled
          if (isAISitemapEnabled) {
            console.log('[SITEMAP] Adding AI metadata for multilingual product:', product.handle, 'language:', lang);
            xml += '    <ai:product>\n';
            xml += '      <ai:title>' + escapeXml(langTitle) + '</ai:title>\n';
            xml += '      <ai:description><![CDATA[' + langDescription + ']]></ai:description>\n';
            xml += '      <ai:language>' + lang + '</ai:language>\n';
            xml += '    </ai:product>\n';
          }
          
          xml += '  </url>\n';
        }
      }
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
  console.log('[SITEMAP] ===== SERVE SITEMAP CALLED =====');
  console.log('[SITEMAP] URL:', req.url);
  console.log('[SITEMAP] Query:', req.query);
  console.log('[SITEMAP] Method:', req.method);
  
  try {
    const shop = normalizeShop(req.query.shop || req.params.shop);
    if (!shop) {
      console.error('[SITEMAP] Missing shop parameter');
      return res.status(400).send('Missing shop parameter');
    }
    
    const forceRegenerate = req.query.force === 'true';
    console.log('[SITEMAP] Force regenerate:', forceRegenerate);
    console.log('[SITEMAP] Force parameter value:', req.query.force);
    console.log('[SITEMAP] Looking for sitemap for shop:', shop);
    
    // Check if we should force regenerate
    if (forceRegenerate) {
      console.log('[SITEMAP] Force regeneration requested, generating new sitemap...');
      try {
        const result = await generateSitemapCore(shop);
        console.log('[SITEMAP] Generated new sitemap:', result);
        
        // Get the newly generated sitemap
        const newSitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
        if (newSitemapDoc && newSitemapDoc.content) {
          res.set({
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
            'Last-Modified': new Date(newSitemapDoc.generatedAt).toUTCString()
          });
          return res.send(newSitemapDoc.content);
        }
      } catch (genErr) {
        console.error('[SITEMAP] Failed to generate sitemap:', genErr);
        return res.status(500).send('Failed to generate sitemap');
      }
    }
    
    // Get saved sitemap with content - use .lean() for better performance
    const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
    console.log('[SITEMAP] Found sitemap:', !!sitemapDoc);
    console.log('[SITEMAP] Has content:', !!(sitemapDoc?.content));
    console.log('[SITEMAP] Content length:', sitemapDoc?.content?.length || 0);
    
    if (!sitemapDoc || !sitemapDoc.content) {
      // Try to generate new one if none exists
      console.log('[SITEMAP] No saved sitemap, generating new one...');
      try {
        const result = await generateSitemapCore(shop);
        console.log('[SITEMAP] Generated new sitemap:', result);
        
        // Get the newly generated sitemap
        const newSitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
        if (newSitemapDoc && newSitemapDoc.content) {
          res.set({
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
            'Last-Modified': new Date(newSitemapDoc.generatedAt).toUTCString()
          });
          return res.send(newSitemapDoc.content);
        }
      } catch (genErr) {
        console.error('[SITEMAP] Failed to generate sitemap:', genErr);
      }
      
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

// Public sitemap endpoint (no authentication required)
async function handlePublicSitemap(req, res) {
  console.log('[PUBLIC_SITEMAP] ===== PUBLIC SITEMAP REQUEST =====');
  console.log('[PUBLIC_SITEMAP] Query:', req.query);
  
  const shop = normalizeShop(req.query.shop);
  if (!shop) {
    console.error('[PUBLIC_SITEMAP] Missing shop parameter');
    return res.status(400).send('Missing shop parameter. Use: /api/sitemap/public?shop=your-shop.myshopify.com');
  }
  
  console.log('[PUBLIC_SITEMAP] Processing for shop:', shop);
  
  try {
    // Check for cached sitemap
    const cachedSitemap = await Sitemap.findOne({ shop }).select('+content').lean().exec();
    
    if (cachedSitemap && cachedSitemap.content) {
      console.log('[PUBLIC_SITEMAP] Serving cached sitemap for shop:', shop);
      
      res.set({
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=21600', // 6 hours
        'Last-Modified': new Date(cachedSitemap.generatedAt).toUTCString(),
        'X-Sitemap-Cache': 'HIT',
        'X-Sitemap-Generated': cachedSitemap.generatedAt,
        'X-Sitemap-Products': cachedSitemap.productCount?.toString() || '0'
      });
      return res.send(cachedSitemap.content);
    } else {
      console.log('[PUBLIC_SITEMAP] No cached sitemap found for shop:', shop);
      return res.status(404).send(`
Sitemap not found for shop: ${shop}

To generate a sitemap:
1. Install the NEW AI SEO app in your Shopify admin
2. Go to the Sitemap section and click "Generate Sitemap"
3. Your sitemap will be available at this URL

App URL: https://new-ai-seo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
      `);
    }
  } catch (error) {
    console.error('[PUBLIC_SITEMAP] Error:', error);
    res.status(500).send(`Failed to serve sitemap: ${error.message}`);
  }
}

// Public sitemap endpoint (no authentication required) - simplified version
async function servePublicSitemap(req, res) {
  console.log('[PUBLIC_SITEMAP] ===== PUBLIC SITEMAP REQUEST =====');
  console.log('[PUBLIC_SITEMAP] Query:', req.query);
  
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      console.error('[PUBLIC_SITEMAP] Missing shop parameter');
      return res.status(400).send('Missing shop parameter. Use: ?shop=your-shop.myshopify.com');
    }
    
    console.log('[PUBLIC_SITEMAP] Processing for shop:', shop);
    
    // Get saved sitemap with content
    const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
    console.log('[PUBLIC_SITEMAP] Found sitemap:', !!sitemapDoc);
    
    if (!sitemapDoc || !sitemapDoc.content) {
      console.log('[PUBLIC_SITEMAP] No sitemap found, returning instructions');
      return res.status(404).send(`
Sitemap not found for shop: ${shop}

To generate a sitemap:
1. Install the NEW AI SEO app in your Shopify admin
2. Go to the Sitemap section and click "Generate Sitemap"
3. Your sitemap will be available at this URL

App URL: https://new-ai-seo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
      `);
    }
    
    // Serve the saved sitemap
    console.log('[PUBLIC_SITEMAP] Serving sitemap for shop:', shop);
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=21600', // 6 hours
      'Last-Modified': new Date(sitemapDoc.generatedAt).toUTCString(),
      'X-Sitemap-Cache': 'HIT',
      'X-Sitemap-Generated': sitemapDoc.generatedAt,
      'X-Sitemap-Products': sitemapDoc.productCount?.toString() || '0'
    });
    res.send(sitemapDoc.content);
    
  } catch (err) {
    console.error('[PUBLIC_SITEMAP] Error:', err);
    res.status(500).send(`Failed to serve sitemap: ${err.message}`);
  }
}

// Mount routes on router
router.get('/info', handleInfo);
router.get('/progress', handleProgress);
router.post('/generate', handleGenerate); // POST generates new sitemap
router.get('/generate', serveSitemap); // GET returns saved sitemap
router.get('/view', serveSitemap); // Alternative endpoint to view sitemap
router.get('/public', servePublicSitemap); // Public endpoint (no auth required)

// Export default router
// Export the generate function for background regeneration
export { handleGenerate as generateSitemap, generateSitemapCore };

export default router;