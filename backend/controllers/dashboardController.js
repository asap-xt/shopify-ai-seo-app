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

const router = express.Router();

/**
 * GET /api/dashboard/stats
 * Returns optimization statistics and status for dashboard
 */
router.get('/stats', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    console.log('[Dashboard] Loading stats for:', shop);
    
    // Get subscription to check plan features
    const subscription = await Subscription.findOne({ shop });
    const plan = subscription?.plan || 'starter';
    
    // Products stats
    const totalProducts = await Product.countDocuments({ shop });
    const optimizedProducts = await Product.countDocuments({ 
      shop, 
      optimized: true 
    });
    const lastOptimizedProduct = await Product.findOne({ 
      shop, 
      optimized: true 
    }).sort({ updatedAt: -1 }).select('updatedAt');
    
    // Collections stats (only for Growth+)
    const hasCollections = ['growth', 'growth extra', 'enterprise'].includes(plan);
    let totalCollections = 0;
    let optimizedCollections = 0;
    let lastOptimizedCollection = null;
    
    if (hasCollections) {
      totalCollections = await Collection.countDocuments({ shop });
      optimizedCollections = await Collection.countDocuments({ 
        shop, 
        optimized: true 
      });
      lastOptimizedCollection = await Collection.findOne({ 
        shop, 
        optimized: true 
      }).sort({ updatedAt: -1 }).select('updatedAt');
    }
    
    // Store Metadata status (only for Professional+)
    const hasStoreMetadata = ['professional', 'growth', 'growth extra', 'enterprise'].includes(plan);
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
    const languageStats = [];
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
      
      languageAgg.forEach(lang => {
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
        }[lang._id] || lang._id;
        
        languageStats.push({
          code: lang._id,
          name: langName,
          optimizedCount: lang.optimizedCount,
          totalCount: lang.totalCount,
          primary: lang._id === 'en' // Assume English is primary if present
        });
      });
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
    
    const stats = {
      subscription: {
        plan,
        price: subscription.price || 0
      },
      products: {
        total: totalProducts,
        optimized: optimizedProducts,
        unoptimized: unoptimizedProducts,
        lastOptimized: lastOptimizedProduct?.updatedAt || null
      },
      collections: hasCollections ? {
        total: totalCollections,
        optimized: optimizedCollections,
        unoptimized: totalCollections - optimizedCollections,
        lastOptimized: lastOptimizedCollection?.updatedAt || null
      } : null,
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
    
    console.log('[Dashboard] Stats loaded:', {
      shop,
      productsOptimized: `${optimizedProducts}/${totalProducts}`,
      collectionsOptimized: hasCollections ? `${optimizedCollections}/${totalCollections}` : 'N/A',
      alertsCount: alerts.length
    });
    
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
router.post('/sync', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { adminGraphql } = res.locals;
    
    if (!adminGraphql) {
      return res.status(401).json({ error: 'GraphQL client not available' });
    }

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
      console.log('[Dashboard] Sync progress:', progress);
      // TODO: Can emit SSE events here if needed
    }).catch(error => {
      console.error('[Dashboard] Sync error:', error);
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

    console.log(`[Dashboard] Auto-sync ${enabled ? 'enabled' : 'disabled'} for ${shop}`);

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

