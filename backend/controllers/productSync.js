// backend/controllers/productSync.js
// Builds an AI-ready catalog feed from Shopify Admin API and saves to MongoDB + FeedCache

import mongoose from 'mongoose';
import Product from '../db/Product.js';

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// Helper function to normalize shop domain (fixes duplicate domain issue)
function normalizeShopDomain(input) {
  if (!input) return '';
  return Array.isArray(input) ? input[0] : String(input).trim();
}

// Helper function for consistent GraphQL calls
async function simpleAdminGraphQL(shop, token, query, variables = {}) {
  const shopDomain = normalizeShopDomain(shop);
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json; 
  try { 
    json = JSON.parse(text); 
  } catch { 
    /* noop */ 
  }
  if (!res.ok) throw new Error(`Admin GraphQL failed: ${res.status} ${text}`);
  if (json?.errors) throw new Error(`Admin GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// Get published locales from shop using shopLocales query
async function getPublishedLocales(shop, token) {
  const q = `
    query ShopLocales {
      shopLocales {
        locale
        name
        primary
        published
      }
    }
  `;
  const data = await simpleAdminGraphQL(shop, token, q);
  const list = data?.shopLocales || [];
  const publishedList = list.filter(l => l.published);
  const codes = publishedList.map(l => l.locale);
  const primary = publishedList.find(l => l.primary)?.locale || codes[0] || 'en';
  return { list: publishedList, codes, primary };
}

// Extract optimized languages from metafield keys
function seoKeysToLocales(keys = []) {
  // Expected keys: seo__en, seo__es, seo__bg ...
  return [...new Set(
    keys
      .filter(k => typeof k === 'string' && k.startsWith('seo__'))
      .map(k => k.slice('seo__'.length))
  )];
}

// Get product SEO locales from metafields
async function getProductSeoLocales(shop, token, productGid) {
  const q = `
    query ProductMeta($id: ID!) {
      product(id: $id) {
        id
        metafields(first: 100, namespace: "seo_ai") {
          edges { node { key } }
        }
      }
    }
  `;
  const data = await simpleAdminGraphQL(shop, token, q, { id: productGid });
  const edges = data?.product?.metafields?.edges || [];
  const keys = edges.map(e => e?.node?.key).filter(Boolean);
  return seoKeysToLocales(keys);
}

// Mongo model for cached feed
const FeedCacheSchema = new mongoose.Schema(
  {
    shop: { type: String, index: true, required: true, unique: true },
    format: { type: String, default: 'ndjson' },
    data: { type: String, default: '' }, // NDJSON content
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'feed_cache' }
);

export const FeedCache = mongoose.models.FeedCache || mongoose.model('FeedCache', FeedCacheSchema);

function sanitizeHtmlBasic(html = '') {
  let out = String(html)
    .replace(/<\s*script[\s\S]*?<\/\s*script\s*>/gi, '')
    .replace(/<\s*style[\s\S]*?<\/\s*style\s*>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\son\w+=\S+/gi, '');
  out = out.replace(/<(?!\/?(p|ul|ol|li|br|strong|em|b|i|h1|h2|h3|a|img)\b)[^>]*>/gi, '');
  return out;
}

function minimalJsonLd({ name, description, price, currency, url }) {
  const obj = { '@context': 'https://schema.org', '@type': 'Product', name, description };
  if (price != null && currency) {
    obj.offers = {
      '@type': 'Offer',
      price,
      priceCurrency: currency,
      availability: 'https://schema.org/InStock',
    };
  }
  if (url) obj.url = url;
  return obj;
}

function getAdminApiVersion() {
  return process.env.SHOPIFY_API_VERSION || '2025-07';
}

async function adminGraphQL({ shop, accessToken, query, variables }) {
  if (!shop || !accessToken) throw new Error('Missing shop or access token for Admin GraphQL');
  const url = `https://${shop}/admin/api/${getAdminApiVersion()}/graphql.json`;
  const rsp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
    body: JSON.stringify({ query, variables }),
  });
  const json = await rsp.json();
  if (!rsp.ok || json.errors) {
    const msg = json.errors ? JSON.stringify(json.errors) : await rsp.text();
    throw new Error(`Admin GraphQL error: ${msg}`);
  }
  return json;
}

// Import centralized token resolver
import { resolveShopToken } from '../utils/tokenResolver.js';

