// backend/controllers/productSync.js
// Builds an AI-ready catalog feed from Shopify Admin API and saves to MongoDB + FeedCache

import mongoose from 'mongoose';
import Product from '../db/Product.js';

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

/**
 * Resolve an Admin API access token.
 * For production, replace with your own DB lookup of the shop's offline access token.
 * As a fallback, uses env SHOPIFY_ADMIN_API_ACCESS_TOKEN (single-shop setups).
 */
async function resolveAccessToken(shop) {
  // Debug logs
  console.log('=== RESOLVING TOKEN ===');
  console.log('Shop:', shop);
  console.log('ENV TOKEN:', process.env.SHOPIFY_ADMIN_API_TOKEN);
  console.log('TOKEN exists?', !!process.env.SHOPIFY_ADMIN_API_TOKEN);
  console.log('TOKEN length:', process.env.SHOPIFY_ADMIN_API_TOKEN?.length);
  
  // Временно решение - директно връщаме env токена
  const token = process.env.SHOPIFY_ADMIN_API_TOKEN || null;
  console.log('Returning token:', token ? 'TOKEN FOUND' : 'NO TOKEN');
  return token;
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

// Get shop languages first
async function getShopLanguages(shop, accessToken) {
  const query = `
    query ShopLocales {
      shopLocales {
        locale
        primary
        published
      }
    }
  `;
  
  try {
    const data = await adminGraphQL({ shop, accessToken, query });
    const published = (data?.data?.shopLocales || [])
      .filter(l => l.published)
      .map(l => l.locale.toLowerCase().split('-')[0]) // bg-BG -> bg
      .filter((v, i, a) => a.indexOf(v) === i); // unique
    return published.length ? published : ['en'];
  } catch (e) {
    console.error('Failed to get shop languages:', e.message);
    return ['en'];
  }
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

// Determine SEO optimization status from metafields dynamically
function determineSeoStatus(node, shopLanguages) {
  const seoLanguages = [];
  let hasAnyOptimization = false;
  
  // Check for SEO metafields based on actual shop languages
  for (const lang of shopLanguages) {
    const metafieldKey = `metafield_seo_${lang}`;
    if (node[metafieldKey]?.value) {
      try {
        const seoData = JSON.parse(node[metafieldKey].value);
        if (seoData && Object.keys(seoData).length > 0) {
          seoLanguages.push({
            code: lang,
            optimized: true,
            lastOptimizedAt: new Date() // TODO: get actual date from metafield if available
          });
          hasAnyOptimization = true;
        }
      } catch (e) {
        // Invalid JSON, skip
      }
    }
  }
  
  return {
    optimized: hasAnyOptimization,
    languages: seoLanguages,
    lastCheckedAt: new Date()
  };
}

function toProductDocument(node, shop, shopLanguages, shopCurrency) {
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
    status,
    createdAt,
    publishedAt,
    totalInventory,
    featuredImage
  } = node || {};
  
  const productId = Number(id.split('/').pop());
  const { price, currency, available } = pickPrices(node?.variants, node, shopCurrency);
  const seoStatus = determineSeoStatus(node, shopLanguages);
  
  return {
    shop,
    productId,
    gid: id,
    title,
    description: sanitizeHtmlBasic(descriptionHtml),
    handle,
    vendor,
    productType,
    tags: csv(tags),
    price: price ? String(price) : null,
    currency, // Now dynamic
    available,
    status: status || 'ACTIVE',
    totalInventory: totalInventory || 0,
    createdAt: createdAt ? new Date(createdAt) : null,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
    featuredImage: featuredImage ? {
      url: featuredImage.url,
      altText: featuredImage.altText || ''
    } : null,
    seoStatus,
    syncedAt: new Date(),
    
    // Legacy fields (kept for compatibility)
    images: (node?.images?.edges || []).map(e => e?.node?.url).filter(Boolean),
    aiOptimized: {} // Will be deprecated
  };
}

function toFeedItem(node, shopCurrency) {
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
  } = node || {};
  const bullets = node?.metafield_seo_ai_bullets?.value ? JSON.parse(node.metafield_seo_ai_bullets.value) : [];
  const faq = node?.metafield_seo_ai_faq?.value ? JSON.parse(node.metafield_seo_ai_faq.value) : [];
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
    seo: { title: seo?.title || null, metaDescription: seo?.description || null },
    seo_ai: { bullets, faq },
    bodyHtml,
    jsonLd,
    updatedAt,
  };
}

