// backend/utils/optimizationSummary.js
import Product from '../db/Product.js';
import { executeShopifyGraphQL } from './tokenResolver.js';

/**
 * Updates the optimization_summary metafield for a product
 * This creates a human-readable status indicator visible in Shopify Admin
 */
export async function updateOptimizationSummary(shop, productId) {
  try {
    // 1. Fetch current optimization state from MongoDB
    const product = await Product.findOne({ shop, productId });
    
    if (!product) {
      console.warn(`[OPT-SUMMARY] Product ${productId} not found in MongoDB`);
      return { success: false, error: 'Product not found' };
    }
    
    // 2. Check for schemas in Shopify metafields
    const productGid = `gid://shopify/Product/${productId}`;
    const languages = product.seoStatus?.languages?.map(l => l.code.toLowerCase()) || [];
    
    const schemaTypes = new Set(); // Use Set to avoid duplicates
    
    // Query each language's schema metafield
    for (const lang of languages) {
      try {
        const schemaQuery = `
          query GetSchemaMetafield($productId: ID!, $key: String!) {
            product(id: $productId) {
              metafield(namespace: "advanced_schema", key: $key) {
                value
              }
            }
          }
        `;
        
        const schemaResult = await executeShopifyGraphQL(shop, schemaQuery, {
          productId: productGid,
          key: `schemas_${lang}`
        });
        
        if (schemaResult?.product?.metafield?.value) {
          const schemas = JSON.parse(schemaResult.product.metafield.value);
          
          if (Array.isArray(schemas)) {
            schemas.forEach(schema => {
              if (schema['@type']) {
                schemaTypes.add(schema['@type']);
              }
            });
          }
        }
      } catch (err) {
        console.error(`[OPT-SUMMARY] Error fetching schema for language ${lang}:`, err.message);
      }
    }
    
    // 3. Build human-readable summary
    const languageCodes = languages.map(l => l.toUpperCase());
    
    const lastOptimized = product.seoStatus?.languages?.[0]?.lastOptimizedAt || new Date();
    const lastOptimizedDate = new Date(lastOptimized).toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Build summary parts
    const summaryParts = [];
    
    // Status
    if (product.seoStatus?.optimized) {
      summaryParts.push('✅ Optimized');
    } else {
      summaryParts.push('⚠️ Not Optimized');
    }
    
    // Languages
    if (languageCodes.length > 0) {
      summaryParts.push(`Languages: ${languageCodes.join(', ')}`);
    }
    
    // Last optimization date
    summaryParts.push(`Last: ${lastOptimizedDate}`);
    
    // Schema types (convert Set to Array)
    const schemaTypesArray = Array.from(schemaTypes);
    if (schemaTypesArray.length > 0) {
      summaryParts.push(`Schema: ${schemaTypesArray.join(', ')}`);
    }
    
    const summary = summaryParts.join(' | ');
    
    // 4. Save to Shopify metafield
    const mutation = `
      mutation($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const variables = {
      metafields: [{
        ownerId: `gid://shopify/Product/${productId}`,
        namespace: "seo_ai",
        key: "optimization_summary",
        type: "single_line_text_field",
        value: summary
      }]
    };
    
    const result = await executeShopifyGraphQL(shop, mutation, variables);
    
    if (result?.metafieldsSet?.userErrors?.length > 0) {
      console.error('[OPT-SUMMARY] Error saving metafield:', result.metafieldsSet.userErrors);
      return { success: false, errors: result.metafieldsSet.userErrors };
    }
    
    return { success: true, summary };
    
  } catch (error) {
    console.error('[OPT-SUMMARY] Exception updating optimization summary:', error.message);
    return { success: false, error: error.message };
  }
}

