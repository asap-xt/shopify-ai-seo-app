// backend/webhooks/products.js
// Handles Shopify "products/update" webhook
// - Syncs product data to MongoDB
// - Detects title/description changes and invalidates SEO metafields
// - Invalidates Redis cache to reflect changes immediately

import { deleteAllSeoMetafieldsForProduct, clearSeoStatusInMongoDB } from '../utils/seoMetafieldUtils.js';
import cacheService from '../services/cacheService.js';

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
        
        // 2. Compare with lastShopifyUpdate (if available) for accurate change detection
        // This prevents false positives when our app updates metafields (not product content)
        const referenceTitle = existingProduct.lastShopifyUpdate?.title || existingProduct.title;
        const referenceDescription = existingProduct.lastShopifyUpdate?.description || existingProduct.description;
        
        console.log('[Webhook-Products] Reference title:', referenceTitle);
        console.log('[Webhook-Products] Reference description:', referenceDescription?.substring(0, 100) + '...');
        console.log('[Webhook-Products] New title:', payload.title);
        console.log('[Webhook-Products] New description:', payload.body_html?.substring(0, 100) + '...');
        
        // Detect if title or description changed from last known Shopify state
        const titleChanged = referenceTitle !== payload.title;
        const descriptionChanged = referenceDescription !== payload.body_html;
        
        console.log('[Webhook-Products] Title changed:', titleChanged);
        console.log('[Webhook-Products] Description changed:', descriptionChanged);
        console.log('[Webhook-Products] Title comparison:', `"${referenceTitle}" !== "${payload.title}"`);
        console.log('[Webhook-Products] Description comparison:', `"${referenceDescription?.substring(0, 50)}..." !== "${payload.body_html?.substring(0, 50)}..."`);
        
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
      
      // 5. Update MongoDB with new product data for future comparisons
      // This ensures we have the latest title/description stored
      // IMPORTANT: Update lastShopifyUpdate to reflect current Shopify state
      console.log('[Webhook-Products] Updating MongoDB with new product data...');
      await Product.findOneAndUpdate(
        { shop, productId: numericProductId },
        {
          shopifyProductId: numericProductId,
          productId: numericProductId,
          title: payload.title,
          description: payload.body_html,
          handle: payload.handle,
          vendor: payload.vendor,
          productType: payload.product_type,
          status: payload.status,
          publishedAt: payload.published_at,
          createdAt: payload.created_at,
          updatedAt: payload.updated_at,
          tags: payload.tags || '',
          images: payload.images?.map(img => ({
            id: img.id,
            alt: img.alt || '',
            url: img.src
          })) || [],
          featuredImage: payload.image ? {
            url: payload.image.src,
            altText: payload.image.alt || ''
          } : null,
          price: payload.variants?.[0]?.price || '0.00',
          currency: 'EUR', // Default currency
          totalInventory: payload.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0) || 0,
          gid: productGid,
          syncedAt: new Date(),
          // Update lastShopifyUpdate for accurate future comparisons
          lastShopifyUpdate: {
            title: payload.title,
            description: payload.body_html,
            updatedAt: new Date()
          }
        },
        { upsert: true, new: true }
      );
      console.log('[Webhook-Products] ✅ MongoDB updated successfully (including lastShopifyUpdate reference)');
      
      // 6. Invalidate Redis cache for this shop's products
      // This ensures frontend immediately sees the updated product status
      console.log('[Webhook-Products] Invalidating Redis cache for shop:', shop);
      await cacheService.delPattern(`products:${shop}:*`);
      await cacheService.del(`stats:${shop}`);
      console.log('[Webhook-Products] ✅ Redis cache invalidated for shop products');
      
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
