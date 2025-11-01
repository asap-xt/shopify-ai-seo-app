// backend/webhooks/gdpr-shop-redact.js
// GDPR Compliance: shop/redact webhook
// Triggered when a shop uninstalls the app and requests data deletion

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Webhook validator
function validateWebhook(req) {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const rawBody = req.rawBody; // Assumes raw body middleware
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

router.post('/shop/redact', async (req, res) => {
  try {
    // Validate webhook
    if (!validateWebhook(req)) {
      console.error('[GDPR] Invalid HMAC signature for shop/redact');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { shop_id, shop_domain } = req.body;
    
    console.log('[GDPR] shop/redact received:', {
      shop: shop_domain,
      shop_id
    });
    
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
    res.status(200).json({ 
      message: 'Shop data deleted successfully',
      shop: shop_domain,
      deletedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[GDPR] Error processing shop/redact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