async function fetchAllProducts({ shop, accessToken, shopLanguages, shopCurrency }) {
  const pageSize = 100;
  let after = null;
  const items = [];

  // Build dynamic query with metafields for all shop languages
  const languageMetafields = shopLanguages
    .map(lang => `metafield_seo_${lang}: metafield(namespace: "seo_ai", key: "seo__${lang}") { value }`)
    .join('\n');

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
            images(first: 10) { edges { node { id url altText } } }
            variants(first: 50) { edges { node { id price availableForSale } } }
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            metafield_seo_ai_bullets: metafield(namespace: "seo_ai", key: "bullets") { value }
            metafield_seo_ai_faq: metafield(namespace: "seo_ai", key: "faq") { value }
            ${languageMetafields}
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
    for (const edge of conn?.edges || []) {
      const node = edge?.node;
      if (!node) continue;
      items.push(node);
      after = edge?.cursor || null;
    }
    if (!conn?.pageInfo?.hasNextPage) break;
  }

  return items;
}

/**
 * Sync products from Shopify and save to MongoDB + FeedCache
 * @returns {Promise<{shop:string, count:number, bytes:number, updatedAt:Date}>}
 */
export async function syncProductsForShop(shop, opts = {}) {
  if (!shop) throw new Error('Missing shop');
  const accessToken = opts.accessToken || (await resolveAccessToken(shop));
  if (!accessToken) throw new Error(`No Admin API token available for shop ${shop}`);

  console.log(`Starting product sync for ${shop}...`);
  
  // First get shop currency and languages
  const [shopCurrency, shopLanguages] = await Promise.all([
    getShopCurrency(shop, accessToken),
    getShopLanguages(shop, accessToken)
  ]);
  
  console.log(`Shop currency: ${shopCurrency}`);
  console.log(`Shop languages: ${shopLanguages.join(', ')}`);
  
  const rawProducts = await fetchAllProducts({ shop, accessToken, shopLanguages, shopCurrency });
  console.log(`Fetched ${rawProducts.length} products from Shopify`);

  // Save each product to MongoDB
  let savedCount = 0;
  const feedItems = [];
  
  for (const node of rawProducts) {
    try {
      // Convert to Product document with dynamic languages and currency
      const productDoc = toProductDocument(node, shop, shopLanguages, shopCurrency);
      
      // Update or create in MongoDB
      await Product.findOneAndUpdate(
        { shop, productId: productDoc.productId },
        productDoc,
        { upsert: true, new: true }
      );
      
      savedCount++;
      
      // Also prepare feed item
      feedItems.push(toFeedItem(node, shopCurrency));
    } catch (e) {
      console.error(`Failed to save product ${node.id}:`, e.message);
    }
  }

  // Update FeedCache for backward compatibility
  const lines = feedItems.map((obj) => JSON.stringify(obj));
  const ndjson = lines.join('\n');
  const updatedAt = new Date();
  
  await FeedCache.updateOne(
    { shop },
    { $set: { format: 'ndjson', data: ndjson, updatedAt } },
    { upsert: true }
  );

  console.log(`Sync complete: saved ${savedCount} products to MongoDB`);

  return {
    shop,
    count: savedCount,
    bytes: Buffer.byteLength(ndjson, 'utf8'),
    updatedAt,
  };
}