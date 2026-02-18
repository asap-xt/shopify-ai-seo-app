// backend/mcp/mcpTools.js
// MCP Tool handler implementations - DB queries, RAG logic, data formatting

import Product from '../db/Product.js';
import Collection from '../db/Collection.js';
import Shop from '../db/Shop.js';
import AIVisitLog from '../db/AIVisitLog.js';
import Subscription from '../db/Subscription.js';
import TokenBalance from '../db/TokenBalance.js';
import { resolvePlanKey, getPlanConfig } from '../plans.js';
import { calculateFeatureCost } from '../billing/tokenConfig.js';
import crypto from 'crypto';
import fetch from 'node-fetch';

// Active product filter (reusable)
const ACTIVE_FILTER = {
  $or: [
    { status: 'ACTIVE' },
    { status: { $exists: false } },
    { status: null }
  ]
};

/**
 * Log an MCP tool call to AIVisitLog for analytics
 */
async function logMcpCall(shop, toolName, userAgent) {
  try {
    const ipHash = crypto.createHash('sha256').update('mcp-agent').digest('hex').substring(0, 16);

    const botName = detectBotFromUA(userAgent);
    if (!botName) return; // internal bot — skip analytics

    await AIVisitLog.create({
      shop: shop.replace(/^https?:\/\//, '').toLowerCase(),
      endpoint: `/mcp/tools/${toolName}`,
      botName,
      userAgent: (userAgent || '').substring(0, 500),
      ipHash,
      statusCode: 200,
      responseTimeMs: 0,
      source: 'mcp',
      createdAt: new Date()
    });
  } catch (err) {
    // Silent fail - analytics should never break the app
    if (process.env.NODE_ENV !== 'production') {
      console.error('[MCP-ANALYTICS] Log error:', err.message);
    }
  }
}

/**
 * Detect bot name from User-Agent.
 * Uses the SAME names as KNOWN_BOTS in aiAnalytics.js
 * so they appear as the same bots in the Dashboard.
 */
function detectBotFromUA(ua) {
  if (!ua) return 'Other Bot';
  const lower = ua.toLowerCase();
  if (lower.includes('claude')) return 'Claude';
  if (lower.includes('chatgpt') || lower.includes('gptbot')) return 'ChatGPT';
  if (lower.includes('oai-searchbot')) return 'OpenAI Search';
  if (lower.includes('openai')) return 'ChatGPT';
  if (lower.includes('google-extended') || lower.includes('gemini')) return 'Google AI';
  if (lower.includes('perplexity')) return 'Perplexity';
  if (lower.includes('copilot') || lower.includes('bingbot')) return 'Bing';
  if (lower.includes('meta-externalagent')) return 'Meta AI';
  if (lower.includes('cohere')) return 'Cohere';
  if (lower.includes('youbot')) return 'You.com';
  if (lower.includes('applebot')) return 'Apple';
  if (lower.includes('plamenaaiassistant')) return null; // internal — skip logging
  return 'Other Bot';
}

// ============================================================
// PLAN LIMIT HELPERS
// ============================================================

/**
 * Get the shop's plan config (product limit, collection limit, etc.)
 */
async function getShopPlanConfig(shop) {
  try {
    const subscription = await Subscription.findOne({ shop }).lean();
    const planKey = resolvePlanKey(subscription?.plan) || 'starter';
    const planConfig = getPlanConfig(planKey);
    return {
      planKey,
      productLimit: planConfig?.productLimit || 70,
      collectionLimit: planConfig?.collectionLimit ?? 0,
      plan: planConfig?.name || 'Starter',
    };
  } catch (err) {
    console.error('[MCP] Error getting plan config:', err.message);
    return { planKey: 'starter', productLimit: 70, collectionLimit: 0, plan: 'Starter' };
  }
}

/**
 * Check if shop has sufficient token balance for a feature.
 * Returns { allowed, balance, cost, error? }
 */
async function checkAndDeductTokens(shop, feature) {
  const cost = calculateFeatureCost(feature);

  try {
    const tokenBalance = await TokenBalance.findOne({ shop });
    if (!tokenBalance || !tokenBalance.hasBalance(cost)) {
      return {
        allowed: false,
        balance: tokenBalance?.balance || 0,
        cost,
        error: `Insufficient token balance. Required: ${cost.toLocaleString()} tokens, available: ${(tokenBalance?.balance || 0).toLocaleString()} tokens. Purchase tokens in the app dashboard.`
      };
    }

    // Deduct tokens
    await tokenBalance.deductTokens(cost, feature, { source: 'mcp', tool: 'ask_question' });

    return { allowed: true, balance: tokenBalance.balance, cost };
  } catch (err) {
    console.error('[MCP] Token deduction error:', err.message);
    return {
      allowed: false,
      balance: 0,
      cost,
      error: 'Failed to verify token balance. Please try again later.'
    };
  }
}

/**
 * Parse AI metafields from product._metafields
 * Returns structured object with FAQ, bullets, keywords, etc.
 */
function parseProductMetafields(product) {
  const meta = product._metafields || {};
  const result = {
    aiFaq: null,
    aiBullets: null,
    aiKeywords: null,
    aiTitle: null,
    aiDescription: null,
  };

  // _metafields stores raw metafield data keyed by language code or directly
  for (const [key, value] of Object.entries(meta)) {
    if (!value || typeof value !== 'object') continue;

    // Check for FAQ data
    if (key.includes('faq') || value.faq) {
      result.aiFaq = value.faq || value;
    }
    // Check for bullets
    if (key.includes('bullets') || value.bullets) {
      result.aiBullets = value.bullets || value;
    }
    // Check for keywords
    if (key.includes('keywords') || value.keywords) {
      result.aiKeywords = value.keywords || value;
    }
    // Check for title/description
    if (value.title) result.aiTitle = result.aiTitle || value.title;
    if (value.description) result.aiDescription = result.aiDescription || value.description;
  }

  return result;
}

/**
 * Format a product for MCP response
 */
function formatProduct(product, shopDomain) {
  const meta = parseProductMetafields(product);

  return {
    id: product.shopifyProductId || product.productId,
    handle: product.handle,
    title: meta.aiTitle || product.title,
    description: meta.aiDescription || product.description || '',
    price: product.price,
    currency: product.currency || 'USD',
    product_type: product.productType || '',
    vendor: product.vendor || '',
    tags: product.tags || [],
    available: product.available !== false,
    url: `https://${shopDomain}/products/${product.handle}`,
    image: product.featuredImage?.url || product.images?.[0]?.url || null,
    image_alt: product.featuredImage?.altText || product.images?.[0]?.alt || product.title,
    ai_optimized: product.seoStatus?.optimized || false,
    faq: meta.aiFaq || null,
    bullets: meta.aiBullets || null,
    keywords: meta.aiKeywords || null,
  };
}

// ============================================================
// TOOL: search_products
// ============================================================
export async function searchProducts(shop, args, userAgent) {
  const { query, product_type, tags, min_price, max_price, limit = 10 } = args;

  await logMcpCall(shop, 'search_products', userAgent);

  // Get plan limits
  const planConfig = await getShopPlanConfig(shop);
  const maxProducts = planConfig.productLimit;

  const filter = { shop, ...ACTIVE_FILTER };

  // Add product type filter
  if (product_type) {
    filter.productType = { $regex: product_type, $options: 'i' };
  }

  // Add tags filter
  if (tags) {
    const tagList = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
    filter.tags = { $in: tagList.map(t => new RegExp(t, 'i')) };
  }

  // Effective limit: min of requested, 50 hard cap, and plan product limit
  const effectiveLimit = Math.min(limit, 50, maxProducts);

  // Text search on title
  let products;
  if (query) {
    // Use text index for search
    products = await Product.find(
      { ...filter, $text: { $search: query } },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(effectiveLimit)
      .lean();

    // If text search returns nothing, fall back to regex on title
    if (products.length === 0) {
      products = await Product.find({
        ...filter,
        title: { $regex: query, $options: 'i' }
      })
        .limit(effectiveLimit)
        .lean();
    }
  } else {
    products = await Product.find(filter)
      .sort({ publishedAt: -1 })
      .limit(effectiveLimit)
      .lean();
  }

  // Price filtering (post-query since price is stored as string)
  if (min_price !== undefined || max_price !== undefined) {
    products = products.filter(p => {
      const price = parseFloat(p.price);
      if (isNaN(price)) return true;
      if (min_price !== undefined && price < min_price) return false;
      if (max_price !== undefined && price > max_price) return false;
      return true;
    });
  }

  // Get public domain for URLs
  const publicDomain = await getPublicDomain(shop);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        shop: publicDomain,
        plan: planConfig.plan,
        product_limit: maxProducts,
        query: query || null,
        total_results: products.length,
        products: products.map(p => formatProduct(p, publicDomain))
      }, null, 2)
    }]
  };
}

