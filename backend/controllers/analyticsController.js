import { Router } from 'express';
import OrderRevenue from '../db/OrderRevenue.js';
import ConversionEvent from '../db/ConversionEvent.js';
import AIVisitLog from '../db/AIVisitLog.js';
import Product from '../db/Product.js';
import { syncOrdersForShop } from '../services/orderSyncService.js';
import { resolveAdminToken } from '../utils/tokenResolver.js';

const router = Router();

function getPeriodDates(period) {
  const now = new Date();
  let start;
  switch (period) {
    case 'today': {
      const TZ = 'Europe/Sofia';
      const dayStr = now.toLocaleDateString('en-CA', { timeZone: TZ });
      const localMidnight = new Date(dayStr + 'T00:00:00');
      const offset = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: TZ })).getTime();
      start = new Date(localMidnight.getTime() + offset);
      break;
    }
    case '7d':  start = new Date(now - 7 * 86400000); break;
    case '30d': start = new Date(now - 30 * 86400000); break;
    case '90d': start = new Date(now - 90 * 86400000); break;
    default:    start = new Date(now - 30 * 86400000);
  }
  return { start, end: now };
}

function getPreviousPeriod(period) {
  const { start, end } = getPeriodDates(period);
  const duration = end - start;
  return { start: new Date(start - duration), end: new Date(start) };
}