/**
 * Resolve an Admin API access token using centralized function.
 */
async function resolveAccessToken(shop) {
  try {
    return await resolveShopToken(shop);
  } catch (err) {
    console.error('Error resolving access token:', err.message);
    return null;
  }
}

// Updated pickPrices to accept currency
function pickPrices(variants, product, shopCurrency) {
  let price = null;
  let available = false;
  
  for (const edge of variants?.edges || []) {
    const v = edge?.node;
    if (!v) continue;
    const p = parseFloat(v.price);
    if (!Number.isNaN(p)) {
      if (price === null || p < price) price = p;
    }
    if (v.availableForSale) available = true;
  }
  
  // Get currency from product or fallback to shop currency
  const currency = product?.priceRangeV2?.minVariantPrice?.currencyCode || shopCurrency || 'USD';
  
  return { price, currency, available };
}

// Get published locales from Shopify (requires read_locales scope)
// Updated getShopLanguages to use new getPublishedLocales
async function getShopLanguages(shop, token) {
  const { list, codes, primary } = await getPublishedLocales(shop, token);
  return { details: list, codes, primary };
}

// NEW: Get shop currency
async function getShopCurrency(shop, accessToken) {
  const query = `
    query ShopCurrency {
      shop {
        currencyCode
      }
    }
  `;
  
  try {
    const data = await adminGraphQL({ shop, accessToken, query });
    return data?.data?.shop?.currencyCode || 'USD';
  } catch (e) {
    console.error('Failed to get shop currency:', e.message);
    return 'USD';
  }
}

function csv(arr) {
  return Array.isArray(arr)
    ? arr
    : typeof arr === 'string'
    ? arr.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
}

function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

// Determine SEO optimization status from metafields dynamically
function determineSeoStatus(metafieldsMap, languages = []) {
  console.log('[PRODUCT_SYNC] Determining SEO status for languages:', languages);
  console.log('[PRODUCT_SYNC] Available metafield keys:', Object.keys(metafieldsMap));
  
  const optimizedLanguages = {};
  let hasAnyOptimization = false;
  
  for (const lang of languages) {
    // Проверете за метаполета с различни възможни ключове
    const seoKey = `seo__${lang}`;
    const seoAltKey = `seo_${lang}`;
    const bulletsKey = `bullets__${lang}`;
    const bulletsAltKey = `bullets_${lang}`;
    const faqKey = `faq__${lang}`;
    const faqAltKey = `faq_${lang}`;
    
    const hasSeo = !!(metafieldsMap[seoKey] || metafieldsMap[seoAltKey]);
    const hasBullets = !!(metafieldsMap[bulletsKey] || metafieldsMap[bulletsAltKey]);
    const hasFaq = !!(metafieldsMap[faqKey] || metafieldsMap[faqAltKey]);
    
    const isOptimized = hasSeo || hasBullets || hasFaq;
    
    if (isOptimized) {
      console.log(`[PRODUCT_SYNC] Found optimization for ${lang} - SEO: ${hasSeo} Bullets: ${hasBullets} FAQ: ${hasFaq}`);
      optimizedLanguages[lang] = {
        optimized: true,
        hasSeo,
        hasBullets,
        hasFaq,
        lastOptimizedAt: new Date()
      };
      hasAnyOptimization = true;
    } else {
      console.log(`[PRODUCT_SYNC] Language ${lang} available but not optimized`);
      optimizedLanguages[lang] = {
        optimized: false,
        hasSeo: false,
        hasBullets: false,
        hasFaq: false,
        lastOptimizedAt: null
      };
    }
  }
  
  return {
    optimized: hasAnyOptimization,
    languages: Object.entries(optimizedLanguages).map(([code, status]) => ({
      code,
      ...status
    })),
    lastCheckedAt: new Date()
  };
}

function gidToNumericId(gid) {
  return gid?.split('/')?.pop();
}

