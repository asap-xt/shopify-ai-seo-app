// backend/controllers/languageController.js
// Goal: Return real shop locales and product locales with robust session handling.
// - Primary path: use Shopify session (res.locals.shopify.session.*)
// - Fallback path: use Admin API token from ENV (per-shop map or single token)
// - Includes _debug endpoint for quick diagnostics.
// Comments in English (as requested).

import express from 'express';

const router = express.Router();

// ---------- Helpers ----------

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';

/**
 * Extract admin API auth for the current request.
 * Priority:
 *  1) Session (res.locals.shopify.session.shop/accessToken)
 *  2) ENV per-shop token map (SHOP_TOKENS='{"shop.myshopify.com":"shpat_xxx"}')
 *  3) Single ENV token (SHOPIFY_ADMIN_API_ACCESS_TOKEN) + explicit shop param
 *
 * Returns { shop, token, used: 'session'|'map'|'single' } or null if not resolvable.
 */
function getAdminAuth(req, res) {
  // 1) Session
  const sess = res.locals?.shopify?.session;
  if (sess?.shop && sess?.accessToken) {
    return { shop: sess.shop, token: sess.accessToken, used: 'session' };
  }

  // shop can come from path (/product/:shop/:productId) or query (?shop=...)
  const shopFromReq =
    req.params?.shop ||
    req.query?.shop ||
    null;

  // 2) Per-shop map
  const mapRaw = process.env.SHOP_TOKENS || process.env.SHOPIFY_SHOPS_TOKENS || '';
  if (shopFromReq && mapRaw) {
    try {
      const map = JSON.parse(mapRaw);
      const tok = map[shopFromReq];
      if (tok) return { shop: shopFromReq, token: tok, used: 'map' };
    } catch {
      // ignore JSON errors
    }
  }

  // 3) Single token
  const singleTok = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
  if (shopFromReq && singleTok) {
    return { shop: shopFromReq, token: singleTok, used: 'single' };
  }

  return null;
}

function adminRestUrl(shop, path) {
  const base = `https://${shop}/admin/api/${API_VERSION}`;
  if (path.startsWith('/')) return base + path;
  return `${base}/${path}`;
}

async function getJson(url, token, opts = {}) {
  const rsp = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await rsp.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text?.slice(0, 500) || 'Non-JSON response' }; }
  if (!rsp.ok) {
    const msg = data?.errors || data?.error || `HTTP ${rsp.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = rsp.status;
    err.payload = data;
    throw err;
  }
  return data;
}

async function postJson(url, token, body) {
  const rsp = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await rsp.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text?.slice(0, 500) || 'Non-JSON response' }; }
  if (!rsp.ok) {
    const msg = data?.errors || data?.error || `HTTP ${rsp.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = rsp.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function normLocale(x) {
  return String(x || '').toLowerCase().trim();
}

// ---------- Public debug (no session required, no Admin API calls) ----------

/**
 * GET /api/languages/_debug
 * Shows what reaches the server (headers, cookies, locals), without calling Shopify.
 */
router.get('/_debug', (req, res) => {
  const cookieNames = (req.headers?.cookie || '')
    .split(';')
    .map(s => s.trim().split('=')[0])
    .filter(Boolean);

  res.json({
    url: req.originalUrl,
    method: req.method,
    query: req.query,
    headers: {
      authorization_present: !!req.headers?.authorization,
      cookie_names: cookieNames,
      host: req.headers?.host,
      origin: req.headers?.origin,
      referer: req.headers?.referer,
      user_agent: req.headers?.['user-agent'],
    },
    locals: {
      hasShopify: !!res.locals?.shopify,
      hasSession: !!res.locals?.shopify?.session,
      sessionShop: res.locals?.shopify?.session?.shop || null,
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

// ---------- Shop locales ----------

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
        hint: 'Either ensure embedded session is present, or set SHOPIFY_ADMIN_API_ACCESS_TOKEN or SHOP_TOKENS JSON.',
      });
    }

    const url = adminRestUrl(auth.shop, 'shop_locales.json');
    const data = await getJson(url, auth.token);

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
    console.error('[languages/shop] ERROR', err?.status, err?.message, err?.payload || '');
    res.status(err?.status || 500).json({
      error: 'Failed to load shop languages',
      detail: err?.message || String(err),
    });
  }
});

// ---------- Product locales ----------

/**
 * GET /api/languages/product/:shop/:productId
 * Returns shop languages + product languages for the given product.
 * productId may be numeric or a GID.
 * Response:
 * {
 *   shop: "example.myshopify.com",
 *   productId: "gid://shopify/Product/123456789",
 *   primaryLanguage: "en",
 *   shopLanguages: ["en","de","fr"],
 *   productLanguages: ["en","de"],
 *   shouldShowSelector: true|false,
 *   allLanguagesOption: { label: "All languages", value: "all" } | null,
 *   authUsed: "session|map|single",
 * }
 */
router.get('/product/:shop/:productId', async (req, res) => {
  const t0 = Date.now();
  try {
    const auth = getAdminAuth(req, res);
    if (!auth) {
      return res.status(401).json({
        error: 'Unauthorized: missing Shopify session and no ENV token',
        hint: 'Either ensure embedded session is present, or set SHOPIFY_ADMIN_API_ACCESS_TOKEN or SHOP_TOKENS JSON.',
      });
    }

    const { productId } = req.params;

    // 1) Shop locales
    const shopLocalesUrl = adminRestUrl(auth.shop, 'shop_locales.json');
    const shopLocalesRsp = await getJson(shopLocalesUrl, auth.token);
    const locales = Array.isArray(shopLocalesRsp?.locales) ? shopLocalesRsp.locales : [];
    const shopLanguages = locales.filter(l => l?.enabled).map(l => normLocale(l.locale));
    const primaryLanguage = normLocale(locales.find(l => l?.primary)?.locale || shopLanguages[0] || 'en');

    // 2) Normalize productId to GID
    const gid = String(productId).startsWith('gid://')
      ? productId
      : `gid://shopify/Product/${String(productId).trim()}`;

    // 3) Product translations via GraphQL
    const gqlUrl = adminRestUrl(auth.shop, 'graphql.json');
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
    const gqlRsp = await postJson(gqlUrl, auth.token, {
      query,
      variables: { id: gid },
    });

    const content = gqlRsp?.data?.translatableResource?.translatableContent || [];

    // Keys relevant for SEO generation
    const KEYS = new Set(['title', 'body_html', 'handle', 'seo.title', 'seo.description']);
    const set = new Set(
      content
        .filter(c => KEYS.has(String(c?.key)))
        .map(c => normLocale(c?.locale))
        .filter(Boolean)
    );

    if (!set.size && shopLanguages.length) {
      set.add(primaryLanguage); // ensure base content locale is considered
    }

    const productLanguages = Array.from(set).filter(l => shopLanguages.includes(l));

    // 4) Selector visibility
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
    console.error('[languages/product] ERROR', err?.status, err?.message, err?.payload || '');
    res.status(err?.status || 500).json({
      error: 'Failed to load product languages',
      detail: err?.message || String(err),
    });
  }
});

export default router;
