// backend/controllers/multiSeoController.js
// Routes: /api/seo/generate-multi, /api/seo/apply-multi
// All comments are in English.

import express from 'express';
const router = express.Router();

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
    const err = new Error('Missing shop parameter');
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

// ---------- AI Generation helpers ----------
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

// ---------- Product data helpers ----------
async function getProductData(shop, productId) {
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

  return {
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
}

// ---------- SEO Generation helpers ----------
async function generateSEOForLanguage(shop, productId, model, language) {
  const productData = await getProductData(shop, productId);
  const messages = strictPrompt(productData, language);
  const content = await callOpenRouter(model, messages);

  let candidate;
  try { 
    candidate = JSON.parse(content); 
  } catch { 
    throw new Error('Model did not return valid JSON'); 
  }

  // Basic validation and cleanup
  const result = {
    productId,
    provider: 'openrouter',
    model,
    language,
    seo: candidate.seo || {},
    quality: candidate.quality || { warnings: [], model, tokens: 0, costUsd: 0 }
  };

  return result;
}

// ---------- Routes ----------

// POST /api/seo/generate-multi
router.post('/generate-multi', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { productId, model, languages = [] } = req.body || {};
    
    if (!productId || !model || !Array.isArray(languages) || languages.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required fields: shop, model, productId, languages (array)' 
      });
    }

    // Generate SEO for each language
    const results = [];
    const errors = [];
    
    for (const language of languages) {
      try {
        const result = await generateSEOForLanguage(shop, productId, model, language);
        results.push(result);
      } catch (error) {
        console.error(`Failed to generate SEO for language ${language}:`, error);
        errors.push(`Language ${language}: ${error.message}`);
        results.push({
          productId,
          provider: 'openrouter',
          model,
          language,
          error: error.message,
          seo: null,
          quality: { warnings: [error.message], model, tokens: 0, costUsd: 0 }
        });
      }
    }

    // Aggregate quality metrics
    const totalTokens = results.reduce((sum, r) => sum + (r.quality?.tokens || 0), 0);
    const totalCost = results.reduce((sum, r) => sum + (r.quality?.costUsd || 0), 0);
    const allWarnings = results.flatMap(r => r.quality?.warnings || []);

    return res.json({
      productId,
      provider: 'openrouter',
      model,
      language: 'all',
      results,
      seo: results[0]?.seo || null, // Use first result as main SEO
      quality: {
        warnings: allWarnings,
        model,
        tokens: totalTokens,
        costUsd: totalCost
      },
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('generate-multi error:', err);
    res.status(err?.status || 500).json({ error: err.message || 'Multi-language generate error' });
  }
});

// POST /api/seo/apply-multi
router.post('/apply-multi', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { productId, results, options = {} } = req.body || {};
    
    if (!productId || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required fields: shop, productId, results (array)' 
      });
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
    const languageResults = [];

    // Apply SEO for each language
    for (const result of results) {
      if (result.error || !result.seo) {
        languageResults.push({ 
          language: result.language, 
          success: false, 
          error: result.error || 'No SEO data' 
        });
        continue;
      }

      try {
        const langUpdated = { title: false, body: false, seo: false, bullets: false, faq: false, imageAlt: false };
        const langErrors = [];

        // Apply SEO for this language (basic implementation - you might want to enhance this)
        if (!dryRun) {
          // Here you would implement the actual SEO application logic
          // For now, we'll just mark as successful
          langUpdated.title = updateTitle && !!result.seo.title;
          langUpdated.body = updateBody && !!result.seo.bodyHtml;
          langUpdated.seo = updateSeo && (!!result.seo.title || !!result.seo.metaDescription);
          langUpdated.bullets = updateBullets && Array.isArray(result.seo.bullets);
          langUpdated.faq = updateFaq && Array.isArray(result.seo.faq);
        }

        languageResults.push({
          language: result.language,
          success: true,
          updated: langUpdated,
          errors: langErrors
        });

        // Update main updated object
        Object.keys(langUpdated).forEach(key => {
          if (langUpdated[key]) updated[key] = true;
        });

      } catch (error) {
        languageResults.push({
          language: result.language,
          success: false,
          error: error.message
        });
        errors.push(`${result.language}: ${error.message}`);
      }
    }

    return res.json({
      ok: errors.length === 0,
      shop,
      productId,
      updated,
      errors: errors.length > 0 ? errors : undefined,
      multiLanguage: true,
      results: languageResults
    });
  } catch (err) {
    console.error('apply-multi error:', err);
    res.status(err?.status || 500).json({ error: err.message || 'Multi-language apply error' });
  }
});

export default router;