// ============================================================
// TOOL: get_product_details
// ============================================================
export async function getProductDetails(shop, args, userAgent) {
  const { handle, product_id } = args;

  await logMcpCall(shop, 'get_product_details', userAgent);

  let product;
  if (handle) {
    product = await Product.findOne({ shop, handle, ...ACTIVE_FILTER }).lean();
  } else if (product_id) {
    product = await Product.findOne({
      shop,
      $or: [
        { shopifyProductId: String(product_id) },
        { productId: String(product_id) }
      ],
      ...ACTIVE_FILTER
    }).lean();
  }

  if (!product) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: 'Product not found', handle, product_id })
      }],
      isError: true
    };
  }

  const publicDomain = await getPublicDomain(shop);
  const formatted = formatProduct(product, publicDomain);

  // Add extra details for single product view
  formatted.description_full = product.description || '';
  formatted.images = (product.images || []).map(img => ({
    url: img.url,
    alt: img.alt || product.title
  }));
  formatted.inventory = product.totalInventory;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(formatted, null, 2)
    }]
  };
}

// ============================================================
// TOOL: get_store_info
// ============================================================
export async function getStoreInfo(shop, args, userAgent) {
  await logMcpCall(shop, 'get_store_info', userAgent);

  const shopRecord = await Shop.findOne({ shop }).lean();
  if (!shopRecord) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Store not found' }) }],
      isError: true
    };
  }

  // Fetch shop info + AI context metafields from Shopify
  let shopInfo = {};
  let aiContext = null;
  let seoMeta = null;

  try {
    const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shopRecord.accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `{
          shop {
            name
            description
            email
            url
            primaryDomain { url host }
            aiContextMetafield: metafield(namespace: "ai_seo_store", key: "ai_metadata") { value }
            seoMetafield: metafield(namespace: "ai_seo_store", key: "seo_metadata") { value }
            organizationMetafield: metafield(namespace: "ai_seo_store", key: "organization_schema") { value }
          }
        }`
      })
    });
    const data = await response.json();
    shopInfo = data.data?.shop || {};

    if (shopInfo.aiContextMetafield?.value) {
      try { aiContext = JSON.parse(shopInfo.aiContextMetafield.value); } catch {}
    }
    if (shopInfo.seoMetafield?.value) {
      try { seoMeta = JSON.parse(shopInfo.seoMetafield.value); } catch {}
    }
  } catch (e) {
    console.error('[MCP] Failed to fetch shop info:', e.message);
  }

  // Fetch policies
  let policies = {};
  try {
    const policyResponse = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shopRecord.accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `{
          shop {
            shippingPolicy { title body }
            refundPolicy { title body }
            privacyPolicy { title body }
            termsOfService { title body }
          }
        }`
      })
    });
    const policyData = await policyResponse.json();
    const ps = policyData.data?.shop;
    if (ps) {
      const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (ps.shippingPolicy?.body) policies.shipping = { title: ps.shippingPolicy.title, summary: strip(ps.shippingPolicy.body).substring(0, 1000) };
      if (ps.refundPolicy?.body) policies.refund = { title: ps.refundPolicy.title, summary: strip(ps.refundPolicy.body).substring(0, 1000) };
      if (ps.privacyPolicy?.body) policies.privacy = { title: ps.privacyPolicy.title, summary: strip(ps.privacyPolicy.body).substring(0, 500) };
      if (ps.termsOfService?.body) policies.terms = { title: ps.termsOfService.title, summary: strip(ps.termsOfService.body).substring(0, 500) };
    }
  } catch {}

  // Product stats
  const totalProducts = await Product.countDocuments({ shop, ...ACTIVE_FILTER });
  const totalCollections = await Collection.countDocuments({ shop });

  const result = {
    store_name: shopInfo.name || shop.split('.')[0],
    url: shopInfo.primaryDomain?.url || shopInfo.url || `https://${shop}`,
    domain: shopInfo.primaryDomain?.host || shop,
    description: seoMeta?.shortDescription || seoMeta?.fullDescription || shopInfo.description || '',
    email: shopInfo.email || '',
    catalog_size: { products: totalProducts, collections: totalCollections },
    seo: seoMeta ? {
      title: seoMeta.title,
      keywords: seoMeta.keywords,
    } : null,
    brand: aiContext ? {
      business_type: aiContext.businessType || null,
      target_audience: aiContext.targetAudience || null,
      unique_selling_points: aiContext.uniqueSellingPoints || null,
      brand_voice: aiContext.brandVoice || null,
      primary_categories: aiContext.primaryCategories || null,
      languages: aiContext.languages || null,
      shipping_regions: aiContext.shippingRegions || null,
    } : null,
    policies,
  };

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

