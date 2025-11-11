// backend/controllers/sitemapController.js - Enhanced version with debugging
// Key changes marked with // DEBUG: comments
// PHASE 4: Queue system for async sitemap generation

import express from 'express';
import fetch from 'node-fetch';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import Sitemap from '../db/Sitemap.js';
import { resolveShopToken } from '../utils/tokenResolver.js';
import { enhanceProductForSitemap } from '../services/aiSitemapEnhancer.js';
import sitemapQueue from '../services/sitemapQueue.js'; // PHASE 4

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
  
  // Always use OAuth access token for GraphQL API calls
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token,
  };
  
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
        return seoData;
      } catch (parseErr) {
        return null;
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Helper: get plan limits from central plans.js configuration
async function getPlanLimits(shop) {
  try {
    const { getPlanConfig } = await import('../plans.js');
    const sub = await Subscription.findOne({ shop }).lean().exec();
    
    if (!sub) {
      // Default to starter plan
      const starterConfig = getPlanConfig('starter');
      return { 
        limit: starterConfig.productLimit, 
        collections: starterConfig.collectionLimit, 
        plan: 'starter' 
      };
    }
    
    const planConfig = getPlanConfig(sub.plan);
    if (!planConfig) {
      const starterConfig = getPlanConfig('starter');
      return { 
        limit: starterConfig.productLimit, 
        collections: starterConfig.collectionLimit, 
        plan: sub.plan 
      };
    }
    
    return { 
      limit: planConfig.productLimit, 
      collections: planConfig.collectionLimit, 
      plan: sub.plan 
    };
  } catch (e) {
    console.error('[SITEMAP] Error getting plan limits:', e.message);
    return { limit: 70, collections: 0, plan: 'starter' };
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
// Main sitemap generation function
// options.enableAIEnhancement: if true, makes real-time AI calls for each product (Enterprise/Growth Extra only)
async function generateSitemapCore(shop, options = {}) {
  const { enableAIEnhancement = false } = options;
  
  try {
    const normalizedShop = normalizeShop(shop);
    if (!normalizedShop) {
      throw new Error('Invalid shop parameter');
    }
    
    const { limit, plan } = await getPlanLimits(normalizedShop);
    
    // AI Enhancement state (only used if enableAIEnhancement is true)
    let isAISitemapEnabled = false;
    let reservationId = null;
    let totalAITokens = 0;
    
    // Check AI Discovery settings ONLY if enableAIEnhancement is requested
    if (enableAIEnhancement) {
      try {
        const { default: aiDiscoveryService } = await import('../services/aiDiscoveryService.js');
        const { default: Shop } = await import('../db/Shop.js');
        
        const shopRecord = await Shop.findOne({ shop: normalizedShop });
        if (shopRecord?.accessToken) {
          const session = { accessToken: shopRecord.accessToken };
          const settings = await aiDiscoveryService.getSettings(normalizedShop, session);
          
          // Check eligibility for AI-enhanced sitemap
          const planKey = (settings?.planKey || plan || 'starter').toLowerCase().replace(/\s+/g, '_');
          const plansWithAccess = ['growth_extra', 'enterprise'];
          const plusPlansRequireTokens = ['professional_plus', 'growth_plus'];
          
          let isEligiblePlan = plansWithAccess.includes(planKey);
          
          // Plus plans: Check if they have tokens
          if (plusPlansRequireTokens.includes(planKey)) {
            const { default: TokenBalance } = await import('../db/TokenBalance.js');
            const tokenBalance = await TokenBalance.getOrCreate(normalizedShop);
            
            if (tokenBalance.balance > 0) {
              isEligiblePlan = true;
            } else {
              isEligiblePlan = false;
            }
          }
          
          isAISitemapEnabled = (settings?.features?.aiSitemap || false) && isEligiblePlan;
          
          // === TRIAL PERIOD CHECK ===
          const { default: Subscription } = await import('../db/Subscription.js');
          const subscription = await Subscription.findOne({ shop: normalizedShop });
          const now = new Date();
          const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
          const isActive = subscription?.status === 'active';
          
          // === TOKEN RESERVATION FOR AI-SITEMAP ===
          if (isAISitemapEnabled) {
            const { estimateTokensWithMargin, requiresTokens, isBlockedInTrial } = await import('../billing/tokenConfig.js');
            const { default: TokenBalance } = await import('../db/TokenBalance.js');
            const feature = 'ai-sitemap-optimized';
            
            if (requiresTokens(feature)) {
              const tokenEstimate = estimateTokensWithMargin(feature, { productCount: limit });
              const tokenBalance = await TokenBalance.getOrCreate(normalizedShop);
              
              // Determine plan type
              const planKey = (subscription?.plan || 'starter').toLowerCase().replace(/\s+/g, '_');
              const includedTokensPlans = ['growth_extra', 'enterprise'];
              const hasIncludedTokens = includedTokensPlans.includes(planKey);
              
              // CRITICAL: Trial restriction ONLY for plans with included tokens
              // Plus plans can use purchased tokens during trial without activating plan
              // NOTE: We check ONLY inTrial, NOT isActive! Status is 'active' during trial.
              if (hasIncludedTokens && inTrial && isBlockedInTrial(feature)) {
                // Return error response instead of generating basic sitemap
                return res.status(402).json({
                  error: 'AI-Optimized Sitemap is locked during trial period',
                  trialRestriction: true,
                  requiresActivation: true,
                  trialEndsAt: subscription.trialEndsAt,
                  currentPlan: subscription.plan,
                  message: 'Activate your plan to unlock AI-Optimized Sitemap with included tokens'
                });
              } else if (tokenBalance.hasBalance(tokenEstimate.withMargin)) {
                // Has tokens AND (plan active OR trial ended OR purchased tokens) → Reserve tokens
                const reservation = tokenBalance.reserveTokens(tokenEstimate.withMargin, feature, { shop: normalizedShop });
                reservationId = reservation.reservationId;
                await reservation.save();
              } else {
                // Insufficient tokens
                isAISitemapEnabled = false;
              }
            }
          }
          // === END TOKEN RESERVATION ===
        }
      } catch (error) {
        // Could not fetch AI Discovery settings, continue with basic sitemap
      }
    }
    
    // Get shop info and languages
    const shopQuery = `
      query {
        shop {
          primaryDomain { url }
        }
      }
    `;
    
    const shopData = await shopGraphQL(normalizedShop, shopQuery);
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
      const localesData = await shopGraphQL(normalizedShop, localesQuery);
      if (localesData.shopLocales) {
        locales = localesData.shopLocales;
      }
    } catch (localeErr) {
      // Could not fetch locales, using default
    }
    
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
      
      const data = await shopGraphQL(normalizedShop, productsQuery, { cursor, first: batchSize });
      const products = data?.products || { edges: [], pageInfo: {} };
      
      allProducts.push(...products.edges);
      hasMore = products.pageInfo.hasNextPage;
      cursor = products.edges[products.edges.length - 1]?.cursor;
    }
    
    // Track if we have any AI-enhanced products (to decide if xmlns:ai is needed)
    let hasAnyAIProducts = false;
    
    // Build product/collection entries first (we'll add XML header after checking for AI products)
    let xml = '';
    
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
      
      // Check if product has seo_ai metafield (basic SEO data)
      let hasSeoAI = false;
      let bullets = null;
      let faq = null;
      
      if (product.metafield_seo_ai?.value) {
        try {
          const seoData = JSON.parse(product.metafield_seo_ai.value);
          bullets = seoData.bullets || null;
          faq = seoData.faq || null;
          hasSeoAI = true;
        } catch (e) {
          // Could not parse seo_ai metafield
        }
      }
      
      // Add AI metadata structure if we have SEO data OR if AI sitemap is enabled
      if (hasSeoAI || isAISitemapEnabled) {
        hasAnyAIProducts = true; // Track that we have at least one AI product
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
        
        // Add bullets from seo_ai metafield (if available)
        if (bullets && Array.isArray(bullets) && bullets.length > 0) {
          xml += '      <ai:features>\n';
          bullets.forEach(bullet => {
            if (bullet && bullet.trim()) {
              xml += '        <ai:feature>' + escapeXml(bullet) + '</ai:feature>\n';
            }
          });
          xml += '      </ai:features>\n';
        }
        
        // Add FAQ from seo_ai metafield (if available)
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
        
        // ===== AI-ENHANCED METADATA (REAL-TIME AI GENERATION - Enterprise/Growth Extra only) =====
        // NOTE: This block makes AI API calls to generate advanced metadata
        // It only runs when:
        // 1. User has Enterprise or Growth Extra plan (or Plus plan with tokens)
        // 2. "AI-Optimized Sitemap" feature is enabled in settings
        // 3. User has sufficient token balance
        if (isAISitemapEnabled) {
          try {
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
            
            // Set timeout to avoid blocking (15s for 6 parallel AI calls)
            const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 15000));
            const aiEnhancements = await Promise.race([enhancementPromise, timeoutPromise]);
            
            // Track AI token usage
            if (aiEnhancements?.usage) {
              totalAITokens += aiEnhancements.usage.total_tokens || 0;
            }
            
            if (aiEnhancements) {
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
            }
          } catch (aiError) {
            console.error('[SITEMAP-CORE] Error in AI enhancement for', product.handle, ':', aiError.message);
            // Continue without AI enhancements
          }
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
            // Could not get SEO for language
          }
          
          xml += '  <url>\n';
          xml += '    <loc>' + langUrl + '</loc>\n';
          xml += '    <lastmod>' + lastmod + '</lastmod>\n';
          xml += '    <changefreq>weekly</changefreq>\n';
          xml += '    <priority>0.8</priority>\n';
          
          // Always add AI metadata for multilingual URLs (to be consistent with main product URL)
          hasAnyAIProducts = true; // Track that we have at least one AI product
          xml += '    <ai:product>\n';
          xml += '      <ai:title>' + escapeXml(langTitle) + '</ai:title>\n';
          xml += '      <ai:description><![CDATA[' + langDescription + ']]></ai:description>\n';
          xml += '      <ai:language>' + lang + '</ai:language>\n';
          
          // Add localized AI bullets and FAQ from seo_ai metafields (if available)
          try {
            const hasLocalizedSeo = await getProductLocalizedContent(normalizedShop, product.id, lang);
            if (hasLocalizedSeo) {
              // Add localized bullets
              if (hasLocalizedSeo.bullets && Array.isArray(hasLocalizedSeo.bullets) && hasLocalizedSeo.bullets.length > 0) {
                xml += '      <ai:features>\n';
                hasLocalizedSeo.bullets.forEach(bullet => {
                  if (bullet && bullet.trim()) {
                    xml += '        <ai:feature>' + escapeXml(bullet) + '</ai:feature>\n';
                  }
                });
                xml += '      </ai:features>\n';
              }
              
              // Add localized FAQ
              if (hasLocalizedSeo.faq && Array.isArray(hasLocalizedSeo.faq) && hasLocalizedSeo.faq.length > 0) {
                xml += '      <ai:faq>\n';
                hasLocalizedSeo.faq.forEach(item => {
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
            // Could not get localized AI content, continue with basic metadata
          }
          
          xml += '    </ai:product>\n';
          xml += '  </url>\n';
        }
      }
    }
    
    // Add collections if plan supports it
    if (['growth', 'growth_extra', 'enterprise'].includes(plan)) {
      try{
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
      } catch (collectionsErr) {
        // Could not fetch collections
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
    } catch (pagesErr) {
      // Could not fetch pages
    }
    
    // Now build the final XML with proper header (including xmlns:ai if needed)
    let finalXml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    finalXml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    finalXml += '        xmlns:xhtml="http://www.w3.org/1999/xhtml"';
    
    // Add AI namespace if we have AI-enhanced products OR if AI sitemap is explicitly enabled
    if (hasAnyAIProducts || isAISitemapEnabled) {
      finalXml += '\n        xmlns:ai="http://www.aidata.org/schemas/sitemap/1.0"';
    }
    
    finalXml += '>\n';
    finalXml += xml; // Add all product/collection/page entries
    finalXml += '</urlset>\n';
    
    // Replace xml with finalXml
    xml = finalXml;
    
    // === FINALIZE TOKEN USAGE ===
    if (reservationId && totalAITokens > 0) {
      try {
        const { default: TokenBalance } = await import('../db/TokenBalance.js');
        const tokenBalance = await TokenBalance.getOrCreate(normalizedShop);
        await tokenBalance.finalizeReservation(reservationId, totalAITokens);
        
        // CRITICAL: Invalidate cache so new token balance is immediately visible
        try {
          const cacheService = await import('../services/cacheService.js');
          await cacheService.default.invalidateShop(normalizedShop);
        } catch (cacheErr) {
          console.error('[AI-SITEMAP] Failed to invalidate cache:', cacheErr);
        }
      } catch (tokenErr) {
        console.error('[AI-SITEMAP] Error finalizing token usage:', tokenErr);
      }
    }
    // === END TOKEN FINALIZATION ===
    
    // Save to database
    
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
        content: xml,
        isAiEnhanced: isAISitemapEnabled
      },
      { upsert: true, new: true }
    );
    
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
// PHASE 4: Async generation with queue system
async function handleGenerate(req, res) {
  try {
    const shop = normalizeShop(req.query.shop || req.body.shop);
    if (!shop) {
      console.error('[SITEMAP] Missing shop parameter');
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    // Check if force-sync (skip queue for immediate generation - for viewing)
    const forceSync = req.query.force === 'true';
    
    if (forceSync) {
      // View existing sitemap (DO NOT regenerate - it would overwrite AI-enhanced version!)
      // Simply read from database and return
      const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean();
      if (!sitemapDoc?.content) {
        return res.status(404).json({ error: 'No sitemap found. Please generate one first from Settings.' });
      }
      
      res.set({
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Robots-Tag': 'noindex'
      });
      return res.send(sitemapDoc.content);
    }
    
    // PHASE 4: Add to queue for async generation
    const jobInfo = await sitemapQueue.addJob(shop, async () => {
      return await generateSitemapCore(shop);
    });
    
    // Return immediate response
    return res.json({
      success: true,
      message: jobInfo.queued 
        ? 'Sitemap generation started' 
        : jobInfo.message,
      job: {
        queued: jobInfo.queued,
        position: jobInfo.position,
        estimatedTime: jobInfo.estimatedTime,
        message: jobInfo.message
      }
    });
    
  } catch (err) {
    console.error('[SITEMAP] Generation error:', err);
    return res.status(err.status || 500).json({ 
      error: err.message || 'Failed to generate sitemap' 
    });
  }
}

async function handleInfo(req, res) {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    const { limit, collections: collectionLimit, plan } = await getPlanLimits(shop);
    
    // Check if sitemap exists
    const existingSitemap = await Sitemap.findOne({ shop }).select('-content').lean();
    
    // Get actual product count
    const countData = await shopGraphQL(shop, `
      query {
        productsCount {
          count
        }
      }
    `);
    
    const productCount = countData.productsCount?.count || 0;
    const includesCollections = collectionLimit > 0;
    
    const response = {
      shop,
      plan,
      productCount,
      limits: {
        products: limit,
        collections: collectionLimit
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
      size: existingSitemap?.size || 0,
      isAiEnhanced: existingSitemap?.isAiEnhanced || false
    };
    
    return res.json(response);
    
  } catch (err) {
    console.error('[SITEMAP] Info error:', err);
    return res.status(err.status || 500).json({ 
      error: err.message || 'Failed to get sitemap info' 
    });
  }
}

async function handleProgress(req, res) {
  // Deprecated - use /status endpoint for queue status
  res.json({ status: 'completed', progress: 100, message: 'Use /api/sitemap/status for queue status' });
}

// PHASE 4: Queue status endpoint
async function handleStatus(req, res) {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    // Get job status from queue
    const jobStatus = await sitemapQueue.getJobStatus(shop);
    
    // Get shop sitemap status from DB
    const shopDoc = await Shop.findOne({ shop }).select('sitemapStatus').lean();
    
    // Get last generated sitemap info
    const sitemapDoc = await Sitemap.findOne({ shop }).select('-content').lean();
    
    res.json({
      shop,
      queue: {
        status: jobStatus.status,
        message: jobStatus.message,
        position: jobStatus.position || null,
        queueLength: jobStatus.queueLength,
        estimatedTime: jobStatus.estimatedTime || null
      },
      sitemap: {
        exists: !!sitemapDoc,
        generatedAt: sitemapDoc?.generatedAt || null,
        productCount: sitemapDoc?.productCount || 0,
        size: sitemapDoc?.size || 0
      },
      shopStatus: shopDoc?.sitemapStatus || null
    });
    
  } catch (err) {
    console.error('[SITEMAP] Status error:', err);
    res.status(500).json({ error: 'Failed to check status' });
  }
}

// Add new function to serve saved sitemap
async function serveSitemap(req, res) {
  try {
    const shop = normalizeShop(req.query.shop || req.params.shop);
    if (!shop) {
      console.error('[SITEMAP] Missing shop parameter');
      return res.status(400).send('Missing shop parameter');
    }
    
    const forceRegenerate = req.query.force === 'true';
    
    // Check if we should force regenerate
    if (forceRegenerate) {
      try {
        const result = await generateSitemapCore(shop);
        
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
    
    if (!sitemapDoc || !sitemapDoc.content) {
      // Try to generate new one if none exists
      try {
        const result = await generateSitemapCore(shop);
        
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
  const shop = normalizeShop(req.query.shop);
  if (!shop) {
    console.error('[PUBLIC_SITEMAP] Missing shop parameter');
    return res.status(400).send('Missing shop parameter. Use: /api/sitemap/public?shop=your-shop.myshopify.com');
  }
  
  try {
    // Check for cached sitemap
    const cachedSitemap = await Sitemap.findOne({ shop }).select('+content').lean().exec();
    
    if (cachedSitemap && cachedSitemap.content) {
      
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
      return res.status(404).send(`
Sitemap not found for shop: ${shop}

To generate a sitemap:
1. Install the NEW AI SEO app in your Shopify admin
2. Go to the Sitemap section and click "Generate Sitemap"
3. Your sitemap will be available at this URL

App URL: https://indexaize-aiseo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
      `);
    }
  } catch (error) {
    console.error('[PUBLIC_SITEMAP] Error:', error);
    res.status(500).send(`Failed to serve sitemap: ${error.message}`);
  }
}

// Public sitemap endpoint (no authentication required) - simplified version
async function servePublicSitemap(req, res) {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      console.error('[PUBLIC_SITEMAP] Missing shop parameter');
      return res.status(400).send('Missing shop parameter. Use: ?shop=your-shop.myshopify.com');
    }
    
    // Get saved sitemap with content
    const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
    
    if (!sitemapDoc || !sitemapDoc.content) {
      return res.status(404).send(`
Sitemap not found for shop: ${shop}

To generate a sitemap:
1. Install the NEW AI SEO app in your Shopify admin
2. Go to the Sitemap section and click "Generate Sitemap"
3. Your sitemap will be available at this URL

App URL: https://indexaize-aiseo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
      `);
    }
    
    // Serve the saved sitemap
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
router.get('/status', handleStatus); // PHASE 4: Queue status
router.post('/generate', handleGenerate); // POST generates new sitemap
router.get('/generate', serveSitemap); // GET returns saved sitemap
router.get('/view', serveSitemap); // Alternative endpoint to view sitemap
router.get('/public', servePublicSitemap); // Public endpoint (no auth required)

// Export default router
// Export the generate function for background regeneration
export { handleGenerate as generateSitemap, generateSitemapCore };

export default router;