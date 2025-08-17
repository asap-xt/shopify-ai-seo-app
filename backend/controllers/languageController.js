// backend/controllers/languageController.js
// Router: mounted at /api/languages
// Route(s):
//   GET /api/languages/product/:shop/:productId
//
// Returns languages for the shop and for a specific product (where it actually has content).
// We rely on Shopify Admin GraphQL with @inContext(language: ...).
//
// IMPORTANT: We forward the request cookies to keep the embedded admin session.

import { Router } from 'express';

const router = Router();

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';
const APP_URL = (process.env.SHOPIFY_APP_URL || '').replace(/\/+$/, '');

const uniq = (arr) => Array.from(new Set(arr));
const baseLang = (loc) => (loc || '').toLowerCase().split('-')[0]; // "en-GB" -> "en"

// Normalize either numeric id -> GID, or pass-through a GID
function toGID(productId) {
  if (/^\d+$/.test(productId)) return `gid://shopify/Product/${productId}`;
  return productId;
}

// Minimal Admin GraphQL helper using our app URL reverse proxy.
// We forward cookies from the incoming request, so the Admin session is preserved.
async function shopGraphQL(req, shop, query, variables) {
  const endpoint = `${APP_URL}/api/${API_VERSION}/graphql.json?shop=${encodeURIComponent(shop)}`;
  const rsp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // forward cookies so the admin session is valid
      Cookie: req.headers.cookie || '',
      'X-Shop': shop,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await rsp.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`Admin GraphQL returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!rsp.ok || json.errors) {
    throw new Error(`Admin GraphQL error: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

// GET /api/languages/product/:shop/:productId
router.get('/product/:shop/:productId', async (req, res) => {
  try {
    const shop = String(req.params.shop || '').trim().toLowerCase();
    const productIdRaw = String(req.params.productId || '').trim();
    if (!shop || !productIdRaw) {
      return res.status(400).json({ error: 'Missing shop or productId' });
    }
    const productId = toGID(productIdRaw);

    // 1) Fetch published shop locales
    const shopLocalesQ = /* GraphQL */ `
      query ShopLocales {
        shopLocales(published: true) {
          locale
          primary
          published
        }
      }
    `;
    const localesData = await shopGraphQL(req, shop, shopLocalesQ, {});
    const published = (localesData?.shopLocales || []).filter(l => l.published);
    const locales = published.map(l => l.locale);                   // e.g. ['en', 'it-IT', 'el']
    const shopLanguages = uniq(locales.map(baseLang));              // e.g. ['en','it','el']
    const primaryLocale = published.find(l => l.primary)?.locale || locales[0] || 'en';
    const primaryLanguage = baseLang(primaryLocale);

    // 2) For each published locale, check if product has content using @inContext(language: ...)
    const withContent = [];
    for (const loc of locales) {
      const productQ = /* GraphQL */ `
        query ProductInLocale($id: ID!) @inContext(language: ${JSON.stringify(loc)}) {
          product(id: $id) {
            id
            title
            descriptionHtml
          }
        }
      `;
      const pData = await shopGraphQL(req, shop, productQ, { id: productId });
      const p = pData?.product;
      const textFromHtml = (html) => (html || '').replace(/<[^>]*>/g, '').trim();
      const hasContent =
        p && ((p.title && p.title.trim().length > 0) ||
              (p.descriptionHtml && textFromHtml(p.descriptionHtml).length > 0));
      if (hasContent) withContent.push(loc);
    }
    const productLanguages = uniq(withContent.map(baseLang));       // e.g. subset of shopLanguages

    // 3) Decide UI flags
    const effectiveLangs = productLanguages.length ? productLanguages : shopLanguages;
    const shouldShowSelector = effectiveLangs.length > 1;
    const allLanguagesOption = shouldShowSelector; // show "All" only when it makes sense

    return res.json({
      shopLanguages,
      productLanguages,
      primaryLanguage,
      shouldShowSelector,
      allLanguagesOption,
    });
  } catch (err) {
    console.error('GET /api/languages/product error:', err);
    return res.status(500).json({ error: 'Failed to load languages' });
  }
});

export default router;
