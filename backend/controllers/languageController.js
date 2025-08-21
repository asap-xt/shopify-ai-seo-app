// backend/controllers/languageController.js
// Устойчиво четене на езиците на магазина и на преводите за продукт.
// Работи със single-admin-token (READ locales/translations) и не изисква сесия.
// Рутове:
//   GET  /api/languages/_routes
//   GET  /api/languages/_debug
//   GET  /api/languages/_check?shop=xxx
//   GET  /api/languages/shop?shop=xxx
//   GET  /api/languages/product/:shop/:productId   (productId може да е числово или GID)

import express from 'express';

// ---- Config & helpers -------------------------------------------------------
const router = express.Router();

const API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || '2024-10';
// Single admin token (private app token или Admin API access token)
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN
  || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
  || process.env.SHOPIFY_API_ACCESS_TOKEN
  || process.env.SHOPIFY_ACCESS_TOKEN
  || process.env.SHOPIFY_ADMIN_API_KEY // ако е поставен така
  || '';

function assertShop(shop) {
  if (!shop || !/^[a-z0-9-]+\.myshopify\.com$/i.test(shop)) {
    const e = new Error('Missing or invalid "shop" (expected myshopify.com domain)');
    e.status = 400;
    throw e;
  }
}

function gidToId(v) {
  if (!v) return v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/Product\/(\d+)/);
  return m ? m[1] : s;
}

function adminUrl(shop, path) {
  return `https://${shop}${path}`;
}

