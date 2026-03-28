// backend/controllers/productSync.js
// Modern product sync using token exchange

import mongoose from 'mongoose';
import { executeGraphQL } from '../middleware/modernAuth.js';
import Subscription from '../db/Subscription.js';

// Mongo model for cached feed
const FeedCacheSchema = new mongoose.Schema({
  shop: {
    type: String,
    index: true,
    required: true,
    unique: true
  },
  format: {
    type: String,
    default: 'ndjson'
  },
  data: {
    type: String,
    default: ''
  }, // NDJSON content
  updatedAt: {
    type: Date,
    default: Date.now
  },
}, {
  collection: 'feed_cache'
});

export const FeedCache = mongoose.models.FeedCache || mongoose.model('FeedCache', FeedCacheSchema);

// GraphQL Queries
const SHOP_INFO_QUERY = `
  query GetShopInfo {
    shop {
      currencyCode
      primaryDomain {
        host
        url
      }
    }
  }
`;

const SHOP_LOCALES_QUERY = `
  query GetShopLocales {
    shopLocales {
      locale
      primary
      published
    }
  }
`;

const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          handle
          title
          descriptionHtml
          productType
          vendor
          tags
          status
          createdAt
          updatedAt
          variants(first: 50) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                sku
                inventoryQuantity
                availableForSale
              }
            }
          }
          images(first: 10) {
            edges {
              node {
                id
                url
                altText
              }
            }
          }
          metafields(first: 30) {
            edges {
              node {
                namespace
                key
                value
                type
              }
            }
          }
          seo {
            title
            description
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

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
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description
  };
  
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

function pickPrices(variants) {
  let price = null, currency = null, available = false;
  
  for (const edge of variants?.edges || []) {
    const v = edge?.node;
    if (!v) continue;
    
    const p = parseFloat(v.price ?? v.priceV2?.amount ?? 0);
    if (p > 0) {
      price = p;
      currency = currency || 'USD'; // Default fallback
      available = available || !!v.availableForSale;
      break;
    }
  }
  
  return { price, currency, available };
}

// Get shop basic info
async function getShopInfo(req) {
  try {
    const data = await executeGraphQL(req, SHOP_INFO_QUERY);
    const shopData = data?.shop;
    
    return {
      currency: shopData?.currencyCode || 'USD',
      domain: shopData?.primaryDomain?.host || req.auth.shop,
      url: shopData?.primaryDomain?.url || `https://${req.auth.shop}`
    };
  } catch (error) {
    console.error(`[SYNC] Failed to get shop info for ${req.auth.shop}:`, error.message);
    return {
      currency: 'USD',
      domain: req.auth.shop,
      url: `https://${req.auth.shop}`
    };
  }
}

// Get shop supported languages
async function getShopLanguages(req) {
  try {
    const data = await executeGraphQL(req, SHOP_LOCALES_QUERY);
    const locales = data?.shopLocales || [];
    
    return locales
      .filter(locale => locale.published)
      .map(locale => locale.locale)
      .filter(Boolean);
  } catch (error) {
    console.error(`[SYNC] Failed to get shop languages for ${req.auth.shop}:`, error.message);
    return ['en']; // Default fallback
  }
}

// Fetch all products using pagination
async function fetchAllProducts(req) {
  const products = [];
  let hasNextPage = true;
  let cursor = null;
  
  while (hasNextPage) {
    try {
      const variables = { first: 50 };
      if (cursor) {
        variables.after = cursor;
      }
      
      const data = await executeGraphQL(req, PRODUCTS_QUERY, variables);
      const productsData = data?.products;
      
      if (!productsData) {
        console.error(`[SYNC] No products data returned for ${req.auth.shop}`);
        break;
      }
      
      const edges = productsData.edges || [];
      
      products.push(...edges.map(edge => edge.node));
      
      hasNextPage = productsData.pageInfo?.hasNextPage || false;
      cursor = productsData.pageInfo?.endCursor || null;
      
      if (edges.length === 0) {
        hasNextPage = false;
      }
      
    } catch (error) {
      console.error(`[SYNC] Error fetching products for ${req.auth.shop}:`, error.message);
      hasNextPage = false;
    }
  }
  
  return products;
}

// Format product for AI consumption
function formatProductForAI(product, { shopCurrency, shopDomain, shopUrl, languages }) {
  const { price, currency, available } = pickPrices(product.variants);
  
  // Extract image info
  const images = product.images?.edges?.map(edge => ({
    id: edge.node.id,
    url: edge.node.url,
    alt: edge.node.altText || ''
  })) || [];
  
  // Build product URL
  const productUrl = `${shopUrl}/products/${product.handle}`;
  
  // Create minimal JSON-LD
  const jsonLd = minimalJsonLd({
    name: product.title,
    description: sanitizeHtmlBasic(product.descriptionHtml),
    price: price,
    currency: currency || shopCurrency,
    url: productUrl
  });
  
  return {
    productId: product.id,
    handle: product.handle,
    title: product.title || '',
    description: sanitizeHtmlBasic(product.descriptionHtml || ''),
    productType: product.productType || '',
    vendor: product.vendor || '',
    tags: product.tags || [],
    status: product.status || 'ACTIVE',
    price: price,
    currency: currency || shopCurrency,
    available: available,
    images: images,
    url: productUrl,
    seo: {
      title: product.seo?.title || product.title,
      description: product.seo?.description || ''
    },
    variants: product.variants?.edges?.map(edge => edge.node) || [],
    languages: languages,
    jsonLd: jsonLd,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    shop: shopDomain
  };
}

