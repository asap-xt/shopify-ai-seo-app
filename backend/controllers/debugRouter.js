// backend/controllers/debugRouter.js
// Uses res.locals.shopify (session injected by your auth) — no shopify.js import.

import { Router } from 'express';
const router = Router();

// ===== DEBUG middleware for /debug =====
router.use(async (req, res, next) => {
  const started = Date.now();
  const auth = req.headers['authorization'] || '';
  const tokenHead = auth.startsWith('Bearer ') ? auth.slice(7, 19) : null;
  const shopByQuery = req.query?.shop;
  const shopByBody = req.body?.shop;
  let shopBySession = null;
  try {
    // If using @shopify/shopify-api middleware, session may be attached
    shopBySession = res.locals?.shopify?.session?.shop || res.locals?.shop || null;
  } catch {}
  console.log('[DEBUG] →', {
    method: req.method,
    path: req.originalUrl,
    hasAuth: !!auth,
    tokenHead,
    queryShop: shopByQuery,
    bodyShop: shopByBody,
    sessionShop: shopBySession,
  });
  const send = res.send.bind(res);
  res.send = function (body) {
    try {
      const elapsed = Date.now() - started;
      let payload = body;
      if (typeof body === 'string') {
        try { payload = JSON.parse(body); } catch {}
      }
      console.log('[DEBUG] ←', {
        status: res.statusCode,
        elapsedMs: elapsed,
        error: payload?.error,
        ok: payload?.ok,
      });
    } catch (e) {
      console.log('[DEBUG] ←', { status: res.statusCode, note: 'failed to log response' });
    }
    return send(body);
  };
  next();
});

const uniq = (arr) => Array.from(new Set(arr));
const baseLang = (loc) => (loc || '').toLowerCase().split('-')[0];
const toGID = (id) => (/^\d+$/.test(String(id)) ? `gid://shopify/Product/${id}` : String(id));

function getGraphQL(res) {
  const api = res.locals?.shopify?.api;
  const session = res.locals?.shopify?.session;
  if (!api || !session) return { error: 'Unauthorized: missing Shopify session' };
  const Graphql = api.clients?.Graphql || api.clients?.graphql;
  if (!Graphql) return { error: 'Shopify GraphQL client not available' };
  return { client: new Graphql({ session }), session };
}

// GET /debug/locales
router.get('/locales', async (req, res) => {
  try {
    const { client, session, error } = getGraphQL(res);
    if (error) return res.status(401).json({ error });

    const q = /* GraphQL */ `
      query DebugShopLocales {
        shopLocales {
          locale
          name
          primary
          published
        }
      }
    `;
    const data = await client.request(q);
    const all = data?.data?.shopLocales || [];
    const published = all.filter((l) => l.published);
    const primary = published.find((l) => l.primary)?.locale || null;

    res.json({
      shop: session?.shop || null,
      locales: all,
      publishedLocales: published.map((l) => l.locale),
      languages: uniq(published.map((l) => baseLang(l.locale))),
      primaryLocale: primary,
    });
  } catch (err) {
    console.error('DEBUG /debug/locales error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// GET /debug/product-locales/:productId
router.get('/product-locales/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const gid = toGID(productId);

    const { client, session, error } = getGraphQL(res);
    if (error) return res.status(401).json({ error });

    const qLocales = /* GraphQL */ `
      query DebugShopLocales {
        shopLocales {
          locale
          primary
          published
        }
      }
    `;
    const locData = await client.request(qLocales);
    const publishedLocales = (locData?.data?.shopLocales || [])
      .filter((l) => l.published)
      .map((l) => l.locale);

    const results = [];
    for (const loc of publishedLocales) {
      try {
        const qProd = /* GraphQL */ `
          query ProductInLocale($id: ID!) @inContext(language: ${JSON.stringify(loc)}) {
            product(id: $id) {
              id
              title
              descriptionHtml
            }
          }
        `;
        const p = await client.request(qProd, { variables: { id: gid } });
        const prod = p?.data?.product;
        const textFromHtml = (html) => (html || '').replace(/<[^>]*>/g, '').trim();
        const hasTitle = !!(prod?.title && prod.title.trim().length);
        const hasBody = !!(prod?.descriptionHtml && textFromHtml(prod.descriptionHtml).length);
        results.push({
          locale: loc,
          language: baseLang(loc),
          hasTitle,
          hasBody,
        });
      } catch (e) {
        results.push({ locale: loc, language: baseLang(loc), error: String(e?.message || e) });
      }
    }

    res.json({
      shop: session?.shop || null,
      productId: gid,
      publishedLocales,
      productLanguages: uniq(results.filter(r => r.hasTitle || r.hasBody).map(r => r.language)),
      checks: results,
    });
  } catch (err) {
    console.error('DEBUG /debug/product-locales error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;
