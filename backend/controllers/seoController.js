// backend/controllers/seoController.js
// Routes: GET /plans/me, POST /seo/generate, POST /seo/apply
// - /seo/generate: auto-fetches product by productId via Admin API (offline token).
//   shop is inferred from Shopify session (embedded) and model defaults to the first allowed for the plan.
// - Validates the LLM output with AJV against a strict schema and applies safe "fixups".
// - /seo/apply: Updates product title/body/seo + metafields (seo_ai.bullets/faq).

import express from 'express';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { callOpenRouterJSON } from '../ai/openrouter.js';
import { withSubscription, enforceQuota, consumeQuery, buildPlanView } from '../middleware/quota.js';
import { allowedModelsForPlan } from '../plans.js';

const router = express.Router();

// ----------------------------- Helpers -----------------------------
function getAdminApiVersion() {
  return process.env.SHOPIFY_API_VERSION || '2025-07';
}

async function adminGraphQL({ shop, accessToken, query, variables }) {
  if (!shop || !accessToken) throw new Error('Missing shop or access token for Admin GraphQL');
  const url = `https://${shop}/admin/api/${getAdminApiVersion()}/graphql.json`;
  const rsp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await rsp.json();
  if (!rsp.ok || json.errors) {
    const msg = json.errors ? JSON.stringify(json.errors) : await rsp.text();
    const err = new Error(`Admin GraphQL error: ${msg}`);
    err.status = rsp.status || 500;
    throw err;
  }
  return json;
}

