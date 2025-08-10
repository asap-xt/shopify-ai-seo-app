// backend/webhooks/products.js
// Handles Shopify "products/update" (и други product-* теми, ако дойдат)

import { syncProductsForShop } from '../controllers/productSync.js';

/**
 * Minimal handler: връща 200 веднага (за да не тайм-аутне Shopify),
 * а синка пускаме асинхронно.
 */
export default async function productsWebhook(req, res) {
  try {
    const shop = (req.get('x-shopify-shop-domain') || req.query.shop || '').replace(/^https?:\/\//, '');
    const topic = (req.get('x-shopify-topic') || '').toLowerCase();

    // Тялото може да е JSON (Express го е парснал) или текст.
    const payload = typeof req.body === 'object' && req.body !== null ? req.body : {};

    console.log('[Webhook] topic=', topic, 'shop=', shop, 'productId=', payload?.id);

    // Отговори незабавно към Shopify
    res.status(200).send('ok');

    // Пусни синк на заден план (цял каталог – стабилно за MVP).
    if (shop) {
      try {
        const count = await syncProductsForShop(shop);
        console.log(`[Webhook] Resynced ${count} products for ${shop}`);
      } catch (err) {
        console.error('[Webhook] syncProductsForShop error:', err?.message || err);
      }
    }
  } catch (e) {
    console.error('[Webhook] products error:', e?.message || e);
    // Във всеки случай не искаме да връщаме 5xx към Shopify – отговори 200
    try { res.status(200).send('ok'); } catch {}
  }
}
