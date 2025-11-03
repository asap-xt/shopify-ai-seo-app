// backend/utils/metafieldDefinitions.js
// Create metafield definitions to make metafields visible in Shopify Admin

import { makeShopifyGraphQLRequest } from './shopifyGraphQL.js';
import { resolveAdminToken } from './tokenResolver.js';

/**
 * Create optimization_summary metafield definition
 * Visible in: Product → Metafields section
 * Format: "✅ Optimized | Languages: EN, BG | Last: 2025-10-16 | Schema: Product, Review"
 */
export async function createOptimizationSummaryDefinition(req, shop) {
  
  try {
    const accessToken = await resolveAdminToken(req, shop);
    if (!accessToken) {
      throw new Error(`No access token found for shop: ${shop}`);
    }
    
    // Check if definition already exists
    const checkQuery = `
      query {
        metafieldDefinitions(first: 50, ownerType: PRODUCT, namespace: "seo_ai", key: "optimization_summary") {
          nodes {
            id
            name
            namespace
            key
          }
        }
      }
    `;
    
    const checkResult = await makeShopifyGraphQLRequest(shop, accessToken, checkQuery);
    const existingDefs = checkResult?.metafieldDefinitions?.nodes || [];
    
    if (existingDefs.length > 0) {
      return { 
        success: true, 
        alreadyExists: true, 
        definitionId: existingDefs[0].id 
      };
    }
    
    // Create new definition
    const createMutation = `
      mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
            name
            namespace
            key
            type {
              name
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const variables = {
      definition: {
        name: "AI Search Optimization Status",
        namespace: "seo_ai",
        key: "optimization_summary",
        description: "Human-readable summary of product's AI Search optimization status, languages, and schema data",
        type: "single_line_text_field",
        ownerType: "PRODUCT"
      }
    };
    
    const createResult = await makeShopifyGraphQLRequest(shop, accessToken, createMutation, variables);
    
    const errors = createResult?.metafieldDefinitionCreate?.userErrors || [];
    if (errors.length > 0) {
      console.error(`[METAFIELD-DEF] Errors:`, errors);
      return {
        success: false,
        errors: errors.map(e => e.message)
      };
    }
    
    const definition = createResult?.metafieldDefinitionCreate?.createdDefinition;
    
    return {
      success: true,
      alreadyExists: false,
      definitionId: definition.id
    };
    
  } catch (error) {
    console.error(`[METAFIELD-DEF] Error:`, error);
    return {
      success: false,
      errors: [error.message]
    };
  }
}

/**
 * Create schema metafield definitions for shop's published languages only
 * Visible in: Product → Metafields section
 * Format: JSON array of schema objects
 */
export async function createSchemaDefinitions(req, shop) {
  
  try {
    const accessToken = await resolveAdminToken(req, shop);
    if (!accessToken) {
      throw new Error(`No access token found for shop: ${shop}`);
    }
    
    // Fetch shop's published languages
    const localesQuery = `
      query {
        shopLocales {
          locale
          primary
          published
        }
      }
    `;
    
    const localesResult = await makeShopifyGraphQLRequest(shop, accessToken, localesQuery);
    const shopLocales = localesResult?.shopLocales || [];
    
    // Extract only published language codes
    const languages = shopLocales
      .filter(l => l.published)
      .map(l => l.locale.toLowerCase().split('-')[0]) // Extract language code (e.g., 'en' from 'en-US')
      .filter((v, i, a) => a.indexOf(v) === i); // Remove duplicates
    
    
    const results = {};
    
    for (const lang of languages) {
      const key = `schemas_${lang}`;
      
      // Check if definition already exists
      const checkQuery = `
        query {
          metafieldDefinitions(first: 50, ownerType: PRODUCT, namespace: "advanced_schema", key: "${key}") {
            nodes {
              id
              name
              namespace
              key
            }
          }
        }
      `;
      
      const checkResult = await makeShopifyGraphQLRequest(shop, accessToken, checkQuery);
      const existingDefs = checkResult?.metafieldDefinitions?.nodes || [];
      
      if (existingDefs.length > 0) {
        results[lang] = { 
          success: true, 
          alreadyExists: true, 
          definitionId: existingDefs[0].id 
        };
        continue;
      }
      
      // Create new definition
      const createMutation = `
        mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition {
              id
              name
              namespace
              key
              type {
                name
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      
      const variables = {
        definition: {
          name: `Advanced Schema (${lang.toUpperCase()})`,
          namespace: "advanced_schema",
          key: key,
          description: `JSON-LD structured data schemas for ${lang.toUpperCase()} language (Product, Review, FAQ, BreadcrumbList, etc.)`,
          type: "json",
          ownerType: "PRODUCT"
        }
      };
      
      const createResult = await makeShopifyGraphQLRequest(shop, accessToken, createMutation, variables);
      
      const errors = createResult?.metafieldDefinitionCreate?.userErrors || [];
      if (errors.length > 0) {
        console.error(`[METAFIELD-DEF] Errors for ${key}:`, errors);
        results[lang] = {
          success: false,
          errors: errors.map(e => e.message)
        };
        continue;
      }
      
      const definition = createResult?.metafieldDefinitionCreate?.createdDefinition;
      
      results[lang] = {
        success: true,
        alreadyExists: false,
        definitionId: definition.id
      };
    }
    
    return results;
    
  } catch (error) {
    console.error(`[METAFIELD-DEF] Error:`, error);
    return {
      success: false,
      errors: [error.message]
    };
  }
}

/**
 * Create all metafield definitions for the app
 * Called automatically on app installation
 */
export async function createAllMetafieldDefinitions(req, shop) {
  
  const results = {
    optimizationSummary: await createOptimizationSummaryDefinition(req, shop),
    schemas: await createSchemaDefinitions(req, shop)
  };
  
  return results;
}

