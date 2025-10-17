// backend/controllers/seoController.js
// Routes: /seo/generate, /seo/apply (plans/me е премахнат - използваме GraphQL)
// Behavior: Do NOT generate if the product has no real translation for the requested language.

import express from 'express';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import mongoose from 'mongoose';
import Subscription from '../db/Subscription.js';
import Shop from '../db/Shop.js';
import TokenBalance from '../db/TokenBalance.js';
import { getPlanConfig, DEFAULT_MODELS, vendorFromModel, TRIAL_DAYS } from '../plans.js';
import { validateRequest } from '../middleware/shopifyAuth.js';
import { calculateFeatureCost, requiresTokens, isBlockedInTrial } from '../billing/tokenConfig.js';

const router = express.Router();

// Единствен източник на истината за отговора на "plans me"
export async function getPlansMeForShop(app, shop) {
  if (!shop) {
    throw new Error('Shop not provided');
  }

  // 1. First check Subscription (this is the truth)
  let subscription = await Subscription.findOne({ shop });
  console.log('[PLANS-DEBUG] Found subscription:', subscription ? {
    shop: subscription.shop,
    plan: subscription.plan,
    queryLimit: subscription.queryLimit,
    productLimit: subscription.productLimit
  } : 'No subscription found');
  
  // 2. If no subscription, create trial
  if (!subscription) {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord) {
      throw new Error('Shop not found');
    }
    
    // Create trial subscription
    subscription = await Subscription.create({
      shop,
      plan: 'starter', // trial plan - start with Starter
      queryLimit: 50,
      productLimit: 50,
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
    });
  }
  
  // 3. Get configuration
  let plan = subscription.plan;
  
  // Apply in-memory test override if any:
  try {
    const override = app?.locals?.planOverrides?.get?.(shop);
    if (override) {
      console.log(`[TEST] Using plan override: ${shop} -> ${override}`);
      plan = override;
    }
  } catch (e) {
    // no-op
  }
  
  const planConfig = getPlanConfig(plan);
  if (!planConfig) {
    throw new Error('Invalid plan');
  }
  
  // 4. Prepare response
  const modelsSuggested = [];
  for (const provider of planConfig.providersAllowed) {
    modelsSuggested.push(...(DEFAULT_MODELS[provider] || []));
  }
  
  const now = new Date();
  const trialEnd = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
  const isInTrial = trialEnd && now < trialEnd;
  
  return {
    // Shop info
    shop,
    
    // Plan info
    plan: planConfig.name,
    planKey: planConfig.key,
    priceUsd: planConfig.priceUsd,
    
    // Limits (from plan config, not subscription)
    product_limit: planConfig.productLimit,
    
    // Features
    providersAllowed: planConfig.providersAllowed,
    modelsSuggested,
    autosyncCron: planConfig.autosyncCron,
    
    // Trial info
    trial: isInTrial ? {
      active: true,
      ends_at: trialEnd,
      days_left: Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000))
    } : null
  };
}

/* --------------------------- Plan presets (unchanged) --------------------------- */
const PLAN_PRESETS = {
  starter: {
    plan: 'Starter',
    planKey: 'starter',
    queryLimit: 200,
    productLimit: 100,
    providersAllowed: ['openai', 'anthropic'],
    modelsSuggested: [
      'openai/gpt-4o-mini',
      'openai/o3-mini',
      'anthropic/claude-3.5-sonnet',
    ],
    autosync: '72h',
  },
  professional: {
    plan: 'Professional',
    planKey: 'professional',
    queryLimit: 700,
    productLimit: 350,
    providersAllowed: ['openai', 'anthropic', 'gemini'],
    modelsSuggested: [
      'google/gemini-1.5-flash',
      'openai/gpt-4o-mini',
      'anthropic/claude-3-haiku',
    ],
    autosync: '48h',
  },
  growth: {
    plan: 'Growth',
    planKey: 'growth',
    queryLimit: 2000,
    productLimit: 1000,
    providersAllowed: ['claude', 'openai', 'gemini'],
    modelsSuggested: [
      'google/gemini-1.5-flash',  // Cheapest
      'anthropic/claude-3-haiku',
      'openai/gpt-4o-mini',
      'openai/o3-mini',
      'google/gemini-1.5-pro',
    ],
    autosync: '24h',
  },
  growth_extra: {
    plan: 'Growth Extra',
    planKey: 'growth_extra',
    queryLimit: 5000,
    productLimit: 2500,
    providersAllowed: ['gemini', 'openai', 'claude'],
    modelsSuggested: [
      'google/gemini-1.5-flash',
      'google/gemini-1.5-pro',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
    ],
    autosync: '12h',
  },
  enterprise: {
    plan: 'Enterprise',
    planKey: 'enterprise',
    queryLimit: 12000,
    productLimit: 6000,
    providersAllowed: ['claude', 'openai', 'gemini', 'deepseek', 'llama'],
    modelsSuggested: [
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o',
      'google/gemini-1.5-pro',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.1-70b-instruct',
    ],
    autosync: '2h',
  },
};

function resolvePlanForShop(_shop) {
  const envKey = (process.env.APP_PLAN || '').toLowerCase();
  if (envKey && PLAN_PRESETS[envKey]) return PLAN_PRESETS[envKey];
  return PLAN_PRESETS.growth;
}

/* --------------------------- Admin API helpers --------------------------- */
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

function normalizeShop(shop) {
  if (!shop) return '';
  const s = String(shop).trim();
  if (!s) return '';
  if (/^https?:\/\//.test(s)) {
    const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return u.toLowerCase();
  }
  if (!/\.myshopify\.com$/i.test(s)) return `${s.toLowerCase()}.myshopify.com`;
  return s.toLowerCase();
}

function requireShop(req) {
  const shop = req.shopDomain || normalizeShop(req.query.shop || req.body?.shop || req.headers['x-shop']);
  if (!shop) {
    const err = new Error('Missing ?shop');
    err.status = 400;
    throw err;
  }
  return shop;
}

// Import centralized token resolver
import { resolveShopToken, resolveAdminToken } from '../utils/tokenResolver.js';
import { updateOptimizationSummary } from '../utils/optimizationSummary.js';

// Resolve Admin token using centralized function
async function resolveAdminTokenForShop(shop, req = null) {
  console.log('=== TOKEN RESOLVER DEBUG ===');
  console.log('1. Looking for shop:', shop);
  
  try {
    // Try to get idToken from request if available
    let idToken = null;
    if (req) {
      console.log('=== ID TOKEN EXTRACTION DEBUG ===');
      console.log('req.headers:', Object.keys(req.headers));
      console.log('req.headers.authorization:', req.headers['authorization'] ? 'Present' : 'Missing');
      console.log('req.headers.Authorization:', req.headers['Authorization'] ? 'Present' : 'Missing');
      console.log('req.query.id_token:', req.query.id_token ? 'Present' : 'Missing');
      console.log('req.body?.id_token:', req.body?.id_token ? 'Present' : 'Missing');
      
      idToken = req.headers['authorization']?.replace('Bearer ', '') || 
                req.headers['Authorization']?.replace('Bearer ', '') ||
                req.query.id_token ||
                req.body?.id_token;
      
      console.log('Extracted idToken:', idToken ? 'Present' : 'Missing');
    }
    
    const token = await resolveShopToken(shop, { idToken, requested: 'offline' });
    console.log('2. Token resolved successfully');
    console.log('3. Token type:', typeof token);
    console.log('4. Token starts with shpat_:', token?.startsWith('shpat_'));
    return token;
  } catch (err) {
    console.error('5. Token resolution failed:', err.message);
    throw new Error(`No Admin API token available for shop ${shop}: ${err.message}`);
  }
}

async function shopGraphQL(req, shop, query, variables = {}) {
  console.log('[GRAPHQL] Shop:', shop);
  console.log('[GRAPHQL] Query:', query.substring(0, 100) + '...');
  console.log('[GRAPHQL] Variables:', JSON.stringify(variables, null, 2));
  
  const token = await resolveAdminToken(req, shop);
  console.log('[GRAPHQL] Token resolved:', token ? 'Yes' : 'No');
  
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  console.log('[GRAPHQL] URL:', url);
  
  const rsp = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  
  const json = await rsp.json().catch(() => ({}));
  
  if (!rsp.ok || json.errors) {
    console.error('[GRAPHQL] Error - Status:', rsp.status, 'Errors:', json.errors || json);
    const e = new Error(`Admin GraphQL error: ${JSON.stringify(json.errors || json)}`);
    e.status = rsp.status || 500;
    throw e;
  }
  
  // Collect nested userErrors
  const userErrors = [];
  (function collect(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(collect);
    if (node.userErrors && node.userErrors.length) userErrors.push(...node.userErrors);
    Object.values(node).forEach(collect);
  })(json.data);
  
  if (userErrors.length) {
    console.error('[GRAPHQL] User errors found:', userErrors);
    const e = new Error(`Admin GraphQL userErrors: ${JSON.stringify(userErrors)}`);
    e.status = 400;
    throw e;
  }
  
  console.log('[GRAPHQL] Success, returning data');
  return json.data;
}

/* --------------------------- OpenRouter (AI) --------------------------- */
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

async function openrouterChat(model, messages, response_format_json = true) {
  console.log('🔴 [AI CALL] Starting AI request with model:', model);
  console.log('🔴 [AI CALL] Messages being sent:', JSON.stringify(messages, null, 2));
  
  // TEMPORARY CLAUDE BLOCK - remove if you want to use Claude
  if (model.includes('claude')) {
    console.error('🚫 BLOCKED: Claude model calls are disabled');
    throw new Error('Claude models are temporarily disabled to save costs');
  }
  
  if (!OPENROUTER_API_KEY) {
    const err = new Error('OpenRouter API key missing');
    err.status = 500;
    throw err;
  }
  const rsp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: response_format_json ? { type: 'json_object' } : undefined,
      messages,
      temperature: 0.4,
    }),
  });
  if (!rsp.ok) {
    const text = await rsp.text().catch(() => '');
    const e = new Error(`OpenRouter ${rsp.status}: ${text || rsp.statusText}`);
    e.status = rsp.status || 500;
    throw e;
  }
  const j = await rsp.json();
  const content =
    j?.choices?.[0]?.message?.content ||
    j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
    '';
  
  console.log('🔴 [AI RESPONSE] Received from AI:', content);
  console.log('🔴 [AI USAGE] Tokens used:', j?.usage);
  
  return { content, usage: j?.usage || {} };
}

