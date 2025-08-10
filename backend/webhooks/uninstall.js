// backend/webhooks/uninstall.js
// Handles "app/uninstalled" – тук чистим локални данни / маркираме като uninstalled

export default async function uninstallWebhook(req, res) {
  try {
    const shop = (req.get('x-shopify-shop-domain') || req.query.shop || '').replace(/^https?:\/\//, '');
    console.log('[Webhook] app/uninstalled for', shop);

    // Място за почистване: даунгрейд/disable абонамент, изтриване на токени и т.н.
    // Пример (ако имаш модел Subscription):
    // await Subscription.updateOne({ shop }, { $set: { disabled: true } });

    res.status(200).send('ok');
  } catch (e) {
    console.error('[Webhook] uninstall error:', e?.message || e);
    try { res.status(200).send('ok'); } catch {}
  }
}
