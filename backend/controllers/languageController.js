import express from 'express';
import { validateRequest } from '../middleware/shopifyAuth.js';
import { resolveShopToken, resolveAdminToken } from '../utils/tokenResolver.js';

// ===== Config
const API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || '2025-07';

// ---- helpers
const normalizeLocale = (l) => (l ? String(l).trim().toLowerCase() : null);

// Helper function to normalize shop domain (fixes duplicate domain issue)
function normalizeShopDomain(input) {
  if (!input) return '';
  return Array.isArray(input) ? input[0] : String(input).trim();
}

// Unified GraphQL client with token normalization
async function adminGraphQL(shop, token, query, variables = {}) {
  const shopDomain = normalizeShopDomain(shop);
  const url = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ query, variables }),
  });

  // retry on 401 with forced token exchange
  if (res.status === 401) {
    console.log('[LANGUAGE-GRAPHQL] Got 401, attempting token exchange...');
    try {
      const freshToken = await resolveShopToken(shopDomain, { requested: 'offline' });
      const retry = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': freshToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ query, variables }),
      });
      return await retry.json();
    } catch (e) {
      console.error('[LANGUAGE-GRAPHQL] Token exchange failed:', e.message);
      throw e;
    }
  }

  return await res.json();
}

// Query: all published shop locales
const Q_SHOP_LOCALES = `
  query ShopLocales {
    shopLocales {
      locale
      name
      primary
      published
    }
  }
`;

async function getShopLocales(shop, token) {
  const json = await adminGraphQL(shop, token, Q_SHOP_LOCALES);
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const locales = json?.data?.shopLocales ?? [];
  return locales.filter(l => l.published); // [{ locale, name, primary, published }]
}

// Query: SEO metafields for product (to see which languages are optimized)
const Q_PRODUCT_SEO_KEYS = `
  query ProductSeoMetafields($id: ID!) {
    product(id: $id) {
      id
      metafields(first: 100, namespace: "seo_ai") {
        edges {
          node { key }
        }
      }
    }
  }
`;

