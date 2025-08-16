// backend/controllers/seoController.js
// Routes: /plans/me, /seo/generate, /seo/apply
// All comments are in English.

import express from 'express';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const router = express.Router();

// ---------- Plan presets ----------
const PLAN_PRESETS = {
  starter: {
    plan: 'Starter',
    planKey: 'starter',
    queryLimit: 50,
    productLimit: 150,
    providersAllowed: ['deepseek', 'llama'],
    modelsSuggested: [
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.1-8b-instruct',
    ],
    autosync: '14d',
  },
  professional: {
    plan: 'Professional',
    planKey: 'professional',
    queryLimit: 600,
    productLimit: 300,
    providersAllowed: ['openai', 'llama', 'deepseek'],
    modelsSuggested: [
      'openai/gpt-4o-mini',
      'openai/o3-mini',
      'meta-llama/llama-3.1-8b-instruct',
      'deepseek/deepseek-chat',
    ],
    autosync: '48h',
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
    providersAllowed: ['claude', 'openai', 'gemini', 'llama'],
    modelsSuggested: [
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o-mini',
      'google/gemini-1.5-pro',
      'meta-llama/llama-3.1-70b-instruct',
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

// ---------- Admin API helpers ----------
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

function normalizeShop(shop) {
  if (!shop) return '';
  const s = String(shop).trim();
  if (!s) return '';
  if (s.endsWith('.myshopify.com')) return s;
  return s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
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

function resolveAdminTokenForShop(_shop) {
  const t = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
  if (t && t.trim()) return t.trim();
  const err = new Error('No Admin API token available for this shop');
  err.status = 400;
  throw err;
}

async function shopGraphQL(shop, query, variables = {}) {
  const token = resolveAdminTokenForShop(shop);
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const rsp = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await rsp.json();
  if (!rsp.ok || json.errors) {
    const e = new Error(`Admin GraphQL error: ${JSON.stringify(json.errors || json)}`);
    e.status = rsp.status || 500;
    throw e;
  }
  // Collect userErrors nested anywhere in data
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

// ---------- OpenRouter (AI) ----------
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

function strictPrompt(product, language) {
  return [
    {
      role: 'system',
      content:
        `You are an SEO generator for Shopify products. Return ONLY valid JSON that matches the schema I provide. ` +
        `Language: ${language}. Respect length limits strictly. Use concise, professional tone. ` +
        `Never include markdown or extra text. No trailing commas.`,
    },
    {
      role: 'user',
      content:
`Schema:

{
  "productId": "gid://shopify/Product/...",
  "provider": "openrouter",
  "model": "vendor/model",
  "language": "en|de|es|fr|bg|...",
  "seo": {
    "title": "Max 70 chars",
    "metaDescription": "20..200 chars",
    "slug": "kebab-case",
    "bodyHtml": "<p>Rich HTML...</p>",
    "bullets": ["Point 1","Point 2","Point 3"],
    "faq": [{"q":"Question?","a":"Answer."}],
    "imageAlt": [{"imageId":"gid://shopify/ProductImage/...","alt":"Short alt"}],
    "jsonLd": { "@context":"https://schema.org", "@type":"Product", "name":"...", "description":"...", "offers": { "@type":"Offer","price":"...","priceCurrency":"..." } }
  },
  "quality": { "warnings":[], "model":"vendor/model", "tokens":0, "costUsd":0 }
}

Context:
${JSON.stringify(product, null, 2)}

Rules:
- Title ≤ 70 chars; meta 20..200.
- Slug = lowercase kebab-case.
- Body HTML clean (<h2>,<ul>,<li>,<p>).
- Bullets: 3–6; FAQ: 1–5.
- Output ONLY the JSON.`,
    },
  ];
}

async function callOpenRouter(model, messages) {
  const url = `${OPENROUTER_BASE_URL}/chat/completions`;
  const rsp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
    }),
  });
  const json = await rsp.json();
  if (!rsp.ok) {
    const e = new Error(`OpenRouter error: ${JSON.stringify(json)}`);
    e.status = rsp.status || 502;
    throw e;
  }
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    const e = new Error(`OpenRouter returned no content: ${JSON.stringify(json)}`);
    e.status = 502;
    throw e;
  }
  return content;
}

