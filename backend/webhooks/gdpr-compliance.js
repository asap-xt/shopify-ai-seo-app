// backend/webhooks/gdpr-compliance.js
// GDPR Compliance: All 3 mandatory webhooks in one endpoint
// Shopify sends all compliance topics to the same URI

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
  
  return crypto.timingSafeEqual(
    Buffer.from(hmacHeader),
    Buffer.from(hash)
  );
}

// Determine which webhook topic this is based on payload structure
function identifyTopic(payload) {
  if (payload.data_request) {
    return 'customers/data_request';
  }
  if (payload.orders_to_redact) {
    return 'customers/redact';
  }
  if (payload.shop_id && payload.shop_domain && !payload.customer) {
    return 'shop/redact';
  }
  return 'unknown';
}

// Single POST endpoint for all GDPR webhooks
router.post('/', async (req, res) => {
  try {
    // Validate HMAC
    if (!validateWebhook(req)) {
      console.error('[GDPR] Invalid HMAC signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const payload = req.body;
    const topic = identifyTopic(payload);
    
    console.log(`[GDPR] Received webhook: ${topic}`, {
      shop: payload.shop_domain,
      shop_id: payload.shop_id
    });
    
    // Route to appropriate handler
    switch (topic) {
      case 'customers/data_request':
        return handleDataRequest(req, res, payload);
      
      case 'customers/redact':
        return handleCustomerRedact(req, res, payload);
      
      case 'shop/redact':
        return handleShopRedact(req, res, payload);
      
      default:
        console.error('[GDPR] Unknown webhook topic:', payload);
        return res.status(400).json({ error: 'Unknown webhook topic' });
    }
    
  } catch (error) {
    console.error('[GDPR] Error processing webhook:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handler for customers/data_request
async function handleDataRequest(req, res, payload) {
  const { shop_domain, customer, orders_requested } = payload;
  
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
}

// Handler for customers/redact
async function handleCustomerRedact(req, res, payload) {
  const { shop_domain, customer, orders_to_redact } = payload;
  
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
}

// Handler for shop/redact
async function handleShopRedact(req, res, payload) {
  const { shop_id, shop_domain } = payload;
  
  console.log('[GDPR] shop/redact:', {
    shop: shop_domain,
    shop_id
  });
  
  try {
    // Import models
    const Shop = require('../db/Shop');
    const Product = require('../db/Product');
    const Subscription = require('../db/Subscription');
    const TokenBalance = require('../db/TokenBalance');
    const Sitemap = require('../db/Sitemap');
    const SyncLog = require('../db/SyncLog');
    const AdvancedSchema = require('../db/AdvancedSchema');
    const AIDiscoverySettings = require('../db/AIDiscoverySettings');
    
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
}

module.exports = router;

