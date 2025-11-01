// backend/webhooks/gdpr-data-request.js
// GDPR Compliance: customers/data_request webhook
// Triggered when a customer requests their data

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

router.post('/customers/data_request', async (req, res) => {
  try {
    // Validate webhook
    if (!validateWebhook(req)) {
      console.error('[GDPR] Invalid HMAC signature for customers/data_request');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { shop_id, shop_domain, customer, orders_requested } = req.body;
    
    console.log('[GDPR] customers/data_request received:', {
      shop: shop_domain,
      shop_id,
      customer_id: customer?.id,
      customer_email: customer?.email,
      orders_requested: orders_requested?.length || 0
    });
    
    // Our app doesn't store customer PII data
    // We only store:
    // - Shop domain and settings
    // - Product SEO data (no customer info)
    // - Token usage (no customer info)
    // - Subscription info (no customer info)
    
    // Response: We have no customer-specific data to provide
    const response = {
      message: 'No customer personal data stored',
      details: 'This app does not collect, store, or process customer personal information. Only shop-level SEO data is stored.'
    };
    
    console.log('[GDPR] customers/data_request response:', response);
    
    // Acknowledge receipt
    res.status(200).json(response);
    
  } catch (error) {
    console.error('[GDPR] Error processing customers/data_request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

