// File: backend/utils/webhookValidator.js
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Middleware to validate Shopify webhook HMAC signature
 */
export function validateShopifyWebhook(req, res, next) {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const body = req.rawBody || JSON.stringify(req.body);
  const generatedHash = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  if (crypto.timingSafeEqual(Buffer.from(generatedHash, 'base64'), Buffer.from(hmacHeader, 'base64'))) {
    return next();
  }

  console.error('❌ Invalid Shopify webhook signature');
  res.status(401).send('Unauthorized');
}
