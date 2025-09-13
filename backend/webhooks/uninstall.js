// backend/webhooks/uninstall.js
// Handles "app/uninstalled" – изтрива shop от базата данни

import Shop from '../db/Shop.js';

export default async function uninstallWebhook(req, res) {
  try {
    const shop = (req.get('x-shopify-shop-domain') || req.query.shop || '').replace(/^https?:\/\//, '');
    console.log('[Webhook] app/uninstalled for', shop);

    if (!shop) {
      console.error('[Webhook] No shop domain in uninstall webhook');
      return res.status(200).send('ok');
    }

    // Изтриваме shop записа от MongoDB
    const result = await Shop.deleteOne({ shop });
    console.log(`[Webhook] Deleted shop ${shop} from database:`, result.deletedCount > 0 ? 'SUCCESS' : 'NOT FOUND');

    // Опционално: изтрий и други свързани данни
    try {
      // Ако имате Subscription модел
      const { default: Subscription } = await import('../db/Subscription.js');
      await Subscription.deleteOne({ shop });
      console.log(`[Webhook] Deleted subscription for ${shop}`);
    } catch (e) {
      // Ако няма Subscription модел, продължаваме
    }

    // Опционално: изтрий продукти ако ги кеширате
    try {
      const { default: Product } = await import('../db/Product.js');
      await Product.deleteMany({ shop });
      console.log(`[Webhook] Deleted products for ${shop}`);
    } catch (e) {
      // Ако няма Product модел, продължаваме
    }

    res.status(200).send('ok');
  } catch (e) {
    console.error('[Webhook] uninstall error:', e?.message || e);
    // Винаги връщаме 200 към Shopify за да не retry-ва
    try { res.status(200).send('ok'); } catch {}
  }
}