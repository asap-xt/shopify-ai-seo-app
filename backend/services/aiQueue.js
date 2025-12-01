// backend/services/aiQueue.js
// Centralized AI API Rate Limiting Service
// PHASE 1 OPTIMIZATION: Prevents rate limit errors and controls costs
// Created: 30 Nov 2024

import PQueue from 'p-queue';

/**
 * AI Queue Service - Manages rate limiting for all AI API calls
 * 
 * Priority Levels:
 * 1 = Highest (real-time user requests, simulations)
 * 3 = Normal (SEO optimization, enhancements)
 * 5 = Low (bulk operations, sitemap generation)
 */
class AIQueue {
  constructor() {
    const IS_PRODUCTION = process.env.NODE_ENV === 'production';
    
    // High Priority Queue - For real-time user interactions
    this.highPriorityQueue = new PQueue({
      concurrency: 3,        // Max 3 parallel calls
      intervalCap: 10,       // Max 10 calls
      interval: 1000,        // per second
      timeout: 30000,        // 30s timeout per job
      throwOnTimeout: true
    });
    
    // Normal Priority Queue - For standard operations
    this.normalQueue = new PQueue({
      concurrency: 2,        // Max 2 parallel calls
      intervalCap: 8,        // Max 8 calls
      interval: 1000,        // per second
      timeout: 30000,        // 30s timeout
      throwOnTimeout: true
    });
    
    // Low Priority Queue - For bulk operations
    this.bulkQueue = new PQueue({
      concurrency: 1,        // Max 1 parallel call (sequential)
      intervalCap: 5,        // Max 5 calls
      interval: 1000,        // per second
      timeout: 60000,        // 60s timeout (bulk can take longer)
      throwOnTimeout: true
    });
    
    // Stats tracking
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      timeoutCalls: 0,
      totalTokens: 0,
      startTime: Date.now()
    };
    
    // Setup event listeners
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    // Track queue events for monitoring
    const setupQueueListeners = (queue, name) => {
      queue.on('error', (error) => {
        console.error(`[AI-QUEUE] ${name} - Queue error:`, error.message);
        this.stats.failedCalls++;
      });
    };
    
    setupQueueListeners(this.highPriorityQueue, 'HIGH');
    setupQueueListeners(this.normalQueue, 'NORMAL');
    setupQueueListeners(this.bulkQueue, 'BULK');
  }
  
  /**
   * Add high priority job (real-time user requests)
   * @param {Function} fn - Async function to execute
   * @param {Object} options - Optional metadata for logging
   * @returns {Promise<any>}
   */
  async addHighPriority(fn, options = {}) {
    return this._addJob(this.highPriorityQueue, fn, { ...options, priority: 'HIGH' });
  }
  
  /**
   * Add normal priority job (standard operations)
   * @param {Function} fn - Async function to execute
   * @param {Object} options - Optional metadata for logging
   * @returns {Promise<any>}
   */
  async add(fn, options = {}) {
    return this._addJob(this.normalQueue, fn, { ...options, priority: 'NORMAL' });
  }
  
  /**
   * Add low priority job (bulk operations)
   * @param {Function} fn - Async function to execute
   * @param {Object} options - Optional metadata for logging
   * @returns {Promise<any>}
   */
  async addBulk(fn, options = {}) {
    return this._addJob(this.bulkQueue, fn, { ...options, priority: 'BULK' });
  }
  
  /**
   * Internal method to add job to queue
   * @private
   */
  async _addJob(queue, fn, options = {}) {
    const startTime = Date.now();
    this.stats.totalCalls++;
    
    try {
      const result = await queue.add(async () => {
        const jobResult = await fn();
        
        // Track token usage if available
        if (jobResult?.usage?.total_tokens) {
          this.stats.totalTokens += jobResult.usage.total_tokens;
        }
        
        return jobResult;
      });
      
      this.stats.successfulCalls++;
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.name === 'TimeoutError') {
        this.stats.timeoutCalls++;
        console.error(`[AI-QUEUE] ${options.priority} - Timeout after ${duration}ms:`, options);
      } else {
        this.stats.failedCalls++;
        console.error(`[AI-QUEUE] ${options.priority} - Job failed:`, error.message, options);
      }
      
      throw error;
    }
  }
  
  /**
   * Get current queue statistics
   * @returns {Object} Stats object
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    const uptimeMinutes = Math.floor(uptime / 60000);
    
    return {
      queues: {
        high: {
          size: this.highPriorityQueue.size,
          pending: this.highPriorityQueue.pending
        },
        normal: {
          size: this.normalQueue.size,
          pending: this.normalQueue.pending
        },
        bulk: {
          size: this.bulkQueue.size,
          pending: this.bulkQueue.pending
        }
      },
      stats: {
        ...this.stats,
        uptime: uptimeMinutes,
        successRate: this.stats.totalCalls > 0 
          ? ((this.stats.successfulCalls / this.stats.totalCalls) * 100).toFixed(2) + '%'
          : 'N/A',
        avgTokensPerCall: this.stats.successfulCalls > 0
          ? Math.round(this.stats.totalTokens / this.stats.successfulCalls)
          : 0
      }
    };
  }
  
  /**
   * Wait for all queues to be idle
   * Useful for graceful shutdown
   * @returns {Promise<void>}
   */
  async onIdle() {
    await Promise.all([
      this.highPriorityQueue.onIdle(),
      this.normalQueue.onIdle(),
      this.bulkQueue.onIdle()
    ]);
  }
  
  /**
   * Clear all queues (emergency use only)
   */
  clearAll() {
    this.highPriorityQueue.clear();
    this.normalQueue.clear();
    this.bulkQueue.clear();
  }
}

// Export singleton instance
export const aiQueue = new AIQueue();
export default aiQueue;

