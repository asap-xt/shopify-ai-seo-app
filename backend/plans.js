// backend/plans.js
// Central plan configuration and helpers.

export const TRIAL_DAYS = 5;

export const PLANS = {
  starter: {
    name: "Starter",
    priceUsd: 9.99,
    queryLimit: 50,
    productLimit: 70,
    collectionLimit: 0, // No collections
    languageLimit: 1, // Only default language
    providersAllowed: ["deepseek", "llama"],
    autosyncCron: "0 0 */14 * *", // every 14 days
  },
  professional: {
    name: "Professional",
    priceUsd: 19.99,
    queryLimit: 600,
    productLimit: 70,
    collectionLimit: 20,
    languageLimit: 1, // Max 1 language
    providersAllowed: ["openai", "llama", "deepseek"],
    autosyncCron: "0 */48 * * *", // every 48 hours (minute 0)
  },
  "professional plus": {
    name: "Professional Plus",
    priceUsd: 29.99,
    queryLimit: 600,
    productLimit: 200,
    collectionLimit: 20,
    languageLimit: 2, // Max 2 languages
    providersAllowed: ["openai", "llama", "deepseek"],
    autosyncCron: "0 */48 * * *", // every 48 hours
    includedTokens: 0, // No included tokens, but AI Discovery features unlocked with purchased tokens
  },
  growth: {
    name: "Growth",
    priceUsd: 35.99,
    queryLimit: 1500,
    productLimit: 450,
    collectionLimit: 40,
    languageLimit: 3, // Max 3 languages
    providersAllowed: ["claude", "openai", "gemini", "llama", "deepseek"].slice(0,3),
    autosyncCron: "0 */24 * * *", // every 24 hours
  },
  "growth plus": {
    name: "Growth Plus",
    priceUsd: 49.99,
    queryLimit: 1500,
    productLimit: 450,
    collectionLimit: 40,
    languageLimit: 3, // Max 3 languages
    providersAllowed: ["claude", "openai", "gemini", "llama", "deepseek"].slice(0,3),
    autosyncCron: "0 */24 * * *", // every 24 hours
    includedTokens: 0, // No included tokens, but AI Discovery features unlocked with purchased tokens
  },
  "growth extra": {
    name: "Growth Extra",
    priceUsd: 99.99,
    queryLimit: 4000,
    productLimit: 750,
    collectionLimit: 999, // Unlimited (practical limit)
    languageLimit: 6, // Max 6 languages
    providersAllowed: ["claude", "openai", "gemini", "llama", "deepseek"].slice(0,4),
    autosyncCron: "0 */12 * * *", // every 12 hours
    includedTokens: 100_000_000, // 100 million tokens per month (included)
  },
  enterprise: {
    name: "Enterprise",
    priceUsd: 179.99,
    queryLimit: 10000,
    productLimit: 1200,
    collectionLimit: 999, // Unlimited (practical limit)
    languageLimit: 10, // Max 10 languages
    providersAllowed: ["claude", "openai", "gemini", "deepseek", "llama"],
    autosyncCron: "0 */2 * * *", // every 2 hours
    includedTokens: 300_000_000, // 300 million tokens per month (included)
  },
};

// Suggested OpenRouter models per vendor (tweak via .env ако искаш)
export const DEFAULT_MODELS = {
  openai: ["openai/gpt-4o-mini", "openai/o3-mini"],
  claude: ["anthropic/claude-3.5-sonnet", "anthropic/claude-3-haiku"],
  gemini: ["google/gemini-1.5-flash", "google/gemini-1.5-pro"],
  deepseek: ["deepseek/deepseek-chat"],
  llama: ["meta-llama/llama-3.1-8b-instruct", "meta-llama/llama-3.1-70b-instruct"],
};

export function resolvePlanKey(input) {
  const key = String(input || "").toLowerCase().trim();
  if (!key) return null;
  if (PLANS[key]) return key;
  
  // Resolve variants
  if (key === "growth_extra" || key === "growthextra") return "growth extra";
  if (key === "professional_plus" || key === "professionalplus") return "professional plus";
  if (key === "growth_plus" || key === "growthplus") return "growth plus";
  
  return null;
}

export function getPlanConfig(plan) {
  const key = resolvePlanKey(plan);
  return key ? { key, ...PLANS[key] } : null;
}

export function vendorFromModel(model = "") {
  const vendor = String(model || "").split("/")[0].toLowerCase();
  if (vendor === "anthropic") return "claude";
  if (vendor === "google") return "gemini";
  if (vendor === "meta-llama" || vendor === "llama" || vendor === "meta") return "llama";
  return vendor;
}

export function allowedModelsForPlan(planKey) {
  const cfg = PLANS[planKey];
  if (!cfg) return [];
  const out = [];
  for (const v of cfg.providersAllowed) out.push(...(DEFAULT_MODELS[v] || []));
  return out;
}