function toProductDocument(node, shop, shopLocales, shopCurrency, optimizedLangCodes) {
  const numericId = gidToNumericId(node.id);
  const { price, currency, available } = pickPrices(node?.variants, node, shopCurrency);
  
  // Determine SEO status for each language
  const optimizedSet = new Set(optimizedLangCodes);
  const languages = shopLocales.map(l => ({
    ...l,
    optimized: optimizedSet.has(l.locale)
  }));
  
  return {
    // Required fields for MongoDB
    shop,                               // <— required
    shopifyProductId: numericId,        // <— required
    productId: node.id,                 // (full GID for compatibility)
    gid: node.id,
    title: node.title,
    handle: node.handle,
    status: node.status || 'ACTIVE',
    priceMin: node.priceRangeV2?.minVariantPrice?.amount ?? null,
    priceCurrency: node.priceRangeV2?.minVariantPrice?.currencyCode ?? shopCurrency ?? 'USD',
    // Language objects with full information
    languages: languages.filter(l => l.optimized), // Only optimized languages
    availableLanguages: shopLocales,   // All available languages
    
    // Additional fields
    description: sanitizeHtmlBasic(node.descriptionHtml),
    vendor: node.vendor,
    productType: node.productType,
    tags: csv(node.tags),
    price: price ? String(price) : null,
    currency,
    available,
    totalInventory: node.totalInventory || 0,
    createdAt: node.createdAt ? new Date(node.createdAt) : null,
    publishedAt: node.publishedAt ? new Date(node.publishedAt) : null,
    featuredImage: node.featuredImage ? {
      url: node.featuredImage.url,
      altText: node.featuredImage.altText || ''
    } : null,
    seoStatus: {
      optimized: false,
      languages: [],
      lastCheckedAt: new Date()
    },
    syncedAt: new Date(),
    
    // Images as objects
    images: (node?.images?.edges || []).map(e => ({
      id: e?.node?.id,
      url: e?.node?.url,
      alt: e?.node?.altText || ''
    })).filter(img => img.url),
    
    // Legacy fields
    aiOptimized: {}
  };
}

function toFeedItem(node, shop, shopCurrency) {
  const {
    id,
    handle,
    title,
    descriptionHtml,
    vendor,
    productType,
    tags,
    onlineStoreUrl,
    updatedAt,
    seo,
    metafieldsData = {}
  } = node || {};
  
  // Вземете bullets и FAQ от основните метаполета (не езикови)
  const bullets = safeJsonParse(metafieldsData.bullets, []);
  const faq = safeJsonParse(metafieldsData.faq, []);
    
  const images = (node?.images?.edges || []).map((e) => ({
    id: e?.node?.id,
    alt: e?.node?.altText || '',
  }));
  
  const { price, currency, available } = pickPrices(node?.variants, node, shopCurrency);
  const bodyHtml = sanitizeHtmlBasic(descriptionHtml || '');
  const jsonLd = minimalJsonLd({
    name: seo?.title || title,
    description: seo?.description || bodyHtml.replace(/<[^>]+>/g, ' ').trim().slice(0, 500),
    price,
    currency,
    url: onlineStoreUrl,
  });

  return {
    productId: id,
    handle,
    title,
    vendor,
    productType,
    tags: csv(tags),
    url: onlineStoreUrl || null,
    price,
    currency,
    available,
    images,
    seo: { 
      title: seo?.title || null, 
      metaDescription: seo?.description || null 
    },
    seo_ai: { bullets, faq },
    bodyHtml,
    jsonLd,
    updatedAt,
    // Метаполетата ще бъдат достъпни за проверка
    _metafields: metafieldsData
  };
}

