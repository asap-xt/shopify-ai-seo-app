// backend/webhooks/gdpr-compliance.js
// GDPR Compliance: All 3 mandatory webhooks
// Separate POST endpoints for each compliance topic

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Webhook HMAC validator
function validateWebhook(req) {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const rawBody = req.rawBody;
  const secret = process.env.SHOPIFY_API_SECRET;
  
  if (!hmacHeader || !rawBody || !secret) {
    return false;
  }
  
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  
  try {
    // timingSafeEqual requires buffers of same length
    const hmacBuffer = Buffer.from(hmacHeader);
    const hashBuffer = Buffer.from(hash);
    
    // If lengths differ, HMAC is invalid
    if (hmacBuffer.length !== hashBuffer.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(hmacBuffer, hashBuffer);
  } catch (error) {
    // Any error means invalid HMAC
    console.error('[GDPR] HMAC validation error:', error.message);
    return false;
  }
}

// POST /webhooks/customers/data_request
router.post('/customers/data_request', async (req, res) => {
  try {
    // Validate HMAC
    if (!validateWebhook(req)) {
      console.error('[GDPR] Invalid HMAC signature for customers/data_request');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { shop_domain, customer, orders_requested } = req.body;
    
    console.log('[GDPR] customers/data_request:', {
      shop: shop_domain,
      customer_id: customer?.id,
      customer_email: customer?.email,
      orders_requested: orders_requested?.length || 0
    });
    
    // Our app doesn't store customer PII data
    const response = {
      message: 'No customer personal data stored',
      details: 'This app does not collect, store, or process customer personal information. Only shop-level SEO data is stored.'
    };
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('[GDPR] Error processing customers/data_request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /webhooks/customers/redact
router.post('/customers/redact', async (req, res) => {
  try {
    // Validate HMAC
    if (!validateWebhook(req)) {
      console.error('[GDPR] Invalid HMAC signature for customers/redact');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { shop_domain, customer, orders_to_redact } = req.body;
    
    console.log('[GDPR] customers/redact:', {
      shop: shop_domain,
      customer_id: customer?.id,
      customer_email: customer?.email,
      orders_to_redact: orders_to_redact?.length || 0
    });
    
    // No action needed - we have no customer data
    return res.status(200).json({ 
      message: 'No customer data to redact',
      details: 'This app does not collect or store customer personal information.'
    });
    
  } catch (error) {
    console.error('[GDPR] Error processing customers/redact:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /webhooks/shop/redact
router.post('/shop/redact', async (req, res) => {
  try {
    // Validate HMAC
    if (!validateWebhook(req)) {
      console.error('[GDPR] Invalid HMAC signature for shop/redact');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { shop_id, shop_domain } = req.body;
    
    console.log('[GDPR] shop/redact:', {
      shop: shop_domain,
      shop_id
    });
    
    try {
      // Import models using dynamic import() for ES modules
      const [
        { default: Shop },
        { default: Product },
        { default: Subscription },
        { default: TokenBalance },
        { default: Sitemap },
        { default: SyncLog },
        { default: AdvancedSchema },
        { default: AIDiscoverySettings }
      ] = await Promise.all([
        import('../db/Shop.js'),
        import('../db/Product.js'),
        import('../db/Subscription.js'),
        import('../db/TokenBalance.js'),
        import('../db/Sitemap.js'),
        import('../db/SyncLog.js'),
        import('../db/AdvancedSchema.js'),
        import('../db/AIDiscoverySettings.js')
      ]);
      
      // Delete all shop data from MongoDB
      const deletionResults = await Promise.allSettled([
        Shop.deleteMany({ domain: shop_domain }),
        Product.deleteMany({ shop: shop_domain }),
        Subscription.deleteMany({ shop: shop_domain }),
        TokenBalance.deleteMany({ shop: shop_domain }),
        Sitemap.deleteMany({ shop: shop_domain }),
        SyncLog.deleteMany({ shop: shop_domain }),
        AdvancedSchema.deleteMany({ shop: shop_domain }),
        AIDiscoverySettings.deleteMany({ shop: shop_domain })
      ]);
      
      console.log('[GDPR] Data deletion completed for shop:', shop_domain);
      console.log('[GDPR] Deletion results:', {
        shops: deletionResults[0].status === 'fulfilled' ? deletionResults[0].value.deletedCount : 0,
        products: deletionResults[1].status === 'fulfilled' ? deletionResults[1].value.deletedCount : 0,
        subscriptions: deletionResults[2].status === 'fulfilled' ? deletionResults[2].value.deletedCount : 0,
        tokenBalances: deletionResults[3].status === 'fulfilled' ? deletionResults[3].value.deletedCount : 0,
        sitemaps: deletionResults[4].status === 'fulfilled' ? deletionResults[4].value.deletedCount : 0,
        syncLogs: deletionResults[5].status === 'fulfilled' ? deletionResults[5].value.deletedCount : 0,
        advancedSchemas: deletionResults[6].status === 'fulfilled' ? deletionResults[6].value.deletedCount : 0,
        aiDiscoverySettings: deletionResults[7].status === 'fulfilled' ? deletionResults[7].value.deletedCount : 0
      });
      
      // Clear Redis cache if available
      try {
        const cacheService = require('../services/cacheService');
        await cacheService.invalidatePattern(`*:${shop_domain}`);
        console.log('[GDPR] Redis cache cleared for shop:', shop_domain);
      } catch (cacheError) {
        console.error('[GDPR] Error clearing Redis cache (non-critical):', cacheError.message);
      }
      
      // Acknowledge receipt
      return res.status(200).json({ 
        message: 'Shop data deleted successfully',
        shop: shop_domain,
        deletedAt: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('[GDPR] Error deleting shop data:', error);
      return res.status(500).json({ error: 'Failed to delete shop data' });
    }
    
  } catch (error) {
    console.error('[GDPR] Error processing shop/redact:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