// ---------- JSON schema ----------
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['productId', 'provider', 'model', 'language', 'seo', 'quality'],
  properties: {
    productId: { type: 'string', pattern: '^gid://shopify/Product/\\d+$' },
    provider: { type: 'string' },
    model: { type: 'string' },
    language: { type: 'string', minLength: 2, maxLength: 10 },
    seo: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'metaDescription', 'slug', 'bodyHtml', 'bullets', 'faq', 'jsonLd'],
      properties: {
        title: { type: 'string', minLength: 5, maxLength: 70 },
        metaDescription: { type: 'string', minLength: 20, maxLength: 200 },
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
              alt: { type: 'string', minLength: 2, maxLength: 120 },
            },
          },
        },
        jsonLd: { type: 'object', minProperties: 1 },
      },
    },
    quality: {
      type: 'object',
      additionalProperties: false,
      required: ['warnings', 'model', 'tokens', 'costUsd'],
      properties: {
        warnings: { type: 'array', items: { type: 'string' } },
        model: { type: 'string' },
        tokens: { type: 'number' },
        costUsd: { type: 'number' },
      },
    },
  },
};
const validateOutput = ajv.compile(OUTPUT_SCHEMA);

// ---------- Small utils ----------
function toKebab(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}
function truncate(s, max) {
  const str = String(s || '').trim();
  if (str.length <= max) return str;
  return str.slice(0, max).replace(/\s+\S*$/, '').trim();
}
function sanitizeHtml(html) {
  const s = String(html || '');
  return s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
}
function fixups(out, ctx = {}) {
  const res = JSON.parse(JSON.stringify(out));
  if (ctx.productId) res.productId = ctx.productId;
  if (ctx.model) res.model = ctx.model;
  if (ctx.language) res.language = ctx.language;
  res.provider = 'openrouter';
  if (res.seo) {
    res.seo.title = truncate(res.seo.title, 70);
    if (res.seo.metaDescription) {
      let md = res.seo.metaDescription.trim();
      if (md.length < 20) md = (md + ' — ').repeat(10).slice(0, 60);
      res.seo.metaDescription = truncate(md, 200);
    }
    res.seo.slug = toKebab(res.seo.slug || res.seo.title || '');
    res.seo.bodyHtml = sanitizeHtml(res.seo.bodyHtml || '');
  }
  if (!res.quality) {
    res.quality = { warnings: [], model: res.model || '', tokens: 0, costUsd: 0 };
  }
  return res;
}

// ---------- Routes ----------

// GET /plans/me
router.get('/plans/me', async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop || req.headers['x-shop']) || '';
    const plan = resolvePlanForShop(shop);
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    res.json({ shop, ...plan, queryCount: 0, inTrial: false, trialEndsAt });
  } catch (err) {
    console.error('plans/me error:', err);
    res.status(500).json({ error: 'Plans error', message: err.message });
  }
});

// POST /seo/generate
router.post('/seo/generate', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { productId, model, language = 'en' } = req.body || {};
    if (!productId || !model) {
      return res.status(400).json({ error: 'Missing required fields: shop, model, productId' });
    }
    const q = `
      query Product($id: ID!) {
        product(id: $id) {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
          images(first: 10) { edges { node { id altText } } }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          handle
        }
      }
    `;
    const data = await shopGraphQL(shop, q, { id: productId });
    const p = data?.product;
    if (!p) throw new Error('Product not found');

    const ctx = {
      id: p.id,
      title: p.title,
      descriptionHtml: p.descriptionHtml,
      vendor: p.vendor,
      productType: p.productType,
      tags: p.tags,
      handle: p.handle,
      price: p?.priceRangeV2?.minVariantPrice?.amount || null,
      currency: p?.priceRangeV2?.minVariantPrice?.currencyCode || null,
      images: (p.images?.edges || []).map(e => ({ id: e.node.id, altText: e.node.altText || null })),
    };

    const messages = strictPrompt(ctx, language);
    const content = await callOpenRouter(model, messages);

    let candidate;
    try { candidate = JSON.parse(content); }
    catch { return res.status(400).json({ error: 'Model did not return valid JSON', raw: content.slice(0, 500) }); }

    const fixed = fixups(candidate, { productId, model, language });
    const ok = validateOutput(fixed);
    if (!ok) {
      return res.status(400).json({ error: 'Output failed schema validation', issues: validateOutput.errors, sample: fixed });
    }
    return res.json(fixed);
  } catch (err) {
    console.error('seo/generate error:', err);
    res.status(err?.status || 500).json({ error: err.message || 'Generate error' });
  }
});

