// backend/controllers/productSync.js
// Modern product sync using token exchange

import mongoose from 'mongoose';
import { executeGraphQL } from '../middleware/modernAuth.js';

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

// Main sync function
export async function syncProductsForShop(req) {
  const startTime = Date.now();
  
  try {
    // Get shop info and languages in parallel
    const [shopInfo, languages] = await Promise.all([
      getShopInfo(req),
      getShopLanguages(req)
    ]);
    
    // Fetch all products
    const products = await fetchAllProducts(req);
    
    // Format products for AI
    const formattedProducts = products.map(product =>
      formatProductForAI(product, {
        shopCurrency: shopInfo.currency,
        shopDomain: shopInfo.domain,
        shopUrl: shopInfo.url,
        languages: languages
      })
    );
    
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