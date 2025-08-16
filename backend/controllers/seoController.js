// backend/controllers/seoController.js
// Unified SEO controller using OpenRouter + plan/quota enforcement.
// Endpoints:
//   POST /seo/generate  { shop, product, productId, model, language }
//   POST /seo/apply     { shop, productId, seo, options }
//   GET  /plans/me?shop=...  -> plan/quota/allowed models

import express from 'express';
import { callOpenRouterJSON } from '../ai/openrouter.js';
import { withSubscription, enforceQuota, consumeQuery, buildPlanView } from '../middleware/quota.js';
import { getPlanConfig, vendorFromModel } from '../plans.js';

const router = express.Router();

/* ============ AJV schema and helpers (inline for cohesion) ============ */
import Ajv from 'ajv';
const ajv = new Ajv({ allErrors: true, removeAdditional: 'failing', strict: false });

const seoSchema = {
  type: "object",
  required: ["productId", "provider", "language", "seo", "quality"],
  additionalProperties: false,
  properties: {
    productId: { type: "string", pattern: "^gid://shopify/Product/\\d+$" },
    provider: { type: "string", enum: ["openrouter"] },
    language: { type: "string", minLength: 2, maxLength: 5 },
    model: { type: "string" },
    seo: {
      type: "object",
      required: ["title", "metaDescription", "slug", "bodyHtml", "bullets", "faq", "jsonLd"],
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 10, maxLength: 70 },
        metaDescription: { type: "string", minLength: 60, maxLength: 180 },
        slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
        bodyHtml: { type: "string", minLength: 30, maxLength: 8000 },
        bullets: {
          type: "array",
          minItems: 3,
          maxItems: 7,
          items: { type: "string", minLength: 2, maxLength: 140 },
        },
        faq: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            required: ["q", "a"],
            additionalProperties: false,
            properties: {
              q: { type: "string", minLength: 5, maxLength: 140 },
              a: { type: "string", minLength: 10, maxLength: 500 },
            },
          },
        },
        imageAlt: {
          type: "array",
          minItems: 0,
          maxItems: 20,
          items: {
            type: "object",
            required: ["imageId", "alt"],
            additionalProperties: false,
            properties: {
              imageId: { type: "string", pattern: "^gid://shopify/ProductImage/\\d+$" },
              alt: { type: "string", minLength: 3, maxLength: 120 },
            },
          },
        },
        jsonLd: { type: "object" },
      },
    },
    quality: {
      type: "object",
      required: ["warnings", "model", "tokens", "costUsd"],
      additionalProperties: false,
      properties: {
        warnings: { type: "array", items: { type: "string" }, maxItems: 10 },
        model: { type: "string" },
        tokens: { type: "integer", minimum: 0 },
        costUsd: { type: "number", minimum: 0 },
      },
    },
  },
};
const validateSEO = ajv.compile(seoSchema);

