// backend/controllers/languageController.js
// Modern language controller using token exchange

import express from 'express';
import { requireAuth, executeGraphQL } from '../middleware/modernAuth.js';

const router = express.Router();

// Apply authentication to all routes
router.use(requireAuth);

// Helper functions
const normalizeLocale = (l) => (l ? String(l).trim().toLowerCase() : null);
const toGID = (id) => {
  const s = String(id || '').trim();
  if (!s) return s;
  if (/^gid:\/\//i.test(s)) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return s;
};

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
async function resolveLanguages({ req, productId }) {
  const t0 = Date.now();
  const errors = [];
  let shopLocalesRaw = [];
  let productLocalesRaw = [];

  try {
    // Get shop locales
    const shopData = await executeGraphQL(req, Q_SHOP_LOCALES);
    shopLocalesRaw = shopData?.shopLocales || [];
  } catch (error) {
    console.error(`[LANGUAGE] Shop locales error:`, error.message);
    errors.push(`Shop locales: ${error.message}`);
  }

  // Get product locales if productId provided
  if (productId) {
    try {
      const gidProductId = toGID(productId);
      const productData = await executeGraphQL(req, Q_PRODUCT_LOCALES, { id: gidProductId });
      productLocalesRaw = productData?.product?.resourcePublications?.edges || [];
    } catch (error) {
      console.error(`[LANGUAGE] Product locales error:`, error.message);
      errors.push(`Product locales: ${error.message}`);
    }
  }

  return shapeOutput({
    shop: req.auth.shop,
    productId,
    shopLocalesRaw,
    productLocalesRaw,
    authUsed: req.auth.source,
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
    tookMs
  };
}

// Route handlers
router.get('/shop/:shop', async (req, res) => {
  try {
    const result = await resolveLanguages({ 
      req,
      productId: null
    });
    
    // Remove product-specific fields for shop-only endpoint
    const { productLanguages, allLanguagesOption, shouldShowSelector, ...shopResult } = result;
    shopResult.source = shopResult.source.split('|')[0];
    
    return res.json(shopResult);

  } catch (error) {
    console.error(`[LANGUAGE-CONTROLLER] Error:`, error.message);
    return res.status(200).json({
      shop: req.auth.shop,
      primaryLanguage: 'en',
      shopLanguages: ['en'],
      authUsed: req.auth.source,
      source: 'fallback',
      tookMs: 0,
      _error: error.message || String(error),
    });
  }
});

router.get('/product/:shop/:productId', async (req, res) => {
  try {
    const productId = String(req.params.productId || '').trim();

    if (!productId) {
      return res.status(400).json({ error: 'Missing productId parameter' });
    }

    const result = await resolveLanguages({ 
      req,
      productId
    });
    
    return res.json(result);

  } catch (error) {
    console.error(`[LANGUAGE-CONTROLLER] Error:`, error.message);
    return res.status(200).json({
      shop: req.auth.shop,
      productId: toGID(req.params.productId),
      primaryLanguage: 'en',
      shopLanguages: ['en'],
      productLanguages: ['en'],
      shouldShowSelector: false,
      allLanguagesOption: null,
      authUsed: req.auth.source,
      source: 'fallback|fallback',
      tookMs: 0,
      _errors: [error.message || String(error)],
    });
  }
});

// Ping endpoint for testing
router.get('/ping/:shop', async (req, res) => {
  try {
    // Simple test query
    const testQuery = `query { shop { id name } }`;
    const data = await executeGraphQL(req, testQuery);
    
    return res.json({ 
      ok: true, 
      authUsed: req.auth.source, 
      shop: data?.shop,
      tokenType: req.auth.tokenType
    });

  } catch (error) {
    return res.status(500).json({ 
      ok: false, 
      authUsed: req.auth.source, 
      error: error.message 
    });
  }
});

export default router;