/* --------------------------- Metafield Definition Helper --------------------------- */
async function ensureMetafieldDefinition(req, shop, language) {
  const key = `seo__${language}`;
  console.log(`[PRODUCT METAFIELDS] ===== STARTING DEFINITION CREATION =====`);
  console.log(`[PRODUCT METAFIELDS] Creating definition for language: ${language}, key: ${key}`);
  console.log(`[PRODUCT METAFIELDS] Shop: ${shop}`);
  
  // Simpler approach - create directly without checking
  const createMutation = `
    mutation {
      metafieldDefinitionCreate(definition: {
        namespace: "seo_ai"
        key: "${key}"
        name: "AI SEO - ${language.toUpperCase()}"
        type: "json"
        ownerType: PRODUCT
        description: "AI-generated SEO content for ${language.toUpperCase()} language"
        pin: true
      }) {
        createdDefinition {
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
  
  try {
    const result = await shopGraphQL(req, shop, createMutation, {});
    
    if (result?.metafieldDefinitionCreate?.userErrors?.length > 0) {
      const errors = result.metafieldDefinitionCreate.userErrors;
      // If error is "already exists", that's OK
      if (errors.some(e => e.message.includes('already exists') || e.message.includes('taken'))) {
        console.log(`[PRODUCT METAFIELDS] Definition already exists for ${key} - OK`);
        return { exists: true };
      }
      console.error(`[PRODUCT METAFIELDS] Errors:`, errors);
      return { errors };
    }
    
    if (result?.metafieldDefinitionCreate?.createdDefinition) {
      console.log(`[PRODUCT METAFIELDS] Created successfully:`, result.metafieldDefinitionCreate.createdDefinition);
      return { created: true };
    }
  } catch (e) {
    console.error(`[PRODUCT METAFIELDS] Exception:`, e.message);
    // Continue - metafield will still work
  }
  
  console.log(`[PRODUCT METAFIELDS] ===== DEFINITION CREATION COMPLETE =====`);
  return { attempted: true };
}

/* --------------------------- Product Metafield Helper --------------------------- */
// Delete product metafield by key
async function deleteProductMetafield(req, shop, productId, key) {
  try {
    const deleteMutation = `
      mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields {
            key
            namespace
            ownerId
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
        ownerId: productId,
        namespace: 'seo_ai',    
        key: key
      }]
    };
    
    const result = await shopGraphQL(req, shop, deleteMutation, variables);
    
    if (result?.metafieldsDelete?.userErrors?.length > 0) {
      const errorMessages = result.metafieldsDelete.userErrors.map(e => e.message);
      console.log(`[DELETE-PRODUCT-METAFIELD] Delete errors for ${key}:`, errorMessages);
      throw new Error(`Delete failed: ${errorMessages.join(', ')}`);
    }
    
    console.log(`[DELETE-PRODUCT-METAFIELD] Successfully deleted metafield ${key}`);
    return true;
  } catch (e) {
    console.error(`[DELETE-PRODUCT-METAFIELD] Error deleting ${key}:`, e.message);
    throw e;
  }
}

/* --------------------------- Collection Metafield Definition Helper --------------------------- */
// Delete collection metafield by key
async function deleteCollectionMetafield(req, shop, collectionId, key) {
  try {
    const deleteMutation = `
      mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields {
            key
            namespace
            ownerId
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
        ownerId: collectionId,
        namespace: 'seo_ai',    
        key: key
      }]
    };
    
    const result = await shopGraphQL(req, shop, deleteMutation, variables);
    
    if (result?.metafieldsDelete?.userErrors?.length > 0) {
      const errorMessages = result.metafieldsDelete.userErrors.map(e => e.message);
      console.log(`[DELETE-COLLECTION-METAFIELD] Delete errors for ${key}:`, errorMessages);
      throw new Error(`Delete failed: ${errorMessages.join(', ')}`);
    }
    
    console.log(`[DELETE-COLLECTION-METAFIELD] Successfully deleted metafield ${key}`);
    return true;
  } catch (e) {
    console.error(`[DELETE-COLLECTION-METAFIELD] Error deleting ${key}:`, e.message);
    throw e;
  }
}

// Get existing metafield definition ID
async function getMetafieldDefinitionId(req, shop, key) {
  try {
    const query = `
      query GetMetafieldDefinition($namespace: String!, $key: String!) {
        metafieldDefinitions(namespace: $namespace, key: $key, first: 1) {
          edges {
            node {
              id
              namespace
              key
            }
          }
        }
      }
    `;
    
    const result = await shopGraphQL(req, shop, query, { namespace: 'seo_ai', key });
    const definition = result?.metafieldDefinitions?.edges?.[0]?.node;
    return definition?.id || null;
  } catch (e) {
    console.error(`[COLLECTION METAFIELDS] Error getting definition ID for ${key}:`, e.message);
    return null;
  }
}

// Creates metafield definitions for Collections
async function ensureCollectionMetafieldDefinitions(req, shop, languages) {
  console.log('[COLLECTION METAFIELDS] ===== STARTING DEFINITION CREATION =====');
  console.log('[COLLECTION METAFIELDS] Creating definitions for languages:', languages);
  console.log('[COLLECTION METAFIELDS] Shop:', shop);
  
  const results = [];
  
  for (const lang of languages) {
    const key = `seo__${lang.toLowerCase()}`; // ALWAYS lowercase
    console.log(`[COLLECTION METAFIELDS] Processing language: ${lang}, key: ${key}`);
    
    const createMutation = `
      mutation {
        metafieldDefinitionCreate(definition: {
          namespace: "seo_ai"
          key: "${key}"
          name: "AI SEO - ${lang.toUpperCase()}"
          type: "json"
          ownerType: COLLECTION
          description: "AI-generated SEO content for ${lang.toUpperCase()} language"
          pin: true
        }) {
          createdDefinition {
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
    
    try {
      const result = await shopGraphQL(req, shop, createMutation, {});
      
      if (result?.metafieldDefinitionCreate?.userErrors?.length > 0) {
        const errors = result.metafieldDefinitionCreate.userErrors;
        if (errors.some(e => e.message.includes('already exists') || e.message.includes('taken'))) {
          console.log(`[COLLECTION METAFIELDS] Definition already exists for ${key} - OK`);
          // Try to get existing definition ID
          const existingDefinition = await getMetafieldDefinitionId(req, shop, key);
          results.push({ lang, status: 'exists', definitionId: existingDefinition });
        } else {
          console.error(`[COLLECTION METAFIELDS] Errors for ${key}:`, errors);
          results.push({ lang, status: 'error', errors });
        }
      } else if (result?.metafieldDefinitionCreate?.createdDefinition) {
        console.log(`[COLLECTION METAFIELDS] Created successfully:`, result.metafieldDefinitionCreate.createdDefinition);
        results.push({ lang, status: 'created', definitionId: result.metafieldDefinitionCreate.createdDefinition.id });
      }
    } catch (e) {
      console.error(`[COLLECTION METAFIELDS] Exception for ${key}:`, e.message);
      results.push({ lang, status: 'error', error: e.message });
    }
  }
  
  console.log('[COLLECTION METAFIELDS] ===== DEFINITION CREATION COMPLETE =====');
  console.log('[COLLECTION METAFIELDS] Final results:', results);
  return results;
}

/* --------------------------- Product JSON-LD Generator --------------------------- */
function generateProductJsonLd(product, seoData, language) {
  console.log('🟢 [JSON-LD] Generating locally (NOT via AI) for language:', language);
  console.log('🟢 [JSON-LD] Product data:', JSON.stringify(product, null, 2));
  console.log('🟢 [JSON-LD] SEO data:', JSON.stringify(seoData, null, 2));
  
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": seoData.title || product.title,
    "description": seoData.metaDescription || "",
    "image": product.images?.edges?.map(e => e.node.url).filter(Boolean) || [],
    "brand": {
      "@type": "Brand",
      "name": product.vendor || "Unknown"
    },
    "offers": {
      "@type": "Offer",
      "price": product.priceRangeV2?.minVariantPrice?.amount || "0",
      "priceCurrency": product.priceRangeV2?.minVariantPrice?.currencyCode || "USD",
      "availability": "https://schema.org/InStock",
      "priceValidUntil": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    }
  };
  
  // URL added if exists
  if (product.onlineStoreUrl) {
    jsonLd.url = product.onlineStoreUrl;
  }
  
  // SKU added if exists
  if (product.variants?.edges?.[0]?.node?.sku) {
    jsonLd.sku = product.variants.edges[0].node.sku;
  }
  
  // For various languages we could add inLanguage
  if (language && language !== 'en') {
    jsonLd.inLanguage = language;
  }
  
  console.log('🟢 [JSON-LD] Generated:', JSON.stringify(jsonLd, null, 2));
  return jsonLd;
}

/* --------------------------- JSON schema (ANY language) --------------------------- */
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const seoSchema = {
  type: 'object',
  required: ['productId', 'provider', 'model', 'language', 'seo', 'quality'],
  additionalProperties: true,
  properties: {
    productId: { type: 'string', pattern: '^gid://shopify/Product/\\d+$' },
    provider: { type: 'string', minLength: 1 },
    model: { type: 'string', minLength: 1 },
    language: { type: 'string', minLength: 1, maxLength: 32 }, // no enum
    seo: {
      type: 'object',
      required: ['title', 'metaDescription', 'slug', 'bodyHtml'], // Validation requires these fields
      additionalProperties: true,
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        metaDescription: { type: 'string', minLength: 1, maxLength: 400 },
        slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        bodyHtml: { type: 'string', minLength: 1 },
        bullets: {
          type: 'array',
          minItems: 2,
          maxItems: 10,
          items: { type: 'string', minLength: 2, maxLength: 160 },
        },
        faq: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['q', 'a'],
            properties: {
              q: { type: 'string', minLength: 3, maxLength: 160 },
              a: { type: 'string', minLength: 3, maxLength: 400 },
            },
          },
        },
        imageAlt: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['imageId', 'alt'],
            properties: {
              imageId: { type: 'string', pattern: '^gid://shopify/ProductImage/\\d+$' },
              alt: { type: 'string', minLength: 1, maxLength: 125 },
            },
          },
        },
        // REMOVED jsonLd property definition
      },
    },
    quality: {
      type: 'object',
      required: ['warnings', 'model', 'tokens', 'costUsd'],
      additionalProperties: true,
      properties: {
        warnings: { type: 'array', items: { type: 'string' } },
        model: { type: 'string' },
        tokens: { type: 'integer' },
        costUsd: { type: ['number', 'integer'] },
      },
    },
  },
};
const validateSeo = ajv.compile(seoSchema);

/* --------------------------- Fixups --------------------------- */
const TITLE_LIMIT = 70;
const META_MIN = 20;
const META_TARGET = 180;
const META_MAX = 200;

function kebab(str = '') {
  return String(str)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '') // ASCII only
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
function sanitizeHtmlSafe(html = '') {
  return String(html || '').replace(/<\/?(script|style|iframe)[^>]*>/gi, '');
}
function clamp(s = '', max) {
  const x = String(s || '');
  if (x.length <= max) return x;
  return x.slice(0, max - 1).trimEnd() + '…';
}
function gidTail(gid = '') {
  const m = String(gid || '').match(/\/(\d+)$/);
  return m ? m[1] : '0';
}
function canonLang(locale) {
  const L = String(locale || 'en').toLowerCase();
  return L.split(/[_-]/)[0] || 'en';
}

/* --------------------------- Locales & translations --------------------------- */

// 1) Published shop locales (e.g. ["en-US","bg-BG"]), filtered to published only.
async function getShopPublishedLocales(req, shop) {
  const Q = `query { shopLocales { locale published } }`;
  const d = await shopGraphQL(req, shop, Q);
  const list = (d?.shopLocales || [])
    .filter(l => l && l.published)
    .map(l => String(l.locale));
  return Array.from(new Set(list));
}

// 2) Does the product have real translated content for given locale?
async function hasProductTranslation(req, shop, productId, locale) {
  const Q = `
    query($id: ID!, $locale: String!) {
      product(id: $id) {
        id
        translations(locale: $locale) {
          key
          value
        }
      }
    }
  `;
  const d = await shopGraphQL(req, shop, Q, { id: productId, locale });
  const arr = d?.product?.translations || [];
  const keys = new Set(['title','body_html','seo_title','seo_description']);
  return arr.some(t => keys.has(t.key) && typeof t.value === 'string' && t.value.trim().length > 0);
}

