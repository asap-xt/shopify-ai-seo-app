// backend/controllers/seoController.js
// Routes: /plans/me, /seo/generate, /seo/apply
// Behavior: Do NOT generate if the product has no real translation for the requested language.
// All comments are in English.

import express from 'express';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const router = express.Router();

/* --------------------------- Plan presets (unchanged) --------------------------- */
const PLAN_PRESETS = {
  starter: {
    plan: 'Starter',
    planKey: 'starter',
    queryLimit: 50,
    productLimit: 50,
    providersAllowed: ['openai', 'anthropic'],
    modelsSuggested: [
      'openai/gpt-4o-mini',
      'openai/o3-mini',
      'anthropic/claude-3.5-sonnet',
    ],
    autosync: '72h',
  },
  growth: {
    plan: 'Growth',
    planKey: 'growth',
    queryLimit: 1500,
    productLimit: 1000,
    providersAllowed: ['claude', 'openai', 'gemini'],
    modelsSuggested: [
      'google/gemini-1.5-flash',  // Най-евтин
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
    queryLimit: 4000,
    productLimit: 2000,
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
    queryLimit: 10000,
    productLimit: 10000,
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
  const shop = normalizeShop(req.query.shop || req.body?.shop || req.headers['x-shop']);
  if (!shop) {
    const err = new Error('Missing ?shop');
    err.status = 400;
    throw err;
  }
  return shop;
}

// Resolve Admin token: DB (OAuth) → env fallback
async function resolveAdminTokenForShop(shop) {
  try {
    const mod = await import('../db/Shop.js');
    const Shop = (mod && (mod.default || mod.Shop || mod.shop)) || null;
    if (Shop && typeof Shop.findOne === 'function') {
      const doc = await Shop.findOne({ shopDomain: shop }).lean().exec();
      const tok = doc?.accessToken || doc?.token || doc?.access_token;
      if (tok && String(tok).trim()) return String(tok).trim();
    }
  } catch { /* ignore */ }

  const envToken =
    (process.env.SHOPIFY_ADMIN_API_TOKEN && process.env.SHOPIFY_ADMIN_API_TOKEN.trim()) ||
    (process.env.SHOPIFY_ACCESS_TOKEN && process.env.SHOPIFY_ACCESS_TOKEN.trim()) ||
    (process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN && process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN.trim());

  if (envToken) return envToken;

  const err = new Error('No Admin API token available for this shop');
  err.status = 400;
  throw err;
}

async function shopGraphQL(shop, query, variables = {}) {
  const token = await resolveAdminTokenForShop(shop);
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
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
    const e = new Error(`Admin GraphQL userErrors: ${JSON.stringify(userErrors)}`);
    e.status = 400;
    throw e;
  }
  return json.data;
}

/* --------------------------- OpenRouter (AI) --------------------------- */
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

async function openrouterChat(model, messages, response_format_json = true) {
  console.log('🔴 [AI CALL] Starting AI request with model:', model);
  console.log('🔴 [AI CALL] Messages being sent:', JSON.stringify(messages, null, 2));
  
  // ВРЕМЕНЕН БЛОК НА CLAUDE - премахнете ако искате да използвате Claude
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
async function ensureMetafieldDefinition(shop, language) {
  const key = `seo__${language}`;
  console.log(`[METAFIELD DEF] Checking/creating definition for: ${key}`);
  
  // По-прост подход - директно създаваме без проверка
  const createMutation = `
    mutation {
      metafieldDefinitionCreate(definition: {
        namespace: "seo_ai"
        key: "${key}"
        name: "AI SEO - ${language.toUpperCase()}"
        type: "json"
        ownerType: PRODUCT
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
    const result = await shopGraphQL(shop, createMutation, {});
    
    if (result?.metafieldDefinitionCreate?.userErrors?.length > 0) {
      const errors = result.metafieldDefinitionCreate.userErrors;
      // Ако грешката е "already exists", това е ОК
      if (errors.some(e => e.message.includes('already exists'))) {
        console.log(`[METAFIELD DEF] Definition already exists for ${key} - OK`);
        return { exists: true };
      }
      console.error(`[METAFIELD DEF] Errors:`, errors);
      return { errors };
    }
    
    if (result?.metafieldDefinitionCreate?.createdDefinition) {
      console.log(`[METAFIELD DEF] Created successfully:`, result.metafieldDefinitionCreate.createdDefinition);
      return { created: true };
    }
  } catch (e) {
    console.error(`[METAFIELD DEF] Exception:`, e.message);
    // Продължаваме - метафийлдът пак ще работи
  }
  
  return { attempted: true };
}

/* --------------------------- Collection Metafield Definition Helper --------------------------- */
// Създава metafield definitions за колекции
async function ensureCollectionMetafieldDefinitions(shop, languages) {
  console.log('[COLLECTION METAFIELDS] Creating definitions for languages:', languages);
  
  const results = [];
  
  for (const lang of languages) {
    const key = `seo__${lang.toLowerCase()}`; // ВИНАГИ lowercase
    
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
      const result = await shopGraphQL(shop, createMutation, {});
      
      if (result?.metafieldDefinitionCreate?.userErrors?.length > 0) {
        const errors = result.metafieldDefinitionCreate.userErrors;
        if (errors.some(e => e.message.includes('already exists') || e.message.includes('taken'))) {
          console.log(`[COLLECTION METAFIELDS] Definition already exists for ${key} - OK`);
          results.push({ lang, status: 'exists' });
        } else {
          console.error(`[COLLECTION METAFIELDS] Errors for ${key}:`, errors);
          results.push({ lang, status: 'error', errors });
        }
      } else if (result?.metafieldDefinitionCreate?.createdDefinition) {
        console.log(`[COLLECTION METAFIELDS] Created successfully:`, result.metafieldDefinitionCreate.createdDefinition);
        results.push({ lang, status: 'created' });
      }
    } catch (e) {
      console.error(`[COLLECTION METAFIELDS] Exception for ${key}:`, e.message);
      results.push({ lang, status: 'error', error: e.message });
    }
  }
  
  return results;
}

/* --------------------------- Product JSON-LD Generator --------------------------- */
function generateProductJsonLd(product, seoData, language) {
  console.log('🟢 [JSON-LD] Generating locally (NOT via AI) for language:', language);
  
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
  
  // Добавяме URL само ако има
  if (product.onlineStoreUrl) {
    jsonLd.url = product.onlineStoreUrl;
  }
  
  // Добавяме SKU ако има
  if (product.variants?.edges?.[0]?.node?.sku) {
    jsonLd.sku = product.variants.edges[0].node.sku;
  }
  
  // За различни езици можем да добавим inLanguage
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
      required: ['title', 'metaDescription', 'slug', 'bodyHtml', 'bullets', 'faq'], // REMOVED jsonLd
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
async function getShopPublishedLocales(shop) {
  const Q = `query { shopLocales { locale published } }`;
  const d = await shopGraphQL(shop, Q);
  const list = (d?.shopLocales || [])
    .filter(l => l && l.published)
    .map(l => String(l.locale));
  return Array.from(new Set(list));
}

// 2) Does the product have real translated content for given locale?
async function hasProductTranslation(shop, productId, locale) {
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
  const d = await shopGraphQL(shop, Q, { id: productId, locale });
  const arr = d?.product?.translations || [];
  const keys = new Set(['title','body_html','seo_title','seo_description']);
  return arr.some(t => keys.has(t.key) && typeof t.value === 'string' && t.value.trim().length > 0);
}

// 3) Fetch localized product fields (title/body/seo_*) for a locale
async function getProductLocalizedContent(shop, productId, localeInput) {
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
  const data = await shopGraphQL(shop, Q, { id: productId, locale });
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

  // bodyHtml sanitize + minimal fallback
  if (p.seo.bodyHtml) p.seo.bodyHtml = sanitizeHtmlSafe(p.seo.bodyHtml);
  if (!p.seo.bodyHtml || String(p.seo.bodyHtml).trim().length === 0) {
    const titleFallback = clamp(p.seo?.title || 'Product', 120);
    p.seo.bodyHtml = `<p>${titleFallback}</p>`;
  }

  // metaDescription clamp + fallback
  if (p.seo.metaDescription) {
    let md = p.seo.metaDescription.trim();
    md = clamp(md, META_MAX);
    if (md.length < META_MIN && p.seo.bodyHtml) {
      const plain = String(p.seo.bodyHtml).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      md = clamp(`${md} ${plain}`.trim(), META_MAX);
    }
    p.seo.metaDescription = md;
  } else {
    const plain = String(p.seo.bodyHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    p.seo.metaDescription = clamp(plain || (p.seo.title || 'Great product'), META_MAX);
  }

  // slug normalize; ensure pattern-safe
  if (p.seo.slug) p.seo.slug = kebab(p.seo.slug);
  if (!p.seo.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.seo.slug)) {
    const base = kebab(p.seo?.title || '') || 'product';
    p.seo.slug = `${base}-${gidTail(p.productId)}`.replace(/-+$/, '');
  }

  // bullets
  let bullets = Array.isArray(p.seo.bullets) ? p.seo.bullets : [];
  bullets = bullets
    .map((s) => String(s || '').trim())
    .filter((s) => s.length >= 2)
    .slice(0, 10);
  while (bullets.length < 2) bullets.push('Great value');
  p.seo.bullets = bullets.map((s) => s.slice(0, 160));

  // faq
  let faq = Array.isArray(p.seo.faq) ? p.seo.faq : [];
  faq = faq
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      q: clamp(String(x.q || '').trim(), 160),
      a: clamp(String(x.a || '').trim(), 400),
    }))
    .filter((x) => x.q.length >= 3 && x.a.length >= 3)
    .slice(0, 10);
  if (faq.length < 1) {
    faq.push({
      q: 'What makes this product special?',
      a: 'It offers great quality and value for everyday use.',
    });
  }
  p.seo.faq = faq;

  // REMOVED jsonLd fixup/validation code

  const ok = validateSeo(p);
  return { ok, value: p, issues: ok ? [] : (validateSeo.errors || []).map((e) => `${e.instancePath} ${e.message}`) };
}

/* --------------------------- Routes --------------------------- */

// Plans (used by Dashboard/AI SEO form)
router.get('/plans/me', async (req, res) => {
  try {
    const shop = requireShop(req);
    const plan = resolvePlanForShop(shop);
    res.json({
      ...plan,
      modelsSuggested: plan.modelsSuggested,
      providersAllowed: plan.providersAllowed,
      autosync: plan.autosync,
      trial: { daysLeft: 7, status: 'active' },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
});

router.post('/seo/generate', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { productId, model, language = 'en' } = req.body || {};
    if (!productId || !model) {
      return res.status(400).json({ error: 'Missing required fields: shop, model, productId' });
    }

    const isAll = String(language || '').toLowerCase() === 'all';
    if (isAll) {
      // 1) Get published shop locales
      const shopLocales = await getShopPublishedLocales(shop);
      // 2) Keep only those with real product translations
      const langs = [];
      for (const loc of shopLocales) {
        if (await hasProductTranslation(shop, productId, loc)) {
          const short = canonLang(loc);
          if (!langs.includes(short)) langs.push(short); // dedupe
        }
      }

      const results = [];
      for (const lang of langs) {
        try {
          const result = await generateSEOForLanguage(shop, productId, model, lang);
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
const shopData = await shopGraphQL(shop, Q_SHOP_LOCALES, {});
const primaryLang = (shopData?.shopLocales || []).find(l => l?.primary)?.locale?.toLowerCase() || 'en';
const isPrimary = langNorm.toLowerCase() === primaryLang.toLowerCase();

// Only check for translations if NOT primary language
if (!isPrimary) {
  const hasLoc = await hasProductTranslation(shop, productId, language);
  if (!hasLoc) {
    return res.status(400).json({
      error: 'Product is not translated to the requested language',
      language: langNorm
    });
  }
}

const result = await generateSEOForLanguage(shop, productId, model, language);
return res.json(result);

  } catch (e) {
    const payload = { error: e.message || String(e) };
    if (e.issues) payload.issues = e.issues;
    res.status(e.status || 500).json(payload);
  }
});

async function generateSEOForLanguage(shop, productId, model, language) {
  console.log('🟡 [GENERATE] Starting generation for language:', language, 'model:', model);
  console.log('🚀 [LOCAL MODE] Using product data directly - NO AI costs!');
  
  const langNormalized = canonLang(language);
  
  // Get shop's primary language
  const Q_SHOP_LOCALES = `
    query ShopLocales {
      shopLocales { locale primary published }
    }
  `;
  const shopData = await shopGraphQL(shop, Q_SHOP_LOCALES, {});
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
  const pd = await shopGraphQL(shop, Q, { id: productId });
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
    const loc = await getProductLocalizedContent(shop, productId, language);
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

  /* ЗАКОМЕНТИРАН AI КОД - може да се включи в бъдеще за enhanced SEO
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

  // ЛОКАЛНО ГЕНЕРИРАНЕ НА SEO ДАННИ
  console.log('💰 [ZERO COST] Generating SEO data locally from product data');
  
  // Генерираме метаописание от body или title
  let metaDescription = seoDescription;
  if (!metaDescription && localizedBody) {
    // Вземаме първите 160 символа от body без HTML тагове
    metaDescription = localizedBody
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, META_TARGET);
  }
  if (!metaDescription) {
    metaDescription = localizedTitle || 'Quality product from our store';
  }

  const localSeoData = {
    title: seoTitle || localizedTitle || 'Product',
    metaDescription: metaDescription,
    slug: kebab(localizedTitle || p.handle || 'product'),
    bodyHtml: localizedBody || `<p>${localizedTitle}</p>`,
    bullets: [], // Вече не използваме bullets
    faq: [],     // Вече не използваме FAQ
    imageAlt: [] // Може да добавим от product.images ако има altText
  };

  const fixed = {
    productId: p.id,
    provider: 'local',  // Променено от 'openrouter'
    model: 'none',      // Няма модел - локално генериране
    language: langNormalized,
    seo: {
      ...localSeoData,
      jsonLd: generateProductJsonLd(p, localSeoData, langNormalized),
    },
    quality: {
      warnings: [],
      model: 'none',
      tokens: 0,      // 0 токена!
      costUsd: 0,     // $0.00 разходи!
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

router.post('/seo/apply', async (req, res) => {
  try {
    const shop = req.query.shop || req.body?.shop;
    if (!shop) return res.status(400).json({ error: 'Missing shop' });

    const { productId, seo, options = {}, language } = req.body;
    if (!productId) return res.status(400).json({ error: 'Missing productId' });

    // Get language from body (required now)
    if (!language) {
      return res.status(400).json({ error: "Missing 'language' for /seo/apply" });
    }

    // Validate and get shop locales
    const Q_SHOP_LOCALES = `
      query ShopLocales {
        shopLocales { locale primary published }
      }
    `;
    const shopData = await shopGraphQL(shop, Q_SHOP_LOCALES, {});
    const primary = (shopData?.shopLocales || []).find(l => l?.primary)?.locale?.toLowerCase() || 'en';
    const isPrimary = language.toLowerCase() === primary.toLowerCase();

    // Decide what to update based on primary/secondary language
    const updateTitle = isPrimary && (options?.updateTitle !== false);
    const updateBody = isPrimary && (options?.updateBody !== false);
    const updateSeo = isPrimary && (options?.updateSeo !== false);
    const updateBullets = options?.updateBullets !== false;
    const updateFaq = options?.updateFaq !== false;
    const updateAlt = options?.updateAlt === true;
    const dryRun = options?.dryRun === true;

    const updated = { title: false, body: false, seo: false, bullets: false, faq: false, imageAlt: false };
    const errors = [];

    // Validate/normalize - променяме provider на 'local'
    const fixed = fixupAndValidate({
      productId,
      provider: 'local',    // Променено от 'openrouter'
      model: 'none',        // Променено от 'apply'
      language: canonLang(language),
      seo,
      quality: { warnings: [], model: 'none', tokens: 0, costUsd: 0 },
    });
    if (!fixed.ok) {
      return res.status(400).json({ ok: false, error: 'Schema validation failed', issues: fixed.issues });
    }
    const v = fixed.value.seo;

    if (!dryRun) {
      // 1. Update product base fields ONLY for primary language
      if (isPrimary && (updateTitle || updateBody || updateSeo)) {
        const input = { id: productId };
        if (updateTitle) input.title = v.title;
        if (updateBody) input.descriptionHtml = v.bodyHtml;
        if (updateSeo) input.seo = { title: v.title, description: v.metaDescription };

        const mut = `
          mutation ProductUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id }
              userErrors { field message }
            }
          }
        `;
        const upd = await shopGraphQL(shop, mut, { input });
        const userErrors = upd?.productUpdate?.userErrors || [];
        if (userErrors.length) errors.push(...userErrors.map(e => e.message || JSON.stringify(e)));
        else {
          if (updateTitle) updated.title = true;
          if (updateBody) updated.body = true;
          if (updateSeo) updated.seo = true;
        }
      }

      // 2. Ensure metafield definition exists
      await ensureMetafieldDefinition(shop, language.toLowerCase());

      // 3. Always write language-specific metafield with full SEO data
      const metaMutation = `
        mutation SetAiSeo($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
            metafields { id }
          }
        }
      `;
      const mfKey = `seo__${language.toLowerCase()}`;
      const metafields = [{
        ownerId: productId,
        namespace: 'seo_ai',
        key: mfKey,
        type: 'json',
        value: JSON.stringify({
          ...v,
          language: language.toLowerCase(),
          updatedAt: new Date().toISOString()
        }),
      }];

      // ЗАКОМЕНТИРАНО - Вече не записваме отделни bullets/faq метафийлди
      // 4. Also update bullets/faq if requested
      if (updateBullets) {
        metafields.push({
          ownerId: productId,
          namespace: 'seo_ai',
          key: `bullets__${language.toLowerCase()}`,
          type: 'json',
          value: JSON.stringify(v.bullets || []),
        });
      }
      if (updateFaq) {
        metafields.push({
          ownerId: productId,
          namespace: 'seo_ai',
          key: `faq__${language.toLowerCase()}`,
          type: 'json',
          value: JSON.stringify(v.faq || []),
        });
      }

      const mfRes = await shopGraphQL(shop, metaMutation, { metafields });
      const mfErrs = mfRes?.metafieldsSet?.userErrors || [];
      if (mfErrs.length) {
        errors.push(...mfErrs.map(e => e.message || JSON.stringify(e)));
      } else {
        updated.bullets = updateBullets;
        updated.faq = updateFaq;
      }

      // 5. Optional: image alts (if needed)
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
            const r = await shopGraphQL(shop, mu, { productId, id: it.imageId, altText: String(it.alt || '').slice(0, 125) });
            const ue = r?.productImageUpdate?.userErrors || [];
            if (ue.length) errors.push(...ue.map((e) => e.message || JSON.stringify(e)));
            else updated.imageAlt = true;
          } catch (e) {
            errors.push(e.message || String(e));
          }
        }
      }
    }

    res.json({ 
      ok: errors.length === 0, 
      shop, 
      productId, 
      updated, 
      errors,
      language,
      isPrimary 
    });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || String(e) });
  }
});

// ==================== COLLECTIONS ENDPOINTS ====================

// GET /collections/list - Обновена версия с езици
router.get('/collections/list', async (req, res) => {
  try {
    const shop = requireShop(req);
    const token = await resolveAdminTokenForShop(shop);
    
    console.log('[COLLECTIONS] Fetching collections via REST API for shop:', shop);
    
    // Вземи custom collections
    const customUrl = `https://${shop}/admin/api/${API_VERSION}/custom_collections.json?limit=50`;
    const customResponse = await fetch(customUrl, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      }
    });
    
    if (!customResponse.ok) {
      throw new Error(`Failed to fetch custom collections: HTTP ${customResponse.status}`);
    }
    
    const customData = await customResponse.json();
    const collections = customData.custom_collections || [];
    
    // Вземи и smart collections
    const smartUrl = `https://${shop}/admin/api/${API_VERSION}/smart_collections.json?limit=50`;
    const smartResponse = await fetch(smartUrl, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      }
    });
    
    if (smartResponse.ok) {
      const smartData = await smartResponse.json();
      collections.push(...(smartData.smart_collections || []));
    }
    
    console.log('[COLLECTIONS] Found', collections.length, 'collections');
    
    // За всяка колекция вземи брой продукти И проверяваме за SEO metafields
    const collectionsWithData = await Promise.all(
      collections.map(async (c) => {
        let productsCount = 0;
        let hasSeoData = false;
        let optimizedLanguages = [];
        
        try {
          // Вземи брой продукти
          const countUrl = `https://${shop}/admin/api/${API_VERSION}/products/count.json?collection_id=${c.id}`;
          const countResponse = await fetch(countUrl, {
            headers: {
              'X-Shopify-Access-Token': token,
              'Content-Type': 'application/json',
            }
          });
          
          if (countResponse.ok) {
            const countData = await countResponse.json();
            productsCount = countData.count || 0;
          }
          
          // Проверка за SEO metafields и езици
          try {
            const metafieldUrl = `https://${shop}/admin/api/${API_VERSION}/collections/${c.id}/metafields.json?namespace=seo_ai`;
            const mfResponse = await fetch(metafieldUrl, {
              headers: {
                'X-Shopify-Access-Token': token,
                'Content-Type': 'application/json',
              }
            });
            
            if (mfResponse.ok) {
              const mfData = await mfResponse.json();
              const metafields = mfData.metafields || [];
              
              console.log(`[COLLECTIONS] Metafields for "${c.title}":`, metafields.map(m => m.key));
              
              // Извличаме езиците от keys като seo__en, seo__bg и т.н.
              metafields.forEach(mf => {
                if (mf.key && mf.key.startsWith('seo__')) {
                  const lang = mf.key.replace('seo__', '');
                  if (lang && !optimizedLanguages.includes(lang)) {
                    optimizedLanguages.push(lang);
                  }
                }
              });
              
              hasSeoData = optimizedLanguages.length > 0;
            }
          } catch (e) {
            console.error('[COLLECTIONS] Error checking metafields:', e);
          }
          
          console.log(`[COLLECTIONS] Collection "${c.title}" - products: ${productsCount}, languages: ${optimizedLanguages.join(',') || 'none'}`);
          
        } catch (e) {
          console.error('[COLLECTIONS] Error checking collection data:', e.message);
        }
        
        return {
          id: `gid://shopify/Collection/${c.id}`,
          title: c.title,
          handle: c.handle,
          description: c.body_html || '',
          productsCount: productsCount,
          seo: c.seo || null,
          hasSeoData: hasSeoData,
          optimizedLanguages: optimizedLanguages, // Нов масив с оптимизирани езици
          updatedAt: c.updated_at
        };
      })
    );
    
    res.json({ collections: collectionsWithData });
  } catch (e) {
    console.error('[COLLECTIONS] Error:', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /seo/generate-collection
router.post('/seo/generate-collection', async (req, res) => {
  try {
    const shop = requireShop(req);
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
    
    const data = await shopGraphQL(shop, query, { id: collectionId });
    const collection = data?.collection;
    
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    // Generate SEO data locally (no AI costs)
    const cleanDescription = (collection.descriptionHtml || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const seoData = {
      title: collection.title.slice(0, 70),
      metaDescription: cleanDescription.slice(0, 160) || `Shop our ${collection.title} collection`,
      slug: kebab(collection.handle || collection.title),
      categoryKeywords: extractCategoryKeywords(collection),
      bullets: generateCollectionBullets(collection),
      faq: generateCollectionFAQ(collection),
      jsonLd: generateCollectionJsonLd(collection)
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
router.post('/seo/apply-collection', async (req, res) => {
  console.log('[APPLY-COLLECTION] Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const shop = requireShop(req);
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
    const shopData = await shopGraphQL(shop, Q_SHOP_LOCALES, {});
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
      
      const result = await shopGraphQL(shop, mutation, { input });
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
      const metafields = [{
        ownerId: collectionId,
        namespace: 'seo_ai',  // Същият namespace като продуктите!
        key: `seo__${language}`,  // Същият формат като продуктите!
        type: 'json',
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
      
      const mfResult = await shopGraphQL(shop, metaMutation, { metafields });
      const mfErrors = mfResult?.metafieldsSet?.userErrors || [];
      
      if (mfErrors.length) {
        errors.push(...mfErrors.map(e => e.message));
      } else {
        updated.metafields = true;
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

// Helper functions за collections (добави ги преди export default router)
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

function generateCollectionBullets(collection) {
  const bullets = [];
  
  if (collection.productsCount > 10) {
    bullets.push(`Over ${collection.productsCount} products to choose from`);
  }
  
  const priceRange = getPriceRange(collection.products?.edges || []);
  if (priceRange) {
    bullets.push(`Prices from ${priceRange.min} to ${priceRange.max}`);
  }
  
  const brands = getUniqueBrands(collection.products?.edges || []);
  if (brands.length > 0) {
    bullets.push(`Featuring brands: ${brands.slice(0, 3).join(', ')}`);
  }
  
  bullets.push('Free shipping on orders over $50');
  bullets.push('Easy returns within 30 days');
  
  return bullets.slice(0, 5);
}

function generateCollectionFAQ(collection) {
  return [
    {
      q: `How many products are in the ${collection.title} collection?`,
      a: `This collection contains ${collection.productsCount} carefully selected products.`
    },
    {
      q: 'Do you offer free shipping?',
      a: 'Yes, we offer free shipping on all orders over $50.'
    },
    {
      q: 'What is your return policy?',
      a: 'We accept returns within 30 days of purchase for a full refund.'
    }
  ];
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
router.post('/seo/generate-collection-multi', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { collectionId, model, languages = [] } = req.body;
    
    if (!collectionId || !languages.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const results = [];
    
    for (const language of languages) {
      try {
        // Използваме съществуващия single-language endpoint вътрешно
        const query = `
          query GetCollection($id: ID!) {
            collection(id: $id) {
              id
              title
              handle
              descriptionHtml
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
        
        const data = await shopGraphQL(shop, query, { id: collectionId });
        const collection = data?.collection;
        
        if (!collection) {
          throw new Error('Collection not found');
        }
        
        // Generate SEO data locally
        const cleanDescription = (collection.descriptionHtml || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        const seoData = {
          title: collection.title.slice(0, 70),
          metaDescription: cleanDescription.slice(0, 160) || `Shop our ${collection.title} collection`,
          slug: kebab(collection.handle || collection.title),
          categoryKeywords: extractCategoryKeywords(collection),
          bullets: generateCollectionBullets(collection),
          faq: generateCollectionFAQ(collection),
          jsonLd: generateCollectionJsonLd(collection)
        };
        
        results.push({
          language: canonLang(language),
          seo: seoData,
          success: true
        });
      } catch (err) {
        results.push({
          language: canonLang(language),
          error: err.message,
          success: false
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
router.post('/seo/apply-collection-multi', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { collectionId, results = [], options = {} } = req.body;
    
    console.log('[APPLY-MULTI] Full request body:', JSON.stringify(req.body, null, 2));
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
    const shopData = await shopGraphQL(shop, Q_SHOP_LOCALES, {});
    const primary = (shopData?.shopLocales || []).find(l => l?.primary)?.locale?.toLowerCase() || 'en';
    
    // Ensure EN definition always exists
    const allLanguages = results.map(r => r.language);
    console.log('[APPLY-MULTI] Ensuring definitions for:', allLanguages);
    await ensureCollectionMetafieldDefinitions(shop, allLanguages);
    
    console.log('[APPLY-MULTI] Options:', options);
    console.log('[APPLY-MULTI] options.updateMetafields:', options.updateMetafields);
    
    for (const result of results) {
      try {
        const { language, seo } = result;
        const isPrimary = language.toLowerCase() === primary.toLowerCase();
        
        console.log(`[APPLY-MULTI] Processing ${language}, isPrimary: ${isPrimary}`);
        console.log(`[APPLY-MULTI] Processing ${language} with options:`, {
          updateTitle: options.updateTitle,
          updateDescription: options.updateDescription,
          updateSeo: options.updateSeo,
          updateMetafields: options.updateMetafields
        });
        
        // Update collection base fields only for primary language
        if (isPrimary && (options.updateTitle || options.updateDescription || options.updateSeo)) {
          console.log(`[APPLY-MULTI] ENTERING primary language update block for ${language}`);
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
          
          const updateResult = await shopGraphQL(shop, mutation, { input });
          const userErrors = updateResult?.collectionUpdate?.userErrors || [];
          
          if (userErrors.length) {
            errors.push(...userErrors.map(e => `${language}: ${e.message}`));
          } else {
            updated.push({ language, fields: ['title', 'description', 'seo'] });
          }
          console.log(`[APPLY-MULTI] EXITING primary language update block for ${language}`);
        }
        
        console.log(`[APPLY-MULTI] About to update metafields, options.updateMetafields = ${options.updateMetafields}`);
        
        // Валидация за празни SEO данни ПРЕДИ metafields блока
        if (!seo || !seo.title || !seo.metaDescription) {
          console.error(`[APPLY-MULTI] Empty SEO data for ${language}, skipping metafields`);
          errors.push(`${language}: Empty SEO data`);
        } else {
          // Always update metafields
          if (options.updateMetafields !== false) {
            console.log(`[APPLY-MULTI] Creating metafield for ${language}`);
          
          // Ensure definition exists for this language
          await ensureCollectionMetafieldDefinitions(shop, [language]);
          
          const key = `seo__${String(language || 'en').toLowerCase()}`; // ВИНАГИ lowercase!
          
          // Добави логове
          console.log(`[APPLY-MULTI] Writing metafield with key: ${key}`);
          
          const metafields = [{
            ownerId: collectionId,
            namespace: 'seo_ai',  // Същият namespace като продуктите!
            key,
            type: 'json',
            value: JSON.stringify({
              ...seo,
              language: key.replace('seo__', ''), // също lowercase
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
          
          const mfResult = await shopGraphQL(shop, metaMutation, { metafields });
          const mfErrors = mfResult?.metafieldsSet?.userErrors || [];
          
          console.log(`[APPLY-MULTI] MetafieldsSet response:`, {
            metafieldId: mfResult?.metafieldsSet?.metafields?.[0]?.id,
            key: mfResult?.metafieldsSet?.metafields?.[0]?.key,
            errors: mfErrors
          });
          
          console.log(`[APPLY-MULTI] Metafield result for ${language}:`, mfResult);
          
          if (mfErrors.length) {
            errors.push(...mfErrors.map(e => `${language} metafield: ${e.message}`));
          } else {
            // Веднага провери с GraphQL
            const verifyQuery = `
              query {
                collection(id: "${collectionId}") {
                  metafield(namespace: "seo_ai", key: "${key}") {
                    id
                    value
                  }
                }
              }
            `;
            
            try {
              const verifyResult = await shopGraphQL(shop, verifyQuery);
              console.log(`[APPLY-MULTI] GraphQL verify ${key}:`, {
                exists: !!verifyResult?.collection?.metafield,
                id: verifyResult?.collection?.metafield?.id
              });
            } catch (e) {
              console.error(`[APPLY-MULTI] Verify failed:`, e.message);
            }
            
            updated.push({ language, fields: ['metafields'] });
          }
        }
        } // Затваря else блока за валидацията
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
router.get('/collections/check-definitions', async (req, res) => {
  try {
    const shop = requireShop(req);
    
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
    
    const data = await shopGraphQL(shop, query);
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
router.post('/collections/create-definitions', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { languages = ['en'] } = req.body;
    
    console.log('[CREATE-DEFINITIONS] Creating definitions for languages:', languages);
    
    const results = await ensureCollectionMetafieldDefinitions(shop, languages);
    
    res.json({
      ok: true,
      languages,
      results
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /collections/init-metafields - Създава metafield definitions за колекции
router.post('/collections/init-metafields', async (req, res) => {
  try {
    const shop = requireShop(req);
    
    // Вземи езиците на магазина
    const Q_SHOP_LOCALES = `
      query ShopLocales {
        shopLocales { locale primary published }
      }
    `;
    const shopData = await shopGraphQL(shop, Q_SHOP_LOCALES, {});
    const languages = (shopData?.shopLocales || [])
      .filter(l => l.published)
      .map(l => canonLang(l.locale));
    
    const uniqueLanguages = [...new Set(languages)];
    console.log('[INIT] Creating collection metafield definitions for languages:', uniqueLanguages);
    
    const results = await ensureCollectionMetafieldDefinitions(shop, uniqueLanguages);
    
    res.json({
      ok: true,
      languages: uniqueLanguages,
      results
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /collections/init-metafield-definitions - Създава metafield definitions за колекции
router.post('/collections/init-metafield-definitions', async (req, res) => {
  try {
    const shop = requireShop(req);
    
    // Вземи езиците на магазина
    const Q_SHOP_LOCALES = `
      query ShopLocales {
        shopLocales { locale primary published }
      }
    `;
    const shopData = await shopGraphQL(shop, Q_SHOP_LOCALES, {});
    const languages = (shopData?.shopLocales || [])
      .filter(l => l.published)
      .map(l => canonLang(l.locale));
    
    const uniqueLanguages = [...new Set(languages)];
    const results = [];
    
    // Създаваме definition за всеки език
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
        const result = await shopGraphQL(shop, mutation, {});
        
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

// GET /collections/:id/seo-data - Връща SEO данни за preview
router.get('/collections/:id/seo-data', async (req, res) => {
  try {
    const shop = requireShop(req);
    const token = await resolveAdminTokenForShop(shop);
    const collectionId = req.params.id;
    
    // Вземи metafields
    const metafieldUrl = `https://${shop}/admin/api/${API_VERSION}/collections/${collectionId.split('/').pop()}/metafields.json?namespace=seo_ai`;
    const mfResponse = await fetch(metafieldUrl, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      }
    });
    
    if (!mfResponse.ok) {
      return res.status(404).json({ error: 'No SEO data found' });
    }
    
    const mfData = await mfResponse.json();
    const metafields = mfData.metafields || [];
    
    // Групираме по език
    const results = [];
    metafields.forEach(mf => {
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

export default router;