// ============================================================
// TOOL: search_collections
// ============================================================
export async function searchCollections(shop, args, userAgent) {
  const { query, limit = 20 } = args;

  await logMcpCall(shop, 'search_collections', userAgent);

  // Check plan collection limit
  const planConfig = await getShopPlanConfig(shop);
  if (planConfig.collectionLimit === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Collections are not available on the current plan.',
          plan: planConfig.plan,
          upgrade_message: 'Upgrade to Professional or higher to access collection data.'
        })
      }],
      isError: true
    };
  }

  const effectiveLimit = Math.min(limit, 50, planConfig.collectionLimit);

  let collections;
  if (query) {
    collections = await Collection.find({
      shop,
      title: { $regex: query, $options: 'i' }
    })
      .limit(effectiveLimit)
      .lean();
  } else {
    collections = await Collection.find({ shop })
      .sort({ productsCount: -1 })
      .limit(effectiveLimit)
      .lean();
  }

  const publicDomain = await getPublicDomain(shop);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        shop: publicDomain,
        plan: planConfig.plan,
        collection_limit: planConfig.collectionLimit,
        total_results: collections.length,
        collections: collections.map(c => ({
          id: c.collectionId || c.shopifyCollectionId,
          title: c.title,
          handle: c.handle,
          description: c.description || c.descriptionHtml?.replace(/<[^>]+>/g, ' ').trim() || '',
          products_count: c.productsCount || 0,
          url: `https://${publicDomain}/collections/${c.handle}`,
          ai_optimized: c.seoStatus?.optimized || false,
        }))
      }, null, 2)
    }]
  };
}