async function fetchAllProducts({ shop, accessToken, shopLocales, shopCurrency }) {
  // Използвайте подадените shopLocales
  const languages = shopLocales || [];
  console.log('[PRODUCT_SYNC] Shop languages:', languages.map(l => l.locale).join(', '));
  
  const pageSize = 50;
  let after = null;
  const items = [];

  // Базова заявка без хардкоднати метаполета
  const query = `
    query Products($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: UPDATED_AT) {
        pageInfo { hasNextPage endCursor }
        edges {
          cursor
          node {
            id 
            title 
            handle 
            descriptionHtml 
            onlineStoreUrl 
            vendor 
            productType 
            tags 
            updatedAt
            createdAt
            publishedAt
            status
            totalInventory
            featuredImage {
              url
              altText
            }
            seo { title description }
            images(first: 10) { 
              edges { 
                node { id url altText } 
              } 
            }
            variants(first: 50) { 
              edges { 
                node { id price availableForSale } 
              } 
            }
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            # Вземете ВСИЧКИ метаполета от namespace seo_ai
            metafields(first: 100, namespace: "seo_ai") {
              edges {
                node {
                  key
                  value
                  namespace
                }
              }
            }
          }
        }
      }
    }
  `;

  for (;;) {
    const rsp = await adminGraphQL({
      shop,
      accessToken,
      query,
      variables: { first: pageSize, after },
    });
    
    const conn = rsp?.data?.products;
    if (!conn) break;
    
    for (const edge of conn?.edges || []) {
      const node = edge?.node;
      if (!node) continue;
      
      // Преобразувайте метаполетата в по-удобен формат
      const metafieldsMap = {};
      for (const mfEdge of node.metafields?.edges || []) {
        const { key, value } = mfEdge.node;
        metafieldsMap[key] = value;
      }
      
      // Добавете метаполетата към node обекта
      node.metafieldsData = metafieldsMap;
      
      // Получете оптимизираните езици за този продукт
      const optimizedLangs = await getProductSeoLocales(shop, accessToken, node.id);
      
      // Създайте документа с правилните типове данни
      const productDoc = toProductDocument(node, shop, languages, shopCurrency, optimizedLangs);
      
      // Лог за езиците
      if (optimizedLangs.length === 0) {
        languages.forEach(l => {
          if (!optimizedLangs.includes(l.locale)) {
            console.log(`[PRODUCT_SYNC] Language ${l.locale} available but not optimized for product ${node.title}`);
          }
        });
      }
      
      items.push(productDoc);
    }
    
    if (!conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo?.endCursor;
  }

  return items;
}

/**
 * Sync products from Shopify and save to MongoDB + FeedCache
 * @returns {Promise<Array>} Array of saved products
 */
export async function syncProductsForShop(shop, idToken = null, retryCount = 0) {
  console.log(`Starting product sync for ${shop}...`);
  
  let accessToken;
  
  try {
    // Първи опит с текущия токен
    const { resolveAccessToken } = await import('../utils/tokenResolver.js');
    accessToken = await resolveAccessToken(shop, idToken);
  } catch (err) {
    console.error('Initial token resolution failed:', err);
    throw new Error('No valid access token available');
  }
  
         try {
           // Опитайте се да вземете данните
           const [currency, languageData] = await Promise.all([
             getShopCurrency(shop, accessToken),
             getShopLanguages(shop, accessToken)
           ]);
           
           console.log(`Shop currency: ${currency}`);
           console.log(`Shop languages: ${languageData.codes.join(', ')}`);
           
           const products = await fetchAllProducts({ shop, accessToken, shopLocales: languageData.details, shopCurrency: currency });
    console.log(`Fetched ${products.length} products from Shopify`);
    
    // Запазете в MongoDB с правилни upsert операции
    const Product = (await import('../db/Product.js')).default;
    await Product.deleteMany({ shop });
    
    const savedProducts = [];
    for (const productDoc of products) {
      const saved = await Product.findOneAndUpdate(
        { shop: productDoc.shop, shopifyProductId: productDoc.shopifyProductId },
        {
          $set: productDoc,
          $setOnInsert: {
            shop: productDoc.shop,
            shopifyProductId: productDoc.shopifyProductId,
          },
        },
        { upsert: true, new: true, runValidators: true }
      );
      savedProducts.push(saved);
    }
    
    console.log(`Sync complete: saved ${savedProducts.length} products to MongoDB`);
    return savedProducts;
    
  } catch (error) {
    // Ако грешката е 401 и имаме idToken, опитайте Token Exchange
    if (error.message.includes('401') && idToken && retryCount < 1) {
      console.log('[PRODUCT_SYNC] Got 401, attempting token exchange...');
      
      try {
        // Форсирайте нов Token Exchange
        const { resolveAccessToken } = await import('../utils/tokenResolver.js');
        accessToken = await resolveAccessToken(shop, idToken, true);
        
        // Опитайте отново със новия токен
        return await syncProductsForShop(shop, null, retryCount + 1); // Рекурсивно извикване без idToken
      } catch (exchangeError) {
        console.error('Token exchange failed:', exchangeError);
        throw new Error('Authentication failed after token exchange attempt');
      }
    }
    
    throw error;
  }
}

// Export functions for use in other controllers
export { 
  getPublishedLocales,
  getProductSeoLocales,
  getShopLanguages
};