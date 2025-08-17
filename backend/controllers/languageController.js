// backend/controllers/languageController.js
// Routes: /api/languages/shop/:shop, /api/languages/product/:shop/:productId
// All comments are in English.

import express from 'express';
const router = express.Router();

// ---------- Admin API helpers ----------
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

function normalizeShop(shop) {
  if (!shop) return '';
  const s = String(shop).trim();
  if (!s) return '';
  if (s.endsWith('.myshopify.com')) return s;
  return s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function requireShop(req) {
  const shop = normalizeShop(req.params.shop || req.query.shop || req.body?.shop || req.headers['x-shop']);
  if (!shop) {
    const err = new Error('Missing shop parameter');
    err.status = 400;
    throw err;
  }
  return shop;
}

function resolveAdminTokenForShop(_shop) {
  const t = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
  if (t && t.trim()) return t.trim();
  const err = new Error('No Admin API token available for this shop');
  err.status = 400;
  throw err;
}

async function shopGraphQL(shop, query, variables = {}) {
  const token = resolveAdminTokenForShop(shop);
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const rsp = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await rsp.json();
  if (!rsp.ok || json.errors) {
    const e = new Error(`Admin GraphQL error: ${JSON.stringify(json.errors || json)}`);
    e.status = rsp.status || 500;
    throw e;
  }
  // Collect nested userErrors
  const userErrors = [];
  (function collect(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(collect);
    if (node.userErrors && node.userErrors.length) userErrors.push(...node.userErrors);
    Object.values(node).forEach(collect);
  })(json.data);
  if (userErrors.length) {
    const e = new Error(`Admin GraphQL userErrors: ${JSON.stringify(userErrors)}`);
    e.status = 400;
    throw e;
  }
  return json.data;
}

// ---------- Routes ----------

// GET /api/languages/shop/:shop
router.get('/shop/:shop', async (req, res) => {
  try {
    const shop = requireShop(req);
    
    // Get shop languages using Shopify GraphQL API
    const shopQuery = `
      query ShopLanguages {
        shop {
          primaryDomain {
            locale
          }
          # Note: shop.locales might not be available in all API versions
          # We'll use primaryDomain.locale as fallback
        }
      }
    `;
    
    const shopData = await shopGraphQL(shop, shopQuery);
    const primaryLanguage = shopData?.shop?.primaryDomain?.locale || 'en';
    
    // For now, we'll assume the shop supports the primary language
    // In a real implementation, you might want to check shop settings or use a different approach
    const shopLanguages = [primaryLanguage];

    return res.json({
      shopLanguages,
      primaryLanguage,
      shouldShowSelector: shopLanguages.length > 1,
      allLanguagesOption: shopLanguages.length > 1 ? 'all' : null
    });
  } catch (err) {
    console.error('shop languages error:', err);
    res.status(err?.status || 500).json({ error: err.message || 'Shop languages fetch error' });
  }
});

// GET /api/languages/product/:shop/:productId
router.get('/product/:shop/:productId', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { productId } = req.params;
    
    if (!productId) {
      return res.status(400).json({ error: 'Missing productId parameter' });
    }

    // Get shop languages first
    const shopQuery = `
      query ShopLanguages {
        shop {
          primaryDomain {
            locale
          }
        }
      }
    `;
    
    const shopData = await shopGraphQL(shop, shopQuery);
    const primaryLanguage = shopData?.shop?.primaryDomain?.locale || 'en';
    
    // Get product languages (translations)
    const productQuery = `
      query ProductLanguages($id: ID!) {
        product(id: $id) {
          id
          # Note: product.translations might not be available in all API versions
          # We'll use the primary language as fallback
        }
      }
    `;
    
    const productData = await shopGraphQL(shop, productQuery, { id: productId });
    
    // For now, we'll assume the product is available in the primary language
    // In a real implementation, you might want to check actual translations
    const productLanguages = [primaryLanguage];
    
    // Determine if we should show language selector
    const shouldShowSelector = productLanguages.length > 1;

    return res.json({
      shopLanguages: [primaryLanguage],
      productLanguages,
      primaryLanguage,
      shouldShowSelector,
      allLanguagesOption: productLanguages.length > 1 ? 'all' : null
    });
  } catch (err) {
    console.error('product languages error:', err);
    res.status(err?.status || 500).json({ error: err.message || 'Product languages fetch error' });
  }
});

export default router;
