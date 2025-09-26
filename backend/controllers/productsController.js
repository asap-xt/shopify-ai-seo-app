// backend/controllers/productsController.js  
// Fixed products controller using centralized token resolver and sync

import express from 'express';
import { syncProductsForShop } from './productSync.js';
import { executeShopifyGraphQL } from '../utils/tokenResolver.js';
import { apiResolver, productSyncResolver, attachShop } from '../middleware/apiResolver.js';

const router = express.Router();

// Apply middleware to all routes
router.use(attachShop);

// GraphQL query for listing products
const PRODUCTS_LIST_QUERY = `
  query GetProductsList($first: Int!, $after: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
    products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
      edges {
        node {
          id
          handle
          title
          status
          productType
          vendor
          createdAt
          updatedAt
          featuredImage {
            url
            altText
          }
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// GraphQL query for product tags
const PRODUCT_TAGS_QUERY = `
  query GetProductTags($first: Int!) {
    productTags(first: $first) {
      edges {
        node
      }
    }
  }
`;

// Helper to normalize shop
function normalizeShop(shop) {
  if (!shop) return null;
  const s = String(shop).trim();
  if (/^https?:\/\//.test(s)) {
    const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return u.toLowerCase();
  }
  if (!/\.myshopify\.com$/i.test(s)) return `${s.toLowerCase()}.myshopify.com`;
  return s.toLowerCase();
}

// Convert sort parameters
function convertSortKey(sortBy) {
  const sortMap = {
    'title': 'TITLE',
    'createdAt': 'CREATED_AT', 
    'updatedAt': 'UPDATED_AT',
    'productType': 'PRODUCT_TYPE',
    'vendor': 'VENDOR'
  };
  return sortMap[sortBy] || 'UPDATED_AT';
}

// GET /api/products/list
router.get('/list', apiResolver, async (req, res) => {
  try {
    const shop = req.normalizedShop || normalizeShop(req.query.shop);
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 250); // Max 250
    const sortBy = req.query.sortBy || 'updatedAt';
    const sortOrder = req.query.sortOrder || 'desc';
    
    const sortKey = convertSortKey(sortBy);
    const reverse = sortOrder === 'desc';
    
    console.log(`[PRODUCTS] Fetching products for ${shop}, page ${page}, limit ${limit}`);

    const variables = {
      first: limit,
      sortKey: sortKey,
      reverse: reverse
    };

    // Handle pagination with cursor if not first page
    if (page > 1) {
      // For simplicity, we'll skip cursor pagination in this basic implementation
      // In production, you'd want to implement proper cursor-based pagination
    }

    const data = await executeShopifyGraphQL(shop, PRODUCTS_LIST_QUERY, variables);
    const products = data?.products?.edges?.map(edge => edge.node) || [];

    return res.json({
      success: true,
      products: products,
      pagination: {
        page: page,
        limit: limit,
        hasNextPage: data?.products?.pageInfo?.hasNextPage || false,
        endCursor: data?.products?.pageInfo?.endCursor
      },
      shop: shop
    });

  } catch (error) {
    console.error('[PRODUCTS] List error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch products',
      message: error.message
    });
  }
});

// GET /api/products/tags/list
router.get('/tags/list', apiResolver, async (req, res) => {
  try {
    const shop = req.normalizedShop || normalizeShop(req.query.shop);
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    console.log(`[PRODUCTS] Fetching product tags for ${shop}`);

    const data = await executeShopifyGraphQL(shop, PRODUCT_TAGS_QUERY, { first: 250 });
    const tags = data?.productTags?.edges?.map(edge => edge.node) || [];

    return res.json({
      success: true,
      tags: tags,
      count: tags.length,
      shop: shop
    });

  } catch (error) {
    console.error('[PRODUCTS] Tags error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch product tags',
      message: error.message
    });
  }
});

// POST /api/products/sync
router.post('/sync', productSyncResolver, async (req, res) => {
  try {
    const shop = req.normalizedShop || normalizeShop(req.query.shop || req.body.shop);
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter is required for sync' });
    }

    console.log(`[PRODUCT_SYNC] Starting sync with idToken: ${!!req.headers.authorization}`);
    console.log(`Starting product sync for ${shop}...`);

    const result = await syncProductsForShop(shop);

    return res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error(`POST /api/products/sync error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Product sync failed',
      shop: req.normalizedShop
    });
  }
});

// GET /api/products/sync/status  
router.get('/sync/status', apiResolver, async (req, res) => {
  try {
    const shop = req.normalizedShop || normalizeShop(req.query.shop);
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    // Check if we have cached data
    const { FeedCache } = await import('./productSync.js');
    const cache = await FeedCache.findOne({ shop }).lean();

    return res.json({
      success: true,
      shop: shop,
      lastSync: cache?.updatedAt || null,
      hasData: !!cache?.data,
      dataSize: cache?.data?.length || 0
    });

  } catch (error) {
    console.error('[PRODUCTS] Sync status error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get sync status',
      message: error.message
    });
  }
});

export default router;
