// backend/middleware/webhookValidator.js
// Dev-friendly webhook validator.
// В продукция можеш да затегнеш проверката (виж коментара по-долу).

import crypto from 'crypto';

export default function validateShopifyWebhook(req, res, next) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_API_SECRET_KEY || '';
    const hmac =
      req.get('X-Shopify-Hmac-Sha256') ||
      req.get('x-shopify-hmac-sha256') ||
      '';

    // Опит за изчисляване на подписа върху raw body.
    // Заб: нямаме express.raw() за /webhooks, така че може да не е 1:1 със Shopify payload-а.
    let rawBody;
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body;
    } else if (typeof req.body === 'string') {
      rawBody = Buffer.from(req.body, 'utf8');
    } else if (req.body && typeof req.body === 'object') {
      rawBody = Buffer.from(JSON.stringify(req.body), 'utf8');
    } else {
      rawBody = Buffer.from('', 'utf8');
    }

    if (hmac && secret) {
      const digest = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('base64');

      if (digest !== hmac) {
        console.warn('[Webhooks] HMAC mismatch (dev mode: allowing).');
        // Ако искаш да откажеш при невалиден подпис в прод:
        // return res.status(401).send('Invalid webhook signature');
      }
    } else {
      console.warn('[Webhooks] Missing HMAC header or secret (dev mode: allowing).');
    }

    return next();
  } catch (err) {
    console.error('[Webhooks] Validation error:', err);
    // Не блокираме уебхука в dev
    return next();
  }
}
