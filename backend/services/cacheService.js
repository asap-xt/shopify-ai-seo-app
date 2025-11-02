// backend/services/cacheService.js
// Redis caching service for reducing database load
// PHASE 3: Database Optimization - Caching Layer

import Redis from 'ioredis';

class CacheService {
  constructor() {
    this.redis = null;
    this.enabled = !!process.env.REDIS_URL;
    
    if (this.enabled) {
      this.redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });
      
      this.redis.on('connect', () => console.log('[CACHE] ✅ Redis connected'));
      this.redis.on('error', (err) => console.error('[CACHE] ❌ Redis error:', err.message));
      this.redis.on('close', () => console.warn('[CACHE] ⚠️  Redis connection closed'));
      this.redis.on('reconnecting', () => console.log('[CACHE] 🔄 Redis reconnecting...'));
    } else {
      console.warn('[CACHE] ⚠️  Redis not configured (REDIS_URL missing), caching disabled');
      console.warn('[CACHE] ℹ️  Add Redis on Railway: railway add redis');
    }
  }

  async connect() {
    if (this.enabled && !this.redis.status.includes('connect')) {
      try {
        await this.redis.connect();
        console.log('[CACHE] ✅ Redis connection established');
      } catch (error) {
        console.error('[CACHE] ❌ Failed to connect to Redis:', error.message);
        this.enabled = false; // Disable caching if connection fails
      }
    }
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any|null>} Cached value or null
   */
  async get(key) {
    if (!this.enabled) return null;
    
    try {
      const value = await this.redis.get(key);
      if (value) {
        return JSON.parse(value);
      }
      return null;
    } catch (error) {
      console.error('[CACHE] Get error:', error.message);
      return null; // Fail silently, don't break app
    }
  }

  /**
   * Set value in cache with TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttlSeconds - Time to live in seconds (default: 5 minutes)
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, ttlSeconds = 300) {
    if (!this.enabled) return false;
    
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('[CACHE] Set error:', error.message);
      return false;
    }
  }

  /**
   * Delete key from cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async del(key) {
    if (!this.enabled) return false;
    
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      console.error('[CACHE] Delete error:', error.message);
      return false;
    }
  }

  /**
   * Delete multiple keys matching a pattern
   * @param {string} pattern - Key pattern (e.g., 'shop:*')
   * @returns {Promise<number>} Number of keys deleted
   */
  async delPattern(pattern) {
    if (!this.enabled) return 0;
    
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        return keys.length;
      }
      return 0;
    } catch (error) {
      console.error('[CACHE] Delete pattern error:', error.message);
      return 0;
    }
  }

  /**
   * Invalidate all cache for a shop
   * @param {string} shop - Shop domain
   * @returns {Promise<number>} Total keys deleted
   */
  async invalidateShop(shop) {
    if (!this.enabled) return 0;
    
    const patterns = [
      `subscription:${shop}`,
      `plan:${shop}`,
      `billing:info:${shop}`,  // CRITICAL: Billing info cache
      `dashboard:stats:${shop}`,  // Dashboard stats cache
      `products:${shop}:*`,
      `collections:${shop}:*`,
      `stats:${shop}`,
      `sitemap:${shop}`,
      `tokens:${shop}`,
    ];
    
    let totalDeleted = 0;
    
    for (const pattern of patterns) {
      const deleted = await this.delPattern(pattern);
      totalDeleted += deleted;
    }
    
    return totalDeleted;
  }

  /**
   * Get cache statistics
   * @returns {Promise<object|null>} Cache stats
   */
  async getStats() {
    if (!this.enabled) return null;
    
    try {
      const info = await this.redis.info('stats');
      const lines = info.split('\r\n');
      const stats = {};
      
      for (const line of lines) {
        if (line && !line.startsWith('#')) {
          const [key, value] = line.split(':');
          stats[key] = value;
        }
      }
      
      return {
        totalKeys: await this.redis.dbsize(),
        hits: parseInt(stats.keyspace_hits || 0),
        misses: parseInt(stats.keyspace_misses || 0),
        hitRate: stats.keyspace_hits && stats.keyspace_misses
          ? ((parseInt(stats.keyspace_hits) / (parseInt(stats.keyspace_hits) + parseInt(stats.keyspace_misses))) * 100).toFixed(2) + '%'
          : 'N/A',
      };
    } catch (error) {
      console.error('[CACHE] Stats error:', error.message);
      return null;
    }
  }

  /**
   * Check if cache is enabled and connected
   * @returns {boolean} Connection status
   */
  isConnected() {
    return this.enabled && this.redis?.status === 'ready';
  }

  /**
   * Graceful shutdown
   */
  async disconnect() {
    if (this.redis) {
      try {
        await this.redis.quit();
        console.log('[CACHE] 🔒 Redis connection closed gracefully');
      } catch (error) {
        console.error('[CACHE] ❌ Error closing Redis:', error.message);
      }
    }
  }
}

// Singleton instance
const cacheService = new CacheService();

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  await cacheService.disconnect();
});

process.on('SIGINT', async () => {
  await cacheService.disconnect();
});

export default cacheService;

