// backend/utils/storeContextBuilder.js
// Build comprehensive store context for AI to prevent hallucinations

import fetch from 'node-fetch';
import { resolveAdminTokenForShop } from './tokenResolver.js';

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

/**
 * Build comprehensive store context for AI models
 * This provides factual information about the store to prevent hallucinations
 */
export async function buildStoreContext(shop, options = {}) {
  try {
    // Get access token
    const accessToken = await resolveAdminTokenForShop(shop);
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
    const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
 * Includes: seo_metadata, ai_metadata, organization_schema
 */
async function fetchStoreMetadata(shop, accessToken) {
  const query = `
    query {
      shop {
        seoMetadata: metafield(namespace: "ai_seo_store", key: "seo_metadata") {
          value
        }
        aiMetadata: metafield(namespace: "ai_seo_store", key: "ai_metadata") {
          value
        }
        organizationSchema: metafield(namespace: "ai_seo_store", key: "organization_schema") {
          value
        }
      }
    }
  `;
  
  try {
    const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
    let organizationSchema = {};
    
    if (shop_data.seoMetadata?.value) {
      try {
        seoMetadata = JSON.parse(shop_data.seoMetadata.value);
      } catch (e) {}
    }
    
    if (shop_data.aiMetadata?.value) {
      try {
        aiMetadata = JSON.parse(shop_data.aiMetadata.value);
      } catch (e) {}
    }
    
    if (shop_data.organizationSchema?.value) {
      try {
        organizationSchema = JSON.parse(shop_data.organizationSchema.value);
      } catch (e) {}
    }
    
    return { 
      seo: seoMetadata, 
      ai: aiMetadata, 
      organization: organizationSchema 
    };
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
  // storeMetadata now has structure: { seo: {}, ai: {}, organization: {} }
  const ai = storeMetadata?.ai || {};
  const metadataShipping = ai.shippingInfo || ai.shipping;
  const metadataReturns = ai.returnPolicy || ai.returns;
  
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
    const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
    const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
 * Includes ALL Store Metadata fields for comprehensive AI context
 */
function buildContextString({ shop, storeData, storeMetadata, policies, catalogSummary }) {
  // Extract structured metadata
  const seo = storeMetadata?.seo || {};
  const ai = storeMetadata?.ai || {};
  const org = storeMetadata?.organization || {};
  
  // Use custom store name if set, otherwise Shopify name
  const shopName = seo.storeName || storeData.name || shop.split('.')[0];
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
`;
  
  // Add SEO description (prefer custom over Shopify)
  const description = seo.fullDescription || seo.shortDescription || storeData.description;
  if (description) {
    context += `Description: ${description}\n`;
  }
  
  // Add keywords if set
  if (seo.keywords) {
    const keywordsStr = Array.isArray(seo.keywords) ? seo.keywords.join(', ') : seo.keywords;
    if (keywordsStr) {
      context += `Keywords: ${keywordsStr}\n`;
    }
  }
  
  // CONTACT INFORMATION - Critical for AI to answer contact questions!
  if (org.email || org.phone || storeData.email) {
    context += `
📞 CONTACT INFORMATION:
`;
    if (org.email || storeData.email) {
      context += `Email: ${org.email || storeData.email}\n`;
    }
    if (org.phone) {
      context += `Phone: ${org.phone}\n`;
    }
    if (org.name) {
      context += `Company Name: ${org.name}\n`;
    }
  }
  
  // BRAND IDENTITY - All AI Metadata fields
  if (ai.targetAudience || ai.brandVoice || ai.businessType || ai.uniqueSellingPoints) {
    context += `
🎯 BRAND IDENTITY:
`;
    if (ai.businessType) {
      context += `Business Type: ${ai.businessType}\n`;
    }
    if (ai.targetAudience) {
      context += `Target Audience: ${ai.targetAudience}\n`;
    }
    if (ai.brandVoice) {
      context += `Brand Voice/Tone: ${ai.brandVoice}\n`;
    }
    if (ai.uniqueSellingPoints) {
      const uspStr = Array.isArray(ai.uniqueSellingPoints) ? ai.uniqueSellingPoints.join(', ') : ai.uniqueSellingPoints;
      context += `Unique Selling Points: ${uspStr}\n`;
    }
    if (ai.primaryCategories) {
      const catStr = Array.isArray(ai.primaryCategories) ? ai.primaryCategories.join(', ') : ai.primaryCategories;
      context += `Primary Categories: ${catStr}\n`;
    }
  }
  
  // MARKET INFORMATION - Languages, currencies, regions
  if (ai.languages || ai.supportedCurrencies || ai.shippingRegions) {
    context += `
🌍 MARKET INFORMATION:
`;
    if (ai.languages) {
      const langStr = Array.isArray(ai.languages) ? ai.languages.join(', ') : ai.languages;
      context += `Supported Languages: ${langStr}\n`;
    }
    if (ai.supportedCurrencies) {
      const currStr = Array.isArray(ai.supportedCurrencies) ? ai.supportedCurrencies.join(', ') : ai.supportedCurrencies;
      context += `Supported Currencies: ${currStr}\n`;
    }
    if (ai.shippingRegions) {
      const regStr = Array.isArray(ai.shippingRegions) ? ai.shippingRegions.join(', ') : ai.shippingRegions;
      context += `Shipping Regions: ${regStr}\n`;
    }
    if (ai.culturalConsiderations) {
      context += `Cultural Considerations: ${ai.culturalConsiderations}\n`;
    }
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
  
  // STORE POLICIES - Shipping and Returns
  // Use AI metadata shipping/returns if available, otherwise use policies object
  const shippingInfo = ai.shippingInfo || policies?.shipping;
  const returnPolicy = ai.returnPolicy || policies?.refund;
  
  if (shippingInfo || returnPolicy) {
    const source = (ai.shippingInfo || ai.returnPolicy) ? 'Merchant-verified ✓' : 
                   (policies?.source === 'store_metadata' ? 'Merchant-verified ✓' : 'Shopify defaults');
    context += `
📋 STORE POLICIES (Source: ${source}):
`;
    if (shippingInfo) {
      context += `Shipping: ${shippingInfo}\n`;
    }
    if (returnPolicy) {
      context += `Returns/Refunds: ${returnPolicy}\n`;
    }
    
    // Add extra emphasis if merchant-verified
    if (ai.shippingInfo || ai.returnPolicy || policies?.source === 'store_metadata') {
      context += `\n⚠️ These policies are merchant-verified. Use them EXACTLY as stated.\n`;
    }
  }
  
  // Add critical guidelines
  context += `
═══════════════════════════════════════════════════════
                   CRITICAL GUIDELINES
═══════════════════════════════════════════════════════

⚠️ CONTENT GENERATION RULES:
1. Use ONLY information from STORE CONTEXT above
2. For contact information: Use EXACTLY the email/phone shown above
3. Do NOT invent shipping costs, delivery times, or warranty periods
4. Do NOT add certifications (ISO, CE, FDA) unless specified
5. If information is not provided above, say "Please check the website or contact support"
6. Match the brand voice and tone if specified
7. Answer questions based ONLY on the data provided in this context
`;
  
  return context.trim();
}

/**
 * Minimal context when we cannot fetch live data
 */
function buildMinimalContext(shop) {
  return `
STORE CONTEXT (Limited)
Store: ${shop}
Only minimal information is available.`.trim();
}

/**
 * Check if store has metadata configured
 * Returns detailed status about what's missing
 */
export async function checkStoreMetadataStatus(shop) {
  try {
    const accessToken = await resolveAdminTokenForShop(shop);
    if (!accessToken) {
      return {
        hasMetadata: false,
        hasPolicies: false,
        hasShipping: false,
        hasReturns: false,
        hasContact: false,
        source: 'none'
      };
    }
    
    const storeMetadata = await fetchStoreMetadata(shop, accessToken);
    
    // storeMetadata now has structure: { seo: {}, ai: {}, organization: {} }
    const ai = storeMetadata?.ai || {};
    const org = storeMetadata?.organization || {};
    const seo = storeMetadata?.seo || {};
    
    // Check critical fields
    const hasShipping = !!(ai.shippingInfo || ai.shipping);
    const hasReturns = !!(ai.returnPolicy || ai.returns);
    const hasTargetAudience = !!ai.targetAudience;
    const hasBrandVoice = !!ai.brandVoice;
    const hasContact = !!(org.email || org.phone);
    const hasStoreName = !!seo.storeName;
    const hasDescription = !!(seo.fullDescription || seo.shortDescription);
    
    const hasPolicies = hasShipping && hasReturns;
    const hasMetadata = hasPolicies || hasTargetAudience || hasBrandVoice || hasContact || hasStoreName || hasDescription;
    
    return {
      hasMetadata,
      hasPolicies,
      hasShipping,
      hasReturns,
      hasTargetAudience,
      hasBrandVoice,
      hasContact,
      hasStoreName,
      hasDescription,
      completeness: {
        policies: hasPolicies ? 'complete' : (hasShipping || hasReturns ? 'partial' : 'missing'),
        branding: (hasTargetAudience && hasBrandVoice) ? 'complete' : 
                  (hasTargetAudience || hasBrandVoice) ? 'partial' : 'missing',
        contact: hasContact ? 'complete' : 'missing'
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
      hasContact: false,
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