// ============================================================
// TOOL: ask_question (RAG Q&A)
// ============================================================
export async function askQuestion(shop, args, userAgent) {
  const { question, context: additionalContext } = args;

  await logMcpCall(shop, 'ask_question', userAgent);

  // Check and deduct tokens BEFORE calling Gemini
  const tokenCheck = await checkAndDeductTokens(shop, 'mcp-ask-question');
  if (!tokenCheck.allowed) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Token balance required',
          message: tokenCheck.error,
          tokens_required: tokenCheck.cost,
          tokens_available: tokenCheck.balance,
          help: 'The store owner needs to purchase tokens in the indexAIze app dashboard to enable AI-powered Q&A.'
        })
      }],
      isError: true
    };
  }

  const shopRecord = await Shop.findOne({ shop }).lean();
  if (!shopRecord) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Store not found' }) }],
      isError: true
    };
  }

  // Build RAG context (same logic as /ai/ask)
  let storeContext = '';

  // 1. Products
  const products = await Product.find({ shop, ...ACTIVE_FILTER })
    .select('title description price currency tags handle available productType vendor')
    .limit(50)
    .lean();

  if (products.length > 0) {
    storeContext += 'PRODUCTS:\n';
    products.forEach(p => {
      const price = p.price ? `${p.currency || ''}${p.price}` : '';
      storeContext += `- ${p.title}${price ? ` | ${price}` : ''}${p.description ? ` | ${p.description.substring(0, 150)}` : ''}\n`;
      storeContext += `  URL: https://${shop}/products/${p.handle}\n`;
    });
    storeContext += '\n';
  }

  // 2. Collections
  const collections = await Collection.find({ shop })
    .select('title description handle productsCount')
    .limit(20)
    .lean();

  if (collections.length > 0) {
    storeContext += 'COLLECTIONS:\n';
    collections.forEach(c => {
      storeContext += `- ${c.title}${c.description ? `: ${c.description.substring(0, 100)}` : ''}\n`;
    });
    storeContext += '\n';
  }

  // 3. Shop info + AI context
  try {
    const shopInfoResponse = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shopRecord.accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `{
          shop {
            name description email url
            primaryDomain { url }
            aiContextMetafield: metafield(namespace: "ai_seo_store", key: "ai_metadata") { value }
          }
        }`
      })
    });
    const shopData = await shopInfoResponse.json();
    const info = shopData.data?.shop;

    if (info) {
      storeContext += `STORE INFO:\n`;
      storeContext += `- Name: ${info.name}\n`;
      if (info.description) storeContext += `- Description: ${info.description}\n`;
      if (info.email) storeContext += `- Contact: ${info.email}\n`;
      storeContext += `- URL: ${info.primaryDomain?.url || info.url}\n`;

      let aiContext = null;
      try {
        if (info.aiContextMetafield?.value) aiContext = JSON.parse(info.aiContextMetafield.value);
      } catch {}

      if (aiContext) {
        if (aiContext.businessType) storeContext += `- Business: ${aiContext.businessType}\n`;
        if (aiContext.uniqueSellingPoints) storeContext += `- USPs: ${aiContext.uniqueSellingPoints.substring(0, 500)}\n`;
        if (aiContext.shippingInfo) storeContext += `\nSHIPPING: ${aiContext.shippingInfo.substring(0, 800)}\n`;
        if (aiContext.returnPolicy) storeContext += `\nRETURNS: ${aiContext.returnPolicy.substring(0, 800)}\n`;
      }
    }
  } catch {}

  // Call Gemini for answer
  const { getGeminiResponse } = await import('../ai/gemini.js');

  const prompt = `You are a helpful shopping assistant for an online store. Answer the customer's question based ONLY on the store data provided below. Be concise, accurate, and helpful.

If the question is about a specific product, include the product name, price, and URL in your answer.
If you cannot find relevant information in the store data, say so honestly.
Do NOT make up information that is not in the store data.
Keep your answer under 200 words.
${additionalContext ? `\nADDITIONAL CONTEXT: ${additionalContext}` : ''}

STORE DATA:
${storeContext}

CUSTOMER QUESTION: ${question}

Respond in JSON format:
{
  "answer": "Your helpful answer here",
  "relevant_products": [{"title": "...", "url": "...", "price": "..."}],
  "confidence": "high|medium|low"
}`;

  try {
    const aiResponse = await getGeminiResponse(prompt, { maxTokens: 500, temperature: 0.3 });
    let responseText = typeof aiResponse === 'object' && aiResponse.content ? aiResponse.content : aiResponse;

    // Parse JSON from response
    let parsed;
    try {
      let clean = responseText.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      }
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) clean = match[0];
      parsed = JSON.parse(clean);
    } catch {
      parsed = { answer: responseText, relevant_products: [], confidence: 'medium' };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(parsed, null, 2)
      }]
    };
  } catch (err) {
    console.error('[MCP] ask_question Gemini error:', err.message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to generate answer', details: err.message }) }],
      isError: true
    };
  }
}

