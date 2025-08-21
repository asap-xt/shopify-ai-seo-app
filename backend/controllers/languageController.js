// backend/controllers/languageController.js
// Reads real shop locales (GraphQL) and product translation locales (GraphQL Translations).
// Avoids REST /shop_locales.json /locales.json (they return 404 on some shops).
// Supports two auth paths:
//   1) Embedded session (res.locals.shopify.session.shop/accessToken)
//   2) Admin API token(s) from ENV (SHOPIFY_ADMIN_API_ACCESS_TOKEN or SHOP_TOKENS JSON)
//
// Includes debug endpoints: /_ping, /_routes, /_debug, /_check
// Comments in English.

import express from 'express';

const router = express.Router();
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// ---------- helpers ----------
function normLocale(x) { return String(x || '').toLowerCase().trim(); }
function listCookies(req) {
  const c = req.headers?.cookie || '';
  return c ? c.split(';').map(s => s.trim().split('=')[0]).filter(Boolean) : [];
}
function adminApiUrl(shop, path) {
  const base = `https://${shop}/admin/api/${API_VERSION}`;
  return path.startsWith('/') ? (base + path) : `${base}/${path}`;
}
async function fetchJson(url, token, method = 'GET', body) {
  const rsp = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await rsp.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { error: text?.slice(0, 2000) || 'Non-JSON' }; }
  return { ok: rsp.ok, status: rsp.status, data, headers: Object.fromEntries(rsp.headers.entries()) };
}
async function getJson(url, token) {
  const { ok, status, data } = await fetchJson(url, token, 'GET');
  if (!ok) {
    const e = new Error(data?.errors || data?.error || `HTTP ${status}`);
    e.status = status; e.payload = data;
    throw e;
  }
  return data;
}
async function postJson(url, token, body) {
  const { ok, status, data } = await fetchJson(url, token, 'POST', body);
  if (!ok) {
    const e = new Error(data?.errors || data?.error || `HTTP ${status}`);
    e.status = status; e.payload = data;
    throw e;
  }
  return data;
}

/**
 * Resolve Admin API auth for this request.
 * Priority:
 *  1) res.locals.shopify.session.shop/accessToken (if your auth middleware set it)
 *  2) SHOP_TOKENS JSON map (per shop): {"shop.myshopify.com":"shpat_xxx"}
 *  3) SHOPIFY_ADMIN_API_ACCESS_TOKEN (single token) + shop param
 */
function getAdminAuth(req, res) {
  // 1) session
  const sess = res.locals?.shopify?.session;
  if (sess?.shop && sess?.accessToken) return { shop: sess.shop, token: sess.accessToken, used: 'session' };

  // from path or query
  const shopFromReq = req.params?.shop || req.query?.shop || null;

  // 2) map
  const mapRaw = process.env.SHOP_TOKENS || process.env.SHOPIFY_SHOPS_TOKENS || '';
  if (shopFromReq && mapRaw) {
    try {
      const map = JSON.parse(mapRaw);
      const tok = map[shopFromReq];
      if (tok) return { shop: shopFromReq, token: tok, used: 'map' };
    } catch {/* ignore */}
  }

  // 3) single token
  const singleTok = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
  if (shopFromReq && singleTok) return { shop: shopFromReq, token: singleTok, used: 'single' };

  return null;
}

// ---------- DEBUG endpoints (no Shopify calls for _ping/_routes/_debug) ----------
router.get('/_ping', (req, res) => {
  res.json({ ok: true, path: req.originalUrl, ts: Date.now() });
});

router.get('/_routes', (req, res) => {
  const routes = [
    '/_ping',
    '/_routes',
    '/_debug',
    '/_check',
    '/shop',
    '/product/:shop/:productId',
  ];
  res.json({ mountedAt: '/api/languages', routes, apiVersion: API_VERSION });
});

