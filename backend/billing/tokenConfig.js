// backend/billing/tokenConfig.js
// Token pricing and configuration

// Gemini 2.5 Flash Lite pricing (as of 2025)
// We fetch the actual rate dynamically from OpenRouter
// This is a fallback/default estimate for UI display purposes
// Input: $0.075 per 1M tokens
// Output: $0.30 per 1M tokens
// Average for our use case: ~$0.10 per 1M tokens (mostly input)

const GEMINI_RATE_PER_1M_TOKENS = 0.10; // USD per 1M tokens (fallback estimate)
const GEMINI_RATE_PER_TOKEN = GEMINI_RATE_PER_1M_TOKENS / 1_000_000; // $0.0000001 per token

export const TOKEN_CONFIG = {
  // Purchase settings
  presetAmounts: [10, 20, 50, 100], // Quick select in USD
  minimumPurchase: 5,                // Min $5
  increment: 5,                      // Must be multiple of $5
  maximumPurchase: 1000,             // Safety limit
  customAllowed: true,               // User can enter custom amount
  
  // Revenue split (INTERNAL ONLY - not shown to users)
  appRevenuePercent: 0.40,           // 40% to app
  tokenBudgetPercent: 0.60,          // 60% for Gemini tokens
  
  // Provider (internal only)
  provider: 'gemini-2.5-flash-lite',
  providerRate: GEMINI_RATE_PER_TOKEN, // $0.0000001 per token
  
  // Token expiration
  tokensExpire: false,
  rollover: true,
  
  // Calculate tokens from USD amount
  // Example: $10 → $6 for tokens (60% budget) → tokens based on actual OpenRouter rate
  // With default rate $0.10/1M: $6 → 60,000,000 tokens
  calculateTokens(usdAmount) {
    const tokenBudget = usdAmount * this.tokenBudgetPercent; // 60% goes to tokens
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

// Token costs for different features (in tokens)
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
// These are FIXED monthly limits that reset at billing cycle
export const PLAN_INCLUDED_TOKENS = {
  'starter': 0,
  'professional': 0,
  'growth': 0,
  'growth extra': 100_000_000,  // 100 million tokens per month
  'enterprise': 300_000_000     // 300 million tokens per month
};

// Calculate included tokens for a plan
export function getIncludedTokens(plan) {
  const planKey = String(plan).toLowerCase();
  const tokens = PLAN_INCLUDED_TOKENS[planKey] || 0;
  
  return {
    tokens,
    // Calculate approximate USD value (for display purposes only)
    usdValue: tokens > 0 ? TOKEN_CONFIG.calculateCost(tokens) : 0
  };
}

// Features that require tokens
// NOTE: Basic SEO does NOT require tokens! Only AI-Enhanced features.
export const TOKEN_REQUIRED_FEATURES = [
  'ai-seo-product-enhanced',   // Requires tokens (bullets/FAQ)
  'ai-seo-collection',          // Requires tokens
  'ai-testing-simulation',      // Requires tokens
  'ai-schema-advanced',         // Requires tokens
  'ai-sitemap-optimized'        // Requires tokens
];

// Features blocked during trial
// NOTE: Basic SEO is allowed in trial! Only AI-Enhanced features are blocked.
export const TRIAL_BLOCKED_FEATURES = [
  'ai-seo-product-enhanced',   // Blocked in trial
  'ai-seo-collection',          // Blocked in trial
  'ai-testing-simulation',      // Blocked in trial
  'ai-schema-advanced',         // Blocked in trial
  'ai-sitemap-optimized'        // Blocked in trial
];

// Check if feature requires tokens
export function requiresTokens(feature) {
  return TOKEN_REQUIRED_FEATURES.includes(feature);
}

// Check if feature is blocked during trial
export function isBlockedInTrial(feature) {
  return TRIAL_BLOCKED_FEATURES.includes(feature);
}

// ====================================================================
// DYNAMIC TOKEN TRACKING (т.2)
// ====================================================================

// Safety margin for pre-deduction (10%)
export const TOKEN_SAFETY_MARGIN = 0.10;

// Estimate tokens needed for an operation (with safety margin)
export function estimateTokensWithMargin(feature, options = {}) {
  const baseEstimate = calculateFeatureCost(feature, options);
  const withMargin = Math.ceil(baseEstimate * (1 + TOKEN_SAFETY_MARGIN));
  return {
    estimated: baseEstimate,
    withMargin,
    margin: withMargin - baseEstimate
  };
}

// Calculate actual cost from OpenRouter response
// OpenRouter returns: { prompt_tokens, completion_tokens, total_cost? }
export function calculateActualTokens(usage = {}) {
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const totalTokens = promptTokens + completionTokens;
  
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: usage.total_cost || null // OpenRouter sometimes provides this
  };
}

