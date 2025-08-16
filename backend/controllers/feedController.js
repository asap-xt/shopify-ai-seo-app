// backend/controllers/feedController.js
// Serves AI-ready catalog feed from Mongo cache.
// Secured with ?shop=...&token=... (FEED_TOKEN). If cache is missing, attempts on-demand build.

import express from 'express';
import crypto from 'crypto';
import { FeedCache, syncProductsForShop } from './productSync.js';

const router = express.Router();

function assertAccess(req) {
  const token = req.query.token || req.headers['x-feed-token'];
  const expected = process.env.FEED_TOKEN || '';
  if (!expected) {
    const err = new Error('Feed is disabled (FEED_TOKEN not set)');
    err.status = 401;
    throw err;
  }
  if (token !== expected) {
    const err = new Error('Unauthorized feed access');
    err.status = 401;
    throw err;
  }
}

function etagFor(data, updatedAt) {
  const h = crypto.createHash('md5')
    .update(String(updatedAt || ''))
    .update('|')
    .update(String(data || ''))
    .digest('hex');
  return `"fc-${h}"`;
}

// GET /ai/feed/catalog.ndjson?shop=...&token=...
router.get('/ai/feed/catalog.ndjson', async (req, res) => {
  try {
    assertAccess(req);
    const shop = String(req.query.shop || '').trim();
    if (!shop) return res.status(400).json({ error: 'Missing ?shop' });

    let cache = await FeedCache.findOne({ shop }).lean();
    if (!cache || !cache.data) {
      try {
        await syncProductsForShop(shop);
        cache = await FeedCache.findOne({ shop }).lean();
      } catch (e) {
        return res.status(503).json({ error: 'Feed not ready', details: e.message });
      }
    }

    const etag = etagFor(cache.data, cache.updatedAt);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.setHeader('ETag', etag);
    res.status(200).send(cache.data);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message });
  }
});

// GET /ai/feed/catalog.json?shop=...&token=...
router.get('/ai/feed/catalog.json', async (req, res) => {
  try {
    assertAccess(req);
    const shop = String(req.query.shop || '').trim();
    if (!shop) return res.status(400).json({ error: 'Missing ?shop' });

    let cache = await FeedCache.findOne({ shop }).lean();
    if (!cache || !cache.data) {
      try {
        await syncProductsForShop(shop);
        cache = await FeedCache.findOne({ shop }).lean();
      } catch (e) {
        return res.status(503).json({ error: 'Feed not ready', details: e.message });
      }
    }

    const etag = etagFor(cache.data, cache.updatedAt);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();

    const items = String(cache.data || '')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.setHeader('ETag', etag);
    res.status(200).json({ shop, count: items.length, items });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message });
  }
});

export default router;
