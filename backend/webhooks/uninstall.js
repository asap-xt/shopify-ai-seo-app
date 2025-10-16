// backend/webhooks/uninstall.js
// Handles "app/uninstalled" – пълно изчистване на всички данни и следи от апп-а

import Shop from '../db/Shop.js';
import { deleteAllMetafieldDefinitions } from '../utils/cleanupOnUninstall.js';

export default async function uninstallWebhook(req, res) {
  try {
    console.log('[Webhook] ===== UNINSTALL WEBHOOK CALLED =====');
    console.log('[Webhook] Headers:', req.headers);
    console.log('[Webhook] Body:', req.body);
    console.log('[Webhook] Query:', req.query);
    
    const shop = (req.get('x-shopify-shop-domain') || req.query.shop || '').replace(/^https?:\/\//, '');
    console.log('[Webhook] Extracted shop:', shop);

    if (!shop) {
      console.error('[Webhook] No shop domain in uninstall webhook');
      return res.status(200).send('ok');
    }

    // ===== 1. DELETE ALL METAFIELD DEFINITIONS FROM SHOPIFY =====
    // This will also delete all metafield VALUES automatically!
    console.log('[Webhook] Step 1: Deleting metafield definitions from Shopify...');
    try {
      const cleanupResult = await deleteAllMetafieldDefinitions(shop);
      if (cleanupResult.success) {
        console.log('[Webhook] ✅ Successfully deleted metafield definitions');
        console.log('[Webhook] Results:', cleanupResult.results);
      } else {
        console.error('[Webhook] ⚠️ Failed to delete metafield definitions:', cleanupResult.error);
      }
    } catch (cleanupError) {
      console.error('[Webhook] ⚠️ Error during metafield cleanup:', cleanupError.message);
      // Continue with MongoDB cleanup even if Shopify cleanup fails
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
      await TokenBalance.deleteOne({ shop });
      console.log(`[Webhook] Deleted Token Balance for ${shop}`);
    } catch (e) {
      console.log(`[Webhook] Could not delete Token Balance for ${shop}:`, e.message);
    }

    console.log('[Webhook] ===== UNINSTALL CLEANUP COMPLETED =====');
    console.log(`[Webhook] All data for ${shop} has been removed from both Shopify and MongoDB`);
    res.status(200).send('ok');
  } catch (e) {
    console.error('[Webhook] uninstall error:', e?.message || e);
    // Винаги връщаме 200 към Shopify за да не retry-ва
    try { res.status(200).send('ok'); } catch {}
  }
}