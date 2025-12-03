// frontend/src/utils/tokenEstimates.js
// Centralized token estimation for all AI features
// Keep in sync with backend/billing/tokenConfig.js

/**
 * Token cost configuration
 * IMPORTANT: Keep these values in sync with backend/billing/tokenConfig.js
 */
export const TOKEN_COSTS = {
  'ai-seo-product-enhanced': {
    base: 2000,           // Base cost per product
    perLanguage: 1500,    // Additional per language
    description: 'Enhanced AI SEO with rich attributes'
  },
  
  'ai-seo-collection': {
    base: 1500,           // Base cost per collection
    perLanguage: 1200,    // Additional per language
    description: 'AI SEO optimization for collection'
  },
  
  'ai-schema-advanced': {
    base: 3000,           // Complex schema generation
    perProduct: 150,      // Per product in sitemap
    description: 'Advanced schema data generation'
  },
  
  'ai-sitemap-optimized': {
    base: 2000,           // Overhead for system messages
    perProduct: 2500,     // 5 AI calls × ~500 tokens each = ~2500 per product
    description: 'AI-optimized sitemap generation'
  }
};

// Safety margin multiplier (10% for backend, 50% for frontend display)
const SAFETY_MARGIN = 1.5;

/**
 * Calculate estimated tokens for a feature
 * @param {string} feature - Feature key from TOKEN_COSTS
 * @param {object} options - { productCount, collectionCount, languages }
 * @returns {object} { estimated, withMargin, perItem, itemCount }
 */
export function estimateTokens(feature, options = {}) {
  const cost = TOKEN_COSTS[feature];
  if (!cost) {
    console.warn(`[TokenEstimate] Unknown feature: ${feature}`);
    return { estimated: 0, withMargin: 0, perItem: 0, itemCount: 0 };
  }
  
  const { productCount = 0, collectionCount = 0, languages = 1 } = options;
  
  let estimated = 0;
  let perItem = 0;
  let itemCount = 0;
  
  switch (feature) {
    case 'ai-seo-product-enhanced':
      // Per product × (base + languages × perLanguage)
      perItem = cost.base + (languages * cost.perLanguage);
      itemCount = productCount;
      estimated = productCount * perItem;
      break;
      
    case 'ai-seo-collection':
      // Per collection × (base + languages × perLanguage)
      perItem = cost.base + (languages * cost.perLanguage);
      itemCount = collectionCount;
      estimated = collectionCount * perItem;
      break;
      
    case 'ai-schema-advanced':
      // base + (productCount × perProduct)
      perItem = cost.perProduct;
      itemCount = productCount;
      estimated = cost.base + (productCount * cost.perProduct);
      break;
      
    case 'ai-sitemap-optimized':
      // base + (productCount × perProduct)
      perItem = cost.perProduct;
      itemCount = productCount;
      estimated = cost.base + (productCount * cost.perProduct);
      break;
      
    default:
      estimated = cost.base || 0;
  }
  
  const withMargin = Math.ceil(estimated * SAFETY_MARGIN);
  
  return {
    estimated,
    withMargin,
    perItem,
    itemCount,
    feature,
    formula: getFormula(feature, options)
  };
}

/**
 * Get human-readable formula for debugging
 */
function getFormula(feature, options) {
  const cost = TOKEN_COSTS[feature];
  const { productCount = 0, collectionCount = 0, languages = 1 } = options;
  
  switch (feature) {
    case 'ai-seo-product-enhanced':
      return `${productCount} products × (${cost.base} + ${languages} × ${cost.perLanguage})`;
    case 'ai-seo-collection':
      return `${collectionCount} collections × (${cost.base} + ${languages} × ${cost.perLanguage})`;
    case 'ai-schema-advanced':
      return `${cost.base} + (${productCount} × ${cost.perProduct})`;
    case 'ai-sitemap-optimized':
      return `${cost.base} + (${productCount} × ${cost.perProduct})`;
    default:
      return `base: ${cost.base}`;
  }
}

/**
 * Format token count for display (with comma separators)
 */
export function formatTokens(count) {
  return count?.toLocaleString() || '0';
}

