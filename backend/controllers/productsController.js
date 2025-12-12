// backend/controllers/productsController.js
// Modern products controller using token exchange

import express from 'express';
import { requireAuth, executeGraphQL } from '../middleware/modernAuth.js';
import { withShopCache, CACHE_TTL } from '../utils/cacheWrapper.js';
import Product from '../db/Product.js';

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

  const result = {
    optimized: optimizedLanguages.length > 0,
    optimizedLanguages: [...new Set(optimizedLanguages)], // Remove duplicates
    lastOptimized: lastOptimized?.toISOString() || null
  };
  
  return result;
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
          tags
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
    
    // Filter parameters
    const optimizedFilter = req.query.optimized; // 'true', 'false', or undefined (all)
    const languageFilter = req.query.languageFilter; // e.g., 'en', 'de'
    const tagsFilter = req.query.tags ? req.query.tags.split(',') : []; // e.g., 'tag1,tag2'
    const searchFilter = req.query.search; // search term
    
    // Check if any client-side filters are active (requires fetching all products)
    const hasClientFilters = optimizedFilter || languageFilter || tagsFilter.length > 0 || searchFilter;
    
    const shop = req.auth.shop;

    // Cache key WITHOUT optimization filters (they will be applied AFTER fresh metafield fetch)
    const cacheKey = `products:list:${page}:${limit}:${sortBy}:${sortOrder}:${tagsFilter.join(',')}:${searchFilter || ''}`;
    
    // Get total count of ACTIVE products (for pagination)
    const COUNT_QUERY = `
      query {
        productsCount(query: "status:ACTIVE") {
          count
        }
      }
    `;
    const countData = await executeGraphQL(req, COUNT_QUERY, {});
    const totalProducts = countData?.productsCount?.count || 0;
    
    // Step 1: Get product data - fetch enough to cover the requested page
    // Shopify uses cursor-based pagination, so we need to fetch all products up to (page * limit)
    const cacheKeyAll = `products:all:${sortBy}:${sortOrder}:${tagsFilter.join(',')}:${searchFilter || ''}`;
    
    const allProductsResult = await withShopCache(shop, cacheKeyAll, CACHE_TTL.SHORT, async () => {
      const sortKey = convertSortKey(sortBy);
      const reverse = sortOrder === 'desc';

      let allProducts = [];
      let hasNextPage = true;
      let cursor = null;
      const maxFetch = 250; // Shopify max per request
      
      // Fetch all products (cursor-based pagination)
      while (hasNextPage && allProducts.length < 1000) { // Safety limit
      const variables = {
          first: maxFetch,
        sortKey: sortKey,
          reverse: reverse,
          ...(cursor && { after: cursor })
      };

      const data = await executeGraphQL(req, PRODUCTS_QUERY, variables);
        const products = data?.products?.edges?.map(edge => edge.node) || [];
      
        // Filter only ACTIVE products
        const activeProducts = products.filter(p => p.status === 'ACTIVE');
        allProducts = allProducts.concat(activeProducts);
        
        hasNextPage = data?.products?.pageInfo?.hasNextPage || false;
        cursor = data?.products?.pageInfo?.endCursor;
        
        // Stop if we don't have more
        if (products.length === 0) break;
      }
      
      return allProducts;
    });
    
    // When we have client-side filters (optimized, language), we need to:
    // 1. Fetch metafields for ALL products first
    // 2. Apply filters
    // 3. Then paginate the filtered results
    
    let productsToProcess = allProductsResult;
    let filteredTotal = allProductsResult.length;
    
    // If we have optimization or language filters, we need metafields for all products
    if (hasClientFilters) {
      // Fetch metafields for ALL products (in batches of 250)
      const allProductIds = allProductsResult.map(p => p.id);
      const allFreshMetafields = {};
      
      for (let i = 0; i < allProductIds.length; i += 250) {
        const batchIds = allProductIds.slice(i, i + 250);
        const BATCH_METAFIELDS_QUERY = `
          query GetProductMetafields($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                metafields(first: 50, namespace: "seo_ai") {
                  edges {
                    node {
                      key
                      value
                    }
                  }
                }
              }
            }
          }
        `;
        const batchData = await executeGraphQL(req, BATCH_METAFIELDS_QUERY, { ids: batchIds });
        (batchData?.nodes || []).forEach(node => {
          if (node?.id) {
            allFreshMetafields[node.id] = node.metafields;
          }
        });
      }
      
      // Process all products with metafields
      let allProcessedProducts = allProductsResult.map(product => {
        const metafields = allFreshMetafields[product.id] || { edges: [] };
        const optimizationSummary = processProductMetafields(metafields);
        return {
          ...product,
          optimizationSummary,
          metafields: undefined
        };
      });
      
      // Apply filters BEFORE pagination
      if (optimizedFilter === 'true') {
        allProcessedProducts = allProcessedProducts.filter(p => p.optimizationSummary.optimized === true);
      } else if (optimizedFilter === 'false') {
        allProcessedProducts = allProcessedProducts.filter(p => p.optimizationSummary.optimized === false);
      }
      
      if (languageFilter) {
        allProcessedProducts = allProcessedProducts.filter(p => 
          p.optimizationSummary.optimizedLanguages?.includes(languageFilter)
        );
      }
      
      if (tagsFilter.length > 0) {
        allProcessedProducts = allProcessedProducts.filter(p => {
          const productTags = p.tags || [];
          return tagsFilter.some(tag => productTags.includes(tag));
        });
      }
      
      if (searchFilter) {
        const searchLower = searchFilter.toLowerCase();
        allProcessedProducts = allProcessedProducts.filter(p => 
          p.title?.toLowerCase().includes(searchLower) ||
          p.handle?.toLowerCase().includes(searchLower) ||
          p.productType?.toLowerCase().includes(searchLower)
        );
      }
      
      // Update filtered total and slice for pagination
      filteredTotal = allProcessedProducts.length;
      const startIdx = (page - 1) * limit;
      const endIdx = startIdx + limit;
      productsToProcess = allProcessedProducts.slice(startIdx, endIdx);
      
      // Return early with filtered results
      // Get AI-enhanced status from MongoDB for the page products
      const pageProductNumericIds = productsToProcess.map(p => {
        const id = p.id || '';
        return id.includes('gid://') ? id.split('/').pop() : id;
      }).filter(Boolean);
      
      const mongoProducts = await Product.find({
        shop,
        productId: { $in: pageProductNumericIds }
      }).select('productId seoStatus.aiEnhanced').lean();
      
      const aiEnhancedMap = {};
      mongoProducts.forEach(mp => {
        aiEnhancedMap[mp.productId] = mp.seoStatus?.aiEnhanced || false;
      });
      
      const finalProducts = productsToProcess.map(product => {
        const numericId = product.id.includes('gid://') ? product.id.split('/').pop() : product.id;
        const aiEnhanced = aiEnhancedMap[numericId] || false;
        return {
          ...product,
          optimizationSummary: {
            ...product.optimizationSummary,
            aiEnhanced
          }
        };
      });
      
      return res.json({
        success: true,
        products: finalProducts,
        pagination: {
          page: page,
          limit: limit,
          total: filteredTotal,
          hasNextPage: (page * limit) < filteredTotal,
          hasNext: (page * limit) < filteredTotal
        },
        shop: shop,
        auth: {
          tokenType: req.auth.tokenType,
          source: req.auth.source
        }
      });
    }
    
    // No client-side filters - use normal pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const pageProducts = allProductsResult.slice(startIndex, endIndex);
    
    // Build pagination info
    const cachedResult = {
      success: true,
      products: pageProducts.map(product => ({
        ...product,
        metafields: undefined
      })),
        pagination: {
          page: page,
          limit: limit,
        total: totalProducts,
        hasNextPage: endIndex < allProductsResult.length,
        hasNext: endIndex < allProductsResult.length
        },
        shop: shop
      };
    
    // Step 2: Fetch FRESH optimization status for page products only
    const productIds = cachedResult.products.map(p => p.id);
    
    const FRESH_METAFIELDS_QUERY = `
      query GetProductMetafields($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            metafields(first: 50, namespace: "seo_ai") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
        }
      }
    `;
    
    const freshData = await executeGraphQL(req, FRESH_METAFIELDS_QUERY, { ids: productIds });
    const freshMetafields = {};
    
    (freshData?.nodes || []).forEach(node => {
      if (node?.id) {
        freshMetafields[node.id] = node.metafields;
      }
    });
    
    // Step 3: Get AI-enhanced status from MongoDB
    const productNumericIds = cachedResult.products.map(p => {
      const id = p.id || '';
      return id.includes('gid://') ? id.split('/').pop() : id;
    }).filter(Boolean);
    
    const mongoProducts = await Product.find({
      shop,
      productId: { $in: productNumericIds }
    }).select('productId seoStatus.aiEnhanced').lean();
    
    const aiEnhancedMap = {};
    mongoProducts.forEach(mp => {
      aiEnhancedMap[mp.productId] = mp.seoStatus?.aiEnhanced || false;
    });
    
    // Step 4: Merge cached products with fresh optimization status + AI-enhanced flag
    let products = cachedResult.products.map(product => {
      const metafields = freshMetafields[product.id] || { edges: [] };
      const optimizationSummary = processProductMetafields(metafields);
      
      const numericId = product.id.includes('gid://') ? product.id.split('/').pop() : product.id;
      const aiEnhanced = aiEnhancedMap[numericId] || false;
      
      return {
        ...product,
        optimizationSummary: {
          ...optimizationSummary,
          aiEnhanced // Add AI-enhanced flag to summary
        },
        metafields // Include fresh metafields for debugging
      };
    });

    // Note: Client-side filters are applied above when hasClientFilters is true
    // This code path only runs when NO filters are active

    // Return result with FRESH optimization status
    return res.json({
      success: true,
      products: products,
      pagination: {
        ...cachedResult.pagination,
        total: cachedResult.pagination.total,
        hasNext: page * limit < cachedResult.pagination.total
      },
      shop: shop,
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
      
      allProducts.push(...edges.map(edge => edge.node));
      
      hasNextPage = productsData.pageInfo?.hasNextPage || false;
      cursor = productsData.pageInfo?.endCursor || null;
      
      if (edges.length === 0) break;
    }

    // Count only ACTIVE products (exclude DRAFT and ARCHIVED)
    const activeProducts = allProducts.filter(p => p.status === 'ACTIVE');

    return res.json({
      success: true,
      productsCount: activeProducts.length,
      totalProducts: allProducts.length,
      shop: req.auth.shop,
      message: `Successfully synced ${activeProducts.length} products`
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

/**
 * DELETE /api/products/reset-shop
 * Delete all products from MongoDB for a specific shop
 * Useful for testing or clean slate after schema changes
 */
router.delete('/reset-shop', async (req, res) => {
  try {
    const shop = req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter required in query string' });
    }
    
    // Count products before deletion
    const countBefore = await Product.countDocuments({ shop });
    
    // Delete all products for this shop
    const result = await Product.deleteMany({ shop });
    
    return res.json({
      success: true,
      shop,
      deletedCount: result.deletedCount,
      countBefore,
      message: `Successfully deleted ${result.deletedCount} products from MongoDB for ${shop}`
    });
    
  } catch (error) {
    console.error('[RESET-SHOP] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to reset shop products'
    });
  }
});

export default router;