// backend/webhooks/collections.js
// Handles Shopify "collections/update" webhook
// - Syncs collection data to MongoDB
// - Detects title/description changes and invalidates SEO metafields
// - Invalidates Redis cache to reflect changes immediately

import cacheService from '../services/cacheService.js';

/**
 * Smart webhook handler for collections:
 * 1. Returns 200 immediately (prevents Shopify timeout)
 * 2. Checks if title or description changed
 * 3. If changed → deletes ALL SEO metafields (Basic + AI Enhanced become invalid)
 * 4. Syncs collection data to MongoDB
 */
export default async function collectionsWebhook(req, res) {
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
      // Import Collection model and utilities
      const Collection = (await import('../db/Collection.js')).default;
      const { deleteAllSeoMetafieldsForCollection, clearCollectionSeoStatusInMongoDB } = await import('../utils/seoMetafieldUtils.js');
      
      const collectionId = payload.id.toString();
      const collectionGid = `gid://shopify/Collection/${collectionId}`;
      
      // 1. Find existing collection in MongoDB
      const existingCollection = await Collection.findOne({ shop, collectionId });
      
      // Track whether content changed (initialize outside if block)
      let titleChanged = false;
      let descriptionChanged = false;
      
      if (existingCollection) {
        // 2. Compare with lastShopifyUpdate (if available) for accurate change detection
        // This prevents false positives when our app updates metafields (not collection content)
        const referenceTitle = existingCollection.lastShopifyUpdate?.title || existingCollection.title;
        const referenceDescription = existingCollection.lastShopifyUpdate?.description || existingCollection.description || '';
        
        // 3. Detect if title or description changed
        // CRITICAL: Only detect changes if we have valid reference values
        // If referenceTitle/referenceDescription are undefined, this is likely first webhook
        // or collection created via sync - don't treat as change to avoid deleting SEO metafields
        if (referenceTitle !== undefined && referenceTitle !== null && referenceTitle !== '') {
          titleChanged = referenceTitle !== payload.title;
        } else {
          // No reference title - this is likely first webhook, don't treat as change
          titleChanged = false;
        }
        
        const newDescription = payload.body_html || '';
        if (referenceDescription !== undefined && referenceDescription !== null && referenceDescription !== '') {
          // NOTE: Compare first 500 chars only - Shopify webhook payload may truncate long descriptions
          const refDescTrunc = referenceDescription.substring(0, 500);
          const newDescTrunc = newDescription.substring(0, 500);
          descriptionChanged = refDescTrunc !== newDescTrunc;
        } else {
          // No reference description - this is likely first webhook, don't treat as change
          descriptionChanged = false;
        }
        
        if (titleChanged || descriptionChanged) {
          // 4. Delete all SEO metafields for this collection
          await deleteAllSeoMetafieldsForCollection(req, shop, collectionGid);
          
          // 5. Clear SEO status in MongoDB
          await clearCollectionSeoStatusInMongoDB(shop, collectionId);
        }
      }
      
      // 6. Update MongoDB with new collection data for future comparisons
      
      // Store whether content changed for proper lastShopifyUpdate update
      const contentChanged = titleChanged || descriptionChanged;
      
      try {
        // CRITICAL: Preserve existing seoStatus (including aiEnhanced flag)
        const updateData = {
          shopifyCollectionId: collectionId,
          collectionId,
          gid: collectionGid,
          title: payload.title,
          description: payload.body_html || '',
          descriptionHtml: payload.body_html || '',
          handle: payload.handle,
          productsCount: payload.products_count || 0,
          // CRITICAL: ALWAYS update lastShopifyUpdate with current webhook data
          // This is our reference point for detecting FUTURE changes
          lastShopifyUpdate: {
            title: payload.title,
            description: payload.body_html || '',
            updatedAt: new Date()
          },
          updatedAt: new Date(),
          syncedAt: new Date()
        };
        
        // CRITICAL: Preserve seoStatus if it exists
        if (existingCollection?.seoStatus) {
          updateData.seoStatus = existingCollection.seoStatus;
        }
        
        await Collection.findOneAndUpdate(
          { shop, collectionId },
          updateData,
          { upsert: true, new: true }
        );
        console.log('[Webhook-Collections] ✅ MongoDB updated successfully');
      } catch (mongoError) {
        if (mongoError.code === 11000) {
          // Duplicate key error - try to update existing record
          console.log('[Webhook-Collections] Duplicate key error, updating existing record...');
          
          // CRITICAL: Preserve seoStatus for duplicate key case too
          const updateDataDupe = {
            shopifyCollectionId: collectionId,
            collectionId,
            gid: collectionGid,
            title: payload.title,
            description: payload.body_html || '',
            descriptionHtml: payload.body_html || '',
            handle: payload.handle,
            productsCount: payload.products_count || 0,
            // CRITICAL: ALWAYS update lastShopifyUpdate (same as main update)
            lastShopifyUpdate: {
              title: payload.title,
              description: payload.body_html || '',
              updatedAt: new Date()
            },
            updatedAt: new Date(),
            syncedAt: new Date()
          };
          
          // CRITICAL: Preserve seoStatus if it exists
          if (existingCollection?.seoStatus) {
            updateDataDupe.seoStatus = existingCollection.seoStatus;
          }
          
          await Collection.findOneAndUpdate(
            { shop, handle: payload.handle },
            updateDataDupe,
            { new: true }
          );
        } else {
          throw mongoError;
        }
      }
      
      // 7. Invalidate Redis cache for this shop's collections
      // This ensures frontend immediately sees the updated collection status
      console.log('[Webhook-Collections] Invalidating Redis cache for shop:', shop);
      await cacheService.delPattern(`collections:${shop}:*`);
      await cacheService.del(`stats:${shop}`);
      console.log('[Webhook-Collections] ✅ Redis cache invalidated for shop collections');
      
    } catch (error) {
      console.error('[Webhook-Collections] Error processing webhook:', error);
    }
    
  } catch (error) {
    console.error('[Webhook-Collections] Fatal error:', error);
    // Already sent 200 response, so we can't send error to Shopify
  }
}

