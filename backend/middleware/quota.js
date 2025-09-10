// backend/middleware/quota.js
// Subscription loading + quota enforcement with robust shop inference.
// Works for embedded Admin requests (no ?shop needed), app-bridge host param,
// session tokens (Authorization: Bearer ...), and legacy headers.
//
// Set DEBUG_SHOP_INFER=true in env to print safe debug info when shop is missing.

import {
  getPlanConfig,
  resolvePlanKey,
  vendorFromModel,
  allowedModelsForPlan,
  TRIAL_DAYS,
} from '../plans.js';

let SubscriptionModel = null;

async function loadSubscriptionModel() {
  if (SubscriptionModel) return SubscriptionModel;
  const candidates = [
    '../db/Subscription.js',
    '../models/Subscription.js',
    '../../db/Subscription.js',
    '../../models/Subscription.js',
  ];
  for (const p of candidates) {
    try {
      const mod = await import(p);
      SubscriptionModel = mod.default || mod.Subscription || mod;
      if (SubscriptionModel) return SubscriptionModel;
    } catch {
      // try next path
    }
  }
  throw new Error('Subscription model not found');
}

// ----- helpers to infer shop -----
function b64urlToBuffer(s) {
  // normalize base64url → base64
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  // pad
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function parseJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const payloadJson = b64urlToBuffer(parts[1]).toString('utf8');
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

function shopFromDest(dest) {
  try {
    const u = new URL(dest);
    return u.host; // e.g. example.myshopify.com
  } catch {
    return null;
  }
}

function shopFromHostParam(hostParam) {
  try {
    const decoded = Buffer.from(String(hostParam), 'base64').toString('utf8'); // "<shop>.myshopify.com/admin"
    const u = new URL(`https://${decoded}`);
    return u.host;
  } catch {
    return null;
  }
}

function safeLog(...args) {
  if (String(process.env.DEBUG_SHOP_INFER).toLowerCase() === 'true') {
    console.warn('[withSubscription][inferShop]', ...args);
  }
}

function inferShop(req, res) {
  // 1) Shopify embedded session (preferred)
  const sessShop = res?.locals?.shopify?.session?.shop;
  if (sessShop) return String(sessShop).trim();

  // 2) Common headers
  const h =
    req.get('x-shopify-shop-domain') ||
    req.get('x-shopify-shop') ||
    req.get('shop') ||
    '';
  if (h) return String(h).trim();

  // 3) Authorization: Bearer <session token> (App Bridge v4)
  const auth = req.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const payload = parseJwtPayload(auth.slice(7));
    const dest = payload?.dest || payload?.iss; // dest is typical
    const host = dest ? shopFromDest(dest) : null;
    if (host) return host;
  }

  // 4) X-Shopify-Session-Token header (some setups)
  const sessHeader = req.get('x-shopify-session-token') || '';
  if (sessHeader) {
    const payload = parseJwtPayload(sessHeader);
    const host = payload?.dest ? shopFromDest(payload.dest) : null;
    if (host) return host;
  }

  // 5) app bridge host param (?host=base64("<shop>.myshopify.com/admin"))
  if (req.query?.host) {
    const host = shopFromHostParam(req.query.host);
    if (host) return host;
  }

  // 6) body/query fallback (legacy)
  if (req.query?.shop) return String(req.query.shop).trim();
  if (req.body?.shop) return String(req.body.shop).trim();

  // 7) last resort: try Referer = https://admin.shopify.com/store/<alias>/apps/...
  const ref = req.get('referer');
  if (ref && ref.includes('admin.shopify.com')) {
    // cannot reliably convert alias → *.myshopify.com, so only log
    safeLog('referer admin present but alias is not convertible', { referer: ref });
  }

  return '';
}

// ----- main middleware -----
export async function withSubscription(req, res, next) {
  try {
    const shop = inferShop(req, res);

    if (!shop) {
      safeLog('missing shop after inference', {
        qShop: req.query?.shop ? true : false,
        bShop: req.body?.shop ? true : false,
        xShopDomain: !!req.get('x-shopify-shop-domain'),
        auth: !!req.get('authorization'),
        xSessTok: !!req.get('x-shopify-session-token'),
        hostParam: !!req.query?.host,
        hasSession: !!res?.locals?.shopify?.session,
        referer: req.get('referer') || null,
      });
      return res.status(400).json({ error: 'Missing ?shop' });
    }

    const Subscription = await loadSubscriptionModel();
    const sub = await Subscription.findOne({ shop }).lean();
    if (!sub) return res.status(401).json({ error: 'Subscription not found for shop', shop });

    const planKey = resolvePlanKey(sub.plan);
    const planCfg = getPlanConfig(planKey);

    const now = new Date();
    const trialEndsAt = sub.trialEndsAt
      ? new Date(sub.trialEndsAt)
      : new Date(now.getTime() + TRIAL_DAYS * 864e5);
    const inTrial = trialEndsAt > now;

    req.shop = shop;
    req.subscription = {
      ...sub,
      planKey,
      planCfg,
      inTrial,
      trialEndsAt,
      queryCount: sub.queryCount || 0,
    };

    return next();
  } catch (e) {
    console.error('withSubscription error', e);
    return res.status(500).json({ error: 'Subscription load failed', details: e.message });
  }
}

export function enforceQuota() {
  return async function (req, res, next) {
    const sub = req.subscription;
    if (!sub?.planCfg) return res.status(403).json({ error: 'Plan not configured' });

    const { queryCount = 0 } = sub;
    const { queryLimit } = sub.planCfg;

    if (typeof queryLimit === 'number' && queryCount >= queryLimit && !sub.inTrial) {
      return res.status(403).json({ error: 'AI query limit reached for your plan' });
    }

    // Validate model vendor vs plan
    const model = req.body?.model || '';
    const vendor = vendorFromModel(model);
    if (model && vendor && !sub.planCfg.providersAllowed.includes(vendor)) {
      return res
        .status(403)
        .json({ error: `Model vendor '${vendor}' not allowed for your plan` });
    }

    return next();
  };
}

export async function consumeQuery(shop, inc = 1) {
  try {
    const Subscription = await loadSubscriptionModel();
    await Subscription.updateOne({ shop }, { $inc: { queryCount: inc } }).exec();
  } catch (e) {
    console.warn('consumeQuery failed (non-fatal):', e.message);
  }
}

export function buildPlanView(sub) {
  const cfg = sub?.planCfg;
  const models = cfg ? allowedModelsForPlan(cfg.key) : [];
  return {
    shop: sub?.shop,
    plan: cfg?.name || sub?.plan,
    planKey: cfg?.key,
    queryLimit: cfg?.queryLimit ?? null,
    productLimit: cfg?.productLimit ?? null,
    queryCount: sub?.queryCount || 0,
    providersAllowed: cfg?.providersAllowed || [],
    modelsSuggested: models,
    inTrial: !!sub?.inTrial,
    trialEndsAt: sub?.trialEndsAt,
  };
}