// 3) Fetch localized product fields (title/body/seo_*) for a locale
async function getProductLocalizedContent(req, shop, productId, localeInput) {
  const locale = String(localeInput || 'en');
  const Q = `
    query($id: ID!, $locale: String!) {
      product(id: $id) {
        id
        translations(locale: $locale) {
          key
          value
        }
      }
    }
  `;
  const data = await shopGraphQL(req, shop, Q, { id: productId, locale });
  const map = {};
  for (const t of (data?.product?.translations || [])) {
    if (t?.key) map[t.key] = t.value || '';
  }
  const title = (map['title'] || '').trim();
  const bodyHtml = (map['body_html'] || '').trim();
  const seoTitle = (map['seo_title'] || '').trim();
  const seoDescription = (map['seo_description'] || '').trim();

  const hasAny = !!title || !!bodyHtml || !!seoTitle || !!seoDescription;
  return { locale, title, bodyHtml, seoTitle, seoDescription, hasAny };
}

/* --------------------------- Fixup & validate --------------------------- */
function fixupAndValidate(payload) {
  const p = { ...(payload || {}) };
  if (!p.seo) p.seo = {};

  // language → lowercase
  if (p.language) p.language = String(p.language).toLowerCase();

  // title
  if (p.seo.title) p.seo.title = clamp(p.seo.title.trim(), TITLE_LIMIT);

  // bodyHtml sanitize + minimal safe fallback
  if (p.seo.bodyHtml) {
    p.seo.bodyHtml = sanitizeHtmlSafe(p.seo.bodyHtml);
  }
  // If bodyHtml is missing or empty, use title as minimal fallback
  // This is ONLY for metafield storage, NOT for updating product fields
  if (!p.seo.bodyHtml || String(p.seo.bodyHtml).trim().length === 0) {
    if (p.seo.title) {
      p.seo.bodyHtml = `<p>${clamp(p.seo.title, 120)}</p>`;
    }
  }

  // metaDescription clamp + minimal safe fallback
  if (p.seo.metaDescription) {
    let md = p.seo.metaDescription.trim();
    md = clamp(md, META_MAX);
    if (md.length < META_MIN && p.seo.bodyHtml) {
      const plain = String(p.seo.bodyHtml).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      md = clamp(`${md} ${plain}`.trim(), META_MAX);
    }
    p.seo.metaDescription = md;
  } else if (p.seo.bodyHtml) {
    // Extract from bodyHtml if metaDescription is missing
    const plain = String(p.seo.bodyHtml).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    p.seo.metaDescription = clamp(plain || p.seo.title || '', META_MAX);
  } else if (p.seo.title) {
    // Last resort: use title
    p.seo.metaDescription = clamp(p.seo.title, META_MAX);
  }

  // slug normalize; ensure pattern-safe
  if (p.seo.slug) {
    p.seo.slug = kebab(p.seo.slug);
  } else if (p.seo.title) {
    // Only generate slug from title if title exists
    const base = kebab(p.seo.title) || gidTail(p.productId);
    p.seo.slug = `${base}-${gidTail(p.productId)}`.replace(/-+$/, '');
  }
  // Validate slug pattern
  if (p.seo.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.seo.slug)) {
    p.seo.slug = gidTail(p.productId); // Use product ID as fallback
  }

  // bullets - preserve AI-generated bullets if they exist
  if (Array.isArray(p.seo.bullets) && p.seo.bullets.length > 0) {
    // Just clean them, don't replace with defaults
    p.seo.bullets = p.seo.bullets
      .map((s) => String(s || '').trim())
      .filter((s) => s.length >= 2)
      .slice(0, 10)
      .map((s) => s.slice(0, 160));
  } else {
    // Only add defaults if no bullets provided
    p.seo.bullets = ['Great value', 'Quality product'];
  }

  // faq - preserve AI-generated FAQ
  if (Array.isArray(p.seo.faq) && p.seo.faq.length > 0) {
    p.seo.faq = p.seo.faq
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({
        q: clamp(String(x.q || '').trim(), 160),
        a: clamp(String(x.a || '').trim(), 400),
      }))
      .filter((x) => x.q.length >= 3 && x.a.length >= 3)
      .slice(0, 10);
  }
  // Don't add default FAQ if none provided

  // REMOVED jsonLd fixup/validation code

  // Debug what's being validated
  console.log('🔍 [FIXUP] Final bullets:', p.seo.bullets);
  console.log('🔍 [FIXUP] Final FAQ:', p.seo.faq);

  const ok = validateSeo(p);
  if (!ok) {
    console.log('🔍 [VALIDATION] Schema validation failed:', validateSeo.errors);
    console.log('🔍 [VALIDATION] Payload being validated:', JSON.stringify(p, null, 2));
  }
  return { ok, value: p, issues: ok ? [] : (validateSeo.errors || []).map((e) => `${e.instancePath} ${e.message}`) };
}

/* --------------------------- Routes --------------------------- */

// Plans endpoint е премахнат - използваме GraphQL версията в server.js

router.post('/seo/generate', validateRequest(), async (req, res) => {
  console.log('[SEO/HANDLER]', req.method, req.originalUrl, {
    queryShop: req.query?.shop,
    bodyShop: req.body?.shop,
    sessionShop: res.locals?.shopify?.session?.shop,
  });

  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[SEO/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  // Тук логни и от къде четеш Admin API токена:
  const tokenSource = 'db|kv|session'; // актуализирай според твоя сторидж
  console.log('[SEO/HANDLER] Resolving Admin token', { shop, tokenSource });

  try {
    console.log('[SEO/GENERATE] req.shopDomain:', req.shopDomain);
    console.log('[SEO/GENERATE] req.body:', req.body);
    const shop = req.shopDomain;
    const { productId, model, language = 'en', enhanced = false } = req.body || {};
    if (!productId || !model) {
      return res.status(400).json({ error: 'Missing required fields: shop, model, productId' });
    }

    // === GET SUBSCRIPTION AND PLAN ===
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || 'starter';
    const planConfig = getPlanConfig(planKey);
    const languageLimit = planConfig?.languageLimit || 1;
    
    // === LANGUAGE LIMIT CHECK ===
    const isAll = String(language || '').toLowerCase() === 'all';
    let languageCount = 1;
    let validLangs = [language];
    
    if (isAll) {
      // Get published shop locales to count languages
      const shopLocales = await getShopPublishedLocales(req, shop);
      validLangs = [];
      for (const loc of shopLocales) {
        if (await hasProductTranslation(req, shop, productId, loc)) {
          const short = canonLang(loc);
          if (!validLangs.includes(short)) validLangs.push(short);
        }
      }
      languageCount = validLangs.length || 1;
      
      // Check if language count exceeds plan limit
      if (languageCount > languageLimit) {
        return res.status(403).json({
          error: `Your plan supports up to ${languageLimit} language(s)`,
          currentPlan: planKey,
          languageLimit: languageLimit,
          requestedLanguages: languageCount,
          message: `Upgrade your plan to optimize ${languageCount} languages. Your ${planConfig.name} plan supports ${languageLimit} language(s).`
        });
      }
    }
    
    // === TOKEN CHECKING ===
    // Determine feature type
    const feature = enhanced ? 'ai-seo-product-enhanced' : 'ai-seo-product-basic';
    
    // Check if feature requires tokens (basic SEO does NOT require tokens)
    if (requiresTokens(feature)) {
      // Check trial status
      const now = new Date();
      const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
      
      const requiredTokens = calculateFeatureCost(feature, { languages: languageCount });
      
      // Check token balance
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      // If in trial AND insufficient tokens → Block with trial activation modal
      if (inTrial && isBlockedInTrial(feature) && !tokenBalance.hasBalance(requiredTokens)) {
        return res.status(402).json({
          error: 'Feature not available during trial without tokens',
          trialRestriction: true,
          requiresActivation: true,
          trialEndsAt: subscription.trialEndsAt,
          currentPlan: subscription.plan,
          feature,
          tokensRequired: requiredTokens,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: requiredTokens - tokenBalance.balance,
          message: 'This AI-enhanced feature requires plan activation or token purchase'
        });
      }
      
      // If sufficient tokens → Allow (even in trial, if tokens were purchased)
      if (!tokenBalance.hasBalance(requiredTokens)) {
        return res.status(402).json({
          error: 'Insufficient token balance',
          requiresPurchase: true,
          tokensRequired: requiredTokens,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: requiredTokens - tokenBalance.balance,
          feature,
          message: 'You need more tokens to use this feature'
        });
      }
      
      // Deduct tokens immediately (will be rolled back if generation fails)
      await tokenBalance.deductTokens(requiredTokens, feature, { productId });
      console.log(`[SEO/GENERATE] Deducted ${requiredTokens} tokens for ${feature}, remaining: ${tokenBalance.balance}`);
    }
    // === END TOKEN CHECKING ===

    // isAll and validLangs were already defined in language limit check above
    if (isAll) {
      // 1) Get published shop locales
      const shopLocales = await getShopPublishedLocales(req, shop);
      // 2) Keep only those with real product translations
      const langs = [];
      for (const loc of shopLocales) {
        if (await hasProductTranslation(req, shop, productId, loc)) {
          const short = canonLang(loc);
          if (!langs.includes(short)) langs.push(short); // dedupe
        }
      }

      const results = [];
      for (const lang of langs) {
        try {
          const result = await generateSEOForLanguage(req, shop, productId, model, lang);
          results.push(result);
        } catch (error) {
          results.push({
            productId,
            provider: 'openrouter',
            model,
            language: canonLang(lang),
            error: error.message,
            issues: error.issues || undefined,
            seo: null,
            quality: { warnings: [error.message], model, tokens: 0, costUsd: 0 }
          });
        }
      }
      return res.json({ language: 'all', productId, results });
    }

// Single language - check if we need translation
const langNorm = canonLang(language);

// Get shop's primary language
const Q_SHOP_LOCALES = `
  query ShopLocales {
    shopLocales { locale primary published }
  }
`;
const shopData = await shopGraphQL(req, shop, Q_SHOP_LOCALES, {});
const primaryLang = (shopData?.shopLocales || []).find(l => l?.primary)?.locale?.toLowerCase() || 'en';
const isPrimary = langNorm.toLowerCase() === primaryLang.toLowerCase();

// Only check for translations if NOT primary language
if (!isPrimary) {
  const hasLoc = await hasProductTranslation(req, shop, productId, language);
  if (!hasLoc) {
    return res.status(400).json({
      error: 'Product is not translated to the requested language',
      language: langNorm
    });
  }
}

const result = await generateSEOForLanguage(req, shop, productId, model, language);
return res.json(result);

  } catch (e) {
    const payload = { error: e.message || String(e) };
    if (e.issues) payload.issues = e.issues;
    res.status(e.status || 500).json(payload);
  }
});

function extractBulletsFromHtml(html) {
  const bullets = [];
  // Извлечи от <li> елементи
  const liRegex = /<li[^>]*>(.*?)<\/li>/gi;
  let match;
  while ((match = liRegex.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text && text.length > 10) {
      bullets.push(text.slice(0, 160));
    }
  }
  
  // Ако няма достатъчно, извлечи от параграфи
  if (bullets.length < 2) {
    const pRegex = /<p[^>]*>(.*?)<\/p>/gi;
    while ((match = pRegex.exec(html)) !== null && bullets.length < 5) {
      const text = match[1].replace(/<[^>]+>/g, '').trim();
      if (text && text.length > 20 && !bullets.includes(text)) {
        bullets.push(text.slice(0, 160));
      }
    }
  }
  
  return bullets;
}

async function generateSEOForLanguage(req, shop, productId, model, language) {
  console.log('🟡 [GENERATE] Starting generation for language:', language, 'model:', model);
  console.log('🚀 [LOCAL MODE] Using product data directly - NO AI costs!');
  
  const langNormalized = canonLang(language);
  
  // Get shop's primary language
  const Q_SHOP_LOCALES = `
    query ShopLocales {
      shopLocales { locale primary published }
    }
  `;
  const shopData = await shopGraphQL(req, shop, Q_SHOP_LOCALES, {});
  const primaryLang = (shopData?.shopLocales || []).find(l => l?.primary)?.locale?.toLowerCase() || 'en';
  const isPrimary = langNormalized.toLowerCase() === primaryLang.toLowerCase();

  // Get base product
  const Q = `
    query GetProduct($id: ID!) {
      product(id: $id) {
        id title handle descriptionHtml productType vendor tags
        seo { title description }
        images(first: 10) {
          edges { node { id altText url } }
        }
        priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        variants(first: 1) {
          edges { node { sku } }
        }
        onlineStoreUrl
      }
    }
  `;
  const pd = await shopGraphQL(req, shop, Q, { id: productId });
  const p = pd?.product;
  if (!p) {
    const e = new Error('Product not found');
    e.status = 404;
    throw e;
  }

  let localizedTitle, localizedBody;
  let seoTitle = '';
  let seoDescription = '';

  if (isPrimary) {
    // For primary language, use base product data
    localizedTitle = p.title;
    localizedBody = p.descriptionHtml;
    seoTitle = p.seo?.title || '';
    seoDescription = p.seo?.description || '';
  } else {
    // For other languages, require translations
    const loc = await getProductLocalizedContent(req, shop, productId, language);
    if (!loc?.hasAny) {
      const e = new Error('No translated content for requested language');
      e.status = 400;
      throw e;
    }
    localizedTitle = loc.title || p.title;
    localizedBody = loc.bodyHtml || p.descriptionHtml;
    seoTitle = loc.seoTitle || '';
    seoDescription = loc.seoDescription || '';
  }

  /* COMMENTED AI CODE - can be enabled in the future for enhanced SEO
  const ctx = {
    id: p.id,
    title: localizedTitle,
    descriptionHtml: localizedBody,
    vendor: p.vendor,
    productType: p.productType,
    tags: p.tags,
    handle: p.handle,
    price: p?.priceRangeV2?.minVariantPrice?.amount || null,
    currency: p?.priceRangeV2?.minVariantPrice?.currencyCode || null,
    images: (p.images?.edges || []).map(e => ({ id: e.node.id, altText: e.node.altText || null })),
    language: langNormalized,
  };

  const messages = strictPrompt(ctx, langNormalized);
  console.log('🟡 [PROMPT] Sending to AI:', JSON.stringify(messages, null, 2));
  
  const { content } = await openrouterChat(model, messages, true);

  let candidate;
  try { 
    candidate = JSON.parse(content);
    console.log('🟡 [AI PARSED] AI returned:', JSON.stringify(candidate, null, 2));
  }
  catch { throw new Error('Model did not return valid JSON'); }
  */

  // LOCAL SEO DATA GENERATION
  console.log('💰 [ZERO COST] Generating SEO data locally from product data');
  
  // Generate meta description from body or title
  let metaDescription = seoDescription;
  if (!metaDescription && localizedBody) {
    metaDescription = localizedBody
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, META_TARGET);
  }
  if (!metaDescription) {
    metaDescription = localizedTitle || 'Quality product from our store';
  }

  // Extract bullets from HTML content using improved function
  const extractedBullets = extractBulletsFromHtml(localizedBody);
  const bullets = extractedBullets.length >= 2 
    ? extractedBullets.slice(0, 5)
    : [
        `${localizedTitle} - висококачествен продукт`,
        `Перфектен избор за вашите нужди`
      ];

  // Create simple FAQ with localized data
  const simpleFaq = [];
  if (localizedTitle && metaDescription) {
    simpleFaq.push({
      q: localizedTitle,
      a: metaDescription
    });
  }

  // Debug logs
  console.log('🔍 [DEBUG] Extracted bullets:', extractedBullets);
  console.log('🔍 [DEBUG] Final bullets:', bullets);
  console.log('🔍 [DEBUG] Simple FAQ:', simpleFaq);
  console.log('🔍 [DEBUG] Localized title:', localizedTitle);
  console.log('🔍 [DEBUG] Meta description:', metaDescription);

  const localSeoData = {
    title: seoTitle || localizedTitle || 'Product',
    metaDescription: metaDescription,
    slug: kebab(localizedTitle || p.handle || 'product'),
    bodyHtml: localizedBody || `<p>${localizedTitle}</p>`,
    bullets: bullets,
    faq: simpleFaq,
    imageAlt: []
  };

  const fixed = {
    productId: p.id,
    provider: 'local',
    model: 'none',
    language: langNormalized,
    seo: {
      ...localSeoData,
      jsonLd: generateProductJsonLd(p, localSeoData, langNormalized),
    },
    quality: {
      warnings: [],
      model: 'none',
      tokens: 0,
      costUsd: 0,
    },
  };

  const { ok, value, issues } = fixupAndValidate(fixed);
  if (!ok) {
    const e = new Error('Schema validation failed');
    e.status = 400;
    e.issues = issues;
    throw e;
  }
  
  console.log('✅ [SUCCESS] SEO data generated locally with ZERO AI costs!');
  return value;
}

