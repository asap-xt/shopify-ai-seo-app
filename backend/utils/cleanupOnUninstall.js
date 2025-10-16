// backend/utils/cleanupOnUninstall.js
// Utility functions for cleaning up ALL app data on uninstall

import { resolveAdminToken } from './tokenResolver.js';

/**
 * Delete all metafield definitions created by our app
 * This is SAFE - we filter by namespace to only delete OUR definitions
 * 
 * Our namespaces:
 * - seo_ai (for products & collections)
 * - ai_seo_store (for shop metadata)
 */
export async function deleteAllMetafieldDefinitions(shop) {
  console.log(`[CLEANUP] ===== DELETING METAFIELD DEFINITIONS FOR ${shop} =====`);
  
  try {
    // Get access token
    const accessToken = await resolveAdminToken(shop);
    if (!accessToken) {
      console.error('[CLEANUP] No access token found for shop');
      return { success: false, error: 'No access token' };
    }

    const results = {
      products: { deleted: 0, errors: [] },
      collections: { deleted: 0, errors: [] },
      shop: { deleted: 0, errors: [] }
    };

    // 1. Delete PRODUCT metafield definitions (namespace: seo_ai)
    console.log('[CLEANUP] Fetching PRODUCT metafield definitions with namespace "seo_ai"...');
    const productDefs = await fetchMetafieldDefinitions(shop, accessToken, 'PRODUCT', 'seo_ai');
    console.log(`[CLEANUP] Found ${productDefs.length} product definitions to delete`);
    
    for (const def of productDefs) {
      console.log(`[CLEANUP] Deleting PRODUCT definition: ${def.namespace}.${def.key} (${def.name})`);
      const deleteResult = await deleteMetafieldDefinition(shop, accessToken, def.id);
      if (deleteResult.success) {
        results.products.deleted++;
      } else {
        results.products.errors.push({ def, error: deleteResult.error });
      }
    }

    // 2. Delete COLLECTION metafield definitions (namespace: seo_ai)
    console.log('[CLEANUP] Fetching COLLECTION metafield definitions with namespace "seo_ai"...');
    const collectionDefs = await fetchMetafieldDefinitions(shop, accessToken, 'COLLECTION', 'seo_ai');
    console.log(`[CLEANUP] Found ${collectionDefs.length} collection definitions to delete`);
    
    for (const def of collectionDefs) {
      console.log(`[CLEANUP] Deleting COLLECTION definition: ${def.namespace}.${def.key} (${def.name})`);
      const deleteResult = await deleteMetafieldDefinition(shop, accessToken, def.id);
      if (deleteResult.success) {
        results.collections.deleted++;
      } else {
        results.collections.errors.push({ def, error: deleteResult.error });
      }
    }

    // 3. Delete SHOP metafield definitions (namespace: ai_seo_store)
    console.log('[CLEANUP] Fetching SHOP metafield definitions with namespace "ai_seo_store"...');
    const shopDefs = await fetchMetafieldDefinitions(shop, accessToken, 'SHOP', 'ai_seo_store');
    console.log(`[CLEANUP] Found ${shopDefs.length} shop definitions to delete`);
    
    for (const def of shopDefs) {
      console.log(`[CLEANUP] Deleting SHOP definition: ${def.namespace}.${def.key} (${def.name})`);
      const deleteResult = await deleteMetafieldDefinition(shop, accessToken, def.id);
      if (deleteResult.success) {
        results.shop.deleted++;
      } else {
        results.shop.errors.push({ def, error: deleteResult.error });
      }
    }

    console.log('[CLEANUP] ===== CLEANUP SUMMARY =====');
    console.log(`[CLEANUP] Products: ${results.products.deleted} deleted, ${results.products.errors.length} errors`);
    console.log(`[CLEANUP] Collections: ${results.collections.deleted} deleted, ${results.collections.errors.length} errors`);
    console.log(`[CLEANUP] Shop: ${results.shop.deleted} deleted, ${results.shop.errors.length} errors`);
    console.log('[CLEANUP] Total deleted:', results.products.deleted + results.collections.deleted + results.shop.deleted);
    
    return {
      success: true,
      results
    };

  } catch (error) {
    console.error('[CLEANUP] Error during metafield definition cleanup:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Fetch metafield definitions for a specific owner type and namespace
 * This is SAFE - Shopify API filters by namespace, we double-check in code
 */
async function fetchMetafieldDefinitions(shop, accessToken, ownerType, namespace) {
  const query = `
    query FetchMetafieldDefinitions($ownerType: MetafieldOwnerType!, $namespace: String!) {
      metafieldDefinitions(first: 250, ownerType: $ownerType, namespace: $namespace) {
        edges {
          node {
            id
            name
            namespace
            key
            ownerType
          }
        }
      }
    }
  `;

  const variables = {
    ownerType,
    namespace
  };

  try {
    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      console.error('[CLEANUP] GraphQL request failed:', response.status, response.statusText);
      return [];
    }

    const json = await response.json();
    
    if (json.errors) {
      console.error('[CLEANUP] GraphQL errors:', json.errors);
      return [];
    }

    const definitions = json.data?.metafieldDefinitions?.edges?.map(e => e.node) || [];
    
    // DOUBLE CHECK: Filter by namespace again in code for extra safety
    const safeDefinitions = definitions.filter(def => 
      def.namespace === namespace && 
      (def.namespace === 'seo_ai' || def.namespace === 'ai_seo_store')
    );
    
    if (definitions.length !== safeDefinitions.length) {
      console.warn(`[CLEANUP] ⚠️ WARNING: Filtered out ${definitions.length - safeDefinitions.length} definitions with wrong namespace!`);
    }
    
    return safeDefinitions;

  } catch (error) {
    console.error('[CLEANUP] Error fetching metafield definitions:', error);
    return [];
  }
}

/**
 * Delete a single metafield definition by ID
 */
async function deleteMetafieldDefinition(shop, accessToken, definitionId) {
  const mutation = `
    mutation DeleteMetafieldDefinition($id: ID!) {
      metafieldDefinitionDelete(id: $id) {
        deletedDefinitionId
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = { id: definitionId };

  try {
    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const json = await response.json();
    
    if (json.errors) {
      return { success: false, error: json.errors };
    }

    const result = json.data?.metafieldDefinitionDelete;
    
    if (result?.userErrors?.length > 0) {
      return { success: false, error: result.userErrors };
    }

    if (result?.deletedDefinitionId) {
      return { success: true, deletedId: result.deletedDefinitionId };
    }

    return { success: false, error: 'Unknown error' };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

