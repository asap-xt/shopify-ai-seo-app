// backend/webhooks/products.js
// Handles Shopify "products/update" webhook
// - Syncs product data to MongoDB
// - Detects title/description changes and invalidates SEO metafields
// - Invalidates Redis cache to reflect changes immediately

import { deleteAllSeoMetafieldsForProduct, deleteAdvancedSchemaMetafieldsForProduct, clearSeoStatusInMongoDB } from '../utils/seoMetafieldUtils.js';
import cacheService from '../services/cacheService.js';
import ProductChangeLog from '../db/ProductChangeLog.js';

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
    
    // Respond immediately to Shopify (prevent timeout)
    res.status(200).send('ok');
    
    // Process webhook asynchronously
    if (!shop || !payload?.id) {
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
      
      // Track whether content changed (initialize outside if block)
      let titleChanged = false;
      let descriptionChanged = false;
      
      if (existingProduct) {
        // 2. Compare with lastShopifyUpdate (if available) for accurate change detection
        // This prevents false positives when our app updates metafields (not product content)
        const referenceTitle = existingProduct.lastShopifyUpdate?.title || existingProduct.title;
        const referenceDescription = existingProduct.lastShopifyUpdate?.description || existingProduct.description;
        
        // Detect if title or description changed from last known Shopify state
        titleChanged = referenceTitle !== payload.title;
        descriptionChanged = referenceDescription !== payload.body_html;
        
        // DEBUG: Log comparison details
        console.log(`[Webhook-Products] 📋 Product ${numericProductId} "${payload.title?.substring(0, 30)}...":`, {
          titleChanged,
          descriptionChanged,
          isOptimized: existingProduct.seoStatus?.optimized,
          hasLastShopifyUpdate: !!existingProduct.lastShopifyUpdate,
          refTitle: referenceTitle?.substring(0, 50),
          newTitle: payload.title?.substring(0, 50),
          refDescLength: referenceDescription?.length || 0,
          newDescLength: payload.body_html?.length || 0
        });
        
        if (titleChanged || descriptionChanged) {
          console.log(`[Webhook-Products] 🔄 CHANGE DETECTED for product ${numericProductId}: title=${titleChanged}, desc=${descriptionChanged}`);
          
          // 3. Delete ALL SEO metafields (all languages)
          const deleteResult = await deleteAllSeoMetafieldsForProduct(req, shop, productGid);
          
          // 3b. Delete Advanced Schema metafields too (schemas become outdated)
          const schemaDeleteResult = await deleteAdvancedSchemaMetafieldsForProduct(req, shop, productGid);
          
          if (deleteResult.success) {
            // 4. Clear SEO status in MongoDB (includes hasAdvancedSchema flag)
            await clearSeoStatusInMongoDB(shop, numericProductId);
            console.log(`[Webhook-Products] ✅ SEO cleared for product ${numericProductId}`);
          } else {
            console.error('[Webhook-Products] ❌ Failed to delete SEO metafields:', deleteResult.errors);
          }
          
          if (!schemaDeleteResult.success) {
            console.error('[Webhook-Products] ❌ Failed to delete schema metafields:', schemaDeleteResult.errors);
          }
        } else {
          console.log(`[Webhook-Products] ⏭️ No content change for product ${numericProductId}`);
        }
      } else {
        console.log(`[Webhook-Products] 🆕 New product ${numericProductId} (not in MongoDB yet)`);
      }
      
      // 5. Update MongoDB with new product data for future comparisons
      // This ensures we have the latest title/description stored
      // IMPORTANT: Update lastShopifyUpdate AFTER we've checked for changes
      
      // Store whether content changed for proper lastShopifyUpdate update
      const contentChanged = titleChanged || descriptionChanged;
      
      const updatedProduct = await Product.findOneAndUpdate(
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
          // CRITICAL: ALWAYS update lastShopifyUpdate with current webhook data
          // This is our reference point for detecting future changes
          lastShopifyUpdate: {
            title: payload.title,
            description: payload.body_html,
            updatedAt: new Date()
          }
        },
        { upsert: true, new: true }
      );
      
      // Log change for weekly digest (if significant change or new product)
      const isNewProduct = !existingProduct;
      const changedFields = [];
      
      if (titleChanged) changedFields.push('title');
      if (descriptionChanged) changedFields.push('description');
      
      // Only log if new product OR significant fields changed
      if (isNewProduct || changedFields.length > 0) {
        const hasOptimization = updatedProduct.seoStatus === 'optimized' || 
                               updatedProduct.seoStatus === 'ai_enhanced';
        
        await ProductChangeLog.create({
          shop,
          productId: String(numericProductId),
          productTitle: payload.title,
          productHandle: payload.handle,
          changeType: isNewProduct ? 'created' : 'updated',
          changedFields: isNewProduct ? ['all'] : changedFields,
          hasOptimization,
          needsAttention: !hasOptimization,
          notified: false
        });
      }
      
      // 6. Invalidate Redis cache for this shop's products
      // This ensures frontend immediately sees the updated product status
      // Delete both old format (products:shop:*) and new format (products:*:shop)
      await cacheService.delPattern(`products:${shop}:*`);
      await cacheService.delPattern(`products:*:${shop}`);
      await cacheService.delPattern(`products:${shop}*`);
      await cacheService.del(`stats:${shop}`);
      
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