router.get('/_debug', (req, res) => {
  res.json({
    url: req.originalUrl,
    method: req.method,
    query: req.query,
    headers: {
      authorization_present: !!req.headers?.authorization,
      cookie_names: listCookies(req),
      host: req.headers?.host,
      origin: req.headers?.origin,
      referer: req.headers?.referer,
      user_agent: req.headers?.['user-agent'],
    },
    locals: {
      hasShopify: !!res.locals?.shopify,
      hasSession: !!res.locals?.shopify?.session,
      sessionShop: res.locals?.shopify?.session?.shop || null,
      sessionTokenPresent: !!res.locals?.shopify?.session?.accessToken,
    },
    env: {
      hasSingleToken: !!(process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN),
      hasTokenMap: !!(process.env.SHOP_TOKENS || process.env.SHOPIFY_SHOPS_TOKENS),
      apiVersion: API_VERSION,
      nodeEnv: process.env.NODE_ENV || 'production',
    },
    note: 'This endpoint does not call Shopify APIs.',
  });
});

// ---------- DEEP CHECK endpoint (calls Shopify) ----------
/**
 * GET /api/languages/_check?shop=<shop>
 * Verifies token works and scopes are present, and tests GraphQL for locales:
 *  - GET /admin/api/<ver>/shop.json
 *  - GET /admin/oauth/access_scopes.json  (granted scopes for token)
 *  - POST /admin/api/<ver>/graphql.json  (shop { primaryLocale, enabledLocales })
 */
router.get('/_check', async (req, res) => {
  try {
    const auth = getAdminAuth(req, res);
    if (!auth) {
      return res.status(401).json({
        error: 'Unauthorized: no session & no ENV token',
        fix: 'Open inside embedded app or set SHOPIFY_ADMIN_API_ACCESS_TOKEN / SHOP_TOKENS for this shop.',
      });
    }
    const out = { shop: auth.shop, authUsed: auth.used, version: API_VERSION, steps: {} };

    // 1) shop.json
    try {
      const shopRsp = await getJson(adminApiUrl(auth.shop, 'shop.json'), auth.token);
      out.steps.shop = { ok: true, name: shopRsp?.shop?.name || null, myshopify_domain: shopRsp?.shop?.myshopify_domain || null };
    } catch (e) {
      out.steps.shop = { ok: false, status: e?.status, error: e?.message, payload: e?.payload };
    }

    // 2) access_scopes
    try {
      const scopesRsp = await getJson(`https://${auth.shop}/admin/oauth/access_scopes.json`, auth.token);
      out.steps.scopes = { ok: true, scopes: scopesRsp?.access_scopes || [] };
    } catch (e) {
      out.steps.scopes = { ok: false, status: e?.status, error: e?.message, payload: e?.payload };
    }

    // 3) locales via GraphQL
    try {
      const gql = await postJson(adminApiUrl(auth.shop, 'graphql.json'), auth.token, {
        query: `
          query ShopLocales {
            shop {
              primaryLocale { isoCode }
              enabledLocales { isoCode }
            }
          }
        `,
        variables: {},
      });
      const primaryIso = gql?.data?.shop?.primaryLocale?.isoCode || null;
      const enabled = (gql?.data?.shop?.enabledLocales || []).map(l => l?.isoCode).filter(Boolean);
      out.steps.locales_graphql = {
        ok: true,
        primaryIso,
        enabled,
      };
    } catch (e) {
      out.steps.locales_graphql = { ok: false, status: e?.status, error: e?.message, payload: e?.payload };
    }

    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'check failed', detail: err?.message || String(err) });
  }
});

// ---------- REAL API: shop languages (GraphQL) ----------
/**
 * GET /api/languages/shop
 * Returns active shop locales and primary locale (using GraphQL).
 */