// ============================================================
// RESOURCES
// ============================================================

export async function readCatalogResource(shop) {
  // Apply plan product limit to catalog resource
  const planConfig = await getShopPlanConfig(shop);
  const maxProducts = Math.min(200, planConfig.productLimit);

  const products = await Product.find({ shop, ...ACTIVE_FILTER })
    .select('title handle price currency productType vendor tags available')
    .limit(maxProducts)
    .lean();

  const publicDomain = await getPublicDomain(shop);

  return {
    contents: [{
      uri: `store://${shop}/catalog`,
      mimeType: 'application/json',
      text: JSON.stringify({
        shop: publicDomain,
        plan: planConfig.plan,
        product_limit: planConfig.productLimit,
        products_count: products.length,
        products: products.map(p => ({
          title: p.title,
          handle: p.handle,
          price: p.price,
          currency: p.currency,
          type: p.productType,
          vendor: p.vendor,
          tags: p.tags,
          available: p.available !== false,
          url: `https://${publicDomain}/products/${p.handle}`
        }))
      }, null, 2)
    }]
  };
}

export async function readPoliciesResource(shop) {
  const shopRecord = await Shop.findOne({ shop }).lean();
  if (!shopRecord) {
    return { contents: [{ uri: `store://${shop}/policies`, mimeType: 'application/json', text: '{"error":"Store not found"}' }] };
  }

  let policies = {};
  try {
    const response = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': shopRecord.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ shop { shippingPolicy { title body } refundPolicy { title body } privacyPolicy { title body } termsOfService { title body } } }`
      })
    });
    const data = await response.json();
    const ps = data.data?.shop;
    const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (ps?.shippingPolicy?.body) policies.shipping = { title: ps.shippingPolicy.title, body: strip(ps.shippingPolicy.body) };
    if (ps?.refundPolicy?.body) policies.refund = { title: ps.refundPolicy.title, body: strip(ps.refundPolicy.body) };
    if (ps?.privacyPolicy?.body) policies.privacy = { title: ps.privacyPolicy.title, body: strip(ps.privacyPolicy.body) };
    if (ps?.termsOfService?.body) policies.terms = { title: ps.termsOfService.title, body: strip(ps.termsOfService.body) };
  } catch {}

  return {
    contents: [{
      uri: `store://${shop}/policies`,
      mimeType: 'application/json',
      text: JSON.stringify(policies, null, 2)
    }]
  };
}

