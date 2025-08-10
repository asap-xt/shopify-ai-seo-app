// backend/billing.js
import express from 'express';
import Subscription from './db/models/Subscription.js';
import Shop from './db/models/Shop.js';

// ---- Plan Config (free trial: 5 days) ----
const TRIAL_DAYS = 5;
const PLANS = {
  starter: {
    price: 10,
    queryLimit: 50,
    productLimit: 150,
    aiProviders: ['mock', 'deepseek', 'llama'],
    label: 'Starter',
  },
  professional: {
    price: 39,
    queryLimit: 600,
    productLimit: 300,
    aiProviders: ['mock', 'openai', 'llama', 'deepseek'], // choose any 2 in UI; we allow all 3 here, UI can restrict
    label: 'Professional',
  },
  growth: {
    price: 59,
    queryLimit: 1500,
    productLimit: 1000,
    aiProviders: ['mock', 'claude', 'openai', 'gemini', 'llama', 'deepseek'], // choose any 3 in UI
    label: 'Growth',
  },
  'growth-extra': {
    price: 119,
    queryLimit: 4000,
    productLimit: 2000,
    aiProviders: ['mock', 'claude', 'openai', 'gemini', 'llama', 'deepseek'], // choose any 4 in UI
    label: 'Growth Extra',
  },
  enterprise: {
    price: 299,
    queryLimit: 10000,
    productLimit: 10000,
    aiProviders: ['mock', 'claude', 'openai', 'gemini', 'deepseek', 'llama'],
    label: 'Enterprise',
  },
};

function addDays(d, days) {
  const nd = new Date(d);
  nd.setUTCDate(nd.getUTCDate() + days);
  return nd;
}

const router = express.Router();

/**
 * Helper: resolve shop from query/header
 */
function getShopFromReq(req) {
  return (
    req.query.shop ||
    req.headers['x-shopify-shop-domain'] ||
    req.headers['x-shopify-shop']
  );
}

/**
 * Subscribe (or switch plan) – App Store billing ще дойде по-късно.
 * Сега записваме абонамента в MongoDB с 5-дневен trial.
 * POST /billing/subscribe?shop={shop}
 * Body: { plan: 'starter' | 'professional' | 'growth' | 'growth-extra' | 'enterprise' }
 */
router.post('/subscribe', async (req, res) => {
  try {
    const shop = getShopFromReq(req);
    const { plan } = req.body;

    if (!shop) return res.status(400).json({ error: 'Missing shop' });
    if (!plan || !PLANS[plan])
      return res.status(400).json({ error: 'Invalid plan' });

    // ensure shop exists (installed)
    const shopDoc = await Shop.findOne({ shop });
    if (!shopDoc) return res.status(404).json({ error: 'Shop not authenticated' });

    const now = new Date();
    const subsData = {
      shop,
      plan,
      startedAt: now,
      trialEndsAt: addDays(now, TRIAL_DAYS),
      // Sync limits to plan
      queryLimit: PLANS[plan].queryLimit,
      productLimit: PLANS[plan].productLimit,
      aiProviders: PLANS[plan].aiProviders,
      // preserve current queryCount if exists; otherwise 0
    };

    const existing = await Subscription.findOne({ shop });
    let doc;
    if (existing) {
      doc = await Subscription.findOneAndUpdate(
        { shop },
        {
          ...subsData,
          queryCount: existing.queryCount || 0,
          expiresAt: null, // not used yet
        },
        { new: true }
      );
    } else {
      doc = await Subscription.create({
        ...subsData,
        queryCount: 0,
      });
    }

    return res.json({
      status: 'ok',
      subscription: doc,
      trialDays: TRIAL_DAYS,
    });
  } catch (err) {
    console.error('Billing subscribe error:', err);
    return res.status(500).json({ error: 'Subscribe failed' });
  }
});

/**
 * Get current plan
 * GET /billing/plan?shop={shop}
 */
router.get('/plan', async (req, res) => {
  try {
    const shop = getShopFromReq(req);
    if (!shop) return res.status(400).json({ error: 'Missing shop' });

    const sub = await Subscription.findOne({ shop });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    const now = new Date();
    const inTrial = sub.trialEndsAt && now < new Date(sub.trialEndsAt);

    return res.json({
      status: 'ok',
      plan: sub.plan,
      queryCount: sub.queryCount,
      queryLimit: sub.queryLimit,
      productLimit: sub.productLimit,
      aiProviders: sub.aiProviders,
      trialEndsAt: sub.trialEndsAt,
      inTrial,
    });
  } catch (err) {
    console.error('Billing plan fetch error:', err);
    return res.status(500).json({ error: 'Plan fetch failed' });
  }
});

/**
 * (Optional) reset counters – за тест/разработка
 * POST /billing/reset?shop={shop}
 */
router.post('/reset', async (req, res) => {
  try {
    const shop = getShopFromReq(req);
    if (!shop) return res.status(400).json({ error: 'Missing shop' });

    const sub = await Subscription.findOneAndUpdate(
      { shop },
      { queryCount: 0 },
      { new: true }
    );
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    return res.json({ status: 'ok', subscription: sub });
  } catch (err) {
    console.error('Billing reset error:', err);
    return res.status(500).json({ error: 'Reset failed' });
  }
});

export default router;

/**
 * Helpers for other modules (e.g., SEO controller)
 */
export function isTrialActive(sub) {
  if (!sub.trialEndsAt) return false;
  return new Date() < new Date(sub.trialEndsAt);
}

export function providerAllowed(sub, provider) {
  return Array.isArray(sub.aiProviders) && sub.aiProviders.includes(provider);
}

export function hasQuota(sub) {
  return typeof sub.queryCount === 'number' && sub.queryCount < sub.queryLimit;
}
