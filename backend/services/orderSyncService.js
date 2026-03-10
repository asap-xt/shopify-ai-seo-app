import { makeShopifyGraphQLRequest } from '../utils/shopifyGraphQL.js';
import { resolveAdminToken } from '../utils/tokenResolver.js';
import OrderRevenue from '../db/OrderRevenue.js';
import AIVisitLog from '../db/AIVisitLog.js';

const AI_DOMAINS = [
  'chat.openai.com', 'chatgpt.com',
  'perplexity.ai', 'www.perplexity.ai',
  'claude.ai',
  'gemini.google.com', 'bard.google.com',
  'copilot.microsoft.com',
  'you.com', 'www.you.com',
  'poe.com',
  'phind.com', 'www.phind.com',
  'meta.ai',
  'kagi.com',
];

const AI_SOURCE_MAP = {
  'chat.openai.com': 'ChatGPT',
  'chatgpt.com': 'ChatGPT',
  'perplexity.ai': 'Perplexity',
  'www.perplexity.ai': 'Perplexity',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'bard.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
  'you.com': 'You.com',
  'www.you.com': 'You.com',
  'poe.com': 'Poe',
  'phind.com': 'Phind',
  'www.phind.com': 'Phind',
  'meta.ai': 'Meta AI',
  'kagi.com': 'Kagi',
};

function isAIDomain(domain) {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, '');
  return AI_DOMAINS.some(ai => d === ai || d === ai.replace(/^www\./, ''));
}

function resolveAISource(domain) {
  if (!domain) return null;
  const d = domain.toLowerCase();
  return AI_SOURCE_MAP[d] || AI_SOURCE_MAP[d.replace(/^www\./, '')] || null;
}

