// backend/controllers/seoController.js
import express from 'express';
import Product from '../db/models/Product.js';
import { generateSEO } from '../utils/seoGenerator.js';
import Shop from '../db/models/Shop.js';
import Subscription from '../db/models/Subscription.js';
import { isTrialActive, providerAllowed, hasQuota } from '../billing.js';

const router = express.Router();

/**
 * Generate and save SEO metadata for a single product.
 * Endpoint: POST /seo/product/:productId?shop={shop}
 * Body: { provider: 'openai' | 'claude' | 'gemini' | 'deepseek' | 'llama' }
 */
router.post('/product/:productId', async (req, res) => {
  const { productId } = req.params;
  const { provider } = req.body;
  const shopDomain =
    req.query.shop || req.headers['x-shopify-shop-domain'];

  if (!provider) {
    return res.status(400).json({ error: 'Provider is required' });
  }

  try {
    // Ensure shop is registered and has valid token
    const shop = await Shop.findOne({ shop: shopDomain });
    if (!shop) return res.status(404).json({ error: 'Shop not authenticated' });

    // Subscription
    const subscription = await Subscription.findOne({ shop: shopDomain });
    if (!subscription)
      return res.status(403).json({ error: 'Subscription not found' });

    // Provider allowed?
    if (!providerAllowed(subscription, provider)) {
      return res.status(403).json({
        error: `Provider '${provider}' is not available in your plan '${subscription.plan}'.`,
      });
    }

    // Quota check (allow if in-trial OR has remaining quota)
    const inTrial = isTrialActive(subscription);
    if (!inTrial && !hasQuota(subscription)) {
      return res.status(402).json({
        error: 'Query limit reached for your plan.',
        plan: subscription.plan,
        queryCount: subscription.queryCount,
        queryLimit: subscription.queryLimit,
      });
    }

    // Fetch product from DB
    const product = await Product.findOne({
      shop: shopDomain,
      productId: Number(productId),
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // Generate SEO metadata
    const seoData = await generateSEO(
      {
        title: product.title,
        description: product.description,
        tags: product.tags,
      },
      provider
    );

    // Save to product.aiOptimized
    product.aiOptimized = {
      ...seoData,
      updatedAt: new Date()
    };
    product.markModified('aiOptimized');
    product.syncedAt = new Date();
    await product.save();

    // Increment usage counter if not trial (or count both—твоя политика)
    subscription.queryCount = (subscription.queryCount || 0) + 1;
    await subscription.save();

    res.json({ status: 'ok', seoData, usage: {
      plan: subscription.plan,
      queryCount: subscription.queryCount,
      queryLimit: subscription.queryLimit,
      inTrial
    }});
  } catch (error) {
    console.error('SEO generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
