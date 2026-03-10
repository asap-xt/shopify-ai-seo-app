import { processOrderWebhook } from '../services/orderSyncService.js';

export default async function ordersPaidWebhook(req, res) {
  try {
    const shop = (req.get('x-shopify-shop-domain') || req.query.shop || '').replace(/^https?:\/\//, '');
    const payload = typeof req.body === 'object' && req.body !== null ? req.body : {};

    res.status(200).send('ok');

    if (!shop || !payload?.id) return;

    processOrderWebhook(shop, payload).catch(err => {
      console.error(`[ORDERS-WEBHOOK] Async processing error for ${shop}:`, err.message);
    });
  } catch (err) {
    console.error('[ORDERS-WEBHOOK] Handler error:', err.message);
    if (!res.headersSent) res.status(200).send('ok');
  }
}
