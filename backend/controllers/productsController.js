// backend/controllers/productsController.js
import { Router } from 'express';
import Product from '../db/Product.js';
import { requireShop, shopGraphQL } from './seoController.js';
import fetch from 'node-fetch';

// Import resolveAdminTokenForShop function
async function resolveAdminTokenForShop(shop) {
  try {
    const mod = await import('../db/Shop.js');
    const Shop = (mod && (mod.default || mod.Shop || mod.shop)) || null;
    if (Shop && typeof Shop.findOne === 'function') {
      const doc = await Shop.findOne({ shopDomain: shop }).lean().exec();
      if (doc && doc.accessToken) return doc.accessToken;
    }
  } catch (e) {
    console.warn('[TOKEN] DB lookup failed:', e.message);
  }
  
  // Fallback to env
  const fallback = process.env.SHOPIFY_ADMIN_TOKEN || '';
  if (!fallback) throw new Error('No admin token available');
  return fallback;
}

const router = Router();

// Helper to convert numeric ID to GID
function toGID(productId) {
  if (/^\d+$/.test(String(productId))) return `gid://shopify/Product/${productId}`;
  return String(productId);
}

// Helper to safely query products with valid productIds
function getValidProductsQuery(baseQuery) {
  return {
    ...baseQuery,
    $and: [
      ...(baseQuery.$and || []),
      {
        $or: [
          { productId: { $type: 'number' } },
          { productId: { $exists: false } } // Allow products without productId
        ]
      },
      // ПРЕМАХНИ: { productId: { $ne: NaN } }, // MongoDB не може да сравнява с NaN
      { productId: { $ne: null } }
    ]
  };
}

