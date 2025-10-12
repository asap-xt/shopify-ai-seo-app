// backend/billing/tokenConfig.js
// Token pricing and configuration

// Gemini 2.5 Flash Lite pricing (as of 2025)
// Input: $0.075 per 1M tokens
// Output: $0.30 per 1M tokens
// Average for our use case: ~$0.10 per 1M tokens (mostly input)

const GEMINI_RATE_PER_1M_TOKENS = 0.10; // USD
const GEMINI_RATE_PER_TOKEN = GEMINI_RATE_PER_1M_TOKENS / 1_000_000;

export const TOKEN_CONFIG = {
  // Purchase settings
  presetAmounts: [10, 20, 50, 100], // Quick select in USD
  minimumPurchase: 5,                // Min $5
  increment: 5,                      // Must be multiple of $5
  maximumPurchase: 1000,             // Safety limit
  customAllowed: true,               // User can enter custom amount
  
  // Revenue split
  appRevenuePercent: 0.40,           // 40% to app
  tokenBudgetPercent: 0.60,          // 60% for Gemini tokens
  
  // Provider (internal only)
  provider: 'gemini-2.5-flash-lite',
  providerRate: GEMINI_RATE_PER_TOKEN,
  
  // Token expiration
  tokensExpire: false,
  rollover: true,
  
  // Calculate tokens from USD amount
  calculateTokens(usdAmount) {
    const tokenBudget = usdAmount * this.tokenBudgetPercent;
    const tokens = Math.floor(tokenBudget / this.providerRate);
    return tokens;
  },
  
  // Calculate USD from token amount
  calculateCost(tokens) {
    const providerCost = tokens * this.providerRate;
    const totalCost = providerCost / this.tokenBudgetPercent;
    return Math.ceil(totalCost * 100) / 100; // Round up to nearest cent
  },
  
  // Validate purchase amount
  isValidAmount(amount) {
    if (amount < this.minimumPurchase) return false;
    if (amount > this.maximumPurchase) return false;
    if (amount % this.increment !== 0) return false;
    return true;
  }
};

// Token costs for different features
export const TOKEN_COSTS = {
  'ai-seo-product-basic': {
    base: 1000,           // ~1000 tokens per product (title, description, meta)
    perLanguage: 800,     // Additional per language
    description: 'AI SEO optimization for product'
  },
  
  'ai-seo-product-enhanced': {
    base: 2000,           // More detailed optimization
    perLanguage: 1500,
    description: 'Enhanced AI SEO with rich attributes'
  },
  
  'ai-seo-collection': {
    base: 1500,           // Collection is usually longer
    perLanguage: 1200,
    description: 'AI SEO optimization for collection'
  },
  
  'ai-testing-simulation': {
    base: 500,            // Simple simulation
    description: 'AI testing and simulation'
  },
  
  'ai-schema-advanced': {
    base: 3000,           // Complex schema generation
    perProduct: 2500,
    description: 'Advanced schema data generation'
  },
  
  'ai-sitemap-optimized': {
    base: 5000,           // One-time per generation
    perProduct: 100,      // Small cost per product in sitemap
    description: 'AI-optimized sitemap generation'
  }
};

// Calculate actual cost for a feature
export function calculateFeatureCost(feature, options = {}) {
  const cost = TOKEN_COSTS[feature];
  if (!cost) {
    throw new Error(`Unknown feature: ${feature}`);
  }
  
  let total = cost.base || 0;
  
  // Add language costs
  if (options.languages && cost.perLanguage) {
    const additionalLanguages = Math.max(0, options.languages - 1);
    total += additionalLanguages * cost.perLanguage;
  }
  
  // Add per-product costs
  if (options.productCount && cost.perProduct) {
    total += options.productCount * cost.perProduct;
  }
  
  return total;
}

// Plan-specific token inclusions (for Growth Extra+)
export const PLAN_INCLUDED_TOKENS = {
  'starter': 0,
  'professional': 0,
  'growth': 0,
  'growth extra': {
    usdAmount: 35.70,  // 30% of $119
    tokens: null       // Calculated dynamically
  },
  'enterprise': {
    usdAmount: 89.70,  // 30% of $299
    tokens: null       // Calculated dynamically
  }
};

// Calculate included tokens for a plan
export function getIncludedTokens(plan) {
  const planKey = String(plan).toLowerCase();
  const config = PLAN_INCLUDED_TOKENS[planKey];
  
  if (!config || !config.usdAmount) {
    return { usdAmount: 0, tokens: 0 };
  }
  
  const tokens = TOKEN_CONFIG.calculateTokens(config.usdAmount);
  
  return {
    usdAmount: config.usdAmount,
    tokens
  };
}

// Features that require tokens
export const TOKEN_REQUIRED_FEATURES = [
  'ai-seo-product-basic',
  'ai-seo-product-enhanced',
  'ai-seo-collection',
  'ai-testing-simulation',
  'ai-schema-advanced',
  'ai-sitemap-optimized'
];

// Features blocked during trial
export const TRIAL_BLOCKED_FEATURES = [
  'ai-seo-product-basic',
  'ai-seo-product-enhanced',
  'ai-seo-collection',
  'ai-testing-simulation',
  'ai-schema-advanced',
  'ai-sitemap-optimized'
];

// Check if feature requires tokens
export function requiresTokens(feature) {
  return TOKEN_REQUIRED_FEATURES.includes(feature);
}

// Check if feature is blocked during trial
export function isBlockedInTrial(feature) {
  return TRIAL_BLOCKED_FEATURES.includes(feature);
}

