// backend/controllers/languageController.js
// Reads real shop locales and product translation locales.
// Uses Shopify Admin API with current stable version (default 2025-07) and
// supports two auth paths:
//   1) Embedded session (res.locals.shopify.session.shop/accessToken)
//   2) Admin API token(s) from ENV (SHOPIFY_ADMIN_API_ACCESS_TOKEN or SHOP_TOKENS JSON)
//
// Includes safe debug endpoints: /_ping, /_routes, /_debug
// Comments in English (as requested).

import express from 'express';

const router = express.Router();

// ***** IMPORTANT *****
// Default Admin API version must be current. 2024-07 is sunset → 404.
// You can override via env SHOPIFY_API_VERSION in Railway if needed.
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// ---------- tiny utils ----------
function normLocale(x) { return String(x || '').toLowerCase().trim(); }
function listCookies(req) {
  const c = req.headers?.cookie || '';
  return c ? c.split(';').map(s => s.trim().split('=')[0]).filter(Boolean) : [];
}
function adminRestUrl(shop, path) {
  const base = `https://${shop}/admin/api/${API_VERSION}`;
  return path.startsWith('/') ? (base + path) : `${base}/${path}`;
}
async function getJson(url, token) {
  const rsp = await fetch(url, { method: 'GET', headers: {
    'X-Shopify-Access-Token': token, 'Content-Type': 'application/json',
  }});
  const text = await rsp.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { error: text?.slice(0,500)||'Non-JSON' }; }
  if (!rsp.ok) {
    const msg = data?.errors || data?.error || `HTTP ${rsp.status}`;
    const e = new Error(typeof msg==='string'?msg:JSON.stringify(msg));
    e.status = rsp.status;
    e.payload = data;
    // Helpful hint when version mismatch triggers 404
    if (rsp.status === 404) e.hint = `Check Admin API version (${API_VERSION}). Old/sunset versions return 404.`;
    throw e;
  }
  return data;
}
async function postJson(url, token, body) {
  const rsp = await fetch(url, { method: 'POST', headers: {
    'X-Shopify-Access-Token': token, 'Content-Type': 'application/json',
  }, body: JSON.stringify(body) });
  const text = await rsp.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { error: text?.slice(0,500)||'Non-JSON' }; }
  if (!rsp.ok) {
    const msg = data?.errors || data?.error || `HTTP ${rsp.status}`;
    const e = new Error(typeof msg==='string'?msg:JSON.stringify(msg));
    e.status = rsp.status;
    e.payload = data;
    if (rsp.status === 404) e.hint = `Check Admin API version (${API_VERSION}). Old/sunset versions return 404.`;
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

// ---------- DEBUG ENDPOINTS (NO Shopify API calls). Placed FIRST ----------
router.get('/_ping', (req, res) => {
  res.json({ ok: true, path: req.originalUrl, ts: Date.now() });
});

router.get('/_routes', (req, res) => {
  const routes = [
    '/_ping',
    '/_routes',
    '/_debug',
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
      nodeEnv: process.env.NODE_ENV || 'development',
    },
    note: 'This endpoint does not call Shopify APIs.',
  });
});

// ---------- REAL API ----------

/**
 * GET /api/languages/shop
 * Returns active shop locales and primary locale.
 * Response:
 * {
 *   shop: "example.myshopify.com",
 *   primaryLanguage: "en",
 *   shopLanguages: ["en","de","fr"],
 *   authUsed: "session|map|single",
 * }
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

    const data = await getJson(adminRestUrl(auth.shop, 'shop_locales.json'), auth.token);
    const locales = Array.isArray(data?.locales) ? data.locales : [];
    const active = locales.filter(l => l?.enabled).map(l => normLocale(l.locale));
    const primary = normLocale(locales.find(l => l?.primary)?.locale || active[0] || 'en');

    res.json({
      shop: auth.shop,
      primaryLanguage: primary,
      shopLanguages: active.length ? active : [primary || 'en'],
      authUsed: auth.used,
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

    // 1) shop locales
    const shopLocalesRsp = await getJson(adminRestUrl(auth.shop, 'shop_locales.json'), auth.token);
    const locales = Array.isArray(shopLocalesRsp?.locales) ? shopLocalesRsp.locales : [];
    const shopLanguages = locales.filter(l => l?.enabled).map(l => normLocale(l.locale));
    const primaryLanguage = normLocale(locales.find(l => l?.primary)?.locale || shopLanguages[0] || 'en');

    // 2) product GID
    const gid = String(productId).startsWith('gid://')
      ? productId
      : `gid://shopify/Product/${String(productId).trim()}`;

    // 3) product translations via GraphQL
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