async function getOptimizedLocalesForProduct(shop, token, productGid) {
  const json = await adminGraphQL(shop, token, Q_PRODUCT_SEO_KEYS, { id: productGid });
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const edges = json?.data?.product?.metafields?.edges ?? [];
  // keys are like "seo__en", "seo__es"...
  const locales = [];
  for (const e of edges) {
    const k = e?.node?.key || '';
    const m = /^seo__([a-z]{2}(-[A-Z]{2})?)$/.exec(k);
    if (m) locales.push(m[1]);
  }
  return locales; // ["en", "es", ...]
}
const toGID = (id) => {
  const s = String(id || '').trim();
  if (!s) return s;
  if (/^gid:\/\//i.test(s)) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return s; // let Shopify validate
};

/** Resolve Admin token using centralized function with id_token */
async function resolveAdminTokenForLanguage(shop, req) {
  console.log('=== LANGUAGE CONTROLLER TOKEN RESOLVE ===');
  
  try {
    const token = await resolveAdminToken(req, shop);
    console.log('1. Token resolved successfully from centralized resolver');
    console.log('2. Token type:', typeof token);
    return { token, authUsed: 'token_exchange' };
  } catch (err) {
    console.error('3. Token resolution failed:', err.message);
    return { token: null, authUsed: 'none' };
  }
}

async function shopifyGQL({ shop, token, query, variables }) {
  console.log('[LANGUAGE-GRAPHQL] Shop:', shop);
  console.log('[LANGUAGE-GRAPHQL] Query:', query.substring(0, 100) + '...');
  console.log('[LANGUAGE-GRAPHQL] Variables:', JSON.stringify(variables, null, 2));
  console.log('[LANGUAGE-GRAPHQL] Token:', token ? `${token.substring(0, 10)}...` : 'null');
  
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  console.log('[LANGUAGE-GRAPHQL] URL:', url);
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  
  console.log('[LANGUAGE-GRAPHQL] Response status:', res.status);
  console.log('[LANGUAGE-GRAPHQL] Response headers:', Object.fromEntries(res.headers.entries()));

  const raw = await res.text().catch(() => '');
  console.log('[LANGUAGE-GRAPHQL] Response raw:', raw.substring(0, 200) + (raw.length > 200 ? '...' : ''));
  
  if (!res.ok) {
    console.error('[LANGUAGE-GRAPHQL] Error response:', raw);
    const err = new Error(`GraphQL HTTP ${res.status} ${res.statusText} @ ${url} :: ${raw}`);
    err.status = res.status;
    err.body = raw;
    err.url = url;
    throw err;
  }

  let json;
  try { 
    json = JSON.parse(raw); 
    console.log('[LANGUAGE-GRAPHQL] Response data:', JSON.stringify(json, null, 2));
  } catch {
    console.error('[LANGUAGE-GRAPHQL] Invalid JSON response:', raw);
    const err = new Error(`GraphQL invalid JSON @ ${url} :: ${raw}`);
    err.status = res.status;
    err.body = raw;
    err.url = url;
    throw err;
  }

  if (json?.errors?.length) {
    console.error('[LANGUAGE-GRAPHQL] GraphQL errors:', json.errors);
    const msg = json.errors.map(e => e.message).join('; ');
    const err = new Error(`GraphQL errors @ ${url}: ${msg}`);
    err.graphQLErrors = json.errors;
    throw err;
  }
  
  console.log('[LANGUAGE-GRAPHQL] Success, returning data');
  return json.data;
}

// ---- queries (removed duplicate Q_SHOP_LOCALES)

const Q_PRODUCT_LOCALES = `
  query ProductLocales($id: ID!) {
    product(id: $id) {
      resourcePublications(first: 100) {
        edges {
          node {
            locale { locale }
          }
        }
      }
    }
  }
`;

// ---- shaping
function shapeOutput({ shop, productId, shopLocalesRaw, productLocalesRaw, authUsed, source, errors, tookMs }) {
  const shopLocales = (Array.isArray(shopLocalesRaw) ? shopLocalesRaw : [])
    .map(l => ({
      locale: normalizeLocale(l?.locale),
      primary: !!l?.primary,
      published: !!l?.published,
    }))
    .filter(l => !!l.locale);

  const primaryLanguage = shopLocales.find(l => l.primary)?.locale
    || shopLocales[0]?.locale
    || 'en';

  // Always return string codes only, never objects
  const shopLanguages = shopLocales
    .map(l => l.locale)
    .filter((v, i, a) => v && a.indexOf(v) === i);

  const productLanguages = (Array.isArray(productLocalesRaw) ? productLocalesRaw : [])
    .map(x => normalizeLocale(x))
    .filter(Boolean);

  const effectiveProduct = productLanguages.length ? productLanguages : (shopLanguages.length ? shopLanguages : ['en']);
  const shouldShowSelector = effectiveProduct.length > 1;

  return {
    shop,
    productId,
    primaryLanguage,
    shopLanguages: shopLanguages.length ? shopLanguages : ['en'], // <-- only string codes
    shopLanguageDetails: shopLocales, // <-- full objects if needed for UI
    productLanguages: effectiveProduct, // <-- only string codes
    optimizedLanguages: [], // <-- will be filled by product-specific logic
    shouldShowSelector,
    allLanguagesOption: shouldShowSelector ? { label: 'All languages', value: 'all' } : null,
    authUsed,
    source,
    tookMs,
    ...(errors?.length ? { _errors: errors } : {}),
  };
}

// ---- logic
async function resolveLanguages({ shop, productId, token, authUsed }) {
  console.log('[RESOLVE-LANGUAGES] Starting with:', { shop, productId, token: token ? `${token.substring(0, 10)}...` : 'null', authUsed });
  const t0 = Date.now();
  const errors = [];
  let sourceStart = 'gql';
  let sourceEnd = 'gql';

  // shop locales
  let shopLocalesRaw;
  try {
    const data = await shopifyGQL({ shop, token, query: Q_SHOP_LOCALES });
    shopLocalesRaw = data?.shopLocales || [];
  } catch (e) {
    errors.push(e.message || String(e));
    sourceStart = 'fallback';
    shopLocalesRaw = [{ locale: 'en', primary: true, published: true }];
  }

  // product locales
  let productLocalesRaw;
  const gid = toGID(productId);
  if (gid) {
    try {
      const data = await shopifyGQL({ shop, token, query: Q_PRODUCT_LOCALES, variables: { id: gid } });
      const edges = data?.product?.resourcePublications?.edges || [];
      productLocalesRaw = edges.map(e => e?.node?.locale?.locale).filter(Boolean);
    } catch (e) {
      errors.push(e.message || String(e));
      sourceEnd = 'fallback';
      productLocalesRaw = (shopLocalesRaw || []).map(l => l.locale).filter(Boolean);
    }
  } else {
    sourceEnd = 'fallback';
    productLocalesRaw = (shopLocalesRaw || []).map(l => l.locale).filter(Boolean);
  }

  return shapeOutput({
    shop,
    productId: gid || productId,
    shopLocalesRaw,
    productLocalesRaw,
    authUsed,
    source: `${sourceStart}|${sourceEnd}`,
    errors,
    tookMs: Date.now() - t0,
  });
}

// ---- router
const router = express.Router();

/** GET /api/languages/shop/:shop */
router.get('/shop/:shop', validateRequest(), async (req, res) => {
  console.log('[LANGUAGE-ENDPOINT] ===== HANDLER CALLED =====');
  console.log('[LANGUAGE-ENDPOINT] req.shopDomain:', req.shopDomain);
  console.log('[LANGUAGE-ENDPOINT] req.params:', req.params);
  const shop = req.shopDomain;
  console.log('[LANGUAGE-ENDPOINT] Starting with shop:', shop);
  
  const { token, authUsed } = await resolveAdminTokenForLanguage(req.shopDomain, req);
  console.log('[LANGUAGE-ENDPOINT] Token resolved:', { token: token ? `${token.substring(0, 10)}...` : 'null', authUsed });

  try {
    const locales = await getShopLocales(shop, token);
    const primary = locales.find(l => l.primary)?.locale || null;
    
    console.log(`[LANGUAGE-CONTROLLER] Shop languages response for ${shop}:`, { locales, primary });
    return res.json({
      shop,
      locales,                                    // [{ locale,name,primary,published }]
      primary
    });
  } catch (e) {
    console.error('[LANGUAGE-CONTROLLER] Error:', e.message);
    return res.status(200).json({
      shop,
      locales: [{ locale: 'en', name: 'English', primary: true, published: true }],
      primary: 'en',
      _error: e.message || String(e),
    });
  }
});

/** GET /api/languages/product/:shop/:productId */
router.get('/product/:shop/:productId', validateRequest(), async (req, res) => {
  const shop = req.shopDomain;
  const productId = String(req.params.productId || '').trim();
  const { token, authUsed } = await resolveAdminTokenForLanguage(req.shopDomain, req);

  if (!productId) return res.status(400).json({ error: 'Missing :productId' });
  if (!token) return res.status(500).json({ error: 'Admin token missing (session/header/env)' });

  try {
    const productGid = toGID(productId);
    const [shopLocales, optimizedLocales] = await Promise.all([
      getShopLocales(shop, token),
      getOptimizedLocalesForProduct(shop, token, productGid),
    ]);

    const byCode = new Map(shopLocales.map(l => [l.locale, l]));
    const languages = shopLocales.map(l => ({
      ...l,
      optimized: optimizedLocales.includes(l.locale),
    }));

    return res.json({
      shop,
      productId: productGid,
      availableLanguages: shopLocales,  // for UI: all published
      languages,                        // for UI: with optimized flag
      primary: shopLocales.find(l => l.primary)?.locale || null,
    });
  } catch (e) {
    console.error('[LANGUAGE-CONTROLLER] Error:', e.message);
    return res.status(200).json({
      shop,
      productId: toGID(productId),
      availableLanguages: [{ locale: 'en', name: 'English', primary: true, published: true }],
      languages: [{ locale: 'en', name: 'English', primary: true, published: true, optimized: false }],
      primary: 'en',
      _error: e.message || String(e),
    });
  }
});

/** Optional: quick sanity ping to expose the real GQL error quickly */
router.get('/ping/:shop', validateRequest(), async (req, res) => {
  const shop = req.shopDomain;
  const { token, authUsed } = await resolveAdminTokenForLanguage(req.shopDomain, req);
  if (!token) return res.status(500).json({ error: 'Admin token missing (session/header/env)' });

  try {
    // super cheap field, mainly to validate token+shop
    const data = await shopifyGQL({
      shop,
      token,
      query: `query { shop { id name } }`,
    });
    return res.json({ ok: true, authUsed, shop: data?.shop });
  } catch (e) {
    return res.status(500).json({ ok: false, authUsed, error: e.message });
  }
});

export default router;
