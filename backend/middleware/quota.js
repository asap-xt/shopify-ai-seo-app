// backend/middleware/quota.js
// Subscription loading + quota enforcement. Dynamic import of Subscription model.

import { getPlanConfig, resolvePlanKey, vendorFromModel, allowedModelsForPlan, TRIAL_DAYS } from '../plans.js';

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
      // try next
    }
  }
  throw new Error('Subscription model not found');
}

export async function withSubscription(req, res, next) {
  try {
    const shop = String(
      req.query.shop || req.body?.shop || req.headers['x-shopify-shop-domain'] || ''
    ).trim();
    if (!shop) return res.status(400).json({ error: 'Missing ?shop' });

    const Subscription = await loadSubscriptionModel();
    const sub = await Subscription.findOne({ shop }).lean();
    if (!sub) return res.status(401).json({ error: 'Subscription not found for shop' });

    const planKey = resolvePlanKey(sub.plan);
    const planCfg = getPlanConfig(planKey);

    const now = new Date();
    const trialEndsAt = sub.trialEndsAt ? new Date(sub.trialEndsAt) : new Date(now.getTime() + TRIAL_DAYS * 864e5);
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
      return res.status(403).json({ error: `Model vendor '${vendor}' not allowed for your plan` });
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

// Return data for the UI
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
