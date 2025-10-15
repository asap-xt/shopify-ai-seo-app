// backend/utils/seoMetafieldUtils.js
// Utility functions for SEO metafield operations

import { shopGraphQL } from '../shopify/shopGraphQL.js';

/**
 * Delete all SEO metafields for a product (all languages)
 * Called when product title or description changes in Shopify
 * 
 * @param {Object} req - Express request object (for shopGraphQL)
 * @param {string} shop - Shop domain
 * @param {string} productGid - Product GID (e.g., "gid://shopify/Product/123")
 * @returns {Promise<Object>} - { success: boolean, deletedCount: number, errors: array }
 */
export async function deleteAllSeoMetafieldsForProduct(req, shop, productGid) {
  console.log(`[SEO-METAFIELD-UTILS] Deleting ALL SEO metafields for product: ${productGid}`);
  
  try {
    // 1. Fetch all metafields for the product in seo_ai namespace
    const fetchQuery = `
      query GetProductMetafields($id: ID!) {
        product(id: $id) {
          id
          metafields(namespace: "seo_ai", first: 50) {
            edges {
              node {
                id
                key
                namespace
              }
            }
          }
        }
      }
    `;
    
    const fetchResult = await shopGraphQL(req, shop, fetchQuery, { id: productGid });
    
    if (!fetchResult?.product?.metafields?.edges) {
      console.log(`[SEO-METAFIELD-UTILS] No metafields found for product ${productGid}`);
      return { success: true, deletedCount: 0, errors: [] };
    }
    
    const metafieldIds = fetchResult.product.metafields.edges
      .map(edge => edge.node.id)
      .filter(id => id); // Remove any nulls
    
    if (metafieldIds.length === 0) {
      console.log(`[SEO-METAFIELD-UTILS] No SEO metafields to delete for ${productGid}`);
      return { success: true, deletedCount: 0, errors: [] };
    }
    
    console.log(`[SEO-METAFIELD-UTILS] Found ${metafieldIds.length} metafields to delete`);
    
    // 2. Delete all metafields using their IDs
    const deleteMutation = `
      mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields {
            key
            namespace
            ownerId
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    // Build metafield identifiers array
    const metafieldIdentifiers = metafieldIds.map(id => ({ id }));
    
    const deleteResult = await shopGraphQL(req, shop, deleteMutation, {
      metafields: metafieldIdentifiers
    });
    
    const errors = deleteResult?.metafieldsDelete?.userErrors || [];
    const deletedMetafields = deleteResult?.metafieldsDelete?.deletedMetafields || [];
    
    if (errors.length > 0) {
      console.error(`[SEO-METAFIELD-UTILS] Errors deleting metafields:`, errors);
      return {
        success: false,
        deletedCount: deletedMetafields.length,
        errors: errors.map(e => e.message)
      };
    }
    
    console.log(`[SEO-METAFIELD-UTILS] Successfully deleted ${deletedMetafields.length} metafields`);
    
    return {
      success: true,
      deletedCount: deletedMetafields.length,
      errors: []
    };
    
  } catch (error) {
    console.error(`[SEO-METAFIELD-UTILS] Error in deleteAllSeoMetafieldsForProduct:`, error);
    return {
      success: false,
      deletedCount: 0,
      errors: [error.message]
    };
  }
}

/**
 * Clear SEO status in MongoDB for a product
 * Called after deleting metafields
 * 
 * @param {string} shop - Shop domain
 * @param {number} productId - Numeric product ID
 * @returns {Promise<boolean>} - Success status
 */
export async function clearSeoStatusInMongoDB(shop, productId) {
  try {
    const Product = (await import('../db/Product.js')).default;
    
    const result = await Product.findOneAndUpdate(
      { shop, productId },
      { 
        $set: {
          'seoStatus.optimized': false,
          'seoStatus.languages': [],
          'seoStatus.lastCheckedAt': new Date()
        }
      },
      { new: true }
    );
    
    if (result) {
      console.log(`[SEO-METAFIELD-UTILS] Cleared SEO status in MongoDB for product ${productId}`);
      return true;
    } else {
      console.log(`[SEO-METAFIELD-UTILS] Product ${productId} not found in MongoDB`);
      return false;
    }
  } catch (error) {
    console.error(`[SEO-METAFIELD-UTILS] Error clearing SEO status in MongoDB:`, error);
    return false;
  }
}