export async function readMetadataResource(shop) {
  const shopRecord = await Shop.findOne({ shop }).lean();
  if (!shopRecord) {
    return { contents: [{ uri: `store://${shop}/metadata`, mimeType: 'application/json', text: '{"error":"Store not found"}' }] };
  }

  let metadata = { shop };
  try {
    const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': shopRecord.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ shop { name description email url primaryDomain { url host }
          aiContextMetafield: metafield(namespace: "ai_seo_store", key: "ai_metadata") { value }
          seoMetafield: metafield(namespace: "ai_seo_store", key: "seo_metadata") { value }
        }}`
      })
    });
    const data = await response.json();
    const info = data.data?.shop;
    if (info) {
      metadata.name = info.name;
      metadata.url = info.primaryDomain?.url || info.url;
      metadata.domain = info.primaryDomain?.host;
      metadata.description = info.description;
      metadata.email = info.email;
      try { metadata.seo = JSON.parse(info.seoMetafield?.value); } catch {}
      try { metadata.ai_context = JSON.parse(info.aiContextMetafield?.value); } catch {}
    }
  } catch {}

  return {
    contents: [{
      uri: `store://${shop}/metadata`,
      mimeType: 'application/json',
      text: JSON.stringify(metadata, null, 2)
    }]
  };
}

// ============================================================
// HELPERS
// ============================================================

const domainCache = new Map();

async function getPublicDomain(shop) {
  if (domainCache.has(shop)) return domainCache.get(shop);

  try {
    const shopRecord = await Shop.findOne({ shop }).select('accessToken').lean();
    if (!shopRecord) return shop;

    const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': shopRecord.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `{ shop { primaryDomain { host } } }` })
    });
    const data = await response.json();
    const domain = data.data?.shop?.primaryDomain?.host || shop;
    domainCache.set(shop, domain);

    // Expire cache after 10 minutes
    setTimeout(() => domainCache.delete(shop), 10 * 60 * 1000);

    return domain;
  } catch {
    return shop;
  }
}
