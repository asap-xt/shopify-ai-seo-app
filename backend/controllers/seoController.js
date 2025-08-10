// backend/controllers/seoController.js
import express from 'express';
import Product from '../db/models/Product.js';
import Subscription from '../db/models/Subscription.js';
import { generateSEO } from '../utils/seoGenerator.js';

const router = express.Router();

function buildProviderOrder(requested, allowed) {
  const list = [];
  if (requested) list.push(requested);
  list.push(...allowed.filter((p) => p !== requested));
  list.push('mock');                         // последен шанс – локален генератор
  return Array.from(new Set(list));          // dedupe
}

router.post('/product/:productId', async (req, res) => {
  const shop = String(req.query.shop || '').trim();
  const requestedProvider = String(req.body?.provider || '').toLowerCase();
  const productId = Number(req.params.productId);

  try {
    // 1) Проверка за абонамент и лимити
    const sub = await Subscription.findOne({ shop });
    if (!sub) return res.status(401).json({ error: 'Shop not authenticated or subscription not found' });

    if (typeof sub.queryLimit === 'number' && (sub.queryCount || 0) >= sub.queryLimit) {
      return res.status(403).json({ error: 'Query limit reached for your plan.' });
    }

    const allowed = Array.isArray(sub.aiProviders) ? sub.aiProviders.map(p => String(p).toLowerCase()) : [];
    if (requestedProvider && requestedProvider !== 'mock' && !allowed.includes(requestedProvider)) {
      return res.status(403).json({ error: `Provider '${requestedProvider}' is not available in your plan '${sub.plan}'.` });
    }

    // 2) Продукт
    const product = await Product.findOne({ shop, productId });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // 3) Опит с падаща последователност: избрания → другите позволени → mock
    const order = buildProviderOrder(requestedProvider || allowed[0], allowed);

    let seoData = null;
    let providerUsed = null;
    let lastErr = null;

    for (const p of order) {
      try {
        const out = await generateSEO(product, p);
        seoData = out;
        providerUsed = p;
        break; // успех — спираме
      } catch (e) {
        lastErr = e;
        console.warn(`[SEO Fallback] Provider "${p}" failed: ${e?.message || e}`);
      }
    }

    if (!seoData) {
      return res.status(502).json({ error: 'All providers failed', detail: lastErr?.message || 'Unknown error' });
    }

    // 4) Запис в базата + дати
    product.aiOptimized = { ...seoData, provider: providerUsed, updatedAt: new Date() };
    product.markModified('aiOptimized');
    product.syncedAt = new Date();
    await product.save();

    // 5) Брояч
    sub.queryCount = (sub.queryCount || 0) + 1;
    await sub.save();

    return res.status(200).json({
      status: 'ok',
      providerUsed,
      seoData,
      usage: {
        plan: sub.plan,
        queryCount: sub.queryCount,
        queryLimit: sub.queryLimit,
        inTrial: Boolean(sub.trialEndsAt && new Date(sub.trialEndsAt) > new Date()),
      },
    });
  } catch (err) {
    console.error('SEO controller error:', err);
    return res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
  }
});

export default router;
