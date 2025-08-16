// backend/controllers/productSync.js
// Builds an AI-ready catalog feed from Shopify Admin API and caches it as NDJSON in Mongo.

import mongoose from 'mongoose';

// Mongo model for cached feed
const FeedCacheSchema = new mongoose.Schema(
  {
    shop: { type: String, index: true, required: true, unique: true },
    format: { type: String, default: 'ndjson' },
    data: { type: String, default: '' }, // NDJSON content
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'feed_cache' }
);

export const FeedCache = mongoose.models.FeedCache || mongoose.model('FeedCache', FeedCacheSchema);

function sanitizeHtmlBasic(html = '') {
  let out = String(html)
    .replace(/<\s*script[\s\S]*?<\/\s*script\s*>/gi, '')
    .replace(/<\s*style[\s\S]*?<\/\s*style\s*>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\son\w+=\S+/gi, '');
  out = out.replace(/<(?!\/?(p|ul|ol|li|br|strong|em|b|i|h1|h2|h3|a|img)\b)[^>]*>/gi, '');
  return out;
}

function minimalJsonLd({ name, description, price, currency, url }) {
  const obj = { '@context': 'https://schema.org', '@type': 'Product', name, description };
  if (price != null && currency) {
    obj.offers = {
      '@type': 'Offer',
      price,
      priceCurrency: currency,
      availability: 'https://schema.org/InStock',
    };
  }
  if (url) obj.url = url;
  return obj;
}

function getAdminApiVersion() {
  return process.env.SHOPIFY_API_VERSION || '2025-07';
}

async function adminGraphQL({ shop, accessToken, query, variables }) {
  if (!shop || !accessToken) throw new Error('Missing shop or access token for Admin GraphQL');
  const url = `https://${shop}/admin/api/${getAdminApiVersion()}/graphql.json`;
  const rsp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
    body: JSON.stringify({ query, variables }),
  });
  const json = await rsp.json();
  if (!rsp.ok || json.errors) {
    const msg = json.errors ? JSON.stringify(json.errors) : await rsp.text();
    throw new Error(`Admin GraphQL error: ${msg}`);
  }
  return json;
}

/**
 * Resolve an Admin API access token.
 * For production, replace with your own DB lookup of the shop's offline access token.
 * As a fallback, uses env SHOPIFY_ADMIN_API_ACCESS_TOKEN (single-shop setups).
 */
async function resolveAccessToken(shop) {
  // TODO: swap with offline session lookup per shop
  return process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || null;
}

function pickPrices(variants) {
  let price = null,
    currency = null,
    available = false;
  for (const edge of variants?.edges || []) {
    const v = edge?.node;
    if (!v) continue;
    const p = parseFloat(v.price ?? v.priceV2?.amount);
    const c = v.currencyCode || v.priceV2?.currencyCode || currency;
    if (!Number.isNaN(p)) {
      if (price === null || p < price) price = p;
      if (!currency && c) currency = c;
    }
    if (v.availableForSale) available = true;
  }
  return { price, currency, available };
}

function csv(arr) {
  return Array.isArray(arr)
    ? arr
    : typeof arr === 'string'
    ? arr.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
}

function toFeedItem(node) {
  const {
    id,
    handle,
    title,
    descriptionHtml,
    vendor,
    productType,
    tags,
    onlineStoreUrl,
    updatedAt,
    seo,
  } = node || {};
  const bullets = node?.metafield_seo_ai_bullets?.value ? JSON.parse(node.metafield_seo_ai_bullets.value) : [];
  const faq = node?.metafield_seo_ai_faq?.value ? JSON.parse(node.metafield_seo_ai_faq.value) : [];
  const images = (node?.images?.edges || []).map((e) => ({
    id: e?.node?.id,
    alt: e?.node?.altText || '',
  }));
  const { price, currency, available } = pickPrices(node?.variants);
  const bodyHtml = sanitizeHtmlBasic(descriptionHtml || '');
  const jsonLd = minimalJsonLd({
    name: seo?.title || title,
    description: seo?.description || bodyHtml.replace(/<[^>]+>/g, ' ').trim().slice(0, 500),
    price,
    currency,
    url: onlineStoreUrl,
  });

  return {
    productId: id,
    handle,
    title,
    vendor,
    productType,
    tags: csv(tags),
    url: onlineStoreUrl || null,
    price,
    currency,
    available,
    images,
    seo: { title: seo?.title || null, metaDescription: seo?.description || null },
    seo_ai: { bullets, faq },
    bodyHtml,
    jsonLd,
    updatedAt,
  };
}

async function fetchAllProducts({ shop, accessToken }) {
  const pageSize = 100;
  let after = null;
  const items = [];

  const query = `
    query Products($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: UPDATED_AT) {
        pageInfo { hasNextPage endCursor }
        edges {
          cursor
          node {
            id title handle descriptionHtml onlineStoreUrl vendor productType tags updatedAt
            seo { title description }
            images(first: 10) { edges { node { id altText } } }
            variants(first: 50) { edges { node { id price currencyCode availableForSale } } }
            metafield_seo_ai_bullets: metafield(namespace: "seo_ai", key: "bullets") { value }
            metafield_seo_ai_faq: metafield(namespace: "seo_ai", key: "faq") { value }
          }
        }
      }
    }
  `;

  for (;;) {
    const rsp = await adminGraphQL({
      shop,
      accessToken,
      query,
      variables: { first: pageSize, after },
    });
    const conn = rsp?.data?.products;
    for (const edge of conn?.edges || []) {
      const node = edge?.node;
      if (!node) continue;
      items.push(toFeedItem(node));
      after = edge?.cursor || null;
    }
    if (!conn?.pageInfo?.hasNextPage) break;
  }

  return items;
}

/**
 * Build NDJSON feed and cache it in Mongo.
 * @returns {Promise<{shop:string, count:number, bytes:number, updatedAt:Date}>}
 */
export async function syncProductsForShop(shop, opts = {}) {
  if (!shop) throw new Error('Missing shop');
  const accessToken = opts.accessToken || (await resolveAccessToken(shop));
  if (!accessToken) throw new Error(`No Admin API token available for shop ${shop}`);

  const items = await fetchAllProducts({ shop, accessToken });

  const lines = items.map((obj) => JSON.stringify(obj));
  const ndjson = lines.join('\n');

  const updatedAt = new Date();
  await FeedCache.updateOne(
    { shop },
    { $set: { format: 'ndjson', data: ndjson, updatedAt } },
    { upsert: true }
  ).exec();

  return {
    shop,
    count: items.length,
    bytes: Buffer.byteLength(ndjson, 'utf8'),
    updatedAt,
  };
}
