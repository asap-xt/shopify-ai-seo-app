// backend/controllers/languageController.js
// Fixed version using centralized token resolver

import express from 'express';
import { executeShopifyGraphQL } from '../utils/tokenResolver.js';

const router = express.Router();

// Helper functions
const normalizeLocale = (l) => (l ? String(l).trim().toLowerCase() : null);
const toGID = (id) => {
  const s = String(id || '').trim();
  if (!s) return s;
  if (/^gid:\/\//i.test(s)) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return s;
};

function normalizeShop(shop) {
  if (!shop) return null;
  const s = String(shop).trim();
  if (/^https?:\/\//.test(s)) {
    const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return u.toLowerCase();
  }
  if (!/\.myshopify\.com$/i.test(s)) return `${s.toLowerCase()}.myshopify.com`;
  return s.toLowerCase();
}

// GraphQL queries
const Q_SHOP_LOCALES = `
  query ShopLocales {
    shopLocales {
      locale
      primary
      published
    }
  }
`;

const Q_PRODUCT_LOCALES = `
  query ProductLocales($id: ID!) {
    product(id: $id) {
      resourcePublications(first: 100) {
        edges {
          node {
            locale { locale }
          }
        }
      }
    }
  }
`;

// Main language resolver function
async function resolveLanguages({ shop, productId, authUsed = 'token_exchange' }) {
  const t0 = Date.now();
  const errors = [];
  let shopLocalesRaw = [];
  let productLocalesRaw = [];

  console.log(`[LANGUAGE-ENDPOINT] Starting language resolution for shop: ${shop}, product: ${productId || 'none'}`);

  try {
    // Get shop locales
    console.log(`[LANGUAGE-ENDPOINT] Fetching shop locales...`);
    const shopData = await executeShopifyGraphQL(shop, Q_SHOP_LOCALES);
    shopLocalesRaw = shopData?.shopLocales || [];
    console.log(`[LANGUAGE-ENDPOINT] Found ${shopLocalesRaw.length} shop locales`);
  } catch (error) {
    console.error(`[LANGUAGE-ENDPOINT] Shop locales error:`, error.message);
    errors.push(`Shop locales: ${error.message}`);
  }

  // Get product locales if productId provided
  if (productId) {
    try {
      console.log(`[LANGUAGE-ENDPOINT] Fetching product locales for ${productId}...`);
      const gidProductId = toGID(productId);
      const productData = await executeShopifyGraphQL(shop, Q_PRODUCT_LOCALES, { id: gidProductId });
      productLocalesRaw = productData?.product?.resourcePublications?.edges || [];
      console.log(`[LANGUAGE-ENDPOINT] Found ${productLocalesRaw.length} product locales`);
    } catch (error) {
      console.error(`[LANGUAGE-ENDPOINT] Product locales error:`, error.message);
      errors.push(`Product locales: ${error.message}`);
    }
  }

  return shapeOutput({
    shop,
    productId,
    shopLocalesRaw,
    productLocalesRaw,
    authUsed,
    source: errors.length > 0 ? 'partial' : 'graphql',
    errors,
    tookMs: Date.now() - t0
  });
}

// Shape the output
function shapeOutput({ shop, productId, shopLocalesRaw, productLocalesRaw, authUsed, source, errors, tookMs }) {
  const shopLocales = (Array.isArray(shopLocalesRaw) ? shopLocalesRaw : [])
    .map(l => ({
      locale: normalizeLocale(l?.locale),
      primary: !!l?.primary,
      published: !!l?.published,
    }))
    .filter(l => l.locale);

  const productLanguages = (Array.isArray(productLocalesRaw) ? productLocalesRaw : [])
    .map(edge => normalizeLocale(edge?.node?.locale?.locale))
    .filter(Boolean);

  const primaryLanguage = shopLocales.find(l => l.primary)?.locale || 'en';
  const shopLanguages = shopLocales.filter(l => l.published).map(l => l.locale);
  const uniqueProductLanguages = [...new Set(productLanguages)];

  const shouldShowSelector = uniqueProductLanguages.length > 1;
  const allLanguagesOption = shouldShowSelector ? 'all' : null;

  return {
    shop,
    ...(productId && { productId: toGID(productId) }),
    primaryLanguage,
    shopLanguages: shopLanguages.length > 0 ? shopLanguages : ['en'],
    ...(productId && { 
      productLanguages: uniqueProductLanguages.length > 0 ? uniqueProductLanguages : ['en'],
      shouldShowSelector,
      allLanguagesOption
    }),
    authUsed,
    source: `${source}${productId ? '|graphql' : ''}`,
    errors,
    tookMs: Date.now() - tookMs
  };
}

// Route handlers
router.get('/shop/:shop', async (req, res) => {
  try {
    // Try multiple sources for shop domain
    const shop = normalizeShop(req.params.shop || req.query.shop || req.shopDomain);
    if (!shop) {
      return res.status(400).json({ error: 'Missing or invalid shop parameter' });
    }

    console.log(`[LANGUAGE-ENDPOINT] ===== HANDLER CALLED =====`);
    console.log(`[LANGUAGE-ENDPOINT] req.shopDomain: ${shop}`);
    console.log(`[LANGUAGE-ENDPOINT] req.params:`, req.params);
    console.log(`[LANGUAGE-ENDPOINT] Starting with shop: ${shop}`);

    const result = await resolveLanguages({ 
      shop, 
      productId: null, 
      authUsed: 'token_exchange' 
    });
    
    // Remove product-specific fields for shop-only endpoint
    const { productLanguages, allLanguagesOption, shouldShowSelector, ...shopResult } = result;
    shopResult.source = shopResult.source.split('|')[0];
    
    return res.json(shopResult);

  } catch (error) {
    console.error(`[LANGUAGE-CONTROLLER] Error:`, error.message);
    return res.status(200).json({
      shop: normalizeShop(req.params.shop),
      primaryLanguage: 'en',
      shopLanguages: ['en'],
      authUsed: 'token_exchange',
      source: 'fallback',
      tookMs: 0,
      _error: error.message || String(error),
    });
  }
});

router.get('/product/:shop/:productId', async (req, res) => {
  try {
    const shop = normalizeShop(req.params.shop || req.query.shop || req.shopDomain);
    const productId = String(req.params.productId || '').trim();

    if (!shop) {
      return res.status(400).json({ error: 'Missing or invalid shop parameter' });
    }
    if (!productId) {
      return res.status(400).json({ error: 'Missing productId parameter' });
    }

    const result = await resolveLanguages({ 
      shop, 
      productId, 
      authUsed: 'token_exchange' 
    });
    
    return res.json(result);

  } catch (error) {
    console.error(`[LANGUAGE-CONTROLLER] Error:`, error.message);
    return res.status(200).json({
      shop: normalizeShop(req.params.shop),
      productId: toGID(req.params.productId),
      primaryLanguage: 'en',
      shopLanguages: ['en'],
      productLanguages: ['en'],
      shouldShowSelector: false,
      allLanguagesOption: null,
      authUsed: 'token_exchange',
      source: 'fallback|fallback',
      tookMs: 0,
      _errors: [error.message || String(error)],
    });
  }
});

// Ping endpoint for testing
router.get('/ping/:shop', async (req, res) => {
  try {
    const shop = normalizeShop(req.params.shop || req.query.shop || req.shopDomain);
    if (!shop) {
      return res.status(400).json({ error: 'Missing or invalid shop parameter' });
    }

    // Simple test query
    const testQuery = `query { shop { id name } }`;
    const data = await executeShopifyGraphQL(shop, testQuery);
    
    return res.json({ 
      ok: true, 
      authUsed: 'token_exchange', 
      shop: data?.shop 
    });

  } catch (error) {
    return res.status(500).json({ 
      ok: false, 
      authUsed: 'token_exchange', 
      error: error.message 
    });
  }
});

export default router;