import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import ConversionEvent from '../db/ConversionEvent.js';

const router = Router();

const pixelLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.body?.shop || req.ip,
  standardHeaders: false,
  legacyHeaders: false,
});

router.post('/pixel/events', pixelLimiter, async (req, res) => {
  try {
    const {
      shop, eventType, aiSource, sessionId,
      productId, productHandle, productTitle, variantId,
      quantity, price, currency, totalPrice, orderId,
      referrerUrl, lineItems, timestamp
    } = req.body || {};

    if (!shop || !eventType || !aiSource) {
      return res.status(400).json({ error: 'Missing required fields: shop, eventType, aiSource' });
    }

    const allowed = ['page_viewed', 'add_to_cart', 'checkout_completed'];
    if (!allowed.includes(eventType)) {
      return res.status(400).json({ error: `Invalid eventType. Allowed: ${allowed.join(', ')}` });
    }

    const normalizedShop = shop.replace(/^https?:\/\//, '').toLowerCase();

    if (eventType === 'checkout_completed' && lineItems?.length) {
      const docs = lineItems.slice(0, 20).map(li => ({
        shop: normalizedShop,
        eventType: 'checkout_completed',
        productId: li.productId || '',
        productTitle: li.title || '',
        quantity: li.quantity || 1,
        price: li.price || '0',
        currency: currency || 'USD',
        totalPrice: totalPrice || '0',
        orderId: orderId || '',
        aiSource,
        sessionId: sessionId || '',
        createdAt: timestamp ? new Date(timestamp) : new Date()
      }));
      await ConversionEvent.insertMany(docs, { ordered: false }).catch(() => {});
    } else {
      await ConversionEvent.create({
        shop: normalizedShop,
        eventType,
        productId: productId || '',
        productHandle: productHandle || '',
        productTitle: productTitle || '',
        variantId: variantId || '',
        quantity: quantity || 1,
        price: price || '0',
        currency: currency || 'USD',
        totalPrice: totalPrice || '0',
        orderId: orderId || '',
        aiSource,
        referrerUrl: referrerUrl || '',
        sessionId: sessionId || '',
        createdAt: timestamp ? new Date(timestamp) : new Date()
      });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[PIXEL] Event error:', err.message);
    res.status(200).json({ ok: true });
  }
});

export default router;
