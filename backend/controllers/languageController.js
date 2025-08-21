// backend/controllers/languageController.js
// Purpose: Return real shop locales and product locales using the same Shopify session
// as your existing /plans/me and /seo/* routes. Minimal & defensive integration.
//
// Notes:
// - We DO NOT import a non-existing named export from ../auth.js.
// - If auth.validateAuthenticatedSession(req, res) exists, we use it.
// - Else we fall back to res.locals.shopify.session (if present) or 401.

import express from 'express';
import * as Shopify from '@shopify/shopify-api';
import * as auth from '../auth.js'; // defensive import (may or may not export validateAuthenticatedSession)

const router = express.Router();

/**
 * Session guard that works with different auth.js shapes.
 * Tries, in order:
 *  1) auth.validateAuthenticatedSession(req, res)
 *  2) existing res.locals.shopify.session
 *  3) 401
 */
async function sessionGuard(req, res, next) {
  try {
    if (typeof auth.validateAuthenticatedSession === 'function') {
      await auth.validateAuthenticatedSession(req, res);
      if (res.headersSent) return;
      if (res.locals?.shopify?.session) return next();
      return res.status(401).json({ error: 'Unauthorized: missing Shopify session' });
    }
    if (res.locals?.shopify?.session) return next();
    return res.status(401).json({ error: 'Unauthorized: missing Shopify session' });
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: ' + (err?.message || 'missing Shopify session') });
  }
}

/** Create REST client from current session. */
function restClient(session) {
  return new Shopify.clients.Rest({ session });
}

/** Create GraphQL client from current session. */
function gqlClient(session) {
  return new Shopify.clients.Graphql({ session });
}

/**
 * GET /api/languages/shop
 * Returns active shop locales and primary locale.
 * {
 *   shop: "example.myshopify.com",
 *   primaryLanguage: "en",
 *   shopLanguages: ["en","de","fr"]
 * }
 */
router.get('/shop', sessionGuard, async (req, res) => {
  try {
    const session = res.locals.shopify?.session;
    if (!session) return res.status(401).json({ error: 'Unauthorized: missing Shopify session' });

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
 * Returns shop languages + product languages for the given product.
 * productId may be numeric or a GID.
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
router.get('/product/:shop/:productId', sessionGuard, async (req, res) => {
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

    // 3) Product translations (GraphQL Translations API)
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

    const KEYS = new Set(['title', 'body_html', 'handle', 'seo.title', 'seo.description']);
    const productLocalesSet = new Set(
      content
        .filter(c => KEYS.has(String(c?.key)))
        .map(c => String(c?.locale || '').toLowerCase())
        .filter(Boolean)
    );

    if (!productLocalesSet.size && shopLanguages.length) {
      productLocalesSet.add(primaryLanguage);
    }

    const productLanguages = Array.from(productLocalesSet).filter(l => shopLanguages.includes(l));

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
