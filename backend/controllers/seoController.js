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
      'anthropic/claude-3.5-sonnet',
      'anthropic/claude-3-haiku',
      'openai/gpt-4o-mini',
      'openai/o3-mini',
      'google/gemini-1.5-flash',
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

/* --------------------------- Product JSON-LD Generator --------------------------- */
function generateProductJsonLd(product, seoData, language) {
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
    provider: { const: 'openrouter' },
    model: { type: 'string', minLength: 1 },
    language: { type: 'string', minLength: 1, maxLength: 32 }, // no enum
    seo: {
      type: 'object',
      required: ['title', 'metaDescription', 'slug', 'bodyHtml', 'bullets', 'faq', 'jsonLd'],
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
        jsonLd: {
          type: 'object',
          required: ['@context', '@type', 'name', 'description', 'offers'],
          properties: {
            '@context': { const: 'https://schema.org' },
            '@type': { const: 'Product' },
            name: { type: 'string' },
            description: { type: 'string' },
            url: { type: 'string', nullable: true },
            brand: { type: ['string', 'object'], nullable: true },
            offers: {
              type: 'object',
              required: ['@type', 'price', 'priceCurrency'],
              properties: {
                '@type': { const: 'Offer' },
                price: { type: ['string', 'number'] },
                priceCurrency: { type: 'string' },
                availability: { type: 'string', nullable: true },
              },
            },
          },
          additionalProperties: true,
        },
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

  // jsonLd constants + Offer fields
  const fallbackName = p.seo.title || 'Product';
  const fallbackDesc = String(p.seo.bodyHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  if (!p.seo.jsonLd || typeof p.seo.jsonLd !== 'object') {
    p.seo.jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: fallbackName,
      description: clamp(fallbackDesc || fallbackName, META_MAX),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    };
  } else {
    const jl = p.seo.jsonLd;
    jl['@context'] = 'https://schema.org';
    jl['@type'] = 'Product';
    if (!jl.name) jl.name = fallbackName;
    if (!jl.description) jl.description = clamp(fallbackDesc || fallbackName, META_MAX);

    if (!jl.offers || typeof jl.offers !== 'object') jl.offers = {};
    jl.offers['@type'] = 'Offer';
    const priceEmpty = jl.offers.price === undefined || jl.offers.price === null || jl.offers.price === '';
    if (priceEmpty) jl.offers.price = '0';
    if (!jl.offers.priceCurrency || typeof jl.offers.priceCurrency !== 'string') {
      jl.offers.priceCurrency = 'USD';
    } else {
      jl.offers.priceCurrency = jl.offers.priceCurrency.toString().toUpperCase();
    }
  }

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
          edges { node { id altText } }
        }
        priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
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

  if (isPrimary) {
    // For primary language, use base product data
    localizedTitle = p.title;
    localizedBody = p.descriptionHtml;
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
  }

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
  const { content } = await openrouterChat(model, messages, true);

  let candidate;
  try { candidate = JSON.parse(content); }
  catch { throw new Error('Model did not return valid JSON'); }

  const fixed = {
    productId: p.id,
    provider: 'openrouter',
    model,
    language: langNormalized,
    seo: {
      title: candidate.title || localizedTitle || 'Product',
      metaDescription: candidate.metaDescription || '',
      slug: candidate.slug || p.handle || kebab(localizedTitle || 'product'),
      bodyHtml: candidate.bodyHtml || localizedBody || '',
      bullets: Array.isArray(candidate.bullets) ? candidate.bullets : [],
      faq: Array.isArray(candidate.faq) ? candidate.faq : [{ q: `What is ${localizedTitle}?`, a: `A product by ${p.vendor || 'our brand'}.` }],
      imageAlt: Array.isArray(candidate.imageAlt) ? candidate.imageAlt : [],
      jsonLd: generateProductJsonLd(p, {
  title: candidate.title || localizedTitle,
  metaDescription: candidate.metaDescription
}, langNormalized),
        },
    quality: {
      warnings: [],
      model,
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
        `Constraints:\n` +
        `- title <= ${TITLE_LIMIT} chars\n` +
        `- metaDescription ~${META_TARGET} (cap ${META_MAX})\n` +
        `- bullets: array of short benefits (<=160 chars each, min 2)\n` +
        `- faq: array (min 1) of { q, a }\n` +
        `- bodyHtml: clean HTML, no script/iframe/style\n` +
        `- slug: kebab-case\n` +
        `- jsonLd: Product with Offer (price, priceCurrency)\n`,
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

    // Validate/normalize
    const fixed = fixupAndValidate({
      productId,
      provider: 'openrouter',
      model: 'apply',
      language: canonLang(language),
      seo,
      quality: { warnings: [], model: 'apply', tokens: 0, costUsd: 0 },
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

      /* ЗАКОМЕНТИРАНО - Вече не записваме отделни bullets/faq метафийлди
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
      */

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

export default router;