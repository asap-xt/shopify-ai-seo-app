// backend/controllers/dashboardController.js
import express from 'express';
import Product from '../db/Product.js';
import Collection from '../db/Collection.js';
import Shop from '../db/Shop.js';
import Sitemap from '../db/Sitemap.js';
import Subscription from '../db/Subscription.js';
import { verifyRequest } from '../middleware/verifyRequest.js';

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
    const alerts = [];
    
    // Alert: Unoptimized products
    const unoptimizedProducts = totalProducts - optimizedProducts;
    if (unoptimizedProducts > 0) {
      alerts.push({
        type: 'warning',
        title: `${unoptimizedProducts} products not yet optimized`,
        message: 'Optimize your products to improve AI Search visibility.',
        action: {
          label: 'Optimize Now',
          url: `/products?shop=${shop}`
        }
      });
    }
    
    // Alert: Unoptimized collections (if available)
    if (hasCollections) {
      const unoptimizedCollections = totalCollections - optimizedCollections;
      if (unoptimizedCollections > 0) {
        alerts.push({
          type: 'warning',
          title: `${unoptimizedCollections} collections not yet optimized`,
          message: 'Optimize your collections to improve AI Search visibility.',
          action: {
            label: 'Optimize Now',
            url: `/collections?shop=${shop}`
          }
        });
      }
    }
    
    // Alert: Incomplete Store Metadata
    if (hasStoreMetadata && !storeMetadataComplete) {
      alerts.push({
        type: 'info',
        title: 'Store Metadata incomplete',
        message: 'Complete your store metadata to help AI provide accurate information about shipping, returns, and policies.',
        action: {
          label: 'Complete Now',
          url: `/store-metadata?shop=${shop}`
        }
      });
    }
    
    // Alert: No sitemap
    if (!sitemapGenerated) {
      alerts.push({
        type: 'info',
        title: 'Sitemap not yet generated',
        message: 'Generate a sitemap to help AI bots discover your store content.',
        action: {
          label: 'Generate Sitemap',
          url: `/sitemap?shop=${shop}`
        }
      });
    }
    
    // Alert: Advanced Schema not set up (Enterprise only)
    if (hasAdvancedSchema && !advancedSchemaActive) {
      alerts.push({
        type: 'info',
        title: 'Advanced Schema not set up',
        message: 'Add structured data to your products to improve AI understanding.',
        action: {
          label: 'Set Up Schema',
          url: `/schema?shop=${shop}`
        }
      });
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
      storeMetadata: hasStoreMetadata ? {
        complete: storeMetadataComplete
      } : null,
      sitemap: {
        generated: sitemapGenerated
      },
      advancedSchema: hasAdvancedSchema ? {
        active: advancedSchemaActive
      } : null,
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

export default router;

