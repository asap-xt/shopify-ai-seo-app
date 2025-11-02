// backend/utils/storeContextBuilder.js
// Build comprehensive store context for AI to prevent hallucinations

import fetch from 'node-fetch';
import { resolveAdminToken } from './tokenResolver.js';

/**
 * Build comprehensive store context for AI models
 * This provides factual information about the store to prevent hallucinations
 */
export async function buildStoreContext(shop, options = {}) {
  try {
    // Get access token
    const accessToken = await resolveAdminToken({ shopDomain: shop });
    if (!accessToken) {
      console.warn('[STORE-CONTEXT] No access token, using minimal context');
      return buildMinimalContext(shop);
    }

    // Fetch store data from Shopify
    const storeData = await fetchStoreData(shop, accessToken);
    
    // Fetch store metadata (if exists)
    const storeMetadata = await fetchStoreMetadata(shop, accessToken);
    
    // Fetch store policies (prioritize Store Metadata over Shopify policies)
    const policies = await fetchStorePolicies(shop, accessToken, storeMetadata);
    
    // Analyze product catalog (optional, can be cached)
    let catalogSummary = null;
    if (options.includeProductAnalysis !== false) {
      catalogSummary = await getProductCatalogSummary(shop, accessToken);
    }
    
    // Build comprehensive context
    return buildContextString({
      shop,
      storeData,
      storeMetadata,
      policies,
      catalogSummary
    });
    
  } catch (error) {
    console.error('[STORE-CONTEXT] Error building context:', error.message);
    return buildMinimalContext(shop);
  }
}

/**
 * Fetch basic store information from Shopify
 */