function strictPrompt(ctx, language) {
  return [
    {
      role: 'system',
      content:
        `You are an SEO assistant for Shopify products. Output STRICT JSON only.\n` +
        `Language: ${language}\n` +
        `Use ONLY the localized fields provided (title/bodyHtml) and do not invent translations.\n` +
        `IMPORTANT: Do NOT generate jsonLd field - it will be generated separately.\n` + // EXPLICIT INSTRUCTION
        `Constraints:\n` +
        `- title <= ${TITLE_LIMIT} chars\n` +
        `- metaDescription ~${META_TARGET} (cap ${META_MAX})\n` +
        `- bullets: array of short benefits (<=160 chars each, min 2)\n` +
        `- faq: array (min 1) of { q, a }\n` +
        `- bodyHtml: clean HTML, no script/iframe/style\n` +
        `- slug: kebab-case\n` +
        `DO NOT include jsonLd in your response!`,  // DOUBLE EMPHASIS
    },
    { role: 'user', content: JSON.stringify(ctx) },
  ];
}

async function applySEOForLanguage(req, shop, productId, seo, language, options = {}) {
  console.log('[APPLY-SEO] Starting apply for language:', language, 'productId:', productId);

  // Get language from body (required now)
  if (!language) {
    throw new Error("Missing 'language' for apply");
  }

  try {
    // Validate and get shop locales
    const Q_SHOP_LOCALES = `
      query ShopLocales {
        shopLocales { locale primary published }
      }
    `;
    const shopData = await shopGraphQL(req, shop, Q_SHOP_LOCALES, {});
    const primary = (shopData?.shopLocales || []).find(l => l?.primary)?.locale?.toLowerCase() || 'en';
    const isPrimary = language.toLowerCase() === primary.toLowerCase();

    // 🚨 IMPORTANT: We ONLY update metafields, NEVER product base fields!
    // Product title, description, and Shopify SEO fields remain untouched.
    // Only our custom metafields (seo_ai namespace) are updated for AI bots.
    
    const updateAlt = options?.updateAlt === true;
    const dryRun = options?.dryRun === true;

    console.log(`[SEO-APPLY] Language: ${language}, isPrimary: ${isPrimary}`);
    console.log(`[SEO-APPLY] Will update ONLY metafields (no product base fields)`);

    const updated = { seoMetafield: false, imageAlt: false };
    const errors = [];

    // Validate/normalize - change provider to 'local'
    const fixed = fixupAndValidate({
      productId,
      provider: 'local',    // Changed from 'openrouter'
      model: 'none',        // Changed from 'apply'
      language: canonLang(language),
      seo,
      quality: { warnings: [], model: 'none', tokens: 0, costUsd: 0 },
    });
    if (!fixed.ok) {
      return res.status(400).json({ ok: false, error: 'Schema validation failed', issues: fixed.issues });
    }
    const v = fixed.value.seo;

    if (!dryRun) {
      // 🚨 SKIP: We do NOT update product base fields (title, description, seo)
      // Product data remains unchanged - we only update metafields below

      // 1. Ensure metafield definition exists
      await ensureMetafieldDefinition(req, shop, language.toLowerCase());

      // 2. Delete any existing metafield with this key first
      const mfKey = `seo__${language.toLowerCase()}`;
      try {
        console.log(`[APPLY-SEO] Deleting existing metafield ${mfKey} for ${productId}`);
        await deleteProductMetafield(req, shop, productId, mfKey);
      } catch (e) {
        console.log(`[APPLY-SEO] No existing metafield to delete for ${mfKey}:`, e.message);
      }

      // 3. Always write language-specific metafield with full SEO data
      const metaMutation = `
        mutation SetAiSeo($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
            metafields { id }
          }
        }
      `;
      const metafieldData = {
        ...v,
        language: language.toLowerCase(),
        updatedAt: new Date().toISOString()
      };
      
      const metafields = [{
        ownerId: productId,
        namespace: 'seo_ai',
        key: mfKey,
        type: 'json',
        // Note: metafieldDefinitionId might not be supported in metafieldsSet
        // We'll rely on the definition being created and Shopify auto-linking
        value: JSON.stringify(metafieldData),
      }];

      // Bullets and faq are saved in the main SEO metafield (lines 963-967)
      // Not saved as separate metafields

      const mfRes = await shopGraphQL(req, shop, metaMutation, { metafields });
      const mfErrs = mfRes?.metafieldsSet?.userErrors || [];
      
      if (mfErrs.length) {
        console.error(`[SEO-APPLY] Metafield errors for ${mfKey}:`, mfErrs);
        errors.push(...mfErrs.map(e => e.message || JSON.stringify(e)));
      } else {
        console.log(`[SEO-APPLY] Metafield ${mfKey} saved successfully`);
        updated.seoMetafield = true;
      }

      // 4. Optional: image alts (if explicitly requested)
      if (updateAlt && Array.isArray(v.imageAlt) && v.imageAlt.length) {
        for (const it of v.imageAlt) {
          try {
            const mu = `
              mutation ProductImageUpdate($productId: ID!, $id: ID!, $altText: String) {
                productImageUpdate(productId: $productId, id: $id, altText: $altText) {
                  image { id altText }
                  userErrors { field message }
                }
              }
            `;
            const r = await shopGraphQL(req, shop, mu, { productId, id: it.imageId, altText: String(it.alt || '').slice(0, 125) });
            const ue = r?.productImageUpdate?.userErrors || [];
            if (ue.length) errors.push(...ue.map((e) => e.message || JSON.stringify(e)));
            else updated.imageAlt = true;
          } catch (e) {
            errors.push(e.message || String(e));
          }
        }
      }
    }

    // 6. Update MongoDB seoStatus AND lastShopifyUpdate BEFORE sending response
    // This ensures the database is updated before the client reloads data
    // IMPORTANT: We update lastShopifyUpdate HERE to establish the reference point
    // for webhook comparison BEFORE Shopify triggers the webhook!
    if (updated.seoMetafield && !dryRun) {
      try {
        const Product = (await import('../db/Product.js')).default;
        const numericId = productId.replace('gid://shopify/Product/', '');
        
        // Fetch current product data from Shopify for lastShopifyUpdate reference
        // This MUST happen BEFORE saving metafields to establish baseline for webhook
        const productQuery = `
          query GetProduct($id: ID!) {
            product(id: $id) {
              id
              title
              descriptionHtml
            }
          }
        `;
        
        let currentProduct = null;
        try {
          const productData = await shopGraphQL(req, shop, productQuery, { id: productId });
          currentProduct = productData?.product;
          
          if (!currentProduct) {
            console.error(`[SEO-CONTROLLER] Could not fetch product ${productId} from Shopify`);
          } else {
            console.log(`[SEO-CONTROLLER] Fetched current product: title="${currentProduct.title}"`);
          }
        } catch (fetchError) {
          console.error(`[SEO-CONTROLLER] Error fetching product:`, fetchError.message);
        }
        
        // Find or create the product in MongoDB
        let product = await Product.findOne({ shop, productId: parseInt(numericId) });

        if (!product && currentProduct) {
          // Product doesn't exist - CREATE it!
          console.log(`[SEO-CONTROLLER] Product ${numericId} not found in MongoDB, creating new record...`);
          
          product = await Product.create({
            shop,
            productId: parseInt(numericId),
            shopifyProductId: numericId,
            gid: productId,
            title: currentProduct.title,
            description: currentProduct.descriptionHtml || '',
            seoStatus: {
              optimized: true,
              languages: [{ code: language.toLowerCase(), optimized: true, lastOptimizedAt: new Date() }]
            },
            lastShopifyUpdate: {
              title: currentProduct.title,
              description: currentProduct.descriptionHtml || '',
              updatedAt: new Date()
            }
          });
          
          console.log(`[SEO-CONTROLLER] ✅ Created new product record in MongoDB`);
        } else if (product) {
          // Product exists - UPDATE it
          const currentLanguages = product.seoStatus?.languages || [];
          const langCode = language.toLowerCase();
          
          // Check if language already exists
          const existingLangIndex = currentLanguages.findIndex(l => l.code === langCode);
          
          let updatedLanguages;
          if (existingLangIndex >= 0) {
            // Update existing language
            updatedLanguages = [...currentLanguages];
            updatedLanguages[existingLangIndex] = {
              code: langCode,
              optimized: true,
              lastOptimizedAt: new Date()
            };
          } else {
            // Add new language
            updatedLanguages = [
              ...currentLanguages,
              { code: langCode, optimized: true, lastOptimizedAt: new Date() }
            ];
          }
          
          // Prepare update object including lastShopifyUpdate
          const updateFields = { 
            'seoStatus.languages': updatedLanguages,
            'seoStatus.optimized': true
          };
          
          // Add lastShopifyUpdate if we successfully fetched current product data
          if (currentProduct) {
            updateFields['lastShopifyUpdate'] = {
              title: currentProduct.title,
              description: currentProduct.descriptionHtml || '',
              updatedAt: new Date()
            };
            console.log(`[SEO-CONTROLLER] Setting lastShopifyUpdate baseline: title="${currentProduct.title}"`);
          }
          
          // Update the product and WAIT for completion
          console.log(`[SEO-CONTROLLER] Updating MongoDB for product ${numericId}, languages:`, updatedLanguages);
          const updateResult = await Product.findOneAndUpdate(
            { shop, productId: parseInt(numericId) },
            { $set: updateFields },
            { 
              new: true, // Return the updated document
              runValidators: true // Ensure validity
            }
          );
          
          if (updateResult) {
            console.log(`[SEO-CONTROLLER] MongoDB update completed successfully`);
            // Ensure the write is propagated
            await new Promise(resolve => setTimeout(resolve, 50));
          } else {
            console.log(`[SEO-CONTROLLER] MongoDB update failed - document not found`);
            errors.push('Failed to update optimization status in database');
          }
        } else {
          // Couldn't fetch product from Shopify - can't create
          console.error(`[SEO-CONTROLLER] Could not fetch product ${numericId} from Shopify - can't create MongoDB record`);
          errors.push('Failed to create product record in database');
        }
      } catch (e) {
        console.error('Failed to update MongoDB seoStatus:', e.message);
        errors.push(`Database update error: ${e.message}`);
      }
    }

    // Update AI products feed
    try {
      await fetch(`${process.env.APP_URL}/ai/update-product`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop, productId })
      });
    } catch (e) {
      console.error('Failed to update AI feed:', e);
    }

    // Update optimization summary metafield
    if (!dryRun) {
      try {
        const numericId = productId.replace('gid://shopify/Product/', '');
        await updateOptimizationSummary(shop, numericId);
      } catch (e) {
        console.error('Failed to update optimization summary:', e);
      }
    }

    return { 
      ok: errors.length === 0, 
      shop, 
      productId, 
      updated, 
      errors,
      language,
      isPrimary 
    };
  } catch (e) {
    throw e;
  }
}