/** Try to resolve an offline Admin API token for this shop. */
async function resolveAccessToken(shop, res) {
  // If Shopify auth middleware populated a session, use it
  const sessToken = res?.locals?.shopify?.session?.accessToken;
  if (sessToken) return sessToken;

  // Try common session storages dynamically (Mongo-based)
  const candidates = [
    '../db/ShopifySession.js',
    '../models/ShopifySession.js',
    '../db/Session.js',
    '../models/Session.js',
  ];
  for (const p of candidates) {
    try {
      const mod = await import(p);
      const Model = mod.default || mod.Session || mod.ShopifySession || mod;
      if (!Model?.findOne) continue;

      // Look for classic offline session: id = "offline_<shop>"
      const byId = await Model.findOne({ id: `offline_${shop}` }).lean();
      if (byId?.session) {
        try {
          const s = typeof byId.session === 'string' ? JSON.parse(byId.session) : byId.session;
          if (s?.accessToken) return s.accessToken;
        } catch {}
      }

      // Alternative shape: { shop, isOnline:false, accessToken }
      const doc = await Model.findOne({ shop, isOnline: false }).lean();
      if (doc?.accessToken) return doc.accessToken;

      // Some storages keep JSON under "content" or "payload"
      const alt = await Model.findOne({ shop }).lean();
      const content = alt?.content || alt?.payload || alt?.session;
      if (content) {
        try {
          const s = typeof content === 'string' ? JSON.parse(content) : content;
          if (s?.accessToken) return s.accessToken;
        } catch {}
      }
    } catch {
      // try next candidate
    }
  }

  // Fallback for single-shop setups: env var
  if (process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;

  const e = new Error('No Admin API token available for this shop');
  e.status = 503;
  throw e;
}

async function fetchProductById(shop, accessToken, productId) {
  const q = `
    query Product($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        descriptionHtml
        vendor
        tags
        onlineStoreUrl
        updatedAt
        images(first: 10) {
          edges { node { id altText } }
        }
        variants(first: 25) {
          edges { node { id price } }  # Admin API: price only (no currencyCode/availableForSale)
        }
        seo { title description }
        metafield_seo_ai_bullets: metafield(namespace: "seo_ai", key: "bullets") { value }
        metafield_seo_ai_faq:    metafield(namespace: "seo_ai", key: "faq")    { value }
      }
    }
  `;
  const rsp = await adminGraphQL({ shop, accessToken, query: q, variables: { id: productId } });
  const node = rsp?.data?.product;
  if (!node) {
    const e = new Error('Product not found');
    e.status = 404;
    throw e;
  }
  return node;
}

function sanitizeHtmlBasic(html = '') {
  let out = String(html)
    .replace(/<\s*script[\s\S]*?<\/\s*script\s*>/gi, '')
    .replace(/<\s*style[\s\S]*?<\/\s*style\s*>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\son\w+=\S+/gi, '');
  out = out.replace(/<(?!\/?(p|ul|ol|li|br|strong|em|b|i|h1|h2|h3|a|img)\b)[^>]*>/gi, '');
  return out;
}

const kebab = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const truncate = (s, n) => {
  s = String(s || '');
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
};

const toGid = (maybeNumeric) => {
  const s = String(maybeNumeric || '').trim();
  if (/^gid:\/\//.test(s)) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return s;
};

// ----------------------------- AJV Schema -----------------------------
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const OutputSchema = {
  type: 'object',
  required: ['productId', 'provider', 'language', 'seo', 'quality'],
  properties: {
    productId: { type: 'string' },
    provider: { type: 'string', enum: ['openrouter'] },
    model: { type: 'string' },
    language: { type: 'string' },
    seo: {
      type: 'object',
      required: ['title', 'metaDescription', 'slug', 'bodyHtml', 'bullets', 'faq', 'jsonLd'],
      properties: {
        title: { type: 'string', minLength: 10, maxLength: 120 },
        metaDescription: { type: 'string', minLength: 20, maxLength: 240 },
        slug: { type: 'string' },
        bodyHtml: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 },
        faq: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            required: ['q', 'a'],
            properties: {
              q: { type: 'string' },
              a: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        imageAlt: {
          type: 'array',
          items: {
            type: 'object',
            required: ['imageId', 'alt'],
            properties: {
              imageId: { type: 'string' },
              alt: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        jsonLd: { type: 'object' },
      },
      additionalProperties: false,
    },
    quality: {
      type: 'object',
      required: ['warnings', 'model', 'tokens', 'costUsd'],
      properties: {
        warnings: { type: 'array', items: { type: 'string' } },
        model: { type: 'string' },
        tokens: { type: 'number' },
        costUsd: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const validateOutput = ajv.compile(OutputSchema);

// ----------------------------- Prompts -----------------------------
function buildSystemPrompt(lang = 'en') {
  return [
    `You are an SEO generator for Shopify product pages. Return ONLY valid JSON that matches the given schema.`,
    `Language: ${lang}. Keep tone concise, helpful, non-spammy.`,
    `Constraints: title <= 70 chars; metaDescription ~160-180 chars; slug = kebab-case;`,
    `bodyHtml: safe HTML (p, ul, ol, li, br, strong, em, h1-h3, a, img). No scripts, no inline events.`,
    `bullets: 3-6 short value points. faq: 2-5 Q/A.`,
    `jsonLd: minimal Product schema.org with offers if price available.`,
    `Respond with nothing except the JSON.`,
  ].join('\n');
}

function buildUserPrompt(product) {
  const priceEdge = product?.variants?.edges?.[0]?.node;
  const price = priceEdge?.price || priceEdge?.priceV2?.amount;
  const currency = priceEdge?.currencyCode || priceEdge?.priceV2?.currencyCode;

  const ctx = {
    id: product?.id,
    title: product?.title,
    handle: product?.handle,
    vendor: product?.vendor,
    tags: product?.tags,
    url: product?.onlineStoreUrl,
    price,
    currency,
    descriptionHtml: product?.descriptionHtml,
    images: (product?.images?.edges || []).map((e) => ({
      id: e?.node?.id,
      alt: e?.node?.altText || '',
    })),
  };
  return JSON.stringify({
    schema: 'shopify.product.seo.v1',
    instructions: 'Generate SEO JSON for this product.',
    product: ctx,
  });
}

// ----------------------------- Routes -----------------------------

// GET /plans/me (uses subscription middleware)
router.get('/plans/me', withSubscription, (req, res) => {
  try {
    const view = buildPlanView(req.subscription);
    res.status(200).json(view);
  } catch (e) {
    res.status(500).json({ error: 'Failed to build plan view', details: e.message });
  }
});

// POST /seo/generate
router.post('/seo/generate', withSubscription, enforceQuota(), async (req, res) => {
  try {
    // Accept shop from session/middleware; model may be omitted (we'll auto-pick).
    const shop = req.shop || req.body?.shop || res?.locals?.shopify?.session?.shop || '';
    let { model, language = 'en' } = req.body || {};
    let productId = toGid(req.body?.productId || req.query?.productId);

    if (!productId) {
      return res.status(400).json({ error: 'Missing productId (GID or numeric ID)' });
    }

    if (!model) {
      const allowed = allowedModelsForPlan(req.subscription?.planKey || '');
      if (allowed && allowed.length) {
        model = allowed[0];
      } else {
        return res.status(400).json({ error: 'Missing model and no allowed models found for plan' });
      }
    }

    // Ensure product context: fetch via Admin API
    const accessToken = await resolveAccessToken(shop, res);
    const product = await fetchProductById(shop, accessToken, productId);

    const system = buildSystemPrompt(language);
    const user = buildUserPrompt(product);
    const llm = await callOpenRouterJSON({ model, system, user });

    // Parse + validate
    let parsed;
    try {
      parsed = JSON.parse(llm.text);
    } catch {
      return res.status(400).json({ error: 'Model did not return valid JSON', raw: llm.text?.slice(0, 800) });
    }

    // Minimal fixups before validation (lengths/slug/html sanitize)
    parsed.productId = parsed.productId || productId;
    parsed.provider = 'openrouter';
    parsed.model = llm.model || model;
    parsed.language = language;
    parsed.seo = parsed.seo || {};

    parsed.seo.title = truncate(parsed.seo.title || product?.title || '', 70);
    parsed.seo.metaDescription = truncate(parsed.seo.metaDescription || '', 200);
    parsed.seo.slug = kebab(parsed.seo.slug || product?.handle || parsed.seo.title || '');
    parsed.seo.bodyHtml = sanitizeHtmlBasic(parsed.seo.bodyHtml || '');
    parsed.seo.bullets = Array.isArray(parsed.seo.bullets) ? parsed.seo.bullets.slice(0, 6) : [];
    parsed.seo.faq = Array.isArray(parsed.seo.faq) ? parsed.seo.faq.slice(0, 5) : [];
    parsed.seo.jsonLd = parsed.seo.jsonLd || {};

    parsed.quality = parsed.quality || { warnings: [], model: parsed.model, tokens: llm.tokens || 0, costUsd: llm.costUsd || 0 };

    const ok = validateOutput(parsed);
    if (!ok) {
      return res.status(400).json({
        error: 'Output failed schema validation',
        issues: validateOutput.errors,
        sample: parsed,
      });
    }

    // Count query
    await consumeQuery(shop, 1);

    return res.status(200).json(parsed);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message });
  }
});

// POST /seo/apply
router.post('/seo/apply', withSubscription, async (req, res) => {
  try {
    const shop = req.shop || req.body?.shop || res?.locals?.shopify?.session?.shop || '';
    const { productId: productIdRaw, seo, options = {} } = req.body || {};
    const productId = toGid(productIdRaw);

    if (!shop || !productId || !seo) return res.status(400).json({ error: 'Missing shop, productId or seo' });

    const {
      updateTitle = true,
      updateBody = true,
      updateSeo = true,
      updateBullets = true,
      updateFaq = true,
      updateAlt = false, // not implemented here
      dryRun = false,
    } = options;

    const accessToken = await resolveAccessToken(shop, res);

    const updated = { title: false, body: false, seo: false, bullets: false, faq: false, imageAlt: false };
    const errors = [];

    if (!dryRun) {
      // productUpdate
      if (updateTitle || updateBody || updateSeo) {
        const input = { id: productId };
        if (updateTitle && seo.title) input.title = seo.title;
        if (updateBody && seo.bodyHtml) input.bodyHtml = seo.bodyHtml;
        if (updateSeo && (seo.title || seo.metaDescription)) {
          input.seo = {
            title: seo.title || undefined,
            description: seo.metaDescription || undefined,
          };
        }

        if (Object.keys(input).length > 1) {
          const q = `
            mutation productUpdate($input: ProductInput!) {
              productUpdate(input: $input) {
                product { id }
                userErrors { field message }
              }
            }
          `;
          const rsp = await adminGraphQL({ shop, accessToken, query: q, variables: { input } });
          const errs = rsp?.data?.productUpdate?.userErrors || [];
          if (errs.length) errors.push({ step: 'productUpdate', errors: errs });
          else {
            updated.title = !!input.title;
            updated.body = !!input.bodyHtml;
            updated.seo = !!input.seo;
          }
        }
      }

      // metafieldsSet for seo_ai.bullets / seo_ai.faq
      const metafields = [];
      if (updateBullets && Array.isArray(seo.bullets)) {
        metafields.push({
          ownerId: productId,
          namespace: 'seo_ai',
          key: 'bullets',
          type: 'json',
          value: JSON.stringify(seo.bullets),
        });
      }
      if (updateFaq && Array.isArray(seo.faq)) {
        metafields.push({
          ownerId: productId,
          namespace: 'seo_ai',
          key: 'faq',
          type: 'json',
          value: JSON.stringify(seo.faq),
        });
      }
      if (metafields.length) {
        const q = `
          mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id key namespace type }
              userErrors { field message }
            }
          }
        `;
        const rsp = await adminGraphQL({ shop, accessToken, query: q, variables: { metafields } });
        const errs = rsp?.data?.metafieldsSet?.userErrors || [];
        if (errs.length) errors.push({ step: 'metafieldsSet', errors: errs });
        else {
          updated.bullets = !!metafields.find((m) => m.key === 'bullets');
          updated.faq = !!metafields.find((m) => m.key === 'faq');
        }
      }

      // image alt (optional step 2.1) — omitted in this minimal version
      if (updateAlt && Array.isArray(seo.imageAlt) && seo.imageAlt.length) {
        // TODO: implement productImageUpdate loop (requires image IDs)
        updated.imageAlt = false;
      }
    }

    return res.status(200).json({ ok: true, shop, productId, updated, errors });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message });
  }
});

export default router;