function extractDomain(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const ORDERS_QUERY = `
  query FetchOrders($query: String!, $cursor: String) {
    orders(first: 50, query: $query, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          customerJourneySummary {
            firstVisit {
              referrerUrl
              source
              sourceType
              landingPage
              utmParameters { source medium campaign }
            }
            lastVisit {
              referrerUrl
              source
              sourceType
              landingPage
              utmParameters { source medium campaign }
            }
          }
          lineItems(first: 50) {
            edges {
              node {
                product { id handle title }
                variant { id }
                quantity
                originalUnitPriceSet { shopMoney { amount } }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/**
 * Fetch orders from Shopify for a given date range
 */
async function fetchShopifyOrders(shop, accessToken, sinceDate) {
  const allOrders = [];
  let cursor = null;
  const dateStr = sinceDate.toISOString().split('T')[0];
  const queryStr = `created_at:>=${dateStr} financial_status:paid`;

  for (let page = 0; page < 10; page++) {
    const data = await makeShopifyGraphQLRequest(shop, accessToken, ORDERS_QUERY, {
      query: queryStr,
      cursor
    });

    const edges = data?.orders?.edges || [];
    for (const edge of edges) {
      allOrders.push(edge.node);
    }

    if (!data?.orders?.pageInfo?.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return allOrders;
}

/**
 * Check if any product handles from an order were recently visited by AI bots
 */
async function checkAIInfluence(shop, productHandles, orderDate) {
  if (!productHandles.length) return false;

  const windowStart = new Date(orderDate);
  windowStart.setDate(windowStart.getDate() - 30);

  const endpointPatterns = productHandles.map(h => new RegExp(h, 'i'));

  const visitCount = await AIVisitLog.countDocuments({
    shop,
    createdAt: { $gte: windowStart, $lte: new Date(orderDate) },
    botName: { $nin: ['Human/Unknown', 'Other Bot'] },
    $or: endpointPatterns.map(p => ({ endpoint: p }))
  });

  return visitCount > 0;
}

/**
 * Process a single Shopify order and determine attribution
 */
async function processOrder(shop, order) {
  const journey = order.customerJourneySummary;
  const firstRef = journey?.firstVisit?.referrerUrl || '';
  const lastRef = journey?.lastVisit?.referrerUrl || '';
  const firstDomain = extractDomain(firstRef);
  const lastDomain = extractDomain(lastRef);
  const utmSource = (journey?.firstVisit?.utmParameters?.source || '').toLowerCase();

  const lineItems = (order.lineItems?.edges || []).map(e => ({
    productId: e.node.product?.id || '',
    handle: e.node.product?.handle || '',
    title: e.node.product?.title || '',
    quantity: e.node.quantity || 1,
    price: e.node.originalUnitPriceSet?.shopMoney?.amount || '0',
    variantId: e.node.variant?.id || ''
  }));

  const productHandles = lineItems.map(li => li.handle).filter(Boolean);

  let attributionType = 'organic';
  let aiSource = null;

  if (isAIDomain(firstDomain) || isAIDomain(lastDomain)) {
    attributionType = 'direct_ai';
    aiSource = resolveAISource(firstDomain) || resolveAISource(lastDomain);
  } else if (utmSource && AI_DOMAINS.some(d => utmSource.includes(d.split('.')[0]))) {
    attributionType = 'direct_ai';
    aiSource = utmSource;
  } else if (await checkAIInfluence(shop, productHandles, order.createdAt)) {
    attributionType = 'ai_influenced';
  }

  return {
    shop,
    shopifyOrderId: order.id,
    orderNumber: order.name || '',
    totalPrice: order.totalPriceSet?.shopMoney?.amount || '0',
    subtotalPrice: order.subtotalPriceSet?.shopMoney?.amount || '0',
    currency: order.totalPriceSet?.shopMoney?.currencyCode || 'USD',
    lineItems,
    referringDomain: firstDomain || lastDomain || '',
    landingPageUrl: journey?.firstVisit?.landingPage || '',
    customerJourney: {
      firstVisitReferrer: firstRef,
      lastVisitReferrer: lastRef,
      source: journey?.firstVisit?.source || ''
    },
    attributionType,
    aiSource,
    orderCreatedAt: new Date(order.createdAt),
    processedAt: new Date()
  };
}

/**
 * Sync orders for a given shop. Fetches paid orders from the last N days,
 * determines AI attribution, and upserts into OrderRevenue.
 */
export async function syncOrdersForShop(req, shop, days = 30) {
  try {
    const accessToken = await resolveAdminToken(req, shop);
    if (!accessToken) {
      console.warn(`[ORDER-SYNC] No token for ${shop}, skipping`);
      return { synced: 0, skipped: 0, error: null };
    }

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    console.log(`[ORDER-SYNC] Fetching orders for ${shop} since ${sinceDate.toISOString().split('T')[0]}`);
    const orders = await fetchShopifyOrders(shop, accessToken, sinceDate);
    console.log(`[ORDER-SYNC] Fetched ${orders.length} paid orders for ${shop}`);

    let synced = 0;
    let skipped = 0;

    for (const order of orders) {
      try {
        const existing = await OrderRevenue.findOne({ shop, shopifyOrderId: order.id });
        if (existing) {
          skipped++;
          continue;
        }

        const doc = await processOrder(shop, order);
        await OrderRevenue.create(doc);
        synced++;
      } catch (err) {
        if (err.code === 11000) {
          skipped++;
        } else {
          console.error(`[ORDER-SYNC] Error processing order ${order.name}:`, err.message);
        }
      }
    }

    console.log(`[ORDER-SYNC] Done for ${shop}: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped, error: null };
  } catch (err) {
    console.error(`[ORDER-SYNC] Failed for ${shop}:`, err.message);
    return { synced: 0, skipped: 0, error: err.message };
  }
}

/**
 * Process a single order from a webhook payload (real-time)
 */
export async function processOrderWebhook(shop, orderData) {
  try {
    const accessToken = await resolveAdminToken(null, shop);
    if (!accessToken) return;

    const orderId = `gid://shopify/Order/${orderData.id}`;
    const existing = await OrderRevenue.findOne({ shop, shopifyOrderId: orderId });
    if (existing) return;

    const detailQuery = `
      query OrderDetail($id: ID!) {
        order(id: $id) {
          id
          name
          createdAt
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          customerJourneySummary {
            firstVisit {
              referrerUrl
              source
              sourceType
              landingPage
              utmParameters { source medium campaign }
            }
            lastVisit {
              referrerUrl
              source
              sourceType
              landingPage
              utmParameters { source medium campaign }
            }
          }
          lineItems(first: 50) {
            edges {
              node {
                product { id handle title }
                variant { id }
                quantity
                originalUnitPriceSet { shopMoney { amount } }
              }
            }
          }
        }
      }
    `;

    const data = await makeShopifyGraphQLRequest(shop, accessToken, detailQuery, { id: orderId });
    if (!data?.order) return;

    const doc = await processOrder(shop, data.order);
    await OrderRevenue.create(doc);
    console.log(`[ORDER-WEBHOOK] Processed order ${orderData.name || orderData.id} for ${shop} → ${doc.attributionType}`);
  } catch (err) {
    if (err.code === 11000) return;
    console.error(`[ORDER-WEBHOOK] Error for ${shop}:`, err.message);
  }
}

export { AI_DOMAINS, AI_SOURCE_MAP, isAIDomain, resolveAISource };
