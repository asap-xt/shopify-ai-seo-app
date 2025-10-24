// backend/db/indexes.js
// Database indexes for optimized query performance
// Created: 2025-01-24
// Purpose: PHASE 2 - Speed up common queries by 10-50x

import { dbLogger } from '../utils/logger.js';

/**
 * Create all necessary indexes for optimal query performance
 * This runs once on server startup
 */
export async function createAllIndexes() {
  dbLogger.info('📇 Starting index creation (PHASE 2)...');
  
  try {
    // Import models dynamically to avoid circular dependencies
    const Product = (await import('./Product.js')).default;
    const Collection = (await import('./Collection.js')).default;
    const Shop = (await import('./Shop.js')).default;
    const Sitemap = (await import('./Sitemap.js')).default;
    const Subscription = (await import('./Subscription.js')).default;
    const AdvancedSchema = (await import('./AdvancedSchema.js')).default;
    const SyncLog = (await import('./SyncLog.js')).default;
    
    let indexCount = 0;
    
    // ============================================================================
    // PRODUCT INDEXES
    // ============================================================================
    dbLogger.info('📇 Creating Product indexes...');
    
    // Drop existing conflicting indexes first (if they exist)
    try {
      await Product.collection.dropIndex('shop_1_handle_1');
      dbLogger.info('🗑️  Dropped old shop_1_handle_1 index');
    } catch (e) {
      // Index doesn't exist, that's fine
    }
    
    try {
      await Product.collection.dropIndex('shop_1_shopifyId_1');
      dbLogger.info('🗑️  Dropped old shop_1_shopifyId_1 index');
    } catch (e) {
      // Index doesn't exist, that's fine
    }
    
    // Index 1: shop (most common query)
    await Product.collection.createIndex({ shop: 1 });
    indexCount++;
    
    // Index 2: shop + seoStatus.optimized (for optimized products count)
    await Product.collection.createIndex({ 
      shop: 1, 
      'seoStatus.optimized': 1 
    });
    indexCount++;
    
    // Index 3: shop + updatedAt (for sorting by last updated)
    await Product.collection.createIndex({ 
      shop: 1, 
      updatedAt: -1 
    });
    indexCount++;
    
    // Index 4: shop + handle (for quick product lookup) - PARTIAL UNIQUE
    // Only enforce uniqueness when handle exists and is not null
    await Product.collection.createIndex({ 
      shop: 1, 
      handle: 1 
    }, { 
      unique: true,
      partialFilterExpression: { 
        handle: { $exists: true, $type: "string" } 
      }
    });
    indexCount++;
    
    // Index 5: shop + shopifyId (for GraphQL sync) - PARTIAL UNIQUE
    // Only enforce uniqueness when shopifyId exists and is not null (allows drafts/temporary products)
    await Product.collection.createIndex({ 
      shop: 1, 
      shopifyId: 1 
    }, { 
      unique: true,
      partialFilterExpression: { 
        shopifyId: { $exists: true, $type: "string" } 
      }
    });
    indexCount++;
    
    dbLogger.info('✅ Product indexes created (5)');
    
    // ============================================================================
    // COLLECTION INDEXES
    // ============================================================================
    dbLogger.info('📇 Creating Collection indexes...');
    
    // Drop existing conflicting indexes first (if they exist)
    try {
      await Collection.collection.dropIndex('shop_1_handle_1');
      dbLogger.info('🗑️  Dropped old Collection shop_1_handle_1 index');
    } catch (e) {
      // Index doesn't exist, that's fine
    }
    
    // Index 1: shop (most common query)
    await Collection.collection.createIndex({ shop: 1 });
    indexCount++;
    
    // Index 2: shop + seoStatus.optimized (for optimized collections count)
    await Collection.collection.createIndex({ 
      shop: 1, 
      'seoStatus.optimized': 1 
    });
    indexCount++;
    
    // Index 3: shop + handle (for quick collection lookup) - PARTIAL UNIQUE
    // Only enforce uniqueness when handle exists and is not null
    await Collection.collection.createIndex({ 
      shop: 1, 
      handle: 1 
    }, { 
      unique: true,
      partialFilterExpression: { 
        handle: { $exists: true, $type: "string" } 
      }
    });
    indexCount++;
    
    dbLogger.info('✅ Collection indexes created (3)');
    
    // ============================================================================
    // SHOP INDEXES
    // ============================================================================
    dbLogger.info('📇 Creating Shop indexes...');
    
    // Index 1: shop (primary lookup - already exists as unique)
    // This is already defined in Shop.js schema, but let's ensure it
    await Shop.collection.createIndex({ shop: 1 }, { unique: true });
    indexCount++;
    
    dbLogger.info('✅ Shop indexes created (1)');
    
    // ============================================================================
    // SITEMAP INDEXES
    // ============================================================================
    dbLogger.info('📇 Creating Sitemap indexes...');
    
    // Index 1: shop (primary lookup)
    await Sitemap.collection.createIndex({ shop: 1 }, { unique: true });
    indexCount++;
    
    dbLogger.info('✅ Sitemap indexes created (1)');
    
    // ============================================================================
    // SUBSCRIPTION INDEXES
    // ============================================================================
    dbLogger.info('📇 Creating Subscription indexes...');
    
    // Index 1: shop (primary lookup)
    await Subscription.collection.createIndex({ shop: 1 }, { unique: true });
    indexCount++;
    
    // Index 2: status (for active subscription queries)
    await Subscription.collection.createIndex({ status: 1 });
    indexCount++;
    
    dbLogger.info('✅ Subscription indexes created (2)');
    
    // ============================================================================
    // ADVANCED SCHEMA INDEXES
    // ============================================================================
    dbLogger.info('📇 Creating AdvancedSchema indexes...');
    
    // Drop existing conflicting indexes first (if they exist)
    try {
      await AdvancedSchema.collection.dropIndex('shop_1_productHandle_1');
      dbLogger.info('🗑️  Dropped old AdvancedSchema shop_1_productHandle_1 index');
    } catch (e) {
      // Index doesn't exist, that's fine
    }
    
    // Index 1: shop + productHandle (for quick schema lookup) - PARTIAL UNIQUE
    // Only enforce uniqueness when productHandle exists and is not null
    await AdvancedSchema.collection.createIndex({ 
      shop: 1, 
      productHandle: 1 
    }, { 
      unique: true,
      partialFilterExpression: { 
        productHandle: { $exists: true, $type: "string" } 
      }
    });
    indexCount++;
    
    dbLogger.info('✅ AdvancedSchema indexes created (1)');
    
    // ============================================================================
    // SYNC LOG INDEXES
    // ============================================================================
    dbLogger.info('📇 Creating SyncLog indexes...');
    
    // Index 1: shop + createdAt (for latest sync status)
    await SyncLog.collection.createIndex({ 
      shop: 1, 
      createdAt: -1 
    });
    indexCount++;
    
    // Index 2: TTL index - auto-delete logs older than 30 days
    await SyncLog.collection.createIndex(
      { createdAt: 1 }, 
      { expireAfterSeconds: 30 * 24 * 60 * 60 } // 30 days
    );
    indexCount++;
    
    dbLogger.info('✅ SyncLog indexes created (2)');
    
    // ============================================================================
    // SUMMARY
    // ============================================================================
    dbLogger.info(`✅ PHASE 2 COMPLETE: Created ${indexCount} indexes successfully!`);
    dbLogger.info('   Expected performance: 10-50x faster queries');
    
    return { success: true, indexCount };
    
  } catch (error) {
    dbLogger.error('❌ Error creating indexes:', error.message);
    dbLogger.warn('⚠️  App will continue without indexes (degraded performance)');
    return { success: false, error: error.message };
  }
}

/**
 * Get index statistics for monitoring
 */
export async function getIndexStats() {
  try {
    const Product = (await import('./Product.js')).default;
    const Collection = (await import('./Collection.js')).default;
    const Shop = (await import('./Shop.js')).default;
    
    const productIndexes = await Product.collection.indexes();
    const collectionIndexes = await Collection.collection.indexes();
    const shopIndexes = await Shop.collection.indexes();
    
    return {
      Product: productIndexes.length,
      Collection: collectionIndexes.length,
      Shop: shopIndexes.length,
      total: productIndexes.length + collectionIndexes.length + shopIndexes.length
    };
  } catch (error) {
    dbLogger.error('Error getting index stats:', error.message);
    return null;
  }
}