router.get('/shop', async (req, res) => {
  const t0 = Date.now();
  try {
    const auth = getAdminAuth(req, res);
    if (!auth) {
      return res.status(401).json({
        error: 'Unauthorized: missing Shopify session and no ENV token',
        hint: 'Open this route from inside the embedded app OR set SHOPIFY_ADMIN_API_ACCESS_TOKEN or SHOP_TOKENS JSON.',
      });
    }

    const gql = await postJson(adminApiUrl(auth.shop, 'graphql.json'), auth.token, {
      query: `
        query ShopLocales {
          shop {
            primaryLocale { isoCode }
            enabledLocales { isoCode }
          }
        }
      `,
      variables: {},
    });

    const primaryIso = gql?.data?.shop?.primaryLocale?.isoCode || 'EN';
    const enabled = (gql?.data?.shop?.enabledLocales || []).map(l => l?.isoCode).filter(Boolean);

    // normalize ISO (e.g. EN or EN_US) -> en / en-us
    const normalizeIso = (iso) => {
      const s = String(iso || '').toLowerCase();
      return s.includes('_') ? s.replace('_', '-') : s;
    };
    const primary = normalizeIso(primaryIso);
    const shopLanguages = enabled.length ? enabled.map(normalizeIso) : [primary];

    res.json({
      shop: auth.shop,
      primaryLanguage: primary,
      shopLanguages,
      authUsed: auth.used,
      source: 'graphql',
      tookMs: Date.now() - t0,
    });
  } catch (err) {
    console.error('[languages/shop] ERROR', err?.status, err?.message, err?.payload || '');
    res.status(err?.status || 500).json({
      error: 'Failed to load shop languages',
      detail: err?.message || String(err),
    });
  }
});

// ---------- REAL API: product languages (GraphQL) ----------
/**
 * GET /api/languages/product/:shop/:productId
 * Returns shop languages + product languages for the given product.
 */
router.get('/product/:shop/:productId', async (req, res) => {
  const t0 = Date.now();
  try {
    const auth = getAdminAuth(req, res);
    if (!auth) {
      return res.status(401).json({
        error: 'Unauthorized: missing Shopify session and no ENV token',
        hint: 'Open this route from inside the embedded app OR set SHOPIFY_ADMIN_API_ACCESS_TOKEN or SHOP_TOKENS JSON.',
      });
    }

    const { productId } = req.params;

    // 1) shop locales (GraphQL)
    const gqlShop = await postJson(adminApiUrl(auth.shop, 'graphql.json'), auth.token, {
      query: `
        query ShopLocales {
          shop {
            primaryLocale { isoCode }
            enabledLocales { isoCode }
          }
        }
      `,
      variables: {},
    });
    const normalizeIso = (iso) => {
      const s = String(iso || '').toLowerCase();
      return s.includes('_') ? s.replace('_', '-') : s;
    };
    const primaryIso = gqlShop?.data?.shop?.primaryLocale?.isoCode || 'EN';
    const enabled = (gqlShop?.data?.shop?.enabledLocales || []).map(l => l?.isoCode).filter(Boolean);
    const primaryLanguage = normalizeIso(primaryIso);
    const shopLanguages = enabled.length ? enabled.map(normalizeIso) : [primaryLanguage];

    // 2) product GID
    const gid = String(productId).startsWith('gid://')
      ? productId
      : `gid://shopify/Product/${String(productId).trim()}`;

    // 3) product translations (GraphQL Translations API)
    const gqlProd = await postJson(adminApiUrl(auth.shop, 'graphql.json'), auth.token, {
      query: `
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
      `,
      variables: { id: gid },
    });

    const content = gqlProd?.data?.translatableResource?.translatableContent || [];
    const KEYS = new Set(['title', 'body_html', 'handle', 'seo.title', 'seo.description']);
    const set = new Set(
      content
        .filter(c => KEYS.has(String(c?.key)))
        .map(c => normLocale(c?.locale))
        .filter(Boolean)
    );

    if (!set.size && shopLanguages.length) set.add(primaryLanguage);

    const productLanguages = Array.from(set).filter(l => shopLanguages.includes(l));
    const effective = productLanguages.length ? productLanguages : shopLanguages;
    const shouldShowSelector = effective.length > 1;
    const allLanguagesOption = shouldShowSelector ? { label: 'All languages', value: 'all' } : null;

    res.json({
      shop: auth.shop,
      productId: gid,
      primaryLanguage,
      shopLanguages: shopLanguages.length ? shopLanguages : [primaryLanguage || 'en'],
      productLanguages,
      shouldShowSelector,
      allLanguagesOption,
      authUsed: auth.used,
      source: 'graphql',
      tookMs: Date.now() - t0,
    });
  } catch (err) {
    console.error('[languages/product] ERROR', err?.status, err?.message, err?.payload || '');
    res.status(err?.status || 500).json({
      error: 'Failed to load product languages',
      detail: err?.message || String(err),
    });
  }
});

export default router;
