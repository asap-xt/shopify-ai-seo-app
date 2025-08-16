// backend/plans.js
// Central plan configuration and helpers.

export const TRIAL_DAYS = 5;

export const PLANS = {
  starter: {
    name: "Starter",
    priceUsd: 10,
    queryLimit: 50,
    productLimit: 150,
    providersAllowed: ["deepseek", "llama"],
    autosyncCron: "0 0 */14 * *", // every 14 days
  },
  professional: {
    name: "Professional",
    priceUsd: 39,
    queryLimit: 600,
    productLimit: 300,
    providersAllowed: ["openai", "llama", "deepseek"],
    autosyncCron: "0 */48 * * *", // every 48 hours (minute 0)
  },
  growth: {
    name: "Growth",
    priceUsd: 59,
    queryLimit: 1500,
    productLimit: 1000,
    providersAllowed: ["claude", "openai", "gemini", "llama", "deepseek"].slice(0,3),
    autosyncCron: "0 */24 * * *", // every 24 hours
  },
  "growth extra": {
    name: "Growth Extra",
    priceUsd: 119,
    queryLimit: 4000,
    productLimit: 2000,
    providersAllowed: ["claude", "openai", "gemini", "llama", "deepseek"].slice(0,4),
    autosyncCron: "0 */12 * * *", // every 12 hours
  },
  enterprise: {
    name: "Enterprise",
    priceUsd: 299,
    queryLimit: 10000,
    productLimit: 10000,
    providersAllowed: ["claude", "openai", "gemini", "deepseek", "llama"],
    autosyncCron: "0 */2 * * *", // every 2 hours
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
  if (key === "growth_extra" || key === "growthextra") return "growth extra";
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
