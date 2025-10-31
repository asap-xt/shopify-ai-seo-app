// backend/middleware/apiResolver.js
// Fixed API middleware that uses centralized token resolver

import { resolveAdminTokenForShop } from '../utils/tokenResolver.js';

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

function extractShopFromRequest(req) {
  // Try multiple sources for shop domain
  const shop = req.query.shop || 
               req.body?.shop || 
               req.params?.shop ||
               req.headers['x-shopify-shop-domain'] ||
               req.headers['x-shop'];
               
  return normalizeShop(shop);
}

function shouldSkipAuth(req) {
  const url = req.originalUrl || req.url || '';
  
  // Skip auth for public endpoints
  if (url.includes('/sitemap/public')) return true;
  if (url.includes('/sitemap/generate')) return true;
  if (url.includes('/sitemap/view')) return true;
  if (url.includes('/health')) return true;
  if (url.includes('/debug')) return true;
  
  return false;
}

/**
 * Centralized API middleware that ensures all requests have proper authentication
 */
export function apiResolver(req, res, next) {
  // Skip authentication for certain endpoints
  if (shouldSkipAuth(req)) {
    return next();
  }

  const shop = extractShopFromRequest(req);
  
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  // Store normalized shop on request for downstream use
  req.normalizedShop = shop;

  // For GET requests, we can proceed without additional validation
  // The individual controllers will handle token resolution
  if (req.method === 'GET') {
    return next();
  }

  // For non-GET requests, pre-validate the token exists
  resolveAdminTokenForShop(shop)
    .then(token => {
      if (!token) {
        return res.status(401).json({ error: 'No valid access token found for shop' });
      }
      next();
    })
    .catch(error => {
      console.error(`[API-RESOLVER] Token resolution error for ${shop}:`, error.message);
      return res.status(401).json({ 
        error: 'Token resolution failed', 
        message: error.message,
        shop: shop
      });
    });
}

/**
 * Middleware specifically for product sync operations
 */
export function productSyncResolver(req, res, next) {
  const shop = extractShopFromRequest(req);
  
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter for sync' });
  }

  req.normalizedShop = shop;
  
  // Pre-validate token for sync operations
  resolveAdminTokenForShop(shop)
    .then(token => {
      if (!token) {
        return res.status(401).json({ 
          error: 'No valid access token found for sync operation',
          shop: shop
        });
      }
      next();
    })
    .catch(error => {
      console.error(`[PRODUCT_SYNC] Token validation failed for ${shop}:`, error.message);
      return res.status(500).json({ 
        error: 'Sync authentication failed', 
        message: error.message,
        shop: shop
      });
    });
}

/**
 * Middleware to attach normalized shop to request
 */
export function attachShop(req, res, next) {
  const shop = extractShopFromRequest(req);
  
  if (shop) {
    req.normalizedShop = shop;
  }
  
  next();
}
