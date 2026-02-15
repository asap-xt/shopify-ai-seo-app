// backend/controllers/aiAnalyticsController.js
// API endpoints for AI traffic analytics

import express from 'express';
import AIVisitLog from '../db/AIVisitLog.js';
import Shop from '../db/Shop.js';

const router = express.Router();

/**
 * Resolve shop domain to myshopify.com format
 * Dashboard may send custom domain (plamenna.boutique) or myshopify domain
 * AIVisitLog always stores the myshopify.com domain
 */
async function resolveShopDomain(shopParam) {
  const normalized = shopParam.replace(/^https?:\/\//, '').toLowerCase().replace(/\/+$/, '');
  
  // If already myshopify.com format, return as-is
  if (normalized.endsWith('.myshopify.com')) {
    return normalized;
  }
  
  // Try to find shop in DB by the domain (could be custom domain or partial)
  const shopDoc = await Shop.findOne({
    $or: [
      { shop: normalized },
      { shop: normalized + '.myshopify.com' },
      { primaryDomain: normalized },
      { customDomain: normalized }
    ]
  }).lean();
  
  if (shopDoc?.shop) {
    return shopDoc.shop;
  }
  
  // Fallback: search AIVisitLog for any matching pattern
  const visitLog = await AIVisitLog.findOne({
    shop: { $regex: normalized.split('.')[0], $options: 'i' }
  }).lean();
  
  if (visitLog?.shop) {
    return visitLog.shop;
  }
  
  // Last resort: return as-is with .myshopify.com appended
  return normalized.endsWith('.myshopify.com') ? normalized : normalized;
}

/**
 * Calculate date range for a given period
 * Supports: 'today', 'yesterday', '7d', '30d', '90d'
 */
function getPeriodRange(period) {
  const now = new Date();
  let since, until, days;

  switch (period) {
    case 'today': {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // midnight today
      until = now;
      days = 1;
      break;
    }
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      since = new Date(y.getFullYear(), y.getMonth(), y.getDate()); // midnight yesterday
      until = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // midnight today
      days = 1;
      break;
    }
    case '7d': {
      since = new Date(now);
      since.setDate(since.getDate() - 7);
      until = now;
      days = 7;
      break;
    }
    case '90d': {
      since = new Date(now);
      since.setDate(since.getDate() - 90);
      until = now;
      days = 90;
      break;
    }
    default: { // '30d'
      since = new Date(now);
      since.setDate(since.getDate() - 30);
      until = now;
      days = 30;
      break;
    }
  }

  return { since, until, days };
}

/**
 * Get the previous period range for comparison
 * E.g. if current = last 7 days, previous = the 7 days before that
 */
function getPreviousPeriodRange(period, currentSince) {
  const duration = currentSince.getTime() - getPeriodRange(period).since.getTime();
  // Use the same duration going back from the current since
  const ms = getPeriodRange(period).until.getTime() - getPeriodRange(period).since.getTime();
  const prevUntil = new Date(getPeriodRange(period).since);
  const prevSince = new Date(prevUntil.getTime() - ms);
  return { since: prevSince, until: prevUntil };
}

/**
 * GET /api/ai-analytics?shop=xxx&period=today|yesterday|7d|30d&compare=true
 * Returns aggregated AI traffic data for the dashboard
 */
router.get('/ai-analytics', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    const period = req.query.period || '30d';
    const compare = req.query.compare === 'true';
    const { since, until, days } = getPeriodRange(period);

    const shopDomain = await resolveShopDomain(shop);

    // Exclude direct browser visits and our own internal test requests from all metrics
    const botExclude = { $nin: ['Human/Unknown', 'indexAIze Test'] };
    const botFilter = { shop: shopDomain, createdAt: { $gte: since, $lte: until }, botName: botExclude };

    // Run all aggregations in parallel
    const [totalVisits, dailyVisits, topBots, topEndpoints, recentVisits] = await Promise.all([
      // 1. Total visits count (bots only)
      AIVisitLog.countDocuments(botFilter),

      // 2. Visits per day (for chart, bots only)
      AIVisitLog.aggregate([
        { $match: botFilter },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
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
        { $match: botFilter },
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
          $project: { _id: 0, name: '$_id', visits: 1, lastSeen: 1 }
        }
      ]),

      // 4. Top endpoints (bots only)
      AIVisitLog.aggregate([
        { $match: botFilter },
        {
          $group: { _id: '$endpoint', visits: { $sum: 1 } }
        },
        { $sort: { visits: -1 } },
        { $limit: 10 },
        {
          $project: { _id: 0, endpoint: '$_id', visits: 1 }
        }
      ]),

      // 5. Recent visits (bots only, last 20)
      AIVisitLog.find(botFilter)
        .sort({ createdAt: -1 })
        .limit(20)
        .select('endpoint botName source statusCode responseTimeMs createdAt')
        .lean()
    ]);

    // Calculate unique bots
    const uniqueBotsCount = topBots.length;

    // Previous period for trend + comparison
    const prevRange = (() => {
      const ms = until.getTime() - since.getTime();
      const prevUntil = new Date(since);
      const prevSince = new Date(prevUntil.getTime() - ms);
      return { since: prevSince, until: prevUntil };
    })();

    const previousVisits = await AIVisitLog.countDocuments({
      shop: shopDomain,
      createdAt: { $gte: prevRange.since, $lt: prevRange.until },
      botName: botExclude
    });

    const trend = previousVisits > 0
      ? Math.round(((totalVisits - previousVisits) / previousVisits) * 100)
      : totalVisits > 0 ? 100 : 0;

    // Build response
    const response = {
      period,
      days,
      totalVisits,
      uniqueBots: uniqueBotsCount,
      trend,
      previousVisits,
      dailyVisits,
      topBots,
      topEndpoints,
      recentVisits
    };

    // If comparison requested, add previous period daily data
    if (compare) {
      const prevFilter = {
        shop: shopDomain,
        createdAt: { $gte: prevRange.since, $lt: prevRange.until },
        botName: botExclude
      };

      const [prevDaily, prevBots, prevEndpoints] = await Promise.all([
        AIVisitLog.aggregate([
          { $match: prevFilter },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, date: '$_id', visits: '$count' } }
        ]),

        AIVisitLog.aggregate([
          { $match: prevFilter },
          { $group: { _id: '$botName', visits: { $sum: 1 } } },
          { $sort: { visits: -1 } },
          { $limit: 10 },
          { $project: { _id: 0, name: '$_id', visits: 1 } }
        ]),

        AIVisitLog.aggregate([
          { $match: prevFilter },
          { $group: { _id: '$endpoint', visits: { $sum: 1 } } },
          { $sort: { visits: -1 } },
          { $limit: 10 },
          { $project: { _id: 0, endpoint: '$_id', visits: 1 } }
        ])
      ]);

      response.comparison = {
        totalVisits: previousVisits,
        uniqueBots: prevBots.length,
        dailyVisits: prevDaily,
        topBots: prevBots,
        topEndpoints: prevEndpoints
      };
    }

    res.json(response);

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
