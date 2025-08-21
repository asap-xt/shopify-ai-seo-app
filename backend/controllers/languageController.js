// backend/controllers/languageController.js
// Reads real shop locales and product translation locales.
// Adds deep DEBUG endpoints to verify token validity and scopes.
// Uses Admin API v2025-07 by default (override with SHOPIFY_API_VERSION).
// Falls back from shop_locales.json -> locales.json if needed.
// Comments in English (per your request).

import express from 'express';

const router = express.Router();
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// ---------- helpers ----------
function normLocale(x) { return String(x || '').toLowerCase().trim(); }
function listCookies(req) {
  const c = req.headers?.cookie || '';
  return c ? c.split(';').map(s => s.trim().split('=')[0]).filter(Boolean) : [];
}
function adminRestUrl(shop, path) {
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
    if (status === 404) e.hint = `Check Admin API version (${API_VERSION}) or endpoint availability.`;
    throw e;
  }
  return data;
}
async function postJson(url, token, body) {
  const { ok, status, data } = await fetchJson(url, token, 'POST', body);
  if (!ok) {
    const e = new Error(data?.errors || data?.error || `HTTP ${status}`);
    e.status = status; e.payload = data;
    if (status === 404) e.hint = `Check Admin API version (${API_VERSION}) or endpoint availability.`;
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

// ---------- DEBUG endpoints (do NOT call Shopify for _ping/_routes/_debug) ----------
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
 * Verifies token works and scopes are present:
 *  - GET /admin/api/<ver>/shop.json
 *  - GET /admin/oauth/access_scopes.json  (lists granted scopes for the token)
 *  - GET /admin/api/<ver>/shop_locales.json  (primary path)
 *  - (fallback) GET /admin/api/<ver>/locales.json
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
      const shopRsp = await getJson(adminRestUrl(auth.shop, 'shop.json'), auth.token);
      out.steps.shop = { ok: true, name: shopRsp?.shop?.name || null, myshopify_domain: shopRsp?.shop?.myshopify_domain || null };
    } catch (e) {
      out.steps.shop = { ok: false, status: e?.status, error: e?.message, hint: e?.hint, payload: e?.payload };
    }

    // 2) access_scopes
    try {
      const scopesRsp = await getJson(`https://${auth.shop}/admin/oauth/access_scopes.json`, auth.token);
      out.steps.scopes = { ok: true, scopes: scopesRsp?.access_scopes || [] };
    } catch (e) {
      out.steps.scopes = { ok: false, status: e?.status, error: e?.message, hint: e?.hint, payload: e?.payload };
    }

    // 3) shop_locales.json (primary)
    try {
      const localesRsp = await getJson(adminRestUrl(auth.shop, 'shop_locales.json'), auth.token);
      out.steps.shop_locales = { ok: true, sample: (localesRsp?.locales || []).slice(0, 5) };
    } catch (e) {
      out.steps.shop_locales = { ok: false, status: e?.status, error: e?.message, hint: e?.hint, payload: e?.payload };
      // 4) fallback to locales.json
      try {
        const fallbackRsp = await getJson(adminRestUrl(auth.shop, 'locales.json'), auth.token);
        out.steps.locales_fallback = { ok: true, sample: (fallbackRsp?.locales || []).slice(0, 5) };
      } catch (e2) {
        out.steps.locales_fallback = { ok: false, status: e2?.status, error: e2?.message, hint: e2?.hint, payload: e2?.payload };
      }
    }

    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'check failed', detail: err?.message || String(err) });
  }
});

// ---------- REAL API: shop languages ----------
/**
 * GET /api/languages/shop
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

    let locales = [];
    let usedEndpoint = 'shop_locales.json';
    try {
      const data = await getJson(adminRestUrl(auth.shop, 'shop_locales.json'), auth.token);
      locales = Array.isArray(data?.locales) ? data.locales : [];
    } catch (e) {
      // try fallback
      const fallback = await getJson(adminRestUrl(auth.shop, 'locales.json'), auth.token);
      locales = Array.isArray(fallback?.locales) ? fallback.locales : [];
      usedEndpoint = 'locales.json';
    }

    const active = locales.filter(l => l?.enabled || l?.published || l?.available).map(l => normLocale(l.locale || l?.locale_code));
    const primary = normLocale((locales.find(l => l?.primary)?.locale) || active[0] || 'en');

    res.json({
      shop: auth.shop,
      primaryLanguage: primary || 'en',
      shopLanguages: active.length ? active : [primary || 'en'],
      authUsed: auth.used,
      endpointUsed: usedEndpoint,
      tookMs: Date.now() - t0,
    });
  } catch (err) {
    console.error('[languages/shop] ERROR', err?.status, err?.message, err?.hint || '', err?.payload || '');
    res.status(err?.status || 500).json({
      error: 'Failed to load shop languages',
      detail: err?.message || String(err),
      hint: err?.hint || undefined,
    });
  }
});

// ---------- REAL API: product languages ----------
/**
 * GET /api/languages/product/:shop/:productId
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

    // 1) shop locales with fallback
    let locales = [];
    try {
      const data = await getJson(adminRestUrl(auth.shop, 'shop_locales.json'), auth.token);
      locales = Array.isArray(data?.locales) ? data.locales : [];
    } catch {
      const fallback = await getJson(adminRestUrl(auth.shop, 'locales.json'), auth.token);
      locales = Array.isArray(fallback?.locales) ? fallback.locales : [];
    }
    const shopLanguages = locales
      .filter(l => l?.enabled || l?.published || l?.available)
      .map(l => normLocale(l.locale || l?.locale_code));
    const primaryLanguage = normLocale((locales.find(l => l?.primary)?.locale) || shopLanguages[0] || 'en');

    // 2) product GID
    const gid = String(productId).startsWith('gid://')
      ? productId
      : `gid://shopify/Product/${String(productId).trim()}`;

    // 3) product translations via GraphQL Translations API
    const gqlRsp = await postJson(adminRestUrl(auth.shop, 'graphql.json'), auth.token, {
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

    const content = gqlRsp?.data?.translatableResource?.translatableContent || [];
    const KEYS = new Set(['title', 'body_html', 'handle', 'seo.title', 'seo.description']);
    const set = new Set(
      content.filter(c => KEYS.has(String(c?.key)))
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
      tookMs: Date.now() - t0,
    });
  } catch (err) {
    console.error('[languages/product] ERROR', err?.status, err?.message, err?.hint || '', err?.payload || '');
    res.status(err?.status || 500).json({
      error: 'Failed to load product languages',
      detail: err?.message || String(err),
      hint: err?.hint || undefined,
    });
  }
});

export default router;
