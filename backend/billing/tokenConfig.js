// backend/billing/tokenConfig.js
// Token pricing and configuration

import fetch from 'node-fetch';

// Gemini 2.5 Flash Lite pricing (as of 2025)
// We fetch the actual rate dynamically from OpenRouter
// This is a fallback/default estimate for UI display purposes
// Input: $0.075 per 1M tokens
// Output: $0.30 per 1M tokens
// Average for our use case: ~$0.10 per 1M tokens (mostly input)

const GEMINI_RATE_PER_1M_TOKENS = 0.10; // USD per 1M tokens (fallback estimate)

export const TOKEN_CONFIG = {
  // Purchase settings
  presetAmounts: [10, 20, 50, 100], // Quick select in USD
  minimumPurchase: 5,                // Min $5
  increment: 5,                      // Must be multiple of $5
  maximumPurchase: 1000,             // Safety limit
  customAllowed: true,               // User can enter custom amount
  
  // Revenue split (INTERNAL ONLY - not shown to users)
  appRevenuePercent: 0.70,           // 70% to app
  tokenBudgetPercent: 0.30,          // 30% for Gemini tokens
  
  // Provider (internal only)
  provider: 'gemini-2.5-flash-lite',
  providerRatePer1M: GEMINI_RATE_PER_1M_TOKENS, // $0.10 per 1M tokens
  
  // Token expiration
  tokensExpire: false,
  rollover: true,
  
  // Calculate tokens from USD amount
  // Example: $10 → $3 for tokens (30% budget) → $3 / $0.10 per 1M = 30M tokens
  calculateTokens(usdAmount) {
    const tokenBudget = usdAmount * this.tokenBudgetPercent; // 30% goes to tokens
    const tokensInMillions = tokenBudget / this.providerRatePer1M;
    const tokens = Math.floor(tokensInMillions * 1_000_000);
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
  
  'ai-testing-validation': {
    base: 50,             // AI validation of endpoints
    description: 'AI-powered validation of endpoint data'
  },
  
  'ai-schema-advanced': {
    base: 3000,           // Complex schema generation
    perProduct: 2500,
    description: 'Advanced schema data generation'
  },
  
  'ai-sitemap-optimized': {
    base: 5000,           // One-time per generation
    perProduct: 3000,     // Cost per product in sitemap (realistic avg: 2,159 tokens)
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
  const planKey = String(plan).toLowerCase().trim();
  
  // Handle plan key variants
  let normalizedKey = planKey;
  if (planKey === 'growth_extra' || planKey === 'growthextra') {
    normalizedKey = 'growth extra';
  }
  
  const tokens = PLAN_INCLUDED_TOKENS[normalizedKey] || PLAN_INCLUDED_TOKENS[planKey] || 0;
  
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
  'ai-testing-validation',      // Requires tokens
  'ai-schema-advanced',         // Requires tokens
  'ai-sitemap-optimized'        // Requires tokens
];

// Features blocked during trial
// NOTE: Basic SEO is allowed in trial! Only AI-Enhanced features are blocked.
export const TRIAL_BLOCKED_FEATURES = [
  'ai-seo-product-enhanced',   // Blocked in trial
  'ai-seo-collection',          // Blocked in trial
  'ai-testing-simulation',      // Blocked in trial
  'ai-testing-validation',      // Blocked in trial
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

// ====================================================================
// DYNAMIC PRICING FROM OPENROUTER
// ====================================================================

// Cache for model pricing (refresh every hour)
let pricingCache = {
  rate: null,
  lastFetch: null,
  cacheDuration: 60 * 60 * 1000 // 1 hour
};

/**
 * Fetch current pricing for Gemini 2.5 Flash Lite from OpenRouter
 * @returns {Promise<number>} Rate per 1M tokens (USD)
 */
export async function fetchOpenRouterPricing() {
  try {
    // Check cache first
    if (pricingCache.rate && pricingCache.lastFetch) {
      const cacheAge = Date.now() - pricingCache.lastFetch;
      if (cacheAge < pricingCache.cacheDuration) {
        return pricingCache.rate;
      }
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.warn('[TokenConfig] OPENROUTER_API_KEY not set, using fallback rate');
      return GEMINI_RATE_PER_1M_TOKENS;
    }

    // Fetch model pricing from OpenRouter
    const modelName = 'google/gemini-2.5-flash-lite';
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || process.env.APP_URL || 'https://indexaize.com',
        'X-Title': 'indexAIze - Unlock AI Search'
      }
    });

    if (!response.ok) {
      console.warn('[TokenConfig] Failed to fetch pricing from OpenRouter, using fallback');
      return GEMINI_RATE_PER_1M_TOKENS;
    }

    const data = await response.json();
    const model = data.data?.find(m => m.id === modelName);

    if (!model?.pricing) {
      console.warn('[TokenConfig] Model pricing not found, using fallback');
      return GEMINI_RATE_PER_1M_TOKENS;
    }

    // OpenRouter returns prices per token, we need per 1M tokens
    // So we multiply by 1,000,000 to convert
    const inputRatePerToken = model.pricing.prompt || model.pricing.input || 0.000000075; // per token
    const outputRatePerToken = model.pricing.completion || model.pricing.output || 0.00000030; // per token
    
    const inputRate = inputRatePerToken * 1_000_000; // Convert to per 1M tokens
    const outputRate = outputRatePerToken * 1_000_000; // Convert to per 1M tokens

    // Since most of our usage is input (titles, descriptions are in prompt),
    // we weight input more: 80% input, 20% output
    const weightedRate = (inputRate * 0.8) + (outputRate * 0.2);

    // Update cache
    pricingCache.rate = weightedRate;
    pricingCache.lastFetch = Date.now();

    return weightedRate;

  } catch (error) {
    console.error('[TokenConfig] Error fetching OpenRouter pricing:', error.message);
    return GEMINI_RATE_PER_1M_TOKENS; // Fallback to default
  }
}

/**
 * Calculate tokens with dynamic pricing check
 * @param {number} usdAmount - Amount in USD
 * @returns {Promise<number>} Number of tokens
 */
export async function calculateTokensWithDynamicPricing(usdAmount) {
  const tokenBudget = usdAmount * TOKEN_CONFIG.tokenBudgetPercent; // 30% goes to tokens
  const ratePer1M = await fetchOpenRouterPricing(); // This is ALREADY in $ per 1M tokens
  
  // Calculate how many millions of tokens we can buy
  const tokensInMillions = tokenBudget / ratePer1M;
  const tokens = Math.floor(tokensInMillions * 1_000_000);

  return tokens;
}

