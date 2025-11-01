// backend/controllers/dashboardController.js
import express from 'express';
import Product from '../db/Product.js';
import Collection from '../db/Collection.js';
import Shop from '../db/Shop.js';
import Sitemap from '../db/Sitemap.js';
import Subscription from '../db/Subscription.js';
import TokenBalance from '../db/TokenBalance.js';
import { verifyRequest } from '../middleware/verifyRequest.js';
import { requireAuth, executeGraphQL } from '../middleware/modernAuth.js';
import { syncStore } from '../services/syncService.js';
import { withShopCache, CACHE_TTL } from '../utils/cacheWrapper.js';
import cacheService from '../services/cacheService.js';

const router = express.Router();

/**
 * GET /api/dashboard/stats
 * Returns optimization statistics and status for dashboard
 */
router.get('/stats', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // Cache dashboard stats for 1 minute (PHASE 3: Caching)
    // Dashboard is frequently accessed, so short TTL keeps data fresh
    const stats = await withShopCache(shop, 'dashboard:stats', CACHE_TTL.VERY_SHORT, async () => {
      // Get subscription to check plan features
      const subscription = await Subscription.findOne({ shop });
      const plan = subscription?.plan || 'starter';
    
    // Products stats
    const totalProducts = await Product.countDocuments({ shop });
    const optimizedProducts = await Product.countDocuments({ 
      shop, 
      'seoStatus.optimized': true 
    });
    const lastOptimizedProduct = await Product.findOne({ 
      shop, 
      'seoStatus.optimized': true 
    }).sort({ updatedAt: -1 }).select('updatedAt');
    
    // Collections stats (always computed; UI can still gate features by plan)
    const hasCollections = ['growth', 'growth_extra', 'enterprise'].includes(plan);
    const totalCollections = await Collection.countDocuments({ shop });
    const optimizedCollections = await Collection.countDocuments({ 
      shop, 
      'seoStatus.optimized': true 
    });
    const lastOptimizedCollection = await Collection.findOne({ 
      shop, 
      'seoStatus.optimized': true 
    }).sort({ updatedAt: -1 }).select('updatedAt');
    
    // Store Metadata status (only for Professional+)
    const hasStoreMetadata = ['professional', 'growth', 'growth_extra', 'enterprise'].includes(plan);
    let storeMetadataComplete = false;
    
    if (hasStoreMetadata) {
      const shopData = await Shop.findOne({ shop });
      // Check if essential fields are filled
      storeMetadataComplete = !!(
        shopData?.storeProfile?.description &&
        shopData?.shippingInfo?.standardShipping?.description
      );
    }
    
    // Sitemap status
    const sitemap = await Sitemap.findOne({ shop });
    const sitemapGenerated = !!sitemap;
    
    // Advanced Schema status (only for Enterprise)
    const hasAdvancedSchema = plan === 'enterprise';
    let advancedSchemaActive = false;
    
    if (hasAdvancedSchema) {
      // Check if any product has advanced schema
      const productWithSchema = await Product.findOne({ 
        shop, 
        'schemas.0': { $exists: true } 
      });
      advancedSchemaActive = !!productWithSchema;
    }
    
    // Generate alerts & recommendations
    // Priority order: Products > Collections > Store Metadata > Token Balance > Advanced Schema > Sitemap
    const alerts = [];
    
    // PRIORITY 1: Unoptimized products (MOST IMPORTANT)
    const unoptimizedProducts = totalProducts - optimizedProducts;
    if (unoptimizedProducts > 0) {
      alerts.push({
        type: 'warning',
        title: `${unoptimizedProducts} product${unoptimizedProducts > 1 ? 's' : ''} not yet optimized`,
        message: 'Optimize your products to improve AI Search visibility and drive more organic traffic.',
        action: {
          label: 'Optimize Now',
          url: `/ai-seo/products`
        }
      });
    }
    
    // PRIORITY 2: Unoptimized collections (if available)
    if (hasCollections) {
      const unoptimizedCollections = totalCollections - optimizedCollections;
      if (unoptimizedCollections > 0) {
        alerts.push({
          type: 'warning',
          title: `${unoptimizedCollections} collection${unoptimizedCollections > 1 ? 's' : ''} not yet optimized`,
          message: 'Optimize your collections to improve AI Search visibility.',
          action: {
            label: 'Optimize Now',
            url: `/ai-seo/collections`
          }
        });
      }
    }
    
    // PRIORITY 3: Incomplete Store Metadata
    if (hasStoreMetadata && !storeMetadataComplete) {
      alerts.push({
        type: 'info',
        title: 'Complete your store information',
        message: 'Add shipping, return policies, and store details to help AI provide accurate information to customers.',
        action: {
          label: 'Complete Now',
          url: `/ai-seo/store-metadata`
        }
      });
    }
    
    // PRIORITY 4: Low token balance (only for pay-per-use plans)
    const payPerUsePlans = ['starter', 'professional', 'growth'];
    if (payPerUsePlans.includes(plan)) {
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      if (tokenBalance.balance < 10000) { // Less than 10K tokens
        alerts.push({
          type: 'warning',
          title: 'Low token balance',
          message: `You have ${tokenBalance.balance.toLocaleString()} tokens remaining. Purchase more to continue using AI features.`,
          action: {
            label: 'Buy Tokens',
            url: `/billing`
          }
        });
      }
    }
    
    // PRIORITY 5: Advanced Schema not set up (Enterprise only)
    if (hasAdvancedSchema && !advancedSchemaActive) {
      alerts.push({
        type: 'info',
        title: 'Advanced Schema available',
        message: 'Add structured data to your products to improve AI understanding.',
        action: {
          label: 'Set Up Schema',
          url: `/ai-seo/schema-data`
        }
      });
    }
    
    // PRIORITY 6: No sitemap (LEAST IMPORTANT - shown last)
    if (!sitemapGenerated) {
      alerts.push({
        type: 'info',
        title: 'Generate your AI Sitemap',
        message: 'Create a sitemap to help AI bots discover your store content.',
        action: {
          label: 'Generate Sitemap',
          url: `/ai-seo/sitemap`
        }
      });
    }
    
    // Get language statistics
    let languageStats = [];
    try {
      // Aggregate products by language and optimization status
      const languageAgg = await Product.aggregate([
        { $match: { shop } },
        { $unwind: '$seoStatus.languages' },
        { $group: {
          _id: '$seoStatus.languages.code',
          optimizedCount: {
            $sum: { $cond: ['$seoStatus.languages.optimized', 1, 0] }
          },
          totalCount: { $sum: 1 }
        }},
        { $sort: { totalCount: -1 } }
      ]);
      
      // Merge with storeLanguages from Shop to always show available languages
      const shopDataForLangs = await Shop.findOne({ shop }).lean();
      const storeLangs = shopDataForLangs?.storeLanguages || [];

      const aggByCode = new Map(languageAgg.map(l => [l._id, l]));

      storeLangs.forEach(l => {
        const agg = aggByCode.get(l.locale);
        const langName = l.name || l.locale;
        languageStats.push({
          code: l.locale,
          name: langName,
          optimizedCount: agg?.optimizedCount || 0,
          totalCount: agg?.totalCount || 0,
          primary: !!l.primary
        });
        if (agg) aggByCode.delete(l.locale);
      });

      // Add any remaining languages from aggregation not present in storeLanguages
      for (const [code, agg] of aggByCode.entries()) {
        const langName = {
          'en': 'English',
          'de': 'German',
          'fr': 'French',
          'es': 'Spanish',
          'it': 'Italian',
          'nl': 'Dutch',
          'pt': 'Portuguese',
          'ja': 'Japanese',
          'zh': 'Chinese',
          'ko': 'Korean'
        }[code] || code;

        languageStats.push({
          code,
          name: langName,
          optimizedCount: agg.optimizedCount,
          totalCount: agg.totalCount,
          primary: code === 'en'
        });
      }
    } catch (error) {
      console.error('[Dashboard] Error getting language stats:', error);
    }
    
    // Get last optimization date
    let lastOptimization = null;
    try {
      const lastOptimizedProduct = await Product.findOne(
        { 
          shop,
          'seoStatus.languages.optimized': true,
          'seoStatus.languages.lastOptimizedAt': { $exists: true }
        },
        { 'seoStatus.languages.$': 1 }
      ).sort({ 'seoStatus.languages.lastOptimizedAt': -1 });
      
      if (lastOptimizedProduct && lastOptimizedProduct.seoStatus?.languages?.[0]?.lastOptimizedAt) {
        lastOptimization = lastOptimizedProduct.seoStatus.languages[0].lastOptimizedAt;
      }
    } catch (error) {
      console.error('[Dashboard] Error getting last optimization:', error);
    }
    
    // Recommendation: Upgrade plan (if needed)
    if (plan === 'starter' && totalProducts > 50) {
      alerts.push({
        type: 'info',
        title: 'Consider upgrading your plan',
        message: 'Your store has grown! Upgrade to Professional for more features and higher limits.',
        action: {
          label: 'View Plans',
          url: `/billing?shop=${shop}`
        }
      });
    }
    
    // Get plan config for correct pricing (now using Subscription virtual property)
    
    const stats = {
      subscription: {
        plan,
        price: subscription?.price || 0 // Virtual property from Subscription model
      },
      products: {
        total: totalProducts,
        optimized: optimizedProducts,
        unoptimized: unoptimizedProducts,
        lastOptimized: lastOptimizedProduct?.updatedAt || null
      },
      collections: {
        total: totalCollections,
        optimized: optimizedCollections,
        unoptimized: totalCollections - optimizedCollections,
        lastOptimized: lastOptimizedCollection?.updatedAt || null
      },
      languages: languageStats,
      lastOptimization: lastOptimization,
      storeMetadata: hasStoreMetadata ? {
        complete: storeMetadataComplete
      } : null,
      sitemap: {
        generated: sitemapGenerated
      },
      advancedSchema: hasAdvancedSchema ? {
        active: advancedSchemaActive
      } : null,
      storeMarkets: (await Shop.findOne({ shop }))?.storeMarkets || [],
      alerts
    };
    
    return stats; // Return stats for caching
    }); // End withShopCache
    
    res.json(stats);
  } catch (error) {
    console.error('[Dashboard] Error getting stats:', error);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

/**
 * POST /api/dashboard/sync
 * Trigger full store sync
 */
router.post('/sync', requireAuth, async (req, res) => {
  try {
    const shop = req.shopDomain;
    // Wrap GraphQL helper so syncService can call it like a function
    const adminGraphql = (query, variables = {}) => executeGraphQL(req, query, variables);

    console.log(`[Dashboard] Starting store sync for ${shop}`);

    // Check if sync is already in progress
    const shopData = await Shop.findOne({ shop });
    if (shopData?.syncStatus?.inProgress) {
      return res.status(409).json({ 
        error: 'Sync already in progress',
        inProgress: true
      });
    }

    // Start sync (non-blocking)
    syncStore(adminGraphql, shop, (progress) => {
      // TODO: Can emit SSE events here if needed
    }).catch(error => {
      console.error('[Dashboard] Sync error:', error);
    }).finally(async () => {
      // Invalidate cache after sync completes (PHASE 3: Caching)
      await cacheService.invalidateShop(shop);
    });

    // Return immediately
    res.json({ 
      success: true,
      message: 'Sync started',
      inProgress: true
    });
  } catch (error) {
    console.error('[Dashboard] Error starting sync:', error);
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

/**
 * GET /api/dashboard/sync-status
 * Get current sync status
 */
router.get('/sync-status', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    const shopData = await Shop.findOne({ shop });
    if (!shopData) {
      return res.json({ 
        synced: false,
        inProgress: false,
        lastSyncDate: null
      });
    }

    res.json({
      synced: !!shopData.lastSyncDate,
      inProgress: shopData.syncStatus?.inProgress || false,
      lastSyncDate: shopData.lastSyncDate,
      lastError: shopData.syncStatus?.lastError || null,
      autoSyncEnabled: shopData.autoSyncEnabled || false
    });
  } catch (error) {
    console.error('[Dashboard] Error getting sync status:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

/**
 * POST /api/dashboard/auto-sync
 * Toggle auto-sync setting
 */
router.post('/auto-sync', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { enabled } = req.body;

    await Shop.findOneAndUpdate(
      { shop },
      { autoSyncEnabled: !!enabled },
      { new: true }
    );

    res.json({ 
      success: true,
      autoSyncEnabled: !!enabled
    });
  } catch (error) {
    console.error('[Dashboard] Error toggling auto-sync:', error);
    res.status(500).json({ error: 'Failed to toggle auto-sync' });
  }
});

export default router;

