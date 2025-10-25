// backend/utils/cacheWrapper.js
// Cache wrapper utility for easy caching of function results
// PHASE 3: Database Optimization - Caching Layer

import cacheService from '../services/cacheService.js';

/**
 * Wrap a function with caching logic
 * @param {string} key - Cache key
 * @param {number} ttl - Time to live in seconds
 * @param {Function} fetchFn - Function to fetch data (called on cache miss)
 * @returns {Promise<any>} Cached or freshly fetched data
 */
export async function withCache(key, ttl, fetchFn) {
  // Try cache first
  const cached = await cacheService.get(key);
  if (cached !== null) {
    console.log(`[CACHE] ✅ HIT: ${key}`);
    return cached;
  }
  
  // Cache miss, fetch from source
  console.log(`[CACHE] ⚠️  MISS: ${key}`);
  const data = await fetchFn();
  
  // Store in cache
  if (data !== null && data !== undefined) {
    await cacheService.set(key, data, ttl);
    console.log(`[CACHE] 💾 STORED: ${key} (TTL: ${ttl}s)`);
  }
  
  return data;
}

/**
 * Wrap a function that needs shop-specific cache invalidation
 * @param {string} shop - Shop domain
 * @param {string} keyPrefix - Cache key prefix (e.g., 'subscription', 'products')
 * @param {number} ttl - Time to live in seconds
 * @param {Function} fetchFn - Function to fetch data
 * @returns {Promise<any>} Cached or freshly fetched data
 */
export async function withShopCache(shop, keyPrefix, ttl, fetchFn) {
  const key = `${keyPrefix}:${shop}`;
  return withCache(key, ttl, fetchFn);
}

/**
 * Generate cache key for paginated results
 * @param {string} prefix - Key prefix
 * @param {object} params - Query parameters (page, limit, filters, etc.)
 * @returns {string} Cache key
 */
export function generatePaginationKey(prefix, params) {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}:${params[key]}`)
    .join('|');
  
  return `${prefix}:${sortedParams}`;
}

/**
 * Cache TTL presets (in seconds)
 */
export const CACHE_TTL = {
  VERY_SHORT: 60,        // 1 minute - frequently changing data
  SHORT: 300,            // 5 minutes - default
  MEDIUM: 900,           // 15 minutes - semi-static data
  LONG: 3600,            // 1 hour - static data
  VERY_LONG: 86400,      // 24 hours - rarely changing data
};

