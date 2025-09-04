import express from 'express';

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

/** Pick best available Admin token for THIS shop */
function resolveAdminToken(req) {
  // 1) OAuth per-shop (shopify-app-express usually sets this)
  const sessionToken = req?.res?.locals?.shopify?.session?.accessToken;
  if (sessionToken) return { token: sessionToken, authUsed: 'session' };

  // 2) Proxy/header (optional)
  const headerToken = req.headers['x-shopify-access-token'];
  if (headerToken) return { token: String(headerToken), authUsed: 'header' };

  // 3) Single-tenant env (must be created IN THE SAME SHOP you're calling)
  const envToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (envToken) return { token: envToken, authUsed: 'single' };

  return { token: null, authUsed: 'none' };
}

async function shopifyGQL({ shop, token, query, variables }) {
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) {
    const err = new Error(`GraphQL HTTP ${res.status} ${res.statusText} @ ${url} :: ${raw}`);
    err.status = res.status;
    err.body = raw;
    err.url = url;
    throw err;
  }

  let json;
  try { json = JSON.parse(raw); } catch {
    const err = new Error(`GraphQL invalid JSON @ ${url} :: ${raw}`);
    err.status = res.status;
    err.body = raw;
    err.url = url;
    throw err;
  }

  if (json?.errors?.length) {
    const msg = json.errors.map(e => e.message).join('; ');
    const err = new Error(`GraphQL errors @ ${url}: ${msg}`);
    err.graphQLErrors = json.errors;
    throw err;
  }
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
    shopLanguages: shopLanguages.length ? shopLanguages : ['en'],
    productLanguages: effectiveProduct,
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
router.get('/shop/:shop', async (req, res) => {
  const shop = String(req.params.shop || '').trim();
  const { token, authUsed } = resolveAdminToken(req);
  if (!shop) return res.status(400).json({ error: 'Missing :shop' });
  if (!token) return res.status(500).json({ error: 'Admin token missing (session/header/env)' });

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
router.get('/product/:shop/:productId', async (req, res) => {
  const shop = String(req.params.shop || '').trim();
  const productId = String(req.params.productId || '').trim();
  const { token, authUsed } = resolveAdminToken(req);

  if (!shop) return res.status(400).json({ error: 'Missing :shop' });
  if (!productId) return res.status(400).json({ error: 'Missing :productId' });
  if (!token) return res.status(500).json({ error: 'Admin token missing (session/header/env)' });

  try {
    const out = await resolveLanguages({ shop, productId, token, authUsed });
    return res.json(out);
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
router.get('/ping/:shop', async (req, res) => {
  const shop = String(req.params.shop || '').trim();
  const { token, authUsed } = resolveAdminToken(req);
  if (!shop) return res.status(400).json({ error: 'Missing :shop' });
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
