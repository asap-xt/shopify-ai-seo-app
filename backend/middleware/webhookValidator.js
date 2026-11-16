// backend/middleware/webhookValidator.js
// Verifies Shopify webhook signatures (X-Shopify-Hmac-Sha256) over the RAW request body.
// server.js captures the raw bytes in req.rawBody (express.json verify hook).
// Set WEBHOOK_HMAC_ENFORCE=false to fall back to log-only mode in an emergency.

import crypto from 'crypto';

function safeEqual(a, b) {
  const ab = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export default function validateShopifyWebhook(req, res, next) {
  const enforce = String(process.env.WEBHOOK_HMAC_ENFORCE ?? 'true').toLowerCase() !== 'false';
  const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_API_SECRET_KEY || '';
  const hmac = req.get('X-Shopify-Hmac-Sha256') || '';

  const raw = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : typeof req.rawBody === 'string'
      ? Buffer.from(req.rawBody, 'utf8')
      : null;

  if (!secret || !raw) {
    // Misconfiguration on our side — don't drop Shopify's webhooks, but make it loud.
    console.error(`[Webhooks] Cannot verify ${req.originalUrl}: ${!secret ? 'missing secret' : 'raw body not captured'} (allowing)`);
    return next();
  }

  const digest = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  if (hmac && safeEqual(digest, hmac)) return next();

  console.warn(`[Webhooks] Invalid HMAC on ${req.originalUrl} from ${req.ip}${enforce ? ' — rejected' : ' (log-only)'}`);
  if (enforce) return res.status(401).send('Invalid webhook signature');
  return next();
}