// POST /seo/apply
router.post('/seo/apply', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { productId, seo, options = {} } = req.body || {};
    if (!productId || !seo) {
      return res.status(400).json({ error: 'Missing productId or seo' });
    }

    const updateTitle = options.updateTitle !== false;
    const updateBody = options.updateBody !== false;
    const updateSeo = options.updateSeo !== false;
    const updateBullets = options.updateBullets !== false;
    const updateFaq = options.updateFaq !== false;
    const updateAlt = options.updateAlt === true;
    const dryRun = options.dryRun === true;

    const updated = { title: false, body: false, seo: false, bullets: false, faq: false, imageAlt: false };
    const errors = [];

    if (!dryRun) {
      // 1) productUpdate
      if (updateTitle || updateBody || updateSeo) {
        const input = { id: productId };
        if (updateTitle && seo.title) input.title = seo.title;
        if (updateBody && seo.bodyHtml) input.descriptionHtml = seo.bodyHtml;
        if (updateSeo && (seo.title || seo.metaDescription)) {
          input.seo = {
            ...(seo.title ? { title: seo.title } : {}),
            ...(seo.metaDescription ? { description: seo.metaDescription } : {}),
          };
        }
        if (Object.keys(input).length > 1) {
          const mut = `
            mutation UpdateProduct($input: ProductInput!) {
              productUpdate(input: $input) {
                product { id }
                userErrors { field message }
              }
            }
          `;
          try {
            await shopGraphQL(shop, mut, { input });
            updated.title = !!input.title;
            updated.body = !!input.descriptionHtml;
            updated.seo = !!input.seo;
          } catch (e) {
            errors.push(\`productUpdate: \${e.message}\`);
          }
        }
      }

      // 2) metafieldsSet
      const metaInputs = [];
      if (updateBullets && Array.isArray(seo.bullets)) {
        metaInputs.push({
          ownerId: productId,
          namespace: 'seo_ai',
          key: 'bullets',
          type: 'json',
          value: JSON.stringify(seo.bullets),
        });
      }
      if (updateFaq && Array.isArray(seo.faq)) {
        metaInputs.push({
          ownerId: productId,
          namespace: 'seo_ai',
          key: 'faq',
          type: 'json',
          value: JSON.stringify(seo.faq),
        });
      }
      if (metaInputs.length) {
        const mut = `
          mutation SetMetafields($m: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $m) {
              metafields { key namespace type }
              userErrors { field message }
            }
          }
        `;
        try {
          await shopGraphQL(shop, mut, { m: metaInputs });
          updated.bullets = metaInputs.some(m => m.key === 'bullets');
          updated.faq = metaInputs.some(m => m.key === 'faq');
        } catch (e) {
          errors.push(\`metafieldsSet: \${e.message}\`);
        }
      }

      // 3) ensure metafield definitions exist (fix: do not request .type)
      try {
        const defsQ = `
          query {
            metafieldDefinitions(ownerType: PRODUCT, first: 20, namespace: "seo_ai") {
              edges { node { id name key namespace } }
            }
          }
        `;
        const defs = await shopGraphQL(shop, defsQ);
        const haveBullets = !!(defs?.metafieldDefinitions?.edges || []).find(e => e.node.key === 'bullets');
        const haveFaq = !!(defs?.metafieldDefinitions?.edges || []).find(e => e.node.key === 'faq');
        const createMut = `
          mutation($def: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $def) {
              createdDefinition { id }
              userErrors { field message }
            }
          }
        `;
        if (!haveBullets) {
          await shopGraphQL(shop, createMut, {
            def: { name: 'AI Bullets', namespace: 'seo_ai', key: 'bullets', type: 'json', ownerType: 'PRODUCT' },
          });
        }
        if (!haveFaq) {
          await shopGraphQL(shop, createMut, {
            def: { name: 'AI FAQ', namespace: 'seo_ai', key: 'faq', type: 'json', ownerType: 'PRODUCT' },
          });
        }
      } catch (e) {
        // Non-fatal
        errors.push(`metafieldDefinitionCreate: ${e.message}`);
      }
    }

    return res.json({
      ok: errors.length === 0,
      shop,
      productId,
      updated,
      errors,
    });
  } catch (err) {
    console.error('seo/apply error:', err);
    res.status(err?.status || 500).json({ error: err.message || 'Apply error' });
  }
});

export default router;
