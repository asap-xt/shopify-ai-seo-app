// backend/webhooks/products.js
// Handles Shopify "products/update" webhook
// - Syncs product data to MongoDB
// - Detects title/description changes and invalidates SEO metafields

import { syncProductsForShop } from '../controllers/productSync.js';
import { deleteAllSeoMetafieldsForProduct, clearSeoStatusInMongoDB } from '../utils/seoMetafieldUtils.js';

/**
 * Smart webhook handler:
 * 1. Returns 200 immediately (prevents Shopify timeout)
 * 2. Checks if title or description changed
 * 3. If changed → deletes ALL SEO metafields (Basic + AI Enhanced become invalid)
 * 4. Syncs product data to MongoDB
 */
export default async function productsWebhook(req, res) {
  try {
    const shop = (req.get('x-shopify-shop-domain') || req.query.shop || '').replace(/^https?:\/\//, '');
    const topic = (req.get('x-shopify-topic') || '').toLowerCase();
    
    // Parse webhook payload
    const payload = typeof req.body === 'object' && req.body !== null ? req.body : {};
    
    console.log('[Webhook-Products] ===== PRODUCTS/UPDATE WEBHOOK =====');
    console.log('[Webhook-Products] Topic:', topic);
    console.log('[Webhook-Products] Shop:', shop);
    console.log('[Webhook-Products] Product ID:', payload?.id);
    console.log('[Webhook-Products] Product Title:', payload?.title);
    
    // Respond immediately to Shopify (prevent timeout)
    res.status(200).send('ok');
    
    // Process webhook asynchronously
    if (!shop || !payload?.id) {
      console.log('[Webhook-Products] Missing shop or product ID, skipping');
      return;
    }
    
    try {
      // Import Product model
      const Product = (await import('../db/Product.js')).default;
      
      const numericProductId = parseInt(payload.id);
      const productGid = `gid://shopify/Product/${numericProductId}`;
      
      // 1. Check if product exists in MongoDB and get previous state
      const existingProduct = await Product.findOne({ 
        shop, 
        productId: numericProductId 
      });
      
      if (existingProduct) {
        console.log('[Webhook-Products] Found existing product in MongoDB');
        console.log('[Webhook-Products] Previous title:', existingProduct.title);
        console.log('[Webhook-Products] Previous description:', existingProduct.description?.substring(0, 100) + '...');
        
        // 2. Detect if title or description changed
        const titleChanged = existingProduct.title !== payload.title;
        const descriptionChanged = existingProduct.description !== payload.body_html;
        
        if (titleChanged || descriptionChanged) {
          console.log('[Webhook-Products] 🚨 CONTENT CHANGED DETECTED!');
          console.log('[Webhook-Products] Title changed:', titleChanged);
          console.log('[Webhook-Products] Description changed:', descriptionChanged);
          console.log('[Webhook-Products] Invalidating ALL SEO metafields...');
          
          // 3. Delete ALL SEO metafields (all languages)
          const deleteResult = await deleteAllSeoMetafieldsForProduct(req, shop, productGid);
          
          if (deleteResult.success) {
            console.log(`[Webhook-Products] ✅ Deleted ${deleteResult.deletedCount} SEO metafields`);
            
            // 4. Clear SEO status in MongoDB
            await clearSeoStatusInMongoDB(shop, numericProductId);
            console.log('[Webhook-Products] ✅ Cleared SEO status in MongoDB');
            console.log('[Webhook-Products] Product now appears as unoptimized and ready for new SEO generation');
          } else {
            console.error('[Webhook-Products] ❌ Failed to delete metafields:', deleteResult.errors);
          }
        } else {
          console.log('[Webhook-Products] No content changes detected, skipping SEO invalidation');
          console.log('[Webhook-Products] (Only price, inventory, images, or other non-content fields changed)');
        }
      } else {
        console.log('[Webhook-Products] Product not found in MongoDB (new product or first sync)');
      }
      
      // 5. Sync all products for shop (updates MongoDB with latest data)
      // This ensures we have the new title/description stored for future comparisons
      console.log('[Webhook-Products] Starting product sync...');
      const count = await syncProductsForShop(req, shop);
      console.log(`[Webhook-Products] ✅ Synced ${count} products for ${shop}`);
      
    } catch (err) {
      console.error('[Webhook-Products] Error processing webhook:', err?.message || err);
      console.error('[Webhook-Products] Stack:', err?.stack);
    }
    
  } catch (e) {
    console.error('[Webhook-Products] Fatal error:', e?.message || e);
    // Always return 200 to Shopify (prevent retries)
    try { res.status(200).send('ok'); } catch {}
  }
}