// GET /api/analytics/revenue — Revenue summary with attribution breakdown
router.get('/analytics/revenue', async (req, res) => {
  try {
    const shop = (req.query.shop || '').replace(/^https?:\/\//, '').toLowerCase();
    const period = req.query.period || '30d';
    const compare = req.query.compare === 'true';
    if (!shop) return res.status(400).json({ error: 'shop required' });

    const { start, end } = getPeriodDates(period);
    const filter = { shop, orderCreatedAt: { $gte: start, $lte: end } };

    const [allOrders, directOrders, influencedOrders] = await Promise.all([
      OrderRevenue.find(filter).lean(),
      OrderRevenue.find({ ...filter, attributionType: 'direct_ai' }).lean(),
      OrderRevenue.find({ ...filter, attributionType: 'ai_influenced' }).lean(),
    ]);

    const sum = (orders) => orders.reduce((s, o) => s + parseFloat(o.totalPrice || 0), 0);
    const currency = allOrders[0]?.currency || 'USD';

    const result = {
      period,
      currency,
      totalOrders: allOrders.length,
      totalRevenue: sum(allOrders).toFixed(2),
      directAI: {
        orders: directOrders.length,
        revenue: sum(directOrders).toFixed(2),
        sources: countSources(directOrders),
      },
      aiInfluenced: {
        orders: influencedOrders.length,
        revenue: sum(influencedOrders).toFixed(2),
      },
      organic: {
        orders: allOrders.length - directOrders.length - influencedOrders.length,
        revenue: (sum(allOrders) - sum(directOrders) - sum(influencedOrders)).toFixed(2),
      },
      avgOrderValue: allOrders.length ? (sum(allOrders) / allOrders.length).toFixed(2) : '0.00',
    };

    if (compare) {
      const prev = getPreviousPeriod(period);
      const prevFilter = { shop, orderCreatedAt: { $gte: prev.start, $lte: prev.end } };
      const [prevAll, prevDirect, prevInfluenced] = await Promise.all([
        OrderRevenue.countDocuments(prevFilter),
        OrderRevenue.countDocuments({ ...prevFilter, attributionType: 'direct_ai' }),
        OrderRevenue.countDocuments({ ...prevFilter, attributionType: 'ai_influenced' }),
      ]);
      result.comparison = {
        prevTotalOrders: prevAll,
        prevDirectOrders: prevDirect,
        prevInfluencedOrders: prevInfluenced,
        orderGrowth: prevAll ? (((allOrders.length - prevAll) / prevAll) * 100).toFixed(1) : null,
      };
    }

    res.json(result);
  } catch (err) {
    console.error('[ANALYTICS] revenue error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/add-to-cart — Add-to-cart events from AI sessions
router.get('/analytics/add-to-cart', async (req, res) => {
  try {
    const shop = (req.query.shop || '').replace(/^https?:\/\//, '').toLowerCase();
    const period = req.query.period || '30d';
    if (!shop) return res.status(400).json({ error: 'shop required' });

    const { start, end } = getPeriodDates(period);
    const filter = {
      shop,
      createdAt: { $gte: start, $lte: end },
      aiSource: { $ne: null }
    };

    const [addToCart, checkouts, pageViews] = await Promise.all([
      ConversionEvent.find({ ...filter, eventType: 'add_to_cart' }).lean(),
      ConversionEvent.find({ ...filter, eventType: 'checkout_completed' }).lean(),
      ConversionEvent.countDocuments({ ...filter, eventType: 'page_viewed' }),
    ]);

    const productCounts = {};
    for (const ev of addToCart) {
      const key = ev.productTitle || ev.productHandle || ev.productId || 'Unknown';
      productCounts[key] = (productCounts[key] || 0) + 1;
    }
    const topProducts = Object.entries(productCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const uniqueSessions = new Set(addToCart.map(e => e.sessionId).filter(Boolean));
    const checkoutSessions = new Set(checkouts.map(e => e.sessionId).filter(Boolean));

    res.json({
      period,
      aiPageViews: pageViews,
      totalAddToCart: addToCart.length,
      totalCheckouts: checkouts.length,
      addToCartSessions: uniqueSessions.size,
      checkoutSessions: checkoutSessions.size,
      conversionRate: uniqueSessions.size
        ? ((checkoutSessions.size / uniqueSessions.size) * 100).toFixed(1)
        : '0.0',
      topProducts,
      sources: countPixelSources(addToCart),
    });
  } catch (err) {
    console.error('[ANALYTICS] add-to-cart error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/products — Per-product AI performance
router.get('/analytics/products', async (req, res) => {
  try {
    const shop = (req.query.shop || '').replace(/^https?:\/\//, '').toLowerCase();
    const period = req.query.period || '30d';
    if (!shop) return res.status(400).json({ error: 'shop required' });

    const { start, end } = getPeriodDates(period);

    const [products, orders, addToCartEvents, aiVisits] = await Promise.all([
      Product.find({ shop, status: { $ne: 'DRAFT' } }).select('shopifyProductId title handle seoStatus aiOptimized status').lean(),
      OrderRevenue.find({ shop, orderCreatedAt: { $gte: start, $lte: end } }).lean(),
      ConversionEvent.find({
        shop, eventType: 'add_to_cart',
        createdAt: { $gte: start, $lte: end },
        aiSource: { $ne: null }
      }).lean(),
      AIVisitLog.aggregate([
        { $match: { shop, createdAt: { $gte: start, $lte: end }, botName: { $nin: ['Human/Unknown', 'Other Bot'] } } },
        { $group: { _id: '$endpoint', visits: { $sum: 1 } } }
      ]),
    ]);

    const visitsByEndpoint = {};
    for (const v of aiVisits) {
      visitsByEndpoint[v._id] = v.visits;
    }

    const ordersByHandle = {};
    const revenueByHandle = {};
    for (const order of orders) {
      for (const li of order.lineItems || []) {
        if (!li.handle) continue;
        ordersByHandle[li.handle] = (ordersByHandle[li.handle] || 0) + li.quantity;
        revenueByHandle[li.handle] = (revenueByHandle[li.handle] || 0) + parseFloat(li.price || 0) * (li.quantity || 1);
      }
    }

    const directOrdersByHandle = {};
    for (const order of orders.filter(o => o.attributionType === 'direct_ai')) {
      for (const li of order.lineItems || []) {
        if (!li.handle) continue;
        directOrdersByHandle[li.handle] = (directOrdersByHandle[li.handle] || 0) + li.quantity;
      }
    }

    const atcByHandle = {};
    for (const ev of addToCartEvents) {
      const h = ev.productHandle || '';
      if (h) atcByHandle[h] = (atcByHandle[h] || 0) + 1;
    }

    const productStats = products.map(p => {
      const handle = p.handle || '';
      const aiVisitCount = Object.entries(visitsByEndpoint)
        .filter(([ep]) => ep.includes(handle))
        .reduce((s, [, v]) => s + v, 0);

      return {
        productId: p.shopifyProductId,
        title: p.title,
        handle,
        aiVisits: aiVisitCount,
        totalOrders: ordersByHandle[handle] || 0,
        directAIOrders: directOrdersByHandle[handle] || 0,
        revenue: (revenueByHandle[handle] || 0).toFixed(2),
        addToCart: atcByHandle[handle] || 0,
        isOptimized: p.seoStatus?.optimized || false,
        isAIEnhanced: p.seoStatus?.aiEnhanced || false,
        hasAdvancedSchema: p.seoStatus?.hasAdvancedSchema || false,
      };
    });

    const filtered = productStats.filter(p => p.aiVisits > 0 || p.totalOrders > 0 || p.addToCart > 0);
    filtered.sort((a, b) => b.aiVisits - a.aiVisits);

    res.json({ period, products: filtered });
  } catch (err) {
    console.error('[ANALYTICS] products error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/comparison — Optimized vs non-optimized products
router.get('/analytics/comparison', async (req, res) => {
  try {
    const shop = (req.query.shop || '').replace(/^https?:\/\//, '').toLowerCase();
    const period = req.query.period || '30d';
    if (!shop) return res.status(400).json({ error: 'shop required' });

    const { start, end } = getPeriodDates(period);

    const [products, orders, aiVisits] = await Promise.all([
      Product.find({ shop, status: { $ne: 'DRAFT' } }).select('handle seoStatus').lean(),
      OrderRevenue.find({ shop, orderCreatedAt: { $gte: start, $lte: end } }).lean(),
      AIVisitLog.aggregate([
        { $match: { shop, createdAt: { $gte: start, $lte: end }, botName: { $nin: ['Human/Unknown', 'Other Bot'] } } },
        { $group: { _id: '$endpoint', visits: { $sum: 1 } } }
      ]),
    ]);

    const optimizedHandles = new Set(products.filter(p => p.seoStatus?.optimized).map(p => p.handle));
    const allHandles = new Set(products.map(p => p.handle));

    const visitsByEndpoint = {};
    for (const v of aiVisits) visitsByEndpoint[v._id] = v.visits;

    const groups = { optimized: { count: 0, totalVisits: 0, totalOrders: 0, totalRevenue: 0 },
                     unoptimized: { count: 0, totalVisits: 0, totalOrders: 0, totalRevenue: 0 } };

    for (const handle of allHandles) {
      const group = optimizedHandles.has(handle) ? 'optimized' : 'unoptimized';
      groups[group].count++;

      const visits = Object.entries(visitsByEndpoint)
        .filter(([ep]) => ep.includes(handle))
        .reduce((s, [, v]) => s + v, 0);
      groups[group].totalVisits += visits;
    }

    for (const order of orders) {
      for (const li of order.lineItems || []) {
        if (!li.handle) continue;
        const group = optimizedHandles.has(li.handle) ? 'optimized' : 'unoptimized';
        groups[group].totalOrders += li.quantity || 1;
        groups[group].totalRevenue += parseFloat(li.price || 0) * (li.quantity || 1);
      }
    }

    const avg = (total, count) => count ? (total / count).toFixed(2) : '0.00';

    res.json({
      period,
      optimized: {
        productCount: groups.optimized.count,
        avgAIVisits: avg(groups.optimized.totalVisits, groups.optimized.count),
        totalOrders: groups.optimized.totalOrders,
        totalRevenue: groups.optimized.totalRevenue.toFixed(2),
        avgRevenue: avg(groups.optimized.totalRevenue, groups.optimized.count),
      },
      unoptimized: {
        productCount: groups.unoptimized.count,
        avgAIVisits: avg(groups.unoptimized.totalVisits, groups.unoptimized.count),
        totalOrders: groups.unoptimized.totalOrders,
        totalRevenue: groups.unoptimized.totalRevenue.toFixed(2),
        avgRevenue: avg(groups.unoptimized.totalRevenue, groups.unoptimized.count),
      },
    });
  } catch (err) {
    console.error('[ANALYTICS] comparison error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/funnel — AI referral funnel
router.get('/analytics/funnel', async (req, res) => {
  try {
    const shop = (req.query.shop || '').replace(/^https?:\/\//, '').toLowerCase();
    const period = req.query.period || '30d';
    if (!shop) return res.status(400).json({ error: 'shop required' });

    const { start, end } = getPeriodDates(period);

    const [botVisits, pixelPageViews, pixelAddToCart, pixelCheckouts, directOrders] = await Promise.all([
      AIVisitLog.countDocuments({
        shop, createdAt: { $gte: start, $lte: end },
        botName: { $nin: ['Human/Unknown', 'Other Bot'] }
      }),
      ConversionEvent.countDocuments({
        shop, eventType: 'page_viewed', aiSource: { $ne: null },
        createdAt: { $gte: start, $lte: end }
      }),
      ConversionEvent.countDocuments({
        shop, eventType: 'add_to_cart', aiSource: { $ne: null },
        createdAt: { $gte: start, $lte: end }
      }),
      ConversionEvent.countDocuments({
        shop, eventType: 'checkout_completed', aiSource: { $ne: null },
        createdAt: { $gte: start, $lte: end }
      }),
      OrderRevenue.countDocuments({
        shop, attributionType: 'direct_ai',
        orderCreatedAt: { $gte: start, $lte: end }
      }),
    ]);

    const purchases = Math.max(pixelCheckouts, directOrders);

    res.json({
      period,
      funnel: [
        { stage: 'AI Bot Reads Products', count: botVisits },
        { stage: 'Customer Arrives from AI', count: pixelPageViews },
        { stage: 'Add to Cart', count: pixelAddToCart },
        { stage: 'Purchase', count: purchases },
      ],
      conversionRates: {
        botToVisit: botVisits ? ((pixelPageViews / botVisits) * 100).toFixed(2) : '0.00',
        visitToCart: pixelPageViews ? ((pixelAddToCart / pixelPageViews) * 100).toFixed(2) : '0.00',
        cartToPurchase: pixelAddToCart ? ((purchases / pixelAddToCart) * 100).toFixed(2) : '0.00',
        overallConversion: botVisits ? ((purchases / botVisits) * 100).toFixed(4) : '0.0000',
      }
    });
  } catch (err) {
    console.error('[ANALYTICS] funnel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/timeline — Daily revenue breakdown
router.get('/analytics/timeline', async (req, res) => {
  try {
    const shop = (req.query.shop || '').replace(/^https?:\/\//, '').toLowerCase();
    const period = req.query.period || '30d';
    if (!shop) return res.status(400).json({ error: 'shop required' });

    const { start, end } = getPeriodDates(period);

    const pipeline = [
      { $match: { shop, orderCreatedAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$orderCreatedAt' } },
            attribution: '$attributionType'
          },
          revenue: { $sum: { $toDouble: '$totalPrice' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ];

    const data = await OrderRevenue.aggregate(pipeline);

    const dayMap = {};
    for (const row of data) {
      const day = row._id.date;
      if (!dayMap[day]) dayMap[day] = { date: day, direct_ai: 0, ai_influenced: 0, organic: 0, total: 0 };
      dayMap[day][row._id.attribution] = row.revenue;
      dayMap[day].total += row.revenue;
    }

    const timeline = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

    res.json({ period, timeline });
  } catch (err) {
    console.error('[ANALYTICS] timeline error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analytics/sync-orders — Manual order sync trigger
router.post('/analytics/sync-orders', async (req, res) => {
  try {
    const shop = (req.query.shop || req.body.shop || '').replace(/^https?:\/\//, '').toLowerCase();
    if (!shop) return res.status(400).json({ error: 'shop required' });

    const result = await syncOrdersForShop(req, shop, 30);
    res.json(result);
  } catch (err) {
    console.error('[ANALYTICS] sync-orders error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- helpers ---

function countSources(orders) {
  const counts = {};
  for (const o of orders) {
    const src = o.aiSource || 'Unknown';
    counts[src] = (counts[src] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

function countPixelSources(events) {
  const counts = {};
  for (const ev of events) {
    const src = ev.aiSource || 'Unknown';
    counts[src] = (counts[src] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

export default router;
