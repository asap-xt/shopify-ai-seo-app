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

    // Опционално: изтрий продукти ако ги кеширате
    try {
      const { default: Product } = await import('../db/Product.js');
      await Product.deleteMany({ shop });
      console.log(`[Webhook] Deleted products for ${shop}`);
    } catch (e) {
      // Ако няма Product модел, продължаваме
    }

    // Изтрий колекции
    try {
      const { default: Collection } = await import('../db/Collection.js');
      await Collection.deleteMany({ shop });
      console.log(`[Webhook] Deleted collections for ${shop}`);
    } catch (e) {
      console.log(`[Webhook] Could not delete collections for ${shop}:`, e.message);
    }

    // Изтрий AI Discovery настройки
    try {
      const { default: AIDiscoverySettings } = await import('../db/AIDiscoverySettings.js');
      await AIDiscoverySettings.deleteOne({ shop });
      console.log(`[Webhook] Deleted AI Discovery settings for ${shop}`);
    } catch (e) {
      console.log(`[Webhook] Could not delete AI Discovery settings for ${shop}:`, e.message);
    }

    // Изтрий Advanced Schema данни
    try {
      const { default: AdvancedSchema } = await import('../db/AdvancedSchema.js');
      await AdvancedSchema.deleteMany({ shop });
      console.log(`[Webhook] Deleted Advanced Schema data for ${shop}`);
    } catch (e) {
      console.log(`[Webhook] Could not delete Advanced Schema data for ${shop}:`, e.message);
    }

    // Изтрий Sitemap данни
    try {
      const { default: Sitemap } = await import('../db/Sitemap.js');
      await Sitemap.deleteMany({ shop });
      console.log(`[Webhook] Deleted Sitemap data for ${shop}`);
    } catch (e) {
      console.log(`[Webhook] Could not delete Sitemap data for ${shop}:`, e.message);
    }

    // Изтрий Token Balances
    try {
      const { default: TokenBalance } = await import('../db/TokenBalance.js');
      const tokenResult = await TokenBalance.deleteOne({ shop });
      console.log(`[Webhook] Deleted Token Balance for ${shop}: ${tokenResult.deletedCount} records deleted`);
      if (tokenResult.deletedCount === 0) {
        console.warn(`[Webhook] ⚠️ No token balance found to delete for ${shop}`);
      }
    } catch (e) {
      console.error(`[Webhook] ❌ Error deleting Token Balance for ${shop}:`, e.message);
    }

    console.log('[Webhook] ===== UNINSTALL CLEANUP COMPLETED =====');
    console.log(`[Webhook] All MongoDB data for ${shop} has been removed`);
    console.log('[Webhook] Note: Shopify metafield definitions and values will remain in the store');
    res.status(200).send('ok');
  } catch (e) {
    console.error('[Webhook] uninstall error:', e?.message || e);
    // Винаги връщаме 200 към Shopify за да не retry-ва
    try { res.status(200).send('ok'); } catch {}
  }
}