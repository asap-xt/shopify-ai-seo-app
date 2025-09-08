// backend/controllers/feedController.js
// Serves AI-ready catalog feed from Mongo cache.
// Secured with ?shop=...&token=... (FEED_TOKEN). If cache is missing, attempts on-demand build.

import express from 'express';
import crypto from 'crypto';
import { FeedCache, syncProductsForShop } from './productSync.js';
import AdvancedSchema from '../db/AdvancedSchema.js';
import Subscription from '../db/Subscription.js';

console.log('[FEED] AdvancedSchema model loaded:', !!AdvancedSchema); // DEBUG

const router = express.Router();

// Helper function to fetch plan
async function fetchPlan(shop) {
  try {
    const subscription = await Subscription.findOne({ shop });
    return {
      plan: subscription?.plan || 'starter',
      planKey: subscription?.plan?.toLowerCase().replace(' ', '_') || 'starter'
    };
  } catch (error) {
    console.error('Error fetching plan:', error);
    return { plan: 'starter', planKey: 'starter' };
  }
}

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

// GET /ai/schema-data.json?shop=...
router.get('/ai/schema-data.json', async (req, res) => {
  console.log('[SCHEMA-ENDPOINT] ============ REQUEST RECEIVED ============');
  console.log('[SCHEMA-ENDPOINT] URL:', req.url);
  console.log('[SCHEMA-ENDPOINT] Query:', req.query);
  
  try {
    const shop = req.query.shop;
    if (!shop) {
      console.log('[SCHEMA-ENDPOINT] No shop parameter');
      return res.status(400).json({ error: 'Shop required' });
    }
    
    console.log('[SCHEMA-ENDPOINT] Checking plan for shop:', shop);
    const plan = await fetchPlan(shop);
    console.log('[SCHEMA-ENDPOINT] Plan result:', plan);
    
    if (plan.planKey !== 'enterprise') {
      console.log('[SCHEMA-ENDPOINT] Not enterprise plan');
      return res.status(403).json({ error: 'Enterprise plan required' });
    }
    
    console.log('[SCHEMA-ENDPOINT] Looking for AdvancedSchema document...');
    const schemaData = await AdvancedSchema.findOne({ shop });
    console.log('[SCHEMA-ENDPOINT] Found document:', !!schemaData);
    console.log('[SCHEMA-ENDPOINT] Document ID:', schemaData?._id);
    console.log('[SCHEMA-ENDPOINT] Schemas count:', schemaData?.schemas?.length);
    
    if (!schemaData || !schemaData.schemas?.length) {
      console.log('[SCHEMA-ENDPOINT] Returning empty response');
      return res.json({
        shop,
        generated_at: new Date(),
        schemas: [],
        warning: "No advanced schema data found",
        action_required: {
          message: "Please generate schema data first",
          link: `/ai-seo?shop=${shop}#schema-data`,
          link_text: "Go to Schema Data"
        }
      });
    }
    
    console.log('[SCHEMA-ENDPOINT] Returning', schemaData.schemas.length, 'schemas');
    res.json({
      shop,
      generated_at: schemaData.generatedAt,
      total_schemas: schemaData.schemas.length,
      schemas: schemaData.schemas,
      site_faq: schemaData.siteFAQ
    });
    
  } catch (error) {
    console.error('[SCHEMA-ENDPOINT] ERROR:', error);
    res.status(500).json({ error: 'Failed to fetch schema data' });
  }
});

// GET /schema-data.json?shop=...
router.get('/schema-data.json', async (req, res) => {
  console.log('[SCHEMA-ENDPOINT] ============ REQUEST RECEIVED ============');
  console.log('[SCHEMA-ENDPOINT] URL:', req.url);
  console.log('[SCHEMA-ENDPOINT] Query:', req.query);
  
  try {
    const shop = req.query.shop;
    if (!shop) {
      console.log('[SCHEMA-ENDPOINT] No shop parameter');
      return res.status(400).json({ error: 'Shop required' });
    }
    
    console.log('[SCHEMA-ENDPOINT] Checking plan for shop:', shop);
    const plan = await fetchPlan(shop);
    console.log('[SCHEMA-ENDPOINT] Plan result:', plan);
    
    if (plan.planKey !== 'enterprise') {
      console.log('[SCHEMA-ENDPOINT] Not enterprise plan');
      return res.status(403).json({ error: 'Enterprise plan required' });
    }
    
    console.log('[SCHEMA-ENDPOINT] Looking for AdvancedSchema document...');
    const schemaData = await AdvancedSchema.findOne({ shop });
    console.log('[SCHEMA-ENDPOINT] Found document:', !!schemaData);
    console.log('[SCHEMA-ENDPOINT] Document ID:', schemaData?._id);
    console.log('[SCHEMA-ENDPOINT] Schemas count:', schemaData?.schemas?.length);
    
    if (!schemaData || !schemaData.schemas?.length) {
      console.log('[SCHEMA-ENDPOINT] Returning empty response');
      return res.json({
        shop,
        generated_at: new Date(),
        schemas: [],
        warning: "No advanced schema data found",
        action_required: {
          message: "Please generate schema data first",
          link: `/ai-seo?shop=${shop}#schema-data`,
          link_text: "Go to Schema Data"
        }
      });
    }
    
    console.log('[SCHEMA-ENDPOINT] Returning', schemaData.schemas.length, 'schemas');
    res.json({
      shop,
      generated_at: schemaData.generatedAt,
      total_schemas: schemaData.schemas.length,
      schemas: schemaData.schemas,
      site_faq: schemaData.siteFAQ
    });
    
  } catch (error) {
    console.error('[SCHEMA-ENDPOINT] ERROR:', error);
    res.status(500).json({ error: 'Failed to fetch schema data' });
  }
});

export default router;
