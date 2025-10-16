// backend/utils/optimizationSummary.js
import Product from '../db/Product.js';
import AdvancedSchema from '../db/AdvancedSchema.js';
import { executeShopifyGraphQL } from './tokenResolver.js';

/**
 * Updates the optimization_summary metafield for a product
 * This creates a human-readable status indicator visible in Shopify Admin
 */
export async function updateOptimizationSummary(shop, productId) {
  try {
    console.log(`[OPT-SUMMARY] Updating optimization summary for product ${productId}`);
    
    // 1. Fetch current optimization state from MongoDB
    const product = await Product.findOne({ shop, productId });
    
    if (!product) {
      console.warn(`[OPT-SUMMARY] Product ${productId} not found in MongoDB`);
      return { success: false, error: 'Product not found' };
    }
    
    // 2. Check for schemas in MongoDB
    const schemas = await AdvancedSchema.find({ 
      shop, 
      $or: [
        { 'schemas.url': new RegExp(`/products/.*${product.handle}`) },
        { productId: productId }
      ]
    });
    
    // 3. Build human-readable summary
    const languages = product.seoStatus?.languages?.map(l => l.code.toUpperCase()) || [];
    const hasSchema = schemas.length > 0;
    
    // Extract unique schema types
    const schemaTypes = [];
    if (hasSchema) {
      schemas.forEach(schemaDoc => {
        if (schemaDoc.schemas && Array.isArray(schemaDoc.schemas)) {
          schemaDoc.schemas.forEach(schema => {
            if (schema['@type'] && !schemaTypes.includes(schema['@type'])) {
              schemaTypes.push(schema['@type']);
            }
          });
        }
      });
    }
    
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
    if (languages.length > 0) {
      summaryParts.push(`Languages: ${languages.join(', ')}`);
    }
    
    // Last optimization date
    summaryParts.push(`Last: ${lastOptimizedDate}`);
    
    // Schema types
    if (hasSchema && schemaTypes.length > 0) {
      summaryParts.push(`Schema: ${schemaTypes.join(', ')}`);
    }
    
    const summary = summaryParts.join(' | ');
    
    console.log(`[OPT-SUMMARY] Summary for product ${productId}: ${summary}`);
    
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
    
    console.log(`[OPT-SUMMARY] ✅ Optimization summary metafield saved for product ${productId}`);
    return { success: true, summary };
    
  } catch (error) {
    console.error('[OPT-SUMMARY] Exception updating optimization summary:', error.message);
    return { success: false, error: error.message };
  }
}

