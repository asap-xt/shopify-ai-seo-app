// backend/webhooks/uninstall.js
// Handles "app/uninstalled" – изтрива всички MongoDB данни за shop-а

import Shop from '../db/Shop.js';

export default async function uninstallWebhook(req, res) {
  try {
    const shop = (req.get('x-shopify-shop-domain') || req.query.shop || '').replace(/^https?:\/\//, '').trim().toLowerCase();

    if (!shop) {
      console.error('[Webhook] No shop domain in uninstall webhook');
      return res.status(200).send('ok');
    }
    
    // CRITICAL: Get store data BEFORE deletion for email follow-up
    const storeData = await Shop.findOne({ shop }).lean();
    const subscriptionData = storeData ? await import('../db/Subscription.js').then(m => m.default.findOne({ shop }).lean()) : null;
    
    // CRITICAL: Invalidate Redis cache FIRST (before MongoDB cleanup)
    try {
      const { default: cacheService } = await import('../services/cacheService.js');
      await cacheService.invalidateShop(shop);
    } catch (e) {
      console.error('[Webhook] ❌ Error invalidating Redis cache:', e.message);
    }
    
    // Изтриваме shop записа от MongoDB
    await Shop.deleteOne({ shop });

    // Опционално: изтрий и други свързани данни
    try {
      // Ако имате Subscription модел
      const { default: Subscription } = await import('../db/Subscription.js');
      
      const subResult = await Subscription.deleteOne({ shop });
      if (subResult.deletedCount === 0) {
        console.warn(`[Webhook] ⚠️ No subscription found to delete for ${shop}`);
      }
    } catch (e) {
      console.error(`[Webhook] ❌ Error deleting subscription for ${shop}:`, e.message);
    }

    // Delete all shop data silently
    try {
      const { default: Product } = await import('../db/Product.js');
      await Product.deleteMany({ shop });
    } catch (e) { /* Product model may not exist */ }

    try {
      const { default: Collection } = await import('../db/Collection.js');
      await Collection.deleteMany({ shop });
    } catch (e) { /* Collection model may not exist */ }

    try {
      const { default: AIDiscoverySettings } = await import('../db/AIDiscoverySettings.js');
      await AIDiscoverySettings.deleteOne({ shop });
    } catch (e) { /* Settings may not exist */ }

    try {
      const { default: AdvancedSchema } = await import('../db/AdvancedSchema.js');
      await AdvancedSchema.deleteMany({ shop });
    } catch (e) { /* Schema may not exist */ }

    try {
      const { default: Sitemap } = await import('../db/Sitemap.js');
      await Sitemap.deleteMany({ shop });
    } catch (e) { /* Sitemap may not exist */ }

    try {
      const { default: TokenBalance } = await import('../db/TokenBalance.js');
      await TokenBalance.deleteOne({ shop });
    } catch (e) {
      console.error(`[Webhook] ❌ Error deleting Token Balance for ${shop}:`, e.message);
    }

    console.log(`[Webhook] ✅ Uninstall cleanup completed for ${shop}`);
    
    // REMOVED: Uninstall follow-up email - users don't want marketing after uninstall
    
    res.status(200).send('ok');
  } catch (e) {
    console.error('[Webhook] uninstall error:', e?.message || e);
    // Винаги връщаме 200 към Shopify за да не retry-ва
    try { res.status(200).send('ok'); } catch {}
  }
}