function adminHeaders() {
  if (!ADMIN_TOKEN) {
    const e = new Error('Server is missing Admin API token (set SHOPIFY_ADMIN_API_TOKEN)');
    e.status = 500;
    throw e;
  }
  return {
    'X-Shopify-Access-Token': ADMIN_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

// Сигурен fetch с тайм-аут и четене на JSON/грешка.
async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs || 12000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) {
      const err = new Error(json?.errors || json?.error || `${res.status} ${res.statusText}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

// ---- Core loaders -----------------------------------------------------------

/**
 * Връща { primaryLanguage, enabled } чрез устойчиви REST повиквания.
 * 1) /admin/api/${ver}/locales.json
 * 2) ако 404 – пробва /admin/api/unstable/locales.json
 * 3) ако пак няма – връща ["en"] като фолбек
 */
async function loadShopLocales(shop) {
  assertShop(shop);
  const headers = adminHeaders();

  const tryPaths = [
    `/admin/api/${API_VERSION}/locales.json`,
    `/admin/api/unstable/locales.json`,
  ];

  let lastErr;
  for (const p of tryPaths) {
    try {
      const j = await fetchJson(adminUrl(shop, p), { headers });
      // Формат на locales.json: { locales: [{ locale: "en", primary: true, published: true }, ...] }
      const locales = Array.isArray(j?.locales) ? j.locales : [];
      const enabled = locales
        .filter(l => (l.published === true || l.published === 'true' || l.enabled === true))
        .map(l => (l.locale || l.iso_code || '').toLowerCase())
        .filter(Boolean);

      // Primary: ако някой е primary: true – ползваме него, иначе първия 'en' или enabled[0]
      const primary =
        (locales.find(l => l.primary)?.locale
          || locales.find(l => l.primary)?.iso_code
          || enabled.find(lc => lc === 'en')
          || enabled[0]
          || (locales[0]?.locale || locales[0]?.iso_code)
          || 'en').toLowerCase();

      const unique = Array.from(new Set(enabled.length ? enabled : [primary]));
      return { primaryLanguage: primary, enabled: unique, source: p.includes('unstable') ? 'rest:unstable' : 'rest' };
    } catch (e) {
      lastErr = e;
      // 404 => пробваме следващата пътека
      if (e?.status !== 404) break;
    }
  }

  // Фолбек, ако нищо не тръгне
  return {
    primaryLanguage: 'en',
    enabled: ['en'],
    source: 'fallback',
    _error: lastErr?.message || null,
  };
}

/**
 * Връща ["en","bg",…] за продукт, като проверява преводи през:
 *   /admin/api/${ver}/products/{id}/translations.json
 * Ако endpoint-ът липсва (404) – фолбек само към езиците на магазина.
 */
async function loadProductLocales(shop, productId, shopEnabled, primary) {
  assertShop(shop);
  const id = gidToId(productId);
  if (!id || !/^\d+$/.test(id)) {
    const e = new Error('Invalid productId (expect numeric id or gid://shopify/Product/###)');
    e.status = 400;
    throw e;
  }
  const headers = adminHeaders();

  const tryPaths = [
    `/admin/api/${API_VERSION}/products/${id}/translations.json`,
    `/admin/api/unstable/products/${id}/translations.json`,
  ];

  let lastErr;
  for (const p of tryPaths) {
    try {
      const j = await fetchJson(adminUrl(shop, p), { headers });
      // Формат: { translations: [{ locale:"bg", key:"title", value:"...", translated:true }, ...] }
      const translations = Array.isArray(j?.translations) ? j.translations : [];
      const locales = new Set();

      for (const t of translations) {
        const lc = (t?.locale || t?.language || '').toLowerCase();
        // броим език, ако е преведен поне един ключ (translated === true) ИЛИ има някаква стойност
        if (!lc) continue;
        const translated = (t?.translated === true || t?.value || t?.metafield);
        if (translated) locales.add(lc);
      }

      // Винаги добавяме primary
      if (primary) locales.add(primary.toLowerCase());

      // Ограничаваме до позволените за магазина (ако знаем такива)
      const asArray = Array.from(locales);
      const filtered = shopEnabled?.length
        ? asArray.filter(lc => shopEnabled.includes(lc))
        : asArray;

      const result = filtered.length ? filtered : (shopEnabled?.length ? shopEnabled : [primary || 'en']);
      return { productLanguages: Array.from(new Set(result)), source: p.includes('unstable') ? 'rest:unstable' : 'rest' };
    } catch (e) {
      lastErr = e;
      if (e?.status !== 404) break;
    }
  }

  // Фолбек: само езиците на магазина
  return {
    productLanguages: Array.from(new Set(shopEnabled?.length ? shopEnabled : [primary || 'en'])),
    source: 'fallback',
    _error: lastErr?.message || null,
  };
}

// ---- Routes -----------------------------------------------------------------

router.get('/_routes', (_req, res) => {
  res.json({
    mountedAt: '/api/languages',
    routes: ['/_ping', '/_routes', '/_debug', '/_check', '/shop', '/product/:shop/:productId'],
    apiVersion: API_VERSION,
  });
});

router.get('/_ping', (_req, res) => res.json({ pong: true }));

router.get('/_debug', (req, res) => {
  const { shop } = req.query;
  res.json({
    url: req.url,
    query: req.query,
    headers: {
      authorization_present: !!req.headers.authorization,
      cookie_names: Object.keys(req.cookies || {}),
      host: req.headers.host,
      referer: req.headers.referer || null,
      user_agent: req.headers['user-agent'] || null,
    },
    env: {
      apiVersion: API_VERSION,
      hasSingleToken: !!ADMIN_TOKEN,
      nodeEnv: process.env.NODE_ENV || null,
    },
    note: 'This endpoint does not call Shopify APIs.',
  });
});

// Бърза проверка и диагностика: какво ще върне за магазина.
router.get('/_check', async (req, res) => {
  const t0 = Date.now();
  try {
    const { shop } = req.query;
    assertShop(shop);
    const shopLocales = await loadShopLocales(shop);
    res.json({
      shop,
      primaryLanguage: shopLocales.primaryLanguage,
      shopLanguages: shopLocales.enabled,
      authUsed: ADMIN_TOKEN ? 'single' : 'none',
      source: shopLocales.source,
      tookMs: Date.now() - t0,
      _error: shopLocales._error || null,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.payload || null });
  }
});

// Езиците на магазина
router.get('/shop', async (req, res) => {
  const t0 = Date.now();
  try {
    const { shop } = req.query;
    assertShop(shop);
    const shopLocales = await loadShopLocales(shop);
    res.json({
      shop,
      primaryLanguage: shopLocales.primaryLanguage,
      shopLanguages: shopLocales.enabled,
      authUsed: ADMIN_TOKEN ? 'single' : 'none',
      source: shopLocales.source,
      tookMs: Date.now() - t0,
      _error: shopLocales._error || null,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: 'Failed to load shop languages', detail: e.message });
  }
});

// Езиците на продукта (вкл. тези, за които има превод)
router.get('/product/:shop/:productId', async (req, res) => {
  const t0 = Date.now();
  try {
    const shop = req.params.shop;
    const productId = req.params.productId;

    assertShop(shop);

    // 1) Магазински езици
    const shopLocales = await loadShopLocales(shop);
    const primary = shopLocales.primaryLanguage;
    const enabled = shopLocales.enabled;

    // 2) Продуктови езици (от /translations)
    const prodLocales = await loadProductLocales(shop, productId, enabled, primary);

    // Показва ли се селектора? – ако има повече от 1 език общо
    const effective = prodLocales.productLanguages?.length
      ? prodLocales.productLanguages
      : enabled;

    const shouldShowSelector = (Array.from(new Set(effective)).length > 1);

    res.json({
      shop,
      productId,
      primaryLanguage: primary,
      shopLanguages: enabled,
      productLanguages: prodLocales.productLanguages,
      shouldShowSelector,
      allLanguagesOption: shouldShowSelector ? { label: 'All languages', value: 'all' } : null,
      authUsed: ADMIN_TOKEN ? 'single' : 'none',
      source: `${shopLocales.source}|${prodLocales.source}`,
      tookMs: Date.now() - t0,
      _errors: [shopLocales._error, prodLocales._error].filter(Boolean),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: 'Failed to load product languages', detail: e.message });
  }
});

export default router;