// GET /api/products/list - List products with pagination and filters
router.get('/list', async (req, res) => {
  try {
    const shop = requireShop(req);
    const {
      page = 1,
      limit = 50,
      search = '',
      tags = '',
      optimized,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build MongoDB query
    const query = { shop };

   // Search filter (title, handle, or productId)
if (search) {
  const searchConditions = [
    { title: { $regex: search, $options: 'i' } },
    { handle: { $regex: search, $options: 'i' } }
  ];
  
  // Safe numeric check
  const trimmedSearch = search.trim();
  if (/^\d+$/.test(trimmedSearch)) {
    const numericId = parseInt(trimmedSearch);
    if (Number.isFinite(numericId) && numericId > 0) {
      searchConditions.push({ productId: numericId });
    }
  }
  
  // Check for GID format
  if (trimmedSearch.startsWith('gid://')) {
    const match = trimmedSearch.match(/\/(\d+)$/);
    if (match && match[1]) {
      const extractedId = parseInt(match[1]);
      if (Number.isFinite(extractedId) && extractedId > 0) {
        searchConditions.push({ productId: extractedId });
      }
    }
  }
  
  query.$or = searchConditions;
}

    // Tags filter
    if (tags) {
      const tagArray = tags.split(',').map(t => t.trim()).filter(Boolean);
      if (tagArray.length) {
        query.tags = { $in: tagArray };
      }
    }

// Language filter
if (req.query.languageFilter) {
  const [action, lang] = req.query.languageFilter.split('_');
  if (action === 'has') {
    query['seoStatus.languages'] = { 
      $elemMatch: { code: lang, optimized: true } 
    };
  } else if (action === 'missing') {
    query['$or'] = [
      { 'seoStatus.languages': { $not: { $elemMatch: { code: lang, optimized: true } } } },
      { 'seoStatus.languages': { $exists: false } }
    ];
  }
}

    // SEO optimization filter
    if (optimized !== undefined && optimized !== '') {
      query['seoStatus.optimized'] = optimized === 'true';
    }

    // Status filter
    if (status && ['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(status)) {
      query.status = status;
    }

    // Apply valid products filter
    const safeQuery = getValidProductsQuery(query);

    // Execute queries
    const [products, total] = await Promise.all([
      Product.find(safeQuery)
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Product.countDocuments(safeQuery)
    ]);

    // Add optimization summary to each product by reading metafields from Shopify
    console.log('[PRODUCTS] Starting to fetch metafields for', products.length, 'products');
    const startTime = Date.now();
    
    const productsWithSummary = await Promise.all(
      products.map(async (product, index) => {
        let optimizedLanguages = [];
        
        try {
          // Четем metafields директно от Shopify като Collections
          const token = await resolveAdminTokenForShop(shop);
          const metafieldUrl = `https://${shop}/admin/api/2025-07/products/${product.productId}/metafields.json?namespace=seo_ai`;
          const mfResponse = await fetch(metafieldUrl, {
            headers: {
              'X-Shopify-Access-Token': token,
              'Content-Type': 'application/json',
            }
          });
          
          if (mfResponse.ok) {
            const mfData = await mfResponse.json();
            const metafields = mfData.metafields || [];
            
            // Извличаме езиците от keys като seo__en, seo__bg и т.н.
            metafields.forEach(mf => {
              if (mf.key && mf.key.startsWith('seo__')) {
                const lang = mf.key.replace('seo__', '');
                if (lang && !optimizedLanguages.includes(lang)) {
                  optimizedLanguages.push(lang);
                }
              }
            });
            
            if (index < 3) { // Debug първите 3 продукта
              console.log(`[PRODUCTS] Product ${product.productId} (${product.title}): metafields:`, metafields.map(m => m.key), 'optimizedLanguages:', optimizedLanguages);
            }
          }
        } catch (e) {
          console.error('[PRODUCTS] Error checking metafields for product:', product.productId, e.message);
          // Fallback към MongoDB данните
          optimizedLanguages = product.seoStatus?.languages?.filter(l => l.optimized).map(l => l.code) || [];
        }
        
        return {
          ...product,
          optimizationSummary: {
            isOptimized: optimizedLanguages.length > 0,
            optimizedLanguages,
            lastOptimized: product.seoStatus?.languages
              ?.filter(l => l.optimized && l.lastOptimizedAt)
              ?.map(l => l.lastOptimizedAt)
              ?.sort((a, b) => new Date(b) - new Date(a))[0] || null
          }
        };
      })
    );
    
    const endTime = Date.now();
    console.log('[PRODUCTS] Finished fetching metafields in', endTime - startTime, 'ms');

    res.json({
      products: productsWithSummary,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('GET /api/products/list error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to fetch products' });
  }
});

// GET /api/products/sync-status - Check sync status
router.get('/sync-status', async (req, res) => {
  try {
    const shop = requireShop(req);
    
    const safeQuery = getValidProductsQuery({ shop });
    
    const [totalInDB, lastSync, invalidCount] = await Promise.all([
      Product.countDocuments(safeQuery),
      Product.findOne(safeQuery).sort({ syncedAt: -1 }).select('syncedAt').lean(),
      Product.countDocuments({
        shop,
        $or: [
          { productId: { $type: 'string' } },
          { productId: null },
          { productId: { $exists: false } }
        ]
      })
    ]);

    res.json({
      shop,
      totalProducts: totalInDB,
      invalidProducts: invalidCount,
      lastSyncedAt: lastSync?.syncedAt || null,
      needsSync: !lastSync || (Date.now() - new Date(lastSync.syncedAt) > 24 * 60 * 60 * 1000) // older than 24h
    });

  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// POST /api/products/sync - Sync products from Shopify
router.post('/sync', async (req, res) => {
  try {
    const shop = requireShop(req);
    
    // Import dynamically to avoid circular dependencies
    const { syncProductsForShop } = await import('./productSync.js');
    
    // Start sync (this is the simple version, later we'll make it a background job)
    const result = await syncProductsForShop(shop);
    
    res.json({
      success: true,
      shop,
      synced: result.count,
      message: `Successfully synced ${result.count} products`
    });

  } catch (error) {
    console.error('POST /api/products/sync error:', error);
    res.status(error.status || 500).json({ 
      success: false,
      error: error.message || 'Sync failed' 
    });
  }
});

// GET /api/products/tags/list - Get all unique tags for filtering
router.get('/tags/list', async (req, res) => {
  try {
    const shop = requireShop(req);
    
    const safeQuery = getValidProductsQuery({ shop });
    
    // Use MongoDB aggregation to get unique tags
    const tags = await Product.distinct('tags', safeQuery);
    
    res.json({
      tags: tags.filter(Boolean).sort(),
      count: tags.length
    });

  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// GET /api/products/seo-status - Get SEO optimization statistics
router.get('/seo-status', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    console.log(`Getting SEO status for shop: ${shop}`);

    // Use aggregation to safely count products
    const countPipeline = [
      { $match: { shop } },
      {
        $addFields: {
          isValidProduct: {
            $and: [
              { $isNumber: "$productId" },
              { $ne: ["$productId", null] },
              { $ne: [{ $toString: "$productId" }, "NaN"] }
            ]
          }
        }
      }
    ];

    // Get total valid products
    const totalResult = await Product.aggregate([
      ...countPipeline,
      { $match: { isValidProduct: true } },
      { $count: "total" }
    ]);
    const total = totalResult[0]?.total || 0;

    // Get optimized products
    const optimizedResult = await Product.aggregate([
      ...countPipeline,
      { $match: { isValidProduct: true, 'seoStatus.optimized': true } },
      { $count: "optimized" }
    ]);
    const optimized = optimizedResult[0]?.optimized || 0;

    // Get invalid products count
    const invalidResult = await Product.aggregate([
      { $match: { shop } },
      {
        $addFields: {
          isInvalid: {
            $or: [
              { $eq: [{ $type: "$productId" }, "string"] },
              { $eq: ["$productId", null] },
              { $not: [{ $isNumber: "$productId" }] },
              { $eq: [{ $toString: "$productId" }, "NaN"] }
            ]
          }
        }
      },
      { $match: { isInvalid: true } },
      { $count: "invalid" }
    ]);
    const invalidCount = invalidResult[0]?.invalid || 0;

    const unoptimized = total - optimized;

    // Get products by language using aggregation
    const languageStats = await Product.aggregate([
      ...countPipeline,
      { $match: { isValidProduct: true } },
      { $match: { 'seoStatus.languages': { $exists: true, $type: 'array' } } },
      { $unwind: '$seoStatus.languages' },
      { $match: { 'seoStatus.languages.optimized': true } },
      { $group: {
          _id: '$seoStatus.languages.code',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get last sync info
    const lastSyncResult = await Product.aggregate([
      ...countPipeline,
      { $match: { isValidProduct: true } },
      { $sort: { syncedAt: -1 } },
      { $limit: 1 },
      { $project: { syncedAt: 1 } }
    ]);
    const lastSync = lastSyncResult[0];

    res.json({
      shop,
      total,
      optimized,
      unoptimized,
      invalidProducts: invalidCount,
      optimizationRate: total > 0 ? ((optimized / total) * 100).toFixed(1) + '%' : '0%',
      languageStats: languageStats.map(ls => ({
        language: ls._id,
        count: ls.count
      })),
      lastSyncedAt: lastSync?.syncedAt || null,
      warning: invalidCount > 0 ? `Found ${invalidCount} products with invalid IDs. Run cleanup to fix.` : null
    });

  } catch (error) {
    console.error('GET /api/products/seo-status error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch SEO status' });
  }
});

// DELETE /api/products/clear - Clear all products for a shop
router.delete('/clear', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    const result = await Product.deleteMany({ shop });
    res.json({ 
      success: true,
      shop,
      deleted: result.deletedCount 
    });
    
  } catch (error) {
    console.error('DELETE /api/products/clear error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/products/cleanup - Clean up invalid products
router.post('/cleanup', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    console.log(`Starting cleanup for shop: ${shop}`);

    // Use aggregation to find invalid products without triggering cast errors
    const invalidProducts = await Product.aggregate([
      { $match: { shop } },
      {
        $addFields: {
          isInvalid: {
            $or: [
              { $eq: [{ $type: "$productId" }, "string"] },
              { $eq: ["$productId", null] },
              { $not: [{ $isNumber: "$productId" }] },
              { $eq: [{ $toString: "$productId" }, "NaN"] }
            ]
          }
        }
      },
      { $match: { isInvalid: true } },
      {
        $project: {
          _id: 1,
          title: 1,
          productId: 1,
          productIdType: { $type: "$productId" },
          productIdString: { $toString: "$productId" }
        }
      }
    ]);

    console.log(`Found ${invalidProducts.length} invalid products`);

    // Delete invalid products using their _id
    const idsToDelete = invalidProducts.map(p => p._id);
    let deleteResult = { deletedCount: 0 };
    
    if (idsToDelete.length > 0) {
      deleteResult = await Product.deleteMany({
        _id: { $in: idsToDelete }
      });
      console.log(`Deleted ${deleteResult.deletedCount} products`);
    }

    // Count remaining valid products
    const remainingCount = await Product.countDocuments({
      shop,
      productId: { $type: 'number' }
    });

    res.json({
      success: true,
      shop,
      cleaned: {
        found: invalidProducts.length,
        deleted: deleteResult.deletedCount,
        details: invalidProducts.map(p => ({
          _id: p._id,
          title: p.title,
          productId: p.productId,
          type: p.productIdType,
          asString: p.productIdString
        }))
      },
      remaining: remainingCount
    });

  } catch (error) {
    console.error('POST /api/products/cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/bulk-select - Get products for bulk operations
router.get('/bulk-select', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { 
      ids, // comma-separated product IDs
      optimized = 'all' // all, true, false
    } = req.query;

    // Build query with safe filters
    const query = getValidProductsQuery({ shop });

    // Filter by specific IDs if provided
    if (ids) {
      const idArray = ids.split(',').map(id => {
        const num = parseInt(id);
        return !isNaN(num) && isFinite(num) ? num : null;
      }).filter(Boolean);
      
      if (idArray.length > 0) {
        query.productId = { $in: idArray };
      }
    }

    // Filter by optimization status
    if (optimized !== 'all') {
      query['seoStatus.optimized'] = optimized === 'true';
    }

    const products = await Product.find(query)
      .select('productId title handle seoStatus tags images')
      .limit(200) // Limit for bulk operations
      .lean();

    res.json({
      products: products.map(p => ({
        id: p.productId,
        gid: toGID(p.productId),
        title: p.title,
        handle: p.handle,
        image: p.images?.[0] || null,
        isOptimized: p.seoStatus?.optimized || false,
        optimizedLanguages: p.seoStatus?.languages?.filter(l => l.optimized).map(l => l.code) || []
      })),
      count: products.length
    });

  } catch (error) {
    console.error('GET /api/products/bulk-select error:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// GET /api/products/:productId - Get single product with full details
// ВАЖНО: Този route е последен, защото съдържа динамичен параметър
router.get('/:productId', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { productId } = req.params;
    const gid = toGID(productId);
    
    // Parse numeric ID safely
    const numericId = parseInt(productId);
    const isValidNumeric = !isNaN(numericId) && isFinite(numericId);
    
    // Build query conditions
    const queryConditions = [{ gid }];
    if (isValidNumeric) {
      queryConditions.push({ productId: numericId });
    }
    
    // Try to find in MongoDB first
    let product = await Product.findOne({ 
      shop, 
      $or: queryConditions
    }).lean();

    if (!product) {
      // If not in DB, fetch from Shopify
      const query = `
        query GetProduct($id: ID!) {
          product(id: $id) {
            id
            title
            handle
            descriptionHtml
            status
            vendor
            productType
            tags
            createdAt
            publishedAt
            totalInventory
            featuredImage {
              url
              altText
            }
          }
        }
      `;
      
      const data = await shopGraphQL(shop, query, { id: gid });
      
      if (!data.product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      
      // Return Shopify data (not saved to DB yet)
      product = {
        ...data.product,
        productId: numericId,
        shop,
        gid,
        seoStatus: { optimized: false, languages: [] }
      };
    }

    res.json({ product });

  } catch (error) {
    console.error('GET /api/products/:productId error:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

export default router;