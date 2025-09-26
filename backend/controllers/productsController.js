// backend/controllers/productsController.js
// Modern products controller using token exchange

import express from 'express';
import { requireAuth, executeGraphQL } from '../middleware/modernAuth.js';

const router = express.Router();

// Helper function to process product metafields and generate optimizationSummary
function processProductMetafields(metafields) {
  if (!metafields?.edges) {
    return {
      optimized: false,
      optimizedLanguages: [],
      lastOptimized: null
    };
  }

  const optimizedLanguages = [];
  let lastOptimized = null;

  metafields.edges.forEach(({ node: metafield }) => {
    if (metafield.key && metafield.key.startsWith('seo__')) {
      try {
        const seoData = JSON.parse(metafield.value);
        if (seoData && seoData.language) {
          optimizedLanguages.push(seoData.language);
          
          // Track the most recent optimization
          if (seoData.updatedAt) {
            const updatedAt = new Date(seoData.updatedAt);
            if (!lastOptimized || updatedAt > lastOptimized) {
              lastOptimized = updatedAt;
            }
          }
        }
      } catch (error) {
        console.warn(`[PRODUCTS] Failed to parse metafield ${metafield.key}:`, error.message);
      }
    }
  });

  return {
    optimized: optimizedLanguages.length > 0,
    optimizedLanguages: [...new Set(optimizedLanguages)], // Remove duplicates
    lastOptimized: lastOptimized?.toISOString() || null
  };
}

// Apply authentication to all routes
router.use(requireAuth);

// GraphQL queries
const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
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
          metafields(first: 50, namespace: "seo_ai") {
            edges {
              node {
                id
                key
                value
                type
              }
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

const PRODUCT_TAGS_QUERY = `
  query GetProductTags($first: Int!) {
    productTags(first: $first) {
      edges {
        node
      }
    }
  }
`;

const SYNC_PRODUCTS_QUERY = `
  query SyncProducts($first: Int!, $after: String) {
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
router.get('/list', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 250);
    const sortBy = req.query.sortBy || 'updatedAt';
    const sortOrder = req.query.sortOrder || 'desc';
    
    const sortKey = convertSortKey(sortBy);
    const reverse = sortOrder === 'desc';
    
    console.log(`[PRODUCTS] Fetching products for ${req.auth.shop}, page ${page}, limit ${limit}`);

    const variables = {
      first: limit,
      sortKey: sortKey,
      reverse: reverse
    };

    const data = await executeGraphQL(req, PRODUCTS_QUERY, variables);
    const rawProducts = data?.products?.edges?.map(edge => edge.node) || [];
    
    // Process products to add optimizationSummary
    const products = rawProducts.map(product => {
      const optimizationSummary = processProductMetafields(product.metafields);
      return {
        ...product,
        optimizationSummary,
        // Keep metafields for debugging if needed
        metafields: product.metafields
      };
    });

    return res.json({
      success: true,
      products: products,
      pagination: {
        page: page,
        limit: limit,
        hasNextPage: data?.products?.pageInfo?.hasNextPage || false,
        endCursor: data?.products?.pageInfo?.endCursor
      },
      shop: req.auth.shop,
      auth: {
        tokenType: req.auth.tokenType,
        source: req.auth.source
      }
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
router.get('/tags/list', async (req, res) => {
  try {
    console.log(`[PRODUCTS] Fetching product tags for ${req.auth.shop}`);

    const data = await executeGraphQL(req, PRODUCT_TAGS_QUERY, { first: 250 });
    const tags = data?.productTags?.edges?.map(edge => edge.node) || [];

    return res.json({
      success: true,
      tags: tags,
      count: tags.length,
      shop: req.auth.shop
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
router.post('/sync', async (req, res) => {
  try {
    console.log(`[PRODUCT_SYNC] Starting sync for ${req.auth.shop}...`);

    const allProducts = [];
    let hasNextPage = true;
    let cursor = null;
    
    // Fetch all products using pagination
    while (hasNextPage) {
      const variables = { first: 50 };
      if (cursor) {
        variables.after = cursor;
      }
      
      const data = await executeGraphQL(req, SYNC_PRODUCTS_QUERY, variables);
      const productsData = data?.products;
      
      if (!productsData) break;
      
      const edges = productsData.edges || [];
      console.log(`[SYNC] Fetched ${edges.length} products for ${req.auth.shop}`);
      
      allProducts.push(...edges.map(edge => edge.node));
      
      hasNextPage = productsData.pageInfo?.hasNextPage || false;
      cursor = productsData.pageInfo?.endCursor || null;
      
      if (edges.length === 0) break;
    }

    console.log(`[SYNC] Total products synced for ${req.auth.shop}: ${allProducts.length}`);

    return res.json({
      success: true,
      productsCount: allProducts.length,
      shop: req.auth.shop,
      message: `Successfully synced ${allProducts.length} products`
    });

  } catch (error) {
    console.error(`[PRODUCT_SYNC] Error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Product sync failed',
      shop: req.auth.shop
    });
  }
});

export default router;