function toKebabCase(str = "") {
  return String(str)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
function limit(str = "", max = 70) {
  const s = String(str).trim();
  return s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, "").trim();
}
function sanitizeHtmlBasic(html = "") {
  let out = String(html)
    .replace(/<\s*script[\s\S]*?<\/\s*script\s*>/gi, "")
    .replace(/<\s*style[\s\S]*?<\/\s*style\s*>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\son\w+=\S+/gi, "");
  out = out.replace(/<(?!\/?(p|ul|ol|li|br|strong|em|b|i|h1|h2|h3|a|img)\b)[^>]*>/gi, "");
  out = out.replace(/<a\b([^>]*)>/gi, (m, attrs) => {
    const href = attrs.match(/\bhref\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const val = href?.[2] || href?.[3] || href?.[4] || "";
    const safe = /^https?:\/\//i.test(val) || /^mailto:/i.test(val) ? val : "#";
    return `<a href="${safe}">`;
  });
  out = out.replace(/<img\b[^>]*>/gi, (m) => {
    const alt = m.match(/\balt\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const val = alt?.[2] || alt?.[3] || alt?.[4] || "";
    return `<img alt="${val}">`;
  });
  return out;
}
function buildMinimalJsonLd({ name, description, price, currency, url }) {
  const obj = { "@context": "https://schema.org", "@type": "Product", name, description };
  if (price && currency) obj.offers = { "@type": "Offer", price, priceCurrency: currency, availability: "https://schema.org/InStock" };
  if (url) obj.url = url;
  return obj;
}
function collectWarnings({ title, metaDescription, bullets, faq }) {
  const w = [];
  if (!title || title.length < 20) w.push("short title");
  if (!metaDescription || metaDescription.length < 100) w.push("short meta description");
  if (!Array.isArray(bullets) || bullets.length < 3) w.push("few bullets");
  if (!Array.isArray(faq) || faq.length < 2) w.push("few FAQ items");
  return w.slice(0, 10);
}
function estimateTokens(s) {
  const chars = String(s || "").length;
  return Math.ceil(chars / 4);
}
function safeParseJSON(text) {
  if (!text) throw new Error("Empty model response");
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("Model did not return valid JSON");
}
function buildSystemPrompt() {
  return `
You are an SEO writer that outputs ONLY valid JSON matching a given JSON Schema.
Never include code fences, explanations, comments, or any text outside JSON.
Respect length limits strictly. Keep HTML clean (p, ul, ol, li, br, strong, em, h1-h3, a; no inline event handlers).
`.trim();
}
function buildUserPrompt({ product, productId, language, model }) {
  const {
    title = "", descriptionHtml = "", vendor = "", handle = "", tags = [],
    priceRangeV2, onlineStoreUrl, images = [], productType = "", variants = [],
  } = product || {};
  const fallbackPrice = variants?.[0]?.price || priceRangeV2?.minVariantPrice?.amount;
  const currency = variants?.[0]?.currencyCode || priceRangeV2?.minVariantPrice?.currencyCode;
  const imageList = Array.isArray(images) ? images : images?.edges?.map(e => ({ id: e?.node?.id, altText: e?.node?.altText })) || [];
  const plainDesc = String(descriptionHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);

  const schemaShape = {
    productId, provider: "openrouter", model, language,
    seo: {
      title: "Max 70 chars", metaDescription: "Max 160-180 chars", slug: "kebab-case",
      bodyHtml: "<p>Rich but clean HTML</p>",
      bullets: ["Point 1", "Point 2", "Point 3"],
      faq: [{ q: "Question?", a: "Answer." }],
      imageAlt: imageList.slice(0, 12).map((img) => ({ imageId: img?.id || "gid://shopify/ProductImage/0", alt: "Short descriptive alt" })),
      jsonLd: { "@context": "https://schema.org", "@type": "Product",
        name: title || "Product", description: plainDesc || "Product description",
        offers: { "@type": "Offer", price: fallbackPrice || "0.00", priceCurrency: currency || "USD" } },
    },
    quality: { warnings: [], model, tokens: 0, costUsd: 0 },
  };

  return `
Return ONLY a single JSON object that matches this target shape and constraints:

Target shape:
${JSON.stringify(schemaShape, null, 2)}

Hard requirements:
- "seo.title" <= 70 chars; compelling, truthful.
- "seo.metaDescription" ~150–170 chars; CTA tone, no quotes.
- "seo.slug" strictly kebab-case ASCII a–z, 0–9, dashes.
- "seo.bodyHtml" HTML tags allowed: p, ul, ol, li, br, strong, em, h1–h3, a.
- "seo.bullets": 3–7 concise items.
- "seo.faq": 2–6 items.
- "seo.imageAlt": short descriptive alts; skip unknown details.
- "seo.jsonLd": minimal Product JSON-LD.
- Language: ${language}

Product context:
- Title: ${title}
- Vendor: ${vendor}
- Handle: ${handle}
- Type: ${productType}
- Tags: ${Array.isArray(tags) ? tags.join(", ") : ""}
- Price: ${fallbackPrice || ""} ${currency || ""}
- URL: ${onlineStoreUrl || ""}
- Plain description (truncated): ${plainDesc}

Avoid inventing unknown material/fit/color.
`.trim();
}

/* ============ ROUTES ============ */

// Plans view for UI
router.get('/plans/me', withSubscription, async (req, res) => {
  try {
    return res.json(buildPlanView(req.subscription));
  } catch (e) {
    return res.status(500).json({ error: 'plans/me failed', details: e.message });
  }
});

// Generate with OpenRouter
router.post('/seo/generate', withSubscription, enforceQuota(), async (req, res) => {
  try {
    const { product, productId, language = 'en', model } = req.body || {};
    const sub = req.subscription;

    if (!product && !productId) return res.status(400).json({ error: "Provide either 'product' or 'productId'." });
    const pid = product?.id || productId;
    if (!pid || !/^gid:\/\/shopify\/Product\/\d+$/.test(pid)) return res.status(400).json({ error: "Invalid 'productId' (gid://shopify/Product/…)" });

    // Model/vendor check
    const vendor = vendorFromModel(model || '');
    if (!model) return res.status(400).json({ error: 'Missing model (OpenRouter slug, e.g. openai/gpt-4o-mini)' });
    if (!sub.planCfg.providersAllowed.includes(vendor)) {
      return res.status(403).json({ error: `Model vendor '${vendor}' not allowed for your plan` });
    }

    if (!product) {
      return res.status(400).json({ error: "For now, please pass 'product' payload for generation." });
    }

    const system = buildSystemPrompt();
    const user = buildUserPrompt({ product, productId: pid, language, model });

    const out = await callOpenRouterJSON({ model, system, user });
    let obj = safeParseJSON(out.text);

    // Fixups
    obj.productId = pid;
    obj.provider = "openrouter";
    obj.model = model;
    obj.language = (language || "en").slice(0, 5).toLowerCase();
    obj.seo = obj.seo || {};
    obj.seo.title = limit(obj.seo.title || product.title || "Product", 70);
    obj.seo.metaDescription = limit(obj.seo.metaDescription || "", 180);
    obj.seo.slug = toKebabCase(obj.seo.slug || obj.seo.title || product.handle || "");
    obj.seo.bodyHtml = sanitizeHtmlBasic(obj.seo.bodyHtml || "");
    obj.seo.bullets = Array.isArray(obj.seo.bullets) ? obj.seo.bullets.slice(0, 7) : [];
    obj.seo.faq = Array.isArray(obj.seo.faq) ? obj.seo.faq.slice(0, 6) : [];
    if (!Array.isArray(obj.seo.imageAlt)) obj.seo.imageAlt = [];
    obj.seo.imageAlt = obj.seo.imageAlt.filter(x => x && x.imageId && x.alt).slice(0, 20);

    const fallbackPrice = product?.variants?.[0]?.price || product?.priceRangeV2?.minVariantPrice?.amount || null;
    const fallbackCurrency = product?.variants?.[0]?.currencyCode || product?.priceRangeV2?.minVariantPrice?.currencyCode || null;
    const minimalLd = buildMinimalJsonLd({ name: obj.seo.title, description: (obj.seo.metaDescription || "").slice(0,500), price: fallbackPrice, currency: fallbackCurrency, url: product?.onlineStoreUrl });
    obj.seo.jsonLd = Object.assign({}, minimalLd, obj.seo.jsonLd || {});

    obj.quality = obj.quality || {};
    obj.quality.model = out.model || obj.quality.model || model;
    obj.quality.tokens = Number.isInteger(out.tokens) ? out.tokens : estimateTokens(out.text);
    obj.quality.costUsd = typeof out.costUsd === "number" ? out.costUsd : 0;
    const warnings = collectWarnings({ title: obj.seo.title, metaDescription: obj.seo.metaDescription, bullets: obj.seo.bullets, faq: obj.seo.faq });
    obj.quality.warnings = Array.from(new Set([...(obj.quality.warnings || []), ...warnings])).slice(0,10);

    const valid = validateSEO(obj);
    if (!valid) {
      const errors = (validateSEO.errors || []).map((e) => `${e.instancePath} ${e.message}`);
      return res.status(400).json({ error: "Schema validation failed", errors });
    }

    // Consume 1 query
    await consumeQuery(req.shop, 1);

    return res.status(200).json(obj);
  } catch (err) {
    console.error("seo/generate error:", err);
    return res.status(500).json({ error: "Internal error in /seo/generate", details: err.message });
  }
});

// Apply to product via Admin GraphQL
function getShopAndToken(req) {
  const sess = req?.res?.locals?.shopify?.session;
  if (sess?.shop && sess?.accessToken) return { shop: sess.shop, accessToken: sess.accessToken };
  const shop = req.shop || req.query.shop || req.body?.shop || req.headers["x-shopify-shop-domain"] || process.env.SHOPIFY_SHOP;
  const accessToken = req.headers["x-shopify-access-token"] || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
  return { shop, accessToken };
}
async function adminGraphQL({ shop, accessToken, query, variables }) {
  if (!shop || !accessToken) throw new Error("Missing shop or access token");
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-07";
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  const rsp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables }),
  });
  const json = await rsp.json();
  if (!rsp.ok || json.errors) {
    const msg = json.errors ? JSON.stringify(json.errors) : await rsp.text();
    throw new Error(`Admin GraphQL error: ${msg}`);
  }
  return json;
}