async function fetchStoreData(shop, accessToken) {
  const query = `
    query {
      shop {
        name
        description
        email
        currencyCode
        primaryDomain {
          url
        }
        billingAddress {
          country
          countryCodeV2
        }
      }
    }
  `;
  
  try {
    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    
    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`);
    }
    
    const json = await response.json();
    return json.data?.shop || {};
  } catch (error) {
    console.error('[STORE-CONTEXT] Error fetching store data:', error.message);
    return {};
  }
}

/**
 * Fetch store metadata (custom AI SEO metadata)
 */
async function fetchStoreMetadata(shop, accessToken) {
  const query = `
    query {
      shop {
        metafield(namespace: "ai_seo_store", key: "seo_metadata") {
          value
        }
        aiMetadata: metafield(namespace: "ai_seo_store", key: "ai_metadata") {
          value
        }
      }
    }
  `;
  
  try {
    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    
    if (!response.ok) {
      return {};
    }
    
    const json = await response.json();
    const shop_data = json.data?.shop || {};
    
    let seoMetadata = {};
    let aiMetadata = {};
    
    if (shop_data.metafield?.value) {
      try {
        seoMetadata = JSON.parse(shop_data.metafield.value);
      } catch (e) {}
    }
    
    if (shop_data.aiMetadata?.value) {
      try {
        aiMetadata = JSON.parse(shop_data.aiMetadata.value);
      } catch (e) {}
    }
    
    return { ...seoMetadata, ...aiMetadata };
  } catch (error) {
    console.error('[STORE-CONTEXT] Error fetching metadata:', error.message);
    return {};
  }
}

/**
 * Fetch store policies - PRIORITIZE Store Metadata over Shopify policies
 * Store Metadata policies are more accurate and controlled by merchant
 */
async function fetchStorePolicies(shop, accessToken, storeMetadata) {
  // PRIORITY 1: Store Metadata policies (most accurate!)
  const metadataShipping = storeMetadata?.shippingInfo || storeMetadata?.shipping;
  const metadataReturns = storeMetadata?.returnPolicy || storeMetadata?.returns;
  
  if (metadataShipping || metadataReturns) {
    return {
      shipping: metadataShipping || null,
      refund: metadataReturns || null,
      source: 'store_metadata' // Flag for tracking
    };
  }
  
  // PRIORITY 2: Shopify policies (fallback)
  const query = `
    query {
      shop {
        shippingPolicy {
          body
          url
        }
        refundPolicy {
          body
          url
        }
        privacyPolicy {
          body
          url
        }
        termsOfService {
          body
          url
        }
      }
    }
  `;
  
  try {
    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    
    if (!response.ok) {
      return { source: 'none' };
    }
    
    const json = await response.json();
    const shopData = json.data?.shop || {};
    
    return {
      shipping: extractPolicySummary(shopData.shippingPolicy?.body),
      refund: extractPolicySummary(shopData.refundPolicy?.body),
      privacy: shopData.privacyPolicy?.url || null,
      terms: shopData.termsOfService?.url || null,
      source: 'shopify_policies'
    };
  } catch (error) {
    console.error('[STORE-CONTEXT] Error fetching policies:', error.message);
    return { source: 'none' };
  }
}

/**
 * Extract policy summary (first 200 chars, remove HTML)
 */
function extractPolicySummary(policyHtml) {
  if (!policyHtml) return null;
  
  // Remove HTML tags
  const text = policyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Return first 200 characters
  return text.length > 200 ? text.substring(0, 200) + '...' : text;
}

/**
 * Get product catalog summary
 */
async function getProductCatalogSummary(shop, accessToken) {
  const query = `
    query {
      products(first: 50) {
        edges {
          node {
            id
            productType
            vendor
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
              maxVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
      collections(first: 10) {
        edges {
          node {
            title
          }
        }
      }
    }
  `;
  
  try {
    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    
    if (!response.ok) {
      return null;
    }
    
    const json = await response.json();
    const products = json.data?.products?.edges || [];
    const collections = json.data?.collections?.edges || [];
    
    // Analyze products
    const productTypes = new Set();
    const vendors = new Set();
    let minPrice = Infinity;
    let maxPrice = 0;
    let currency = 'USD';
    
    products.forEach(({ node }) => {
      if (node.productType) productTypes.add(node.productType);
      if (node.vendor) vendors.add(node.vendor);
      
      if (node.priceRangeV2) {
        const min = parseFloat(node.priceRangeV2.minVariantPrice.amount);
        const max = parseFloat(node.priceRangeV2.maxVariantPrice.amount);
        currency = node.priceRangeV2.minVariantPrice.currencyCode;
        
        minPrice = Math.min(minPrice, min);
        maxPrice = Math.max(maxPrice, max);
      }
    });
    
    return {
      totalProducts: products.length,
      categories: Array.from(productTypes).slice(0, 5),
      topVendors: Array.from(vendors).slice(0, 3),
      collections: collections.map(c => c.node.title).slice(0, 5),
      minPrice: minPrice === Infinity ? 0 : minPrice.toFixed(2),
      maxPrice: maxPrice === 0 ? 0 : maxPrice.toFixed(2),
      currency
    };
  } catch (error) {
    console.error('[STORE-CONTEXT] Error fetching catalog summary:', error.message);
    return null;
  }
}

/**
 * Build context string for AI
 */
function buildContextString({ shop, storeData, storeMetadata, policies, catalogSummary }) {
  const shopName = storeData.name || shop.split('.')[0];
  const shopUrl = storeData.primaryDomain?.url || `https://${shop}`;
  const country = storeData.billingAddress?.country || 'Unknown';
  
  let context = `
═══════════════════════════════════════════════════════
                     STORE CONTEXT
═══════════════════════════════════════════════════════

🏪 STORE INFORMATION:
Store Name: ${shopName}
Store URL: ${shopUrl}
Country: ${country}
Currency: ${storeData.currencyCode || 'USD'}
Description: ${storeData.description || 'E-commerce store'}
`;

  // Add custom metadata if exists
  if (storeMetadata.targetAudience || storeMetadata.brandVoice) {
    context += `
🎯 BRAND IDENTITY:
Target Audience: ${storeMetadata.targetAudience || 'General consumers'}
Brand Voice: ${storeMetadata.brandVoice || 'Professional and friendly'}
Brand Values: ${storeMetadata.brandValues || 'Quality, Service, Value'}
`;
  }

  // Add catalog summary if available
  if (catalogSummary) {
    context += `
📦 PRODUCT CATALOG:
Total Products Analyzed: ${catalogSummary.totalProducts}
Main Categories: ${catalogSummary.categories.join(', ') || 'Various'}
Top Brands/Vendors: ${catalogSummary.topVendors.join(', ') || 'Various'}
Price Range: ${catalogSummary.minPrice} - ${catalogSummary.maxPrice} ${catalogSummary.currency}
Collections: ${catalogSummary.collections.join(', ') || 'Various'}
`;
  }

  // Add policies if available
  if (policies.shipping || policies.refund) {
    context += `
📋 STORE POLICIES (Source: ${policies.source === 'store_metadata' ? 'Merchant-verified ✓' : 'Shopify defaults'}):
`;
    if (policies.shipping) {
      context += `Shipping: ${policies.shipping}\n`;
    }
    if (policies.refund) {
      context += `Returns: ${policies.refund}\n`;
    }
    
    // Add extra emphasis if from Store Metadata
    if (policies.source === 'store_metadata') {
      context += `\n⚠️ These policies are merchant-verified. Use them EXACTLY as stated.\n`;
    }
  }

  // Add critical guidelines
  context += `
═══════════════════════════════════════════════════════
                   CRITICAL GUIDELINES
═══════════════════════════════════════════════════════

⚠️ CONTENT GENERATION RULES:
1. Use ONLY information from STORE CONTEXT and PRODUCT DATA
2. Do NOT invent shipping costs, delivery times, or warranty periods
3. Do NOT add certifications (ISO, CE, FDA) unless specified in product data
4. Do NOT specify country of origin unless mentioned in product data
5. Do NOT add material percentages unless specified
6. If policy information is not provided above, use generic language:
   - "Check checkout for shipping options"
   - "Standard return policy applies"
   - "See product page for warranty details"
7. Match the brand voice and tone
8. Consider the target audience when writing
9. Stay factual and avoid making claims not supported by data

✅ GOOD EXAMPLES:
- "High-quality product for everyday use"
- "Made with durable materials"
- "Perfect for [target audience from context]"
- "Shipping options available at checkout"

❌ BAD EXAMPLES (DON'T DO THIS):
- "30-day money back guarantee" (unless in policies above)
- "Made in Italy" (unless in product data)
- "ISO 9001 certified" (unless in product data)
- "Free shipping worldwide" (unless in policies above)
- "24/7 customer support" (unless specified above)

═══════════════════════════════════════════════════════
`;

  return context;
}

/**
 * Build minimal context when full context is unavailable
 */
function buildMinimalContext(shop) {
  const shopName = shop.split('.')[0];
  
  return `
STORE CONTEXT:
--------------
Store: ${shopName}

GUIDELINES:
- Use ONLY factual information from product data
- Do NOT invent warranties, shipping terms, or certifications
- Keep content generic and factual
- If unsure, use phrases like "see checkout for details"
`;
}

/**
 * Check if store has metadata configured
 * Returns detailed status about what's missing
 */
export async function checkStoreMetadataStatus(shop) {
  try {
    const accessToken = await resolveAdminToken({ shopDomain: shop });
    if (!accessToken) {
      return {
        hasMetadata: false,
        hasPolicies: false,
        hasShipping: false,
        hasReturns: false,
        source: 'none'
      };
    }
    
    const storeMetadata = await fetchStoreMetadata(shop, accessToken);
    
    // Check critical fields
    const hasShipping = !!(storeMetadata?.shippingInfo || storeMetadata?.shipping);
    const hasReturns = !!(storeMetadata?.returnPolicy || storeMetadata?.returns);
    const hasTargetAudience = !!storeMetadata?.targetAudience;
    const hasBrandVoice = !!storeMetadata?.brandVoice;
    
    const hasPolicies = hasShipping && hasReturns;
    const hasMetadata = hasPolicies || hasTargetAudience || hasBrandVoice;
    
    return {
      hasMetadata,
      hasPolicies,
      hasShipping,
      hasReturns,
      hasTargetAudience,
      hasBrandVoice,
      completeness: {
        policies: hasPolicies ? 'complete' : (hasShipping || hasReturns ? 'partial' : 'missing'),
        branding: (hasTargetAudience && hasBrandVoice) ? 'complete' : 
                  (hasTargetAudience || hasBrandVoice) ? 'partial' : 'missing'
      },
      source: hasMetadata ? 'store_metadata' : 'none'
    };
  } catch (error) {
    console.error('[STORE-CONTEXT] Error checking metadata status:', error.message);
    return {
      hasMetadata: false,
      hasPolicies: false,
      hasShipping: false,
      hasReturns: false,
      source: 'error'
    };
  }
}

/**
 * Simple check if store has basic metadata
 */
export async function hasStoreMetadata(shop) {
  const status = await checkStoreMetadataStatus(shop);
  return status.hasMetadata;
}

/**
 * Cache store context (optional - can implement caching layer)
 */
const contextCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getCachedStoreContext(shop, options = {}) {
  const cacheKey = `${shop}_${JSON.stringify(options)}`;
  const cached = contextCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.context;
  }
  
  const context = await buildStoreContext(shop, options);
  contextCache.set(cacheKey, {
    context,
    timestamp: Date.now()
  });
  
  return context;
}

