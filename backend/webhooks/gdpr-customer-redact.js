// backend/webhooks/gdpr-customer-redact.js
// GDPR Compliance: customers/redact webhook
// Triggered when a customer requests deletion of their data (48 hours after data request)

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

router.post('/customers/redact', async (req, res) => {
  try {
    // Validate webhook
    if (!validateWebhook(req)) {
      console.error('[GDPR] Invalid HMAC signature for customers/redact');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { shop_id, shop_domain, customer, orders_to_redact } = req.body;
    
    console.log('[GDPR] customers/redact received:', {
      shop: shop_domain,
      shop_id,
      customer_id: customer?.id,
      customer_email: customer?.email,
      orders_to_redact: orders_to_redact?.length || 0
    });
    
    // Our app doesn't store customer PII data
    // We only store:
    // - Shop domain and settings
    // - Product SEO data (no customer info)
    // - Token usage (no customer info)
    // - Subscription info (no customer info)
    
    // No action needed - we have no customer data to delete
    console.log('[GDPR] No customer data to redact - app does not store customer PII');
    
    // Acknowledge receipt
    res.status(200).json({ 
      message: 'No customer data to redact',
      details: 'This app does not collect or store customer personal information.'
    });
    
  } catch (error) {
    console.error('[GDPR] Error processing customers/redact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