router.post('/seo/apply', withSubscription, async (req, res) => {
  try {
    const { productId, seo, options = {} } = req.body || {};
    if (!productId || !/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) {
      return res.status(400).json({ error: "Invalid 'productId' (gid://shopify/Product/…)" });
    }
    if (!seo || typeof seo !== "object") return res.status(400).json({ error: "Missing 'seo' object." });

    const envelope = {
      productId,
      provider: "openrouter",
      language: "en",
      model: seo.model || "",
      seo: {
        title: seo.title || "",
        metaDescription: seo.metaDescription || "",
        slug: seo.slug || toKebabCase(seo.title || ""),
        bodyHtml: sanitizeHtmlBasic(seo.bodyHtml || ""),
        bullets: Array.isArray(seo.bullets) ? seo.bullets : [],
        faq: Array.isArray(seo.faq) ? seo.faq : [],
        imageAlt: Array.isArray(seo.imageAlt) ? seo.imageAlt : [],
        jsonLd: seo.jsonLd || {},
      },
      quality: { warnings: [], model: "apply", tokens: 0, costUsd: 0 },
    };
    const valid = validateSEO(envelope);
    if (!valid) {
      const errors = (validateSEO.errors || []).map((e) => `${e.instancePath} ${e.message}`);
      return res.status(400).json({ error: "Schema validation failed", errors });
    }

    const {
      updateTitle = true,
      updateBody = true,
      updateSeo = true,
      updateBullets = true,
      updateFaq = true,
      updateAlt = false,
      dryRun = false,
    } = options;

    const updated = { title: false, body: false, seo: false, bullets: false, faq: false, imageAlt: false };
    const { shop, accessToken } = getShopAndToken(req);
    if (!shop || !accessToken) return res.status(401).json({ error: "Missing shop or access token" });

    // 1) productUpdate
    if (!dryRun && (updateTitle || updateBody || updateSeo)) {
      const productInput = { id: productId };
      if (updateTitle && envelope.seo.title) productInput.title = envelope.seo.title;
      if (updateBody && envelope.seo.bodyHtml) productInput.bodyHtml = envelope.seo.bodyHtml;
      if (updateSeo && (envelope.seo.title || envelope.seo.metaDescription)) {
        productInput.seo = { title: envelope.seo.title || null, description: envelope.seo.metaDescription || null };
      }
      const mutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id title handle seo { title description } }
            userErrors { field message }
          }
        }
      `;
      const rsp = await adminGraphQL({ shop, accessToken, query: mutation, variables: { input: productInput } });
      const errs = rsp?.data?.productUpdate?.userErrors || [];
      if (errs.length) return res.status(400).json({ error: "productUpdate userErrors", details: errs });
      updated.title = Boolean(updateTitle && envelope.seo.title);
      updated.body = Boolean(updateBody && envelope.seo.bodyHtml);
      updated.seo = Boolean(updateSeo);
    }

    // 2) metafieldsSet
    if (!dryRun && (updateBullets || updateFaq)) {
      const metafields = [];
      if (updateBullets) {
        metafields.push({ ownerId: productId, namespace: "seo_ai", key: "bullets", type: "json", value: JSON.stringify(envelope.seo.bullets || []) });
      }
      if (updateFaq) {
        metafields.push({ ownerId: productId, namespace: "seo_ai", key: "faq", type: "json", value: JSON.stringify(envelope.seo.faq || []) });
      }
      if (metafields.length) {
        const mutation = `
          mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id key namespace type }
              userErrors { field message }
            }
          }
        `;
        const rsp = await adminGraphQL({ shop, accessToken, query: mutation, variables: { metafields } });
        const errs = rsp?.data?.metafieldsSet?.userErrors || [];
        if (errs.length) return res.status(400).json({ error: "metafieldsSet userErrors", details: errs });
        updated.bullets = Boolean(updateBullets);
        updated.faq = Boolean(updateFaq);
      }
    }

    // 3) (optional) image alts
    if (!dryRun && updateAlt && Array.isArray(envelope.seo.imageAlt) && envelope.seo.imageAlt.length) {
      const mutation = `
        mutation productImageUpdate($image: ImageUpdateInput!) {
          productImageUpdate(image: $image) {
            image { id altText }
            userErrors { field message }
          }
        }
      `;
      for (const itm of envelope.seo.imageAlt.slice(0, 20)) {
        if (!itm?.imageId || !itm?.alt) continue;
        const image = { id: itm.imageId, altText: limit(itm.alt, 120) };
        const rsp = await adminGraphQL({ shop, accessToken, query: mutation, variables: { image } });
        const errs = rsp?.data?.productImageUpdate?.userErrors || [];
        if (errs.length) return res.status(400).json({ error: "productImageUpdate userErrors", details: errs });
      }
      updated.imageAlt = true;
    }

    return res.status(200).json({ ok: true, productId, updated, errors: [] });
  } catch (err) {
    console.error("seo/apply error:", err);
    return res.status(500).json({ error: "Internal error in /seo/apply", details: err.message });
  }
});

export default router;
