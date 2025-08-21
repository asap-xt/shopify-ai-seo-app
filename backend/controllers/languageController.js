// backend/controllers/languageController.js
// Purpose: Return real shop locales and product locales using the same Shopify session
// as /plans/me and /seo/*, plus rich debug to trace why a session may be missing.

import express from 'express';
import * as Shopify from '@shopify/shopify-api';
import * as auth from '../auth.js'; // defensive import; may or may not export validateAuthenticatedSession

const router = express.Router();

// ---------- Utils (safe logging/masking) ----------
function mask(str, keep = 10) {
  if (!str || typeof str !== 'string') return str;
  const s = str.trim();
  if (s.length <= keep) return s;
  return s.slice(0, keep) + '…';
}
function bool(x) { return !!x; }
function listCookies(req) {
  const c = req.headers?.cookie || '';
  return c ? c.split(';').map(s => s.trim().split('=')[0]).filter(Boolean) : [];
}

// ---------- Session Guard with detailed logs ----------
async function sessionGuard(req, res, next) {
  const startedAt = Date.now();
  const details = {
    path: req.originalUrl,
    method: req.method,
    hasAuthValidator: typeof auth.validateAuthenticatedSession === 'function',
    authHeaderPresent: !!req.headers?.authorization,
    authHeaderPrefix: req.headers?.authorization ? req.headers.authorization.split(' ')[0] : null,
    cookiesPresent: listCookies(req),
    hadSessionBefore: bool(res.locals?.shopify?.session),
  };

  try {
    if (details.hasAuthValidator) {
      // Prefer official validator when present
      try {
        await auth.validateAuthenticatedSession(req, res);
      } catch (e) {
        console.error('[languages][guard] validateAuthenticatedSession threw:', e?.message || e);
        return res.status(401).json({
          error: 'Unauthorized: validator threw',
          debug: { ...details, validatorError: e?.message || String(e), tookMs: Date.now() - startedAt },
        });
      }
      if (res.headersSent) {
        console.warn('[languages][guard] Response was already sent by validator.');
        return;
      }
    }

    const hasSession = bool(res.locals?.shopify?.session);
    if (!hasSession) {
      const debug = {
        ...details,
        hasSessionAfter: false,
        tookMs: Date.now() - startedAt,
      };
      console.warn('[languages][guard] NO SESSION', debug);
      return res.status(401).json({ error: 'Unauthorized: missing Shopify session', debug });
    }

    // ok
    const debug = {
      ...details,
      hasSessionAfter: true,
      shop: res.locals.shopify.session?.shop,
      tookMs: Date.now() - startedAt,
    };
    console.log('[languages][guard] OK', debug);
    next();
  } catch (err) {
    const debug = {
      ...details,
      catchError: err?.message || String(err),
      tookMs: Date.now() - startedAt,
    };
    console.error('[languages][guard] ERROR', debug);
    return res.status(401).json({ error: 'Unauthorized', debug });
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

// ---------- PUBLIC DEBUG (no session required, no Admin API calls) ----------
/**
 * GET /api/languages/_debug
 * Returns request/locals info to see what the server receives.
 * Does NOT call Shopify APIs and does NOT require a session.
 */
router.get('/_debug', (req, res) => {
  try {
    const info = {
      url: req.originalUrl,
      method: req.method,
      query: req.query,
      headers: {
        authorization_present: !!req.headers?.authorization,
        authorization_masked: req.headers?.authorization ? mask(req.headers.authorization, 15) : null,
        cookie_names: listCookies(req),
        host: req.headers?.host,
        origin: req.headers?.origin,
        referer: req.headers?.referer,
        user_agent: req.headers?.['user-agent'],
      },
      locals: {
        hasShopify: !!res.locals?.shopify,
        hasSession: !!res.locals?.shopify?.session,
        shop: res.locals?.shopify?.session?.shop || null,
      },
      env: {
        node_env: process.env.NODE_ENV || 'development',
      },
      note: 'This endpoint does not call Shopify APIs and does not require a session.',
    };
    res.json(info);
  } catch (e) {
    res.status(500).json({ error: 'debug failed', message: e?.message || String(e) });
  }
});

// ---------- SHOP LOCALES ----------
/**
 * GET /api/languages/shop
 * Returns active shop locales and primary locale.
 */
router.get('/shop', sessionGuard, async (req, res) => {
  const t0 = Date.now();
  try {
    const session = res.locals.shopify.session;
    const rest = restClient(session);

    console.log('[languages][shop] calling REST shop_locales for', session.shop);
    const rsp = await rest.get({ path: 'shop_locales' });
    const locales = Array.isArray(rsp?.body?.locales) ? rsp.body.locales : [];

    const active = locales.filter(l => l?.enabled).map(l => String(l.locale).toLowerCase());
    const primary = String((locales.find(l => l?.primary)?.locale) || active[0] || 'en').toLowerCase();

    const out = {
      shop: session.shop,
      primaryLanguage: primary,
      shopLanguages: active.length ? active : [primary || 'en'],
      tookMs: Date.now() - t0,
    };
    console.log('[languages][shop] OK', out);
    res.json(out);
  } catch (err) {
    console.error('[languages][shop] ERROR', err?.response?.body || err?.message || err);
    res.status(500).json({ error: 'Failed to load shop languages', detail: err?.message || String(err) });
  }
});

// ---------- PRODUCT LOCALES ----------
/**
 * GET /api/languages/product/:shop/:productId
 * Returns shop languages + product languages for the given product.
 * productId may be numeric or a GID.
 */
router.get('/product/:shop/:productId', sessionGuard, async (req, res) => {
  const t0 = Date.now();
  try {
    const session = res.locals.shopify.session;
    const { productId } = req.params;

    // 1) Shop locales (REST)
    const rest = restClient(session);
    console.log('[languages][product] shop_locales for', session.shop);
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
    console.log('[languages][product] GQL translations for', gid);
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

    const out = {
      shop: session.shop,
      productId: gid,
      primaryLanguage,
      shopLanguages: shopLanguages.length ? shopLanguages : [primaryLanguage || 'en'],
      productLanguages,
      shouldShowSelector,
      allLanguagesOption,
      tookMs: Date.now() - t0,
    };
    console.log('[languages][product] OK', out);
    res.json(out);
  } catch (err) {
    console.error('[languages][product] ERROR', err?.response?.body || err?.message || err);
    res.status(500).json({ error: 'Failed to load product languages', detail: err?.message || String(err) });
  }
});

export default router;
