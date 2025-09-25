import express from 'express';
import { validateRequest } from '../middleware/shopifyAuth.js';
import { resolveShopToken } from '../utils/tokenResolver.js';

// ===== Config
const API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || '2025-07';

// ---- helpers
const normalizeLocale = (l) => (l ? String(l).trim().toLowerCase() : null);
const toGID = (id) => {
  const s = String(id || '').trim();
  if (!s) return s;
  if (/^gid:\/\//i.test(s)) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return s; // let Shopify validate
};

/** Resolve Admin token using centralized function with id_token */
async function resolveAdminToken(shop, req) {
  console.log('=== LANGUAGE CONTROLLER TOKEN RESOLVE ===');
  
  try {
    const token = await resolveShopToken(shop, { idToken: req?.idToken, requested: 'offline' });
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

// ---- queries
const Q_SHOP_LOCALES = `
  query ShopLocales {
    shopLocales {
      locale
      primary
      published
    }
  }
`;

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
  
  const { token, authUsed } = await resolveAdminToken(req.shopDomain, req);
  console.log('[LANGUAGE-ENDPOINT] Token resolved:', { token: token ? `${token.substring(0, 10)}...` : 'null', authUsed });

  try {
    const out = await resolveLanguages({ shop, productId: null, token, authUsed });
    // remove product-specific fields
    const { productLanguages, allLanguagesOption, shouldShowSelector, ...rest } = out;
    rest.source = rest.source.split('|')[0];
    console.log(`[LANGUAGE-CONTROLLER] Shop languages response for ${shop}:`, rest);
    return res.json(rest);
  } catch (e) {
    return res.status(200).json({
      shop,
      primaryLanguage: 'en',
      shopLanguages: ['en'],
      authUsed,
      source: 'fallback',
      tookMs: 0,
      _error: e.message || String(e),
    });
  }
});

/** GET /api/languages/product/:shop/:productId */
router.get('/product/:shop/:productId', validateRequest(), async (req, res) => {
  const shop = req.shopDomain;
  const productId = String(req.params.productId || '').trim();
  const { token, authUsed } = await resolveAdminToken(req.shopDomain, req);

  if (!productId) return res.status(400).json({ error: 'Missing :productId' });
  if (!token) return res.status(500).json({ error: 'Admin token missing (session/header/env)' });

  try {
    const out = await resolveLanguages({ shop, productId, token, authUsed });
    
    // Get optimized languages for this product using the new productSync functions
    try {
      const { getProductSeoLocales } = await import('./productSync.js');
      const optimized = await getProductSeoLocales(shop, token, toGID(productId));
      out.optimizedLanguages = optimized;
    } catch (e) {
      console.warn('[LANGUAGE-CONTROLLER] Could not get optimized languages:', e.message);
      out.optimizedLanguages = [];
    }
    
    return res.json({
      shop,
      productId: toGID(productId),
      shopLanguages: out.shopLanguages,          // string codes only
      productLanguages: out.productLanguages,    // string codes only  
      optimizedLanguages: out.optimizedLanguages, // string codes only
      primaryLanguage: out.primaryLanguage,
      shouldShowSelector: out.shouldShowSelector,
      allLanguagesOption: out.allLanguagesOption,
      authUsed: out.authUsed,
      source: out.source,
      tookMs: out.tookMs,
      ...(out._errors ? { _errors: out._errors } : {})
    });
  } catch (e) {
    return res.status(200).json({
      shop,
      productId: toGID(productId),
      primaryLanguage: 'en',
      shopLanguages: ['en'],
      productLanguages: ['en'],
      shouldShowSelector: false,
      allLanguagesOption: null,
      authUsed,
      source: 'fallback|fallback',
      tookMs: 0,
      _errors: [e.message || String(e)],
    });
  }
});

/** Optional: quick sanity ping to expose the real GQL error quickly */
router.get('/ping/:shop', validateRequest(), async (req, res) => {
  const shop = req.shopDomain;
  const { token, authUsed } = await resolveAdminToken(req.shopDomain, req);
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