// Taxonomy keys we care about for the feed
const TAXONOMY_FEED_KEYS = [
  'material', 'fabric', 'color', 'colour', 'fit', 'waist_rise',
  'target_gender', 'age_group', 'care_instructions', 'pants_length_type'
];

function extractTaxonomyFromProduct(product) {
  const taxonomy = {};
  for (const edge of (product.metafields?.edges || [])) {
    const mf = edge?.node;
    if (!mf) continue;
    if (mf.namespace === 'taxonomy' || mf.namespace === 'custom' || mf.namespace === 'shopify') {
      const k = mf.key?.toLowerCase();
      if (TAXONOMY_FEED_KEYS.includes(k)) {
        taxonomy[k] = mf.value;
      }
    }
  }
  return taxonomy;
}

function extractGids(val) {
  if (!val || typeof val !== 'string') return [];
  if (val.startsWith('gid://')) return [val];
  if (val.startsWith('[')) {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr)) return arr.filter(v => typeof v === 'string' && v.startsWith('gid://'));
    } catch { /* not JSON */ }
  }
  return [];
}

async function resolveAllTaxonomyGids(req, productsTaxonomy) {
  const allGids = new Set();
  for (const taxonomy of productsTaxonomy) {
    for (const val of Object.values(taxonomy)) {
      extractGids(val).forEach(g => allGids.add(g));
    }
  }
  if (allGids.size === 0) return new Map();

  const gidMap = new Map();
  const ids = [...allGids];
  const BATCH = 250;
  for (let i = 0; i < ids.length; i += BATCH) {
    try {
      const batch = ids.slice(i, i + BATCH);
      const query = `query ResolveMetaobjects($ids: [ID!]!) {
        nodes(ids: $ids) { ... on Metaobject { id displayName } }
      }`;
      const data = await executeGraphQL(req, query, { ids: batch });
      for (const node of (data?.nodes || [])) {
        if (node?.id && node?.displayName) gidMap.set(node.id, node.displayName);
      }
    } catch (err) {
      console.error('[FEED-SYNC] Failed to resolve taxonomy GIDs batch:', err.message);
    }
  }
  return gidMap;
}

function resolveTaxonomyWithMap(taxonomy, gidMap) {
  const resolved = {};
  for (const [key, val] of Object.entries(taxonomy)) {
    const gids = extractGids(val);
    if (gids.length > 0) {
      const names = gids.map(g => gidMap.get(g)).filter(Boolean);
      if (names.length > 0) resolved[key] = names.join(', ');
    } else if (val) {
      resolved[key] = val;
    }
  }
  // Normalize fabric → material
  if (resolved.fabric && !resolved.material) {
    resolved.material = resolved.fabric;
    delete resolved.fabric;
  }
  if (resolved.colour && !resolved.color) {
    resolved.color = resolved.colour;
    delete resolved.colour;
  }
  return resolved;
}

async function getShopPlan(shop) {
  try {
    const sub = await Subscription.findOne({ shop });
    const plan = (sub?.plan || 'starter').toLowerCase().replace(/\s+/g, '_');
    return plan;
  } catch {
    return 'starter';
  }
}

const TAXONOMY_ELIGIBLE_PLANS = [
  'professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'
];

// Main sync function
export async function syncProductsForShop(req) {
  const startTime = Date.now();
  
  try {
    // Get shop info, languages, and plan in parallel
    const [shopInfo, languages, plan] = await Promise.all([
      getShopInfo(req),
      getShopLanguages(req),
      getShopPlan(req.auth.shop)
    ]);
    
    const includeTaxonomy = TAXONOMY_ELIGIBLE_PLANS.includes(plan);
    
    // Fetch all products
    const allProducts = await fetchAllProducts(req);
    
    // FILTER: Only sync ACTIVE products (exclude DRAFT and ARCHIVED)
    const products = allProducts.filter(product => product.status === 'ACTIVE');
    
    // Resolve taxonomy GIDs in one batch (Professional Plus+ only)
    let gidMap = new Map();
    let productsTaxonomy = [];
    if (includeTaxonomy) {
      productsTaxonomy = products.map(p => extractTaxonomyFromProduct(p));
      gidMap = await resolveAllTaxonomyGids(req, productsTaxonomy);
    }
    
    // Format products for AI
    const formattedProducts = products.map((product, idx) => {
      const base = formatProductForAI(product, {
        shopCurrency: shopInfo.currency,
        shopDomain: shopInfo.domain,
        shopUrl: shopInfo.url,
        languages: languages
      });
      if (includeTaxonomy && productsTaxonomy[idx]) {
        const resolved = resolveTaxonomyWithMap(productsTaxonomy[idx], gidMap);
        Object.assign(base, resolved);
      }
      return base;
    });
    
    // Convert to NDJSON
    const ndjsonData = formattedProducts
      .map(product => JSON.stringify(product))
      .join('\n');
    
    // Save to cache
    await FeedCache.findOneAndUpdate(
      { shop: req.auth.shop },
      { 
        shop: req.auth.shop,
        format: 'ndjson',
        data: ndjsonData,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    
    const duration = Date.now() - startTime;
    
    return {
      success: true,
      productsCount: products.length,
      duration,
      shop: req.auth.shop,
      auth: {
        tokenType: req.auth.tokenType,
        source: req.auth.source
      }
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[SYNC] Product sync failed for ${req.auth.shop} after ${duration}ms:`, error.message);
    
    throw error;
  }
}