router.post('/seo/apply', validateRequest(), async (req, res) => {
  console.log('[SEO/HANDLER]', req.method, req.originalUrl, {
    queryShop: req.query?.shop,
    bodyShop: req.body?.shop,
    sessionShop: res.locals?.shopify?.session?.shop,
  });

  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[SEO/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  // Тук логни и от къде четеш Admin API токена:
  const tokenSource = 'db|kv|session'; // актуализирай според твоя сторидж
  console.log('[SEO/HANDLER] Resolving Admin token', { shop, tokenSource });

  try {
    const shop = req.shopDomain;
    const { productId, seo, options = {}, language } = req.body;
    if (!productId) return res.status(400).json({ error: 'Missing productId' });

    const result = await applySEOForLanguage(req, shop, productId, seo, language, options);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || String(e) });
  }
});

// ==================== COLLECTIONS ENDPOINTS ====================

// GET /collections/list-graphql - New GraphQL version
router.get('/collections/list-graphql', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    console.log('[COLLECTIONS-GQL] Fetching collections via GraphQL for shop:', shop);
    
    // Single GraphQL query to get all collections with metafields and product counts
    const query = `
      query GetCollectionsWithMetafields {
        collections(first: 50) {
          edges {
            node {
              id
              title
              handle
              description
              descriptionHtml
              seo {
                title
                description
              }
              productsCount {
                count
              }
              updatedAt
              metafields(namespace: "seo_ai", first: 20) {
                edges {
                  node {
                    key
                    value
                  }
                }
              }
            }
          }
        }
      }
    `;
    
    const token = await resolveAdminToken(req, shop);
    const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GraphQL request failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }
    
    const data = result.data;
    const collections = data?.collections?.edges || [];
    
    console.log('[COLLECTIONS-GQL] Found', collections.length, 'collections');
    
    // Transform to same structure as REST endpoint
    const collectionsWithData = collections.map(edge => {
      const c = edge.node;
      
      // Extract optimized languages from metafields
      const metafields = c.metafields?.edges || [];
      const optimizedLanguages = [];
      let hasSeoData = false;
      
      metafields.forEach(mfEdge => {
        const mf = mfEdge.node;
        if (mf.key && mf.key.startsWith('seo__')) {
          const lang = mf.key.replace('seo__', '');
          if (lang && !optimizedLanguages.includes(lang)) {
            optimizedLanguages.push(lang);
          }
        }
      });
      
      hasSeoData = optimizedLanguages.length > 0;
      
      console.log(`[COLLECTIONS-GQL] Collection "${c.title}" - products: ${c.productsCount?.count || 0}, languages: ${optimizedLanguages.join(',') || 'none'}`);
      
      return {
        id: c.id, // Already in GID format from GraphQL
        title: c.title,
        handle: c.handle,
        description: c.descriptionHtml || '',
        productsCount: c.productsCount?.count || 0,
        seo: c.seo || null,
        hasSeoData: hasSeoData,
        optimizedLanguages: optimizedLanguages,
        updatedAt: c.updatedAt
      };
    });
    
    console.log('[COLLECTIONS-GQL] Returning', collectionsWithData.length, 'collections with data');
    res.json({ collections: collectionsWithData });
    
  } catch (e) {
    console.error('[COLLECTIONS-GQL] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /seo/generate-collection
router.post('/seo/generate-collection', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { collectionId, model, language = 'en' } = req.body;
    
    if (!collectionId) {
      return res.status(400).json({ error: 'Missing required field: collectionId' });
    }
    
    // Fetch collection data
    const query = `
      query GetCollection($id: ID!) {
        collection(id: $id) {
          id
          title
          handle
          descriptionHtml
          productsCount {
            count
          }
          products(first: 10) {
            edges {
              node {
                title
                productType
                vendor
                priceRangeV2 {
                  minVariantPrice { amount currencyCode }
                  maxVariantPrice { amount currencyCode }
                }
              }
            }
          }
        }
      }
    `;
    
    const data = await shopGraphQL(req, shop, query, { id: collectionId });
    const collection = data?.collection;
    
    console.log(`[GENERATE-COLLECTION] Raw GraphQL response:`, JSON.stringify(collection, null, 2));
    console.log(`[GENERATE-COLLECTION] productsCount from GraphQL:`, collection?.productsCount);
    
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    // Transform productsCount to match expected format
    const transformedCollection = {
      ...collection,
      productsCount: collection.productsCount?.count || 0
    };
    
    console.log(`[GENERATE-COLLECTION] Collection "${collection.title}" has ${transformedCollection.productsCount} products`);
    console.log(`[GENERATE-COLLECTION] Transformed collection:`, JSON.stringify(transformedCollection, null, 2));
    
    // Generate SEO data locally (no AI costs)
    const cleanDescription = (collection.descriptionHtml || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const seoData = {
      title: collection.title.slice(0, 70),
      metaDescription: cleanDescription.slice(0, 160) || `Shop our ${collection.title} collection`,
      slug: kebab(collection.handle || collection.title),
      categoryKeywords: extractCategoryKeywords(transformedCollection),
      bullets: generateCollectionBullets(transformedCollection),
      faq: generateCollectionFAQ(transformedCollection),
      jsonLd: generateCollectionJsonLd(transformedCollection)
    };
    
    const result = {
      collectionId: collection.id,
      provider: 'local',
      model: 'none',
      language: canonLang(language),
      seo: seoData,
      quality: {
        warnings: [],
        model: 'none',
        tokens: 0,
        costUsd: 0
      }
    };
    
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /seo/apply-collection
router.post('/seo/apply-collection', validateRequest(), async (req, res) => {
  console.log('[APPLY-COLLECTION] Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const shop = req.shopDomain;
    console.log('[APPLY-COLLECTION] Shop:', shop);
    
    const { collectionId, seo, language = 'en', options = {} } = req.body;
    console.log('[APPLY-COLLECTION] CollectionId:', collectionId);
    console.log('[APPLY-COLLECTION] Language:', language);
    
    if (!collectionId || !seo) {
      console.error('[APPLY-COLLECTION] Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const updated = {
      title: false,
      description: false,
      seo: false,
      metafields: false
    };
    const errors = [];
    
    // Get shop's primary language
    const Q_SHOP_LOCALES = `
      query ShopLocales {
        shopLocales { locale primary published }
      }
    `;
    const shopData = await shopGraphQL(req, shop, Q_SHOP_LOCALES, {});
    const primary = (shopData?.shopLocales || []).find(l => l?.primary)?.locale?.toLowerCase() || 'en';
    const isPrimary = language.toLowerCase() === primary.toLowerCase();
    
    // Update collection base fields (only for primary language)
    if (isPrimary && (options.updateTitle || options.updateDescription || options.updateSeo)) {
      const input = { id: collectionId };
      if (options.updateTitle) input.title = seo.title;
      if (options.updateDescription) input.descriptionHtml = seo.metaDescription ? `<p>${seo.metaDescription}</p>` : '';
      if (options.updateSeo) input.seo = {
        title: seo.title,
        description: seo.metaDescription
      };
      
      const mutation = `
        mutation UpdateCollection($input: CollectionInput!) {
          collectionUpdate(collection: $input) {
            collection { id }
            userErrors { field message }
          }
        }
      `;
      
      const result = await shopGraphQL(req, shop, mutation, { input });
      const userErrors = result?.collectionUpdate?.userErrors || [];
      
      if (userErrors.length) {
        errors.push(...userErrors.map(e => e.message));
      } else {
        if (options.updateTitle) updated.title = true;
        if (options.updateDescription) updated.description = true;
        if (options.updateSeo) updated.seo = true;
      }
    }
    
    // Update metafields
    if (options.updateMetafields !== false) {
      // Ensure definition exists for this language
      const definitionResults = await ensureCollectionMetafieldDefinitions(req, shop, [language]);
      const definitionResult = definitionResults[0];
      const definitionId = definitionResult?.definitionId;
      
      console.log(`[APPLY-COLLECTION] Definition result for ${language}:`, definitionResult);
      console.log(`[APPLY-COLLECTION] Definition ID:`, definitionId);
      
      const metafields = [{
        ownerId: collectionId,
        namespace: 'seo_ai',  // Same namespace like products!
        key: `seo__${language}`,  // Same format like products!
        type: 'json',
        // Note: metafieldDefinitionId might not be supported in metafieldsSet
        // We'll rely on the definition being created and Shopify auto-linking
        value: JSON.stringify({
          ...seo,
          language,
          updatedAt: new Date().toISOString()
        })
      }];
      
      const metaMutation = `
        mutation SetCollectionMetafields($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
            metafields { id }
          }
        }
      `;
      
      const mfResult = await shopGraphQL(req, shop, metaMutation, { metafields });
      const mfErrors = mfResult?.metafieldsSet?.userErrors || [];
      
      if (mfErrors.length) {
        errors.push(...mfErrors.map(e => e.message));
      } else {
        updated.metafields = true;
      }
    }
    
    // Update MongoDB Collection record with lastShopifyUpdate
    // This establishes baseline for webhook comparison
    if (updated.metafields) {
      try {
        const Collection = (await import('../db/Collection.js')).default;
        const numericId = collectionId.replace('gid://shopify/Collection/', '');
        
        // Fetch current collection data from Shopify for lastShopifyUpdate reference
        const collectionQuery = `
          query GetCollection($id: ID!) {
            collection(id: $id) {
              id
              title
              descriptionHtml
            }
          }
        `;
        
        let currentCollection = null;
        try {
          const collectionData = await shopGraphQL(req, shop, collectionQuery, { id: collectionId });
          currentCollection = collectionData?.collection;
          
          if (!currentCollection) {
            console.error(`[APPLY-COLLECTION] Could not fetch collection ${collectionId} from Shopify`);
          } else {
            console.log(`[APPLY-COLLECTION] Fetched current collection: title="${currentCollection.title}"`);
          }
        } catch (fetchError) {
          console.error(`[APPLY-COLLECTION] Error fetching collection:`, fetchError.message);
        }
        
        // Find or create collection record
        const collection = await Collection.findOne({ shop, collectionId: numericId });
        
        if (collection) {
          const currentLanguages = collection.seoStatus?.languages || [];
          const langCode = language.toLowerCase();
          
          // Check if language already exists
          const existingLangIndex = currentLanguages.findIndex(l => l.code === langCode);
          
          let updatedLanguages;
          if (existingLangIndex >= 0) {
            // Update existing language
            updatedLanguages = [...currentLanguages];
            updatedLanguages[existingLangIndex] = {
              code: langCode,
              optimized: true,
              lastOptimizedAt: new Date()
            };
          } else {
            // Add new language
            updatedLanguages = [
              ...currentLanguages,
              { code: langCode, optimized: true, lastOptimizedAt: new Date() }
            ];
          }
          
          // Prepare update object including lastShopifyUpdate
          const updateFields = { 
            'seoStatus.languages': updatedLanguages,
            'seoStatus.optimized': true
          };
          
          // Add lastShopifyUpdate if we successfully fetched current collection data
          if (currentCollection) {
            updateFields['lastShopifyUpdate'] = {
              title: currentCollection.title,
              description: currentCollection.descriptionHtml || '',
              updatedAt: new Date()
            };
            console.log(`[APPLY-COLLECTION] Setting lastShopifyUpdate baseline: title="${currentCollection.title}"`);
          }
          
          // Update the collection
          console.log(`[APPLY-COLLECTION] Updating MongoDB for collection ${numericId}`);
          await Collection.findOneAndUpdate(
            { shop, collectionId: numericId },
            { $set: updateFields },
            { new: true, runValidators: true }
          );
          
          console.log(`[APPLY-COLLECTION] MongoDB update completed successfully`);
        } else {
          // Create new collection record
          const newCollection = {
            shop,
            collectionId: numericId,
            shopifyCollectionId: numericId,
            gid: collectionId,
            title: currentCollection?.title,
            description: currentCollection?.descriptionHtml || '',
            seoStatus: {
              optimized: true,
              languages: [{ code: language.toLowerCase(), optimized: true, lastOptimizedAt: new Date() }]
            }
          };
          
          if (currentCollection) {
            newCollection.lastShopifyUpdate = {
              title: currentCollection.title,
              description: currentCollection.descriptionHtml || '',
              updatedAt: new Date()
            };
          }
          
          await Collection.create(newCollection);
          console.log(`[APPLY-COLLECTION] Created new collection record in MongoDB`);
        }
      } catch (e) {
        console.error('[APPLY-COLLECTION] Failed to update MongoDB:', e.message);
        // Don't fail the request if MongoDB update fails
      }
    }
    
    res.json({
      ok: errors.length === 0,
      collectionId,
      updated,
      errors,
      language,
      isPrimary
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Helper functions for collections
function extractCategoryKeywords(collection) {
  const keywords = new Set();
  
  // From title
  collection.title.toLowerCase().split(/\s+/).forEach(w => {
    if (w.length > 3) keywords.add(w);
  });
  
  // From product types
  collection.products?.edges?.forEach(({ node }) => {
    if (node.productType) {
      node.productType.toLowerCase().split(/\s+/).forEach(w => {
        if (w.length > 3) keywords.add(w);
      });
    }
  });
  
  return Array.from(keywords).slice(0, 10);
}

function generateCollectionBullets(collection, language = 'en') {
  const bullets = [];
  
  // Basic bullets using only universal data (numbers, names, symbols)
  if (collection.productsCount > 0) {
    bullets.push(`${collection.productsCount} products`);
  }
  
  const priceRange = getPriceRange(collection.products?.edges || []);
  if (priceRange) {
    bullets.push(`${priceRange.min} - ${priceRange.max}`);
  }
  
  const brands = getUniqueBrands(collection.products?.edges || []);
  if (brands.length > 0) {
    bullets.push(`${brands.slice(0, 2).join(', ')}`);
  }
  
  // Keep it minimal for basic SEO (only 3 bullets max)
  return bullets.slice(0, 3);
}

function generateCollectionFAQ(collection, language = 'en') {
  // Basic FAQ using only universal data and collection name (already translated)
  const faq = [];
  
  // Always add at least one FAQ with collection title (already translated) and product count
  if (collection.title) {
    faq.push({
      q: `${collection.title}?`,
      a: `${collection.productsCount || 0} products.`
    });
  }
  
  // Keep it minimal for basic SEO (only 1-2 FAQ max)
  return faq.slice(0, 2);
}

function generateCollectionJsonLd(collection) {
  const priceRange = getPriceRange(collection.products?.edges || []);
  
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": collection.title,
    "description": (collection.descriptionHtml || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    "numberOfItems": collection.productsCount,
    "offers": priceRange ? {
      "@type": "AggregateOffer",
      "lowPrice": priceRange.min,
      "highPrice": priceRange.max,
      "priceCurrency": priceRange.currency || "USD"
    } : undefined
  };
}

function getPriceRange(productEdges) {
  if (!productEdges.length) return null;
  
  let min = Infinity;
  let max = 0;
  let currency = 'USD';
  
  productEdges.forEach(({ node }) => {
    if (node.priceRangeV2?.minVariantPrice) {
      const price = parseFloat(node.priceRangeV2.minVariantPrice.amount);
      min = Math.min(min, price);
      max = Math.max(max, price);
      currency = node.priceRangeV2.minVariantPrice.currencyCode;
    }
  });
  
  if (min === Infinity) return null;
  
  return {
    min: min.toFixed(2),
    max: max.toFixed(2),
    currency
  };
}

function getUniqueBrands(productEdges) {
  const brands = new Set();
  productEdges.forEach(({ node }) => {
    if (node.vendor) brands.add(node.vendor);
  });
  return Array.from(brands);
}

// POST /api/seo/generate-collection-multi
router.post('/seo/generate-collection-multi', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { collectionId, model, languages = [] } = req.body;
    
    if (!collectionId || !languages.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const results = [];
    
    // Първо вземи основната колекция
    const query = `
      query GetCollection($id: ID!) {
        collection(id: $id) {
          id
          title
          handle
          descriptionHtml
          productsCount {
            count
          }
          products(first: 10) {
            edges {
              node {
                title
                productType
                vendor
                priceRangeV2 {
                  minVariantPrice { amount currencyCode }
                  maxVariantPrice { amount currencyCode }
                }
              }
            }
          }
        }
      }
    `;
    
    const data = await shopGraphQL(req, shop, query, { id: collectionId });
    const collection = data?.collection;
    
    console.log(`[GENERATE-COLLECTION-MULTI] Raw GraphQL response:`, JSON.stringify(collection, null, 2));
    console.log(`[GENERATE-COLLECTION-MULTI] productsCount from GraphQL:`, collection?.productsCount);
    
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    // Transform productsCount to match expected format
    const transformedCollection = {
      ...collection,
      productsCount: collection.productsCount?.count || 0
    };
    
    console.log(`[GENERATE-COLLECTION-MULTI] Collection "${collection.title}" has ${transformedCollection.productsCount} products`);
    console.log(`[GENERATE-COLLECTION-MULTI] Transformed collection:`, JSON.stringify(transformedCollection, null, 2));

    for (const language of languages) {
      try {
        // Вземи преводите за колекцията
        const translationsQuery = `
          query GetCollectionTranslations($resourceId: ID!) {
            translatableResource(resourceId: $resourceId) {
              translations(locale: "${language}") {
                key
                value
              }
            }
          }
        `;
        
        const translationData = await shopGraphQL(req, shop, translationsQuery, { 
          resourceId: collectionId 
        });
        
        // Извлечи преводите
        let title = collection.title;
        let description = collection.descriptionHtml;
        
        const translations = translationData?.translatableResource?.translations || [];
        
        for (const t of translations) {
          if (t.key === 'title') title = t.value;
          if (t.key === 'body_html') description = t.value;
        }
        
        // Създай обект с преведени данни
        const translatedCollection = {
          ...transformedCollection, // Use transformedCollection with productsCount!
          title: title,
          descriptionHtml: description
        };
        
        // Генерирай SEO с преведените данни
        const seoData = {
          title: title.slice(0, 70),
          metaDescription: (description || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160) || `Shop our ${title} collection`,
          slug: kebab(collection.handle || title),
          categoryKeywords: extractCategoryKeywords(translatedCollection),
          bullets: generateCollectionBullets(translatedCollection, language),
          faq: generateCollectionFAQ(translatedCollection, language),
          jsonLd: generateCollectionJsonLd(translatedCollection, title, description)
        };
        
        results.push({
          language,
          data: seoData
        });
        
      } catch (error) {
        results.push({
          language,
          error: error.message
        });
      }
    }
    
    res.json({
      collectionId,
      results,
      language: 'multi',
      provider: 'local',
      model: 'none'
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/seo/apply-collection-multi
router.post('/seo/apply-collection-multi', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { collectionId, results = [], options = {} } = req.body;
    
    console.log('[APPLY-MULTI] Request languages:', results.map(r => r.language));
    
    if (!collectionId || !results.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const updated = [];
    const errors = [];
    
    // Get primary language
    const Q_SHOP_LOCALES = `
      query ShopLocales {
        shopLocales { locale primary published }
      }
    `;
    const shopData = await shopGraphQL(req, shop, Q_SHOP_LOCALES, {});
    const primary = (shopData?.shopLocales || []).find(l => l?.primary)?.locale?.toLowerCase() || 'en';
    
    // Ensure EN definition always exists
    const allLanguages = results.map(r => r.language);
    console.log('[APPLY-MULTI] Ensuring definitions for:', allLanguages);
    await ensureCollectionMetafieldDefinitions(req, shop, allLanguages);
    
    for (const result of results) {
      try {
        const { language, seo } = result;
        const isPrimary = language.toLowerCase() === primary.toLowerCase();
        
        console.log(`[APPLY-MULTI] Processing ${language}, isPrimary: ${isPrimary}`);
        
        // Update collection base fields only for primary language
        if (isPrimary && (options.updateTitle || options.updateDescription || options.updateSeo)) {
          const input = { id: collectionId };
          if (options.updateTitle) input.title = seo.title;
          if (options.updateDescription) input.descriptionHtml = seo.metaDescription ? `<p>${seo.metaDescription}</p>` : '';
          if (options.updateSeo) input.seo = {
            title: seo.title,
            description: seo.metaDescription
          };
          
          const mutation = `
            mutation UpdateCollection($input: CollectionInput!) {
              collectionUpdate(collection: $input) {
                collection { id }
                userErrors { field message }
              }
            }
          `;
          
          try {
            const updateResult = await shopGraphQL(req, shop, mutation, { input });
            const userErrors = updateResult?.collectionUpdate?.userErrors || [];
            
            if (userErrors.length) {
              errors.push(...userErrors.map(e => `${language}: ${e.message}`));
            } else {
              updated.push({ language, fields: ['title', 'description', 'seo'] });
            }
          } catch (e) {
            console.error(`[APPLY-MULTI] Error in primary language update:`, e.message);
            errors.push(`${language}: ${e.message}`);
          }
        }
        
        // Validation for empty SEO data BEFORE metafields block
        if (!seo || !seo.title || !seo.metaDescription) {
          console.error(`[APPLY-MULTI] Empty SEO data for ${language}, skipping metafields`);
          errors.push(`${language}: Empty SEO data`);
        } else {
          // Always update metafields
          if (options.updateMetafields !== false) {
            // Ensure definition exists for this language
            console.log(`[APPLY-MULTI] ===== ENSURING DEFINITION FOR ${language} =====`);
            const definitionResults = await ensureCollectionMetafieldDefinitions(req, shop, [language]);
            const definitionResult = definitionResults[0];
            const definitionId = definitionResult?.definitionId;
            
            console.log(`[APPLY-MULTI] Definition results:`, definitionResults);
            console.log(`[APPLY-MULTI] Definition result for ${language}:`, definitionResult);
            console.log(`[APPLY-MULTI] Definition ID:`, definitionId);
            console.log(`[APPLY-MULTI] ===== DEFINITION ENSURED =====`);
            
            const key = `seo__${String(language || 'en').toLowerCase()}`; // ALWAYS lowercase!
            
            // Delete any existing metafield with this key first
            try {
              console.log(`[APPLY-MULTI] Deleting existing metafield ${key} for ${collectionId}`);
              await deleteCollectionMetafield(req, shop, collectionId, key);
            } catch (e) {
              console.log(`[APPLY-MULTI] No existing metafield to delete for ${key}:`, e.message);
            }
            
            const metafields = [{
              ownerId: collectionId,
              namespace: 'seo_ai',  // Same namespace as products!
              key,
              type: 'json',
              // Note: metafieldDefinitionId might not be supported in metafieldsSet
              // We'll rely on the definition being created and Shopify auto-linking
              value: JSON.stringify({
                ...seo,
                language: key.replace('seo__', ''), // also lowercase
                updatedAt: new Date().toISOString()
              })
            }];
            
            const metaMutation = `
              mutation SetCollectionMetafields($metafields: [MetafieldsSetInput!]!) {
                metafieldsSet(metafields: $metafields) {
                  userErrors { field message }
                  metafields { id }
                }
              }
            `;
            
            const mfResult = await shopGraphQL(req, shop, metaMutation, { metafields });
            const mfErrors = mfResult?.metafieldsSet?.userErrors || [];
            
            if (mfErrors.length) {
              errors.push(...mfErrors.map(e => `${language} metafield: ${e.message}`));
            } else {
              updated.push({ language, fields: ['metafields'] });
            }
          }
        }
      } catch (err) {
        errors.push(`${result.language}: ${err.message}`);
      }
    }
    
    res.json({
      ok: errors.length === 0,
      collectionId,
      updated,
      errors
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ==================== END COLLECTIONS ENDPOINTS ====================

// GET /collections/check-definitions
router.get('/collections/check-definitions', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    const query = `
      query {
        metafieldDefinitions(first: 10, ownerType: COLLECTION, namespace: "seo_ai") {
          edges {
            node {
              key
              name
            }
          }
        }
      }
    `;
    
    const token = await resolveAdminToken(req, shop);
    const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GraphQL request failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }
    
    const data = result.data;
    const definitions = data?.metafieldDefinitions?.edges || [];
    
    res.json({ 
      hasDefinitions: definitions.length > 0,
      definitions: definitions.map(e => e.node),
      count: definitions.length 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /collections/create-definitions
router.post('/collections/create-definitions', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { languages = ['en'] } = req.body;
    
    console.log('[CREATE-DEFINITIONS] Creating definitions for languages:', languages);
    
    const results = await ensureCollectionMetafieldDefinitions(req, shop, languages);
    
    res.json({
      ok: true,
      languages,
      results
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /collections/init-metafields - Creates metafield definitions for collections
router.post('/collections/init-metafields', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // Get shop languages
    const Q_SHOP_LOCALES = `
      query ShopLocales {
        shopLocales { locale primary published }
      }
    `;
    const shopData = await shopGraphQL(req, shop, Q_SHOP_LOCALES, {});
    const languages = (shopData?.shopLocales || [])
      .filter(l => l.published)
      .map(l => canonLang(l.locale));
    
    const uniqueLanguages = [...new Set(languages)];
    console.log('[INIT] Creating collection metafield definitions for languages:', uniqueLanguages);
    
    const results = await ensureCollectionMetafieldDefinitions(req, shop, uniqueLanguages);
    
    res.json({
      ok: true,
      languages: uniqueLanguages,
      results
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /collections/init-metafield-definitions - Creates metafield definitions for collections
router.post('/collections/init-metafield-definitions', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // Get shop languages
    const Q_SHOP_LOCALES = `
      query ShopLocales {
        shopLocales { locale primary published }
      }
    `;
    const shopData = await shopGraphQL(req, shop, Q_SHOP_LOCALES, {});
    const languages = (shopData?.shopLocales || [])
      .filter(l => l.published)
      .map(l => canonLang(l.locale));
    
    const uniqueLanguages = [...new Set(languages)];
    const results = [];
    
    // Create definition for each language
    for (const lang of uniqueLanguages) {
      const mutation = `
        mutation CreateCollectionMetafield {
          metafieldDefinitionCreate(definition: {
            name: "AI SEO - ${lang.toUpperCase()}"
            namespace: "seo_ai"
            key: "seo__${lang}"
            type: "json"
            ownerType: COLLECTION
            pin: true
            visibleToStorefrontApi: true
          }) {
            createdDefinition {
              id
              name
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
      
      try {
        const result = await shopGraphQL(req, shop, mutation, {});
        
        if (result?.metafieldDefinitionCreate?.userErrors?.length > 0) {
          const errors = result.metafieldDefinitionCreate.userErrors;
          if (errors.some(e => e.message.includes('already exists'))) {
            results.push({ lang, status: 'exists' });
          } else {
            results.push({ lang, status: 'error', errors });
          }
        } else if (result?.metafieldDefinitionCreate?.createdDefinition) {
          results.push({ lang, status: 'created', definition: result.metafieldDefinitionCreate.createdDefinition });
        }
      } catch (e) {
        results.push({ lang, status: 'error', error: e.message });
      }
    }
    
    res.json({
      ok: true,
      languages: uniqueLanguages,
      results
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Export helper functions for use in other controllers
export { 
  requireShop, 
  shopGraphQL,
};

// GET /collections/:id/seo-data - Returns SEO data for preview - MIGRATED TO GRAPHQL
router.get('/collections/:id/seo-data', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const collectionId = req.params.id;
    
    // Convert numeric ID to GID format for GraphQL
    const gid = collectionId.startsWith('gid://') ? collectionId : `gid://shopify/Collection/${collectionId}`;
    
    // GraphQL query to get collection metafields
    const query = `
      query GetCollectionMetafields($id: ID!) {
        collection(id: $id) {
          id
          title
          metafields(namespace: "seo_ai", first: 20) {
            edges {
              node {
                id
                key
                value
                type
              }
            }
          }
        }
      }
    `;
    
    const data = await shopGraphQL(req, shop, query, { id: gid });
    
    if (!data?.collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    const metafields = data.collection.metafields?.edges || [];
    
    // Group by language
    const results = [];
    metafields.forEach(edge => {
      const mf = edge.node;
      if (mf.key && mf.key.startsWith('seo__')) {
        const lang = mf.key.replace('seo__', '');
        try {
          const seoData = JSON.parse(mf.value);
          results.push({
            language: lang,
            seo: seoData,
            success: true
          });
        } catch (e) {
          console.error('Failed to parse SEO data:', e);
        }
      }
    });
    
    res.json({
      collectionId,
      results,
      language: 'multi',
      provider: 'local',
      model: 'none'
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// DELETE /seo/delete - Delete SEO for specific language
router.delete('/seo/delete', validateRequest(), async (req, res) => {
  console.log('[DELETE-SEO] Request received:', req.body);
  
  try {
    const shop = req.shopDomain;
    const { productId, language } = req.body;
    
    if (!productId || !language) {
      return res.status(400).json({ error: 'Missing productId or language' });
    }
    
    const errors = [];
    const deleted = { metafield: false, mongodb: false };
    const metafieldKey = `seo__${language.toLowerCase()}`;
    
    console.log(`[DELETE-SEO] Attempting to delete metafield: ${metafieldKey} for product: ${productId}`);
    
    // 1. Delete using metafieldsDelete - DON'T search for ID, delete directly
    try {
      const deleteMutation = `
        mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields {
              key
              namespace
              ownerId
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      
      // IMPORTANT: Pass ownerId, namespace and key - NOT id!
      const variables = {
        metafields: [{
          ownerId: productId,     // gid://shopify/Product/...
          namespace: 'seo_ai',    
          key: metafieldKey       // seo__en, seo__de, etc.
        }]
      };
      
      console.log('[DELETE-SEO] Calling metafieldsDelete with:', JSON.stringify(variables, null, 2));
      
      const deleteResult = await shopGraphQL(req, shop, deleteMutation, variables);
      
      console.log('[DELETE-SEO] Delete result:', JSON.stringify(deleteResult, null, 2));
      
      if (deleteResult?.metafieldsDelete?.userErrors?.length > 0) {
        const errorMessages = deleteResult.metafieldsDelete.userErrors.map(e => e.message);
        console.error('[DELETE-SEO] Delete errors:', errorMessages);
        errors.push(...errorMessages);
      } else {
        // Successful deletion or metafield doesn't exist
        deleted.metafield = true;
        console.log(`[DELETE-SEO] Metafield deletion completed`);
      }
    } catch (e) {
      console.error('[DELETE-SEO] GraphQL error:', e);
      errors.push(`Metafield deletion failed: ${e.message}`);
    }
    
    // 2. Update MongoDB using Mongoose model
    try {
      console.log('[DELETE-SEO] Updating MongoDB for product ID:', productId);
      
      // Extract numeric ID
      const numericId = parseInt(productId.replace('gid://shopify/Product/', ''));
      
      // Import Product model
      const Product = (await import('../db/Product.js')).default;
      
      // Find the product first
      const product = await Product.findOne({ shop, productId: numericId });
      
      if (product && product.seoStatus?.languages) {
        const langCode = language.toLowerCase();
        
        // Filter out the language to delete
        const updatedLanguages = product.seoStatus.languages.filter(l => l.code !== langCode);
        
        // IMPORTANT: Clear lastShopifyUpdate so webhook can detect future changes
        // This ensures webhook will work correctly after SEO deletion
        const updateResult = await Product.findOneAndUpdate(
          { shop, productId: numericId },
          { 
            $set: { 
              'seoStatus.languages': updatedLanguages,
              'seoStatus.optimized': updatedLanguages.some(l => l.optimized)
            },
            $unset: { 
              'lastShopifyUpdate': 1  // Delete the entire lastShopifyUpdate field
            }
          },
          { new: true }
        );
        
        if (updateResult) {
          deleted.mongodb = true;
          console.log('[DELETE-SEO] MongoDB updated successfully');
          console.log('[DELETE-SEO] Remaining languages:', updatedLanguages.map(l => l.code));
          console.log('[DELETE-SEO] Cleared lastShopifyUpdate baseline');
        } else {
          console.log('[DELETE-SEO] MongoDB update failed - document not found');
          errors.push('Failed to update optimization status in database');
        }
      } else {
        console.log('[DELETE-SEO] Product not found in MongoDB or no seoStatus');
      }
      
    } catch (e) {
      console.error('[DELETE-SEO] MongoDB error:', e);
      errors.push(`MongoDB update failed: ${e.message}`);
    }
    
    // Return response
    if (errors.length === 0) {
      res.json({ 
        ok: true, 
        shop,
        productId,
        language,
        deleted,
        message: `Successfully deleted SEO for language: ${language}`
      });
    } else {
      res.status(400).json({ 
        ok: false, 
        shop,
        productId,
        language,
        errors, 
        deleted
      });
    }
    
  } catch (error) {
    console.error('[DELETE-SEO] Fatal error:', error);
    res.status(500).json({ 
      ok: false,
      error: error.message
    });
  }
});

// DELETE /seo/bulk-delete - Delete SEO for multiple products
router.delete('/seo/bulk-delete', validateRequest(), async (req, res) => {
  console.log('[BULK-DELETE-SEO] Request received');
  
  try {
    const shop = req.shopDomain;
    const { items } = req.body; // Array of { productId, language }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid items array' });
    }
    
    const results = [];
    const metafieldsToDelete = [];
    const mongoUpdates = [];
    
    // Prepare all metafields for deletion
    items.forEach(({ productId, language }) => {
      if (productId && language) {
        metafieldsToDelete.push({
          ownerId: productId,
          namespace: 'seo_ai',
          key: `seo__${language.toLowerCase()}`
        });
        mongoUpdates.push({ productId, language });
      }
    });
    
    console.log(`[BULK-DELETE-SEO] Deleting ${metafieldsToDelete.length} metafields`);
    
    // 1. Delete all metafields in one GraphQL call
    if (metafieldsToDelete.length > 0) {
      try {
        const deleteMutation = `
          mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
            metafieldsDelete(metafields: $metafields) {
              deletedMetafields {
                key
                namespace
                ownerId
              }
              userErrors {
                field
                message
              }
            }
          }
        `;
        
        const deleteResult = await shopGraphQL(req, shop, deleteMutation, {
          metafields: metafieldsToDelete
        });
        
        console.log('[BULK-DELETE-SEO] GraphQL result:', JSON.stringify(deleteResult, null, 2));
        
        if (deleteResult?.metafieldsDelete?.userErrors?.length > 0) {
          results.push({
            type: 'error',
            source: 'shopify',
            errors: deleteResult.metafieldsDelete.userErrors
          });
        }
        
        if (deleteResult?.metafieldsDelete?.deletedMetafields) {
          results.push({
            type: 'success',
            source: 'shopify',
            deletedCount: deleteResult.metafieldsDelete.deletedMetafields.length,
            deleted: deleteResult.metafieldsDelete.deletedMetafields
          });
        }
      } catch (e) {
        console.error('[BULK-DELETE-SEO] GraphQL error:', e);
        results.push({
          type: 'error',
          source: 'shopify',
          error: e.message
        });
      }
    }
    
    // 2. Update MongoDB for all products
    if (mongoUpdates.length > 0) {
      try {
        const db = await dbConnect();
        const collection = db.collection('shopify_products');
        
        // Update each product
        const mongoResults = await Promise.all(
          mongoUpdates.map(async ({ productId, language }) => {
            try {
              const result = await collection.updateOne(
                { _id: productId },
                { $pull: { languages: language } }
              );
              return { productId, language, success: true, modified: result.modifiedCount > 0 };
            } catch (err) {
              return { productId, language, success: false, error: err.message };
            }
          })
        );
        
        results.push({
          type: 'mongodb',
          updates: mongoResults
        });
        
      } catch (e) {
        console.error('[BULK-DELETE-SEO] MongoDB error:', e);
        results.push({
          type: 'error',
          source: 'mongodb',
          error: e.message
        });
      }
    }
    
    // Return consolidated results
    res.json({
      ok: true,
      shop,
      totalRequested: items.length,
      results
    });
    
  } catch (error) {
    console.error('[BULK-DELETE-SEO] Fatal error:', error);
    res.status(500).json({ 
      ok: false,
      error: error.message
    });
  }
});

// DELETE /collections/delete-seo - Delete collection SEO for specific language
router.delete('/collections/delete-seo', validateRequest(), async (req, res) => {
  console.log('[DELETE-COLLECTION-SEO] ===== DELETE REQUEST START =====');
  console.log('[DELETE-COLLECTION-SEO] Request received:', req.body);
  console.log('[DELETE-COLLECTION-SEO] Headers:', req.headers);
  console.log('[DELETE-COLLECTION-SEO] Shop domain:', req.shopDomain);
  
  try {
    const shop = req.shopDomain;
    const { collectionId, language } = req.body;
    
    if (!collectionId || !language) {
      console.log('[DELETE-COLLECTION-SEO] Missing parameters:', { collectionId, language });
      return res.status(400).json({ error: 'Missing collectionId or language' });
    }
    
    console.log('[DELETE-COLLECTION-SEO] Parameters validated:', { shop, collectionId, language });
    
    const errors = [];
    const deleted = { metafield: false };
    const metafieldKey = `seo__${language.toLowerCase()}`;
    
    console.log(`[DELETE-COLLECTION-SEO] Attempting to delete metafield: ${metafieldKey} for collection: ${collectionId}`);
    
    // Delete using metafieldsDelete
    try {
      const deleteMutation = `
        mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields {
              key
              namespace
              ownerId
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
          ownerId: collectionId,
          namespace: 'seo_ai',    
          key: metafieldKey
        }]
      };
      
      console.log('[DELETE-COLLECTION-SEO] Calling metafieldsDelete with:', JSON.stringify(variables, null, 2));
      
      const deleteResult = await shopGraphQL(req, shop, deleteMutation, variables);
      
      console.log('[DELETE-COLLECTION-SEO] Delete result:', JSON.stringify(deleteResult, null, 2));
      
      if (deleteResult?.metafieldsDelete?.userErrors?.length > 0) {
        const errorMessages = deleteResult.metafieldsDelete.userErrors.map(e => e.message);
        console.error('[DELETE-COLLECTION-SEO] Delete errors:', errorMessages);
        errors.push(...errorMessages);
      } else {
        deleted.metafield = true;
        console.log(`[DELETE-COLLECTION-SEO] Metafield deletion completed`);
      }
    } catch (e) {
      console.error('[DELETE-COLLECTION-SEO] GraphQL error:', e);
      errors.push(`Metafield deletion failed: ${e.message}`);
    }
    
    // Return response
    console.log('[DELETE-COLLECTION-SEO] Final result:', { errors: errors.length, deleted });
    
    if (errors.length === 0) {
      console.log('[DELETE-COLLECTION-SEO] ===== DELETE SUCCESS =====');
      res.json({ 
        ok: true, 
        shop,
        collectionId,
        language,
        deleted,
        message: `Successfully deleted SEO for language: ${language}`
      });
    } else {
      console.log('[DELETE-COLLECTION-SEO] ===== DELETE FAILED =====');
      console.log('[DELETE-COLLECTION-SEO] Errors:', errors);
      res.status(400).json({ 
        ok: false, 
        shop,
        collectionId,
        language,
        errors, 
        deleted
      });
    }
    
  } catch (error) {
    console.error('[DELETE-COLLECTION-SEO] Fatal error:', error);
    res.status(500).json({ 
      ok: false,
      error: error.message
    });
  }
});

// DEBUG ROUTE - временен за диагностика на токени
router.get('/debug-token', async (req, res) => {
  const shop = req.query.shop;
  console.log('=== DEBUG TOKEN CHECK ===');
  
  try {
    // Провери DB
    const Shop = await import('../db/Shop.js');
    const doc = await Shop.default.findOne({ shop }).lean();
    
    // Провери token exchange
    console.log('Shop doc:', doc);
    
    res.json({
      shop,
      hasDoc: !!doc,
      accessToken: doc?.accessToken,
      tokenType: typeof doc?.accessToken,
      isUndefinedString: doc?.accessToken === 'undefined',
      tokenLength: doc?.accessToken?.length,
      startsWithShpat: doc?.accessToken?.startsWith('shpat_'),
      installedAt: doc?.installedAt,
      updatedAt: doc?.updatedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { applySEOForLanguage };
export default router;