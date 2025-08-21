// backend/controllers/languageController.js
// Purpose: Secure endpoints to read shop locales and product locales using the SAME Shopify session
// middleware that your /plans/me and /seo/* routes already use.
// Comments are in English by request.

import express from 'express';
import { verifyShopifySession } from '../auth.js'; // same guard as /plans/me and /seo/*
import * as Shopify from '@shopify/shopify-api';  // <-- FIX: no default export; use namespace import

const router = express.Router();

// Guard all routes in this router with Shopify session
router.use(verifyShopifySession);

/** Helper: Admin REST client from current session. */
function restClient(session) {
  return new Shopify.clients.Rest({ session });
}

/** Helper: Admin GraphQL client from current session. */
function gqlClient(session) {
  return new Shopify.clients.Graphql({ session });
}

/**
 * GET /api/languages/shop
 * Returns active shop locales and primary locale.
 * Response:
 * {
 *   shop: "example.myshopify.com",
 *   primaryLanguage: "en",
 *   shopLanguages: ["en","de","fr"],
 * }
 */
router.get('/shop', async (req, res) => {
  try {
    const session = res.locals.shopify?.session;
    if (!session) return res.status(401).json({ error: 'Unauthorized: missing Shopify session' });

    // REST: GET /admin/api/*/shop_locales.json
    const rest = restClient(session);
    const rsp = await rest.get({ path: 'shop_locales' });
    const locales = Array.isArray(rsp?.body?.locales) ? rsp.body.locales : [];

    const active = locales.filter(l => l?.enabled).map(l => String(l.locale).toLowerCase());
    const primary = String((locales.find(l => l?.primary)?.locale) || active[0] || 'en').toLowerCase();

    res.json({
      shop: session.shop,
      primaryLanguage: primary,
      shopLanguages: active.length ? active : [primary || 'en'],
    });
  } catch (err) {
    console.error('GET /api/languages/shop error:', err);
    res.status(500).json({ error: 'Failed to load shop languages' });
  }
});

/**
 * GET /api/languages/product/:shop/:productId
 * Returns shop languages + product languages present for the given product.
 * Product ID can be numeric or GID.
 * Response:
 * {
 *   shop: "example.myshopify.com",
 *   productId: "gid://shopify/Product/123456789",
 *   primaryLanguage: "en",
 *   shopLanguages: ["en","de","fr"],
 *   productLanguages: ["en","de"],
 *   shouldShowSelector: true|false,
 *   allLanguagesOption: { label: "All languages", value: "all" } | null
 * }
 */
router.get('/product/:shop/:productId', async (req, res) => {
  try {
    const session = res.locals.shopify?.session;
    if (!session) return res.status(401).json({ error: 'Unauthorized: missing Shopify session' });

    const { productId } = req.params;

    // 1) Shop locales (REST)
    const rest = restClient(session);
    const rspLocales = await rest.get({ path: 'shop_locales' });
    const locales = Array.isArray(rspLocales?.body?.locales) ? rspLocales.body.locales : [];
    const shopLanguages = locales.filter(l => l?.enabled).map(l => String(l.locale).toLowerCase());
    const primaryLanguage = String((locales.find(l => l?.primary)?.locale) || shopLanguages[0] || 'en').toLowerCase();

    // 2) Normalize productId to GID
    const gid = String(productId).startsWith('gid://')
      ? productId
      : `gid://shopify/Product/${String(productId).trim()}`;

    // 3) Query translations via Admin GraphQL Translations API
    const gql = gqlClient(session);
    const query = `
      query ProductTranslations($id: ID!) {
        translatableResource(resourceId: $id) {
          resourceId
          translatableContent {
            key
            locale
            value
          }
        }
      }
    `;
    const resp = await gql.query({ data: { query, variables: { id: gid } } });
    const content = resp?.body?.data?.translatableResource?.translatableContent || [];

    // Collect locales that have any content for keys we care about
    const KEYS = new Set(['title', 'body_html', 'handle', 'seo.title', 'seo.description']);
    const productLocalesSet = new Set(
      content
        .filter(c => KEYS.has(String(c?.key)))
        .map(c => String(c?.locale || '').toLowerCase())
        .filter(Boolean)
    );

    // If no translations at all, ensure primary is included (base content)
    if (!productLocalesSet.size && shopLanguages.length) {
      productLocalesSet.add(primaryLanguage);
    }

    const productLanguages = Array.from(productLocalesSet).filter(l => shopLanguages.includes(l));

    // 4) Decide selector visibility
    const effective = productLanguages.length ? productLanguages : shopLanguages;
    const shouldShowSelector = effective.length > 1;
    const allLanguagesOption = shouldShowSelector ? { label: 'All languages', value: 'all' } : null;

    res.json({
      shop: session.shop,
      productId: gid,
      primaryLanguage,
      shopLanguages: shopLanguages.length ? shopLanguages : [primaryLanguage || 'en'],
      productLanguages,
      shouldShowSelector,
      allLanguagesOption,
    });
  } catch (err) {
    console.error('GET /api/languages/product error:', err);
    res.status(500).json({ error: 'Failed to load product languages' });
  }
});

export default router;
