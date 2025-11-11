// backend/utils/seoMetafieldUtils.js
// Utility functions for SEO metafield operations

import { makeShopifyGraphQLRequest } from './shopifyGraphQL.js';
import { resolveAdminToken } from './tokenResolver.js';

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
  try {
    // Resolve access token
    const accessToken = await resolveAdminToken(req, shop);
    if (!accessToken) {
      throw new Error(`No access token found for shop: ${shop}`);
    }
    
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
    
    const fetchResult = await makeShopifyGraphQLRequest(shop, accessToken, fetchQuery, { id: productGid });
    
    if (!fetchResult?.product?.metafields?.edges) {
      return { success: true, deletedCount: 0, errors: [] };
    }
    
    const metafields = fetchResult.product.metafields.edges
      .map(edge => ({
        ownerId: productGid,
        namespace: edge.node.namespace,
        key: edge.node.key
      }))
      .filter(mf => mf.key); // Remove any nulls
    
    if (metafields.length === 0) {
      return { success: true, deletedCount: 0, errors: [] };
    }
    
    // 2. Delete all metafields using ownerId, namespace, key
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
    
    // Metafield identifiers are already built correctly
    const metafieldIdentifiers = metafields;
    
    const deleteResult = await makeShopifyGraphQLRequest(shop, accessToken, deleteMutation, {
      metafields: metafieldIdentifiers
    });
    
    const errors = deleteResult?.metafieldsDelete?.userErrors || [];
    const deletedMetafields = deleteResult?.metafieldsDelete?.deletedMetafields || [];
    
    if (errors.length > 0) {
      return {
        success: false,
        deletedCount: deletedMetafields.length,
        errors: errors.map(e => e.message)
      };
    }
    
    return {
      success: true,
      deletedCount: deletedMetafields.length,
      errors: []
    };
    
  } catch (error) {
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
          'seoStatus.aiEnhanced': false, // CRITICAL: Reset AI badge when product content changes
          'seoStatus.languages': [],
          'seoStatus.lastCheckedAt': new Date()
        }
      },
      { new: true }
    );
    
    return !!result;
  } catch (error) {
    return false;
  }
}

/**
 * Delete all SEO metafields for a collection (all languages)
 * Called when collection title or description changes in Shopify
 * 
 * @param {Object} req - Express request object (for shopGraphQL)
 * @param {string} shop - Shop domain
 * @param {string} collectionGid - Collection GID (e.g., "gid://shopify/Collection/123")
 * @returns {Promise<Object>} - { success: boolean, deletedCount: number, errors: array }
 */
export async function deleteAllSeoMetafieldsForCollection(req, shop, collectionGid) {
  try {
    // Resolve access token
    const accessToken = await resolveAdminToken(req, shop);
    if (!accessToken) {
      throw new Error(`No access token found for shop: ${shop}`);
    }
    
    // 1. Fetch all metafields for the collection in seo_ai namespace
    const fetchQuery = `
      query GetCollectionMetafields($id: ID!) {
        collection(id: $id) {
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
    
    const fetchResult = await makeShopifyGraphQLRequest(shop, accessToken, fetchQuery, { id: collectionGid });
    
    if (!fetchResult?.collection?.metafields?.edges) {
      return { success: true, deletedCount: 0, errors: [] };
    }
    
    const metafields = fetchResult.collection.metafields.edges
      .map(edge => ({
        ownerId: collectionGid,
        namespace: edge.node.namespace,
        key: edge.node.key
      }))
      .filter(mf => mf.key); // Remove any nulls
    
    if (metafields.length === 0) {
      return { success: true, deletedCount: 0, errors: [] };
    }
    
    // 2. Delete all metafields using ownerId, namespace, key
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
    
    const deleteResult = await makeShopifyGraphQLRequest(shop, accessToken, deleteMutation, {
      metafields: metafields
    });
    
    const errors = deleteResult?.metafieldsDelete?.userErrors || [];
    const deletedMetafields = deleteResult?.metafieldsDelete?.deletedMetafields || [];
    
    if (errors.length > 0) {
      return {
        success: false,
        deletedCount: deletedMetafields.length,
        errors: errors.map(e => e.message)
      };
    }
    
    return {
      success: true,
      deletedCount: deletedMetafields.length,
      errors: []
    };
    
  } catch (error) {
    return {
      success: false,
      deletedCount: 0,
      errors: [error.message]
    };
  }
}

/**
 * Clear SEO status in MongoDB for a collection
 * Called after deleting metafields
 * 
 * @param {string} shop - Shop domain
 * @param {string} collectionId - Numeric collection ID
 * @returns {Promise<boolean>} - Success status
 */
export async function clearCollectionSeoStatusInMongoDB(shop, collectionId) {
  try {
    const Collection = (await import('../db/Collection.js')).default;
    
    const result = await Collection.findOneAndUpdate(
      { shop, collectionId },
      { 
        $set: {
          'seoStatus.optimized': false,
          'seoStatus.aiEnhanced': false, // CRITICAL: Reset AI badge when collection content changes
          'seoStatus.languages': [],
          'seoStatus.lastCheckedAt': new Date()
        }
      },
      { new: true }
    );
    
    return !!result;
  } catch (error) {
    return false;
  }
}

