// backend/controllers/aiAnalyticsController.js
// API endpoints for AI traffic analytics

import express from 'express';
import AIVisitLog from '../db/AIVisitLog.js';

const router = express.Router();

/**
 * GET /api/ai-analytics?shop=xxx&period=7d|30d|90d
 * Returns aggregated AI traffic data for the dashboard
 */
router.get('/ai-analytics', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    const period = req.query.period || '30d';
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const shopDomain = shop.replace(/^https?:\/\//, '').toLowerCase();

    // Run all aggregations in parallel
    const [totalVisits, dailyVisits, topBots, topEndpoints, recentVisits] = await Promise.all([
      // 1. Total visits count
      AIVisitLog.countDocuments({
        shop: shopDomain,
        createdAt: { $gte: since }
      }),

      // 2. Visits per day (for chart)
      AIVisitLog.aggregate([
        {
          $match: {
            shop: shopDomain,
            createdAt: { $gte: since }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
            },
            count: { $sum: 1 },
            uniqueIPs: { $addToSet: '$ipHash' }
          }
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            date: '$_id',
            visits: '$count',
            uniqueVisitors: { $size: '$uniqueIPs' }
          }
        }
      ]),

      // 3. Top bots
      AIVisitLog.aggregate([
        {
          $match: {
            shop: shopDomain,
            createdAt: { $gte: since }
          }
        },
        {
          $group: {
            _id: '$botName',
            visits: { $sum: 1 },
            lastSeen: { $max: '$createdAt' }
          }
        },
        { $sort: { visits: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            name: '$_id',
            visits: 1,
            lastSeen: 1
          }
        }
      ]),

      // 4. Top endpoints
      AIVisitLog.aggregate([
        {
          $match: {
            shop: shopDomain,
            createdAt: { $gte: since }
          }
        },
        {
          $group: {
            _id: '$endpoint',
            visits: { $sum: 1 }
          }
        },
        { $sort: { visits: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            endpoint: '$_id',
            visits: 1
          }
        }
      ]),

      // 5. Recent visits (last 20)
      AIVisitLog.find({
        shop: shopDomain,
        createdAt: { $gte: since }
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .select('endpoint botName source statusCode responseTimeMs createdAt')
        .lean()
    ]);

    // Calculate unique bots
    const uniqueBotsCount = topBots.length;

    // Calculate trend (compare with previous period)
    const previousSince = new Date(since);
    previousSince.setDate(previousSince.getDate() - days);
    
    const previousVisits = await AIVisitLog.countDocuments({
      shop: shopDomain,
      createdAt: { $gte: previousSince, $lt: since }
    });

    const trend = previousVisits > 0
      ? Math.round(((totalVisits - previousVisits) / previousVisits) * 100)
      : totalVisits > 0 ? 100 : 0;

    res.json({
      period,
      days,
      totalVisits,
      uniqueBots: uniqueBotsCount,
      trend, // % change vs previous period
      dailyVisits,
      topBots,
      topEndpoints,
      recentVisits
    });

  } catch (error) {
    console.error('[AI-ANALYTICS] Error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * GET /api/ai-analytics/debug?shop=xxx
 * Debug endpoint - shows raw recent logs to verify middleware is working
 */
router.get('/ai-analytics/debug', async (req, res) => {
  try {
    const shop = req.query.shop;
    
    // Count total records
    const totalAll = await AIVisitLog.countDocuments({});
    const totalForShop = shop 
      ? await AIVisitLog.countDocuments({ shop: shop.replace(/^https?:\/\//, '').toLowerCase() })
      : 0;
    
    // Get last 10 records (any shop)
    const recentAll = await AIVisitLog.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Get distinct shop values
    const shops = await AIVisitLog.distinct('shop');

    res.json({
      debug: true,
      queriedShop: shop,
      normalizedShop: shop ? shop.replace(/^https?:\/\//, '').toLowerCase() : null,
      totalRecordsAll: totalAll,
      totalRecordsForShop: totalForShop,
      distinctShops: shops,
      recentAll: recentAll.map(r => ({
        shop: r.shop,
        endpoint: r.endpoint,
        botName: r.botName,
        statusCode: r.statusCode,
        source: r.source,
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
