// backend/services/sitemapQueue.js
// PHASE 4: Simplified Queue System (In-Memory)
// Background job processing for sitemap generation without blocking requests

import Shop from '../db/Shop.js';
import { dbLogger } from '../utils/logger.js';

class SitemapQueue {
  constructor() {
    this.queue = []; // In-memory queue (simple array)
    this.processing = false; // Flag to prevent concurrent processing
    this.currentJob = null; // Currently processing job
  }

  /**
   * Add a sitemap generation job to the queue
   * @param {string} shop - Shop domain
   * @param {Function} generatorFn - Function that generates the sitemap
   * @returns {Object} Job info
   */
  async addJob(shop, generatorFn) {
    // Check if job already exists in queue
    const existingJob = this.queue.find(job => job.shop === shop);
    if (existingJob) {
      dbLogger.info(`[QUEUE] Job already queued for shop: ${shop}`);
      return {
        queued: false,
        message: 'Job already in queue',
        position: this.queue.indexOf(existingJob) + 1,
        estimatedTime: (this.queue.indexOf(existingJob) + 1) * 30 // Rough estimate: 30s per job
      };
    }

    // Check if currently processing this shop
    if (this.currentJob?.shop === shop) {
      dbLogger.info(`[QUEUE] Job already processing for shop: ${shop}`);
      return {
        queued: false,
        message: 'Job already processing',
        position: 0,
        estimatedTime: 15 // Rough estimate: halfway through
      };
    }

    // Create job
    const job = {
      id: `${shop}-${Date.now()}`,
      shop,
      generatorFn,
      status: 'queued',
      queuedAt: new Date(),
      attempts: 0,
      maxAttempts: 2
    };

    this.queue.push(job);
    dbLogger.info(`[QUEUE] ✅ Job added for shop: ${shop}, queue length: ${this.queue.length}`);

    // Update shop status in DB
    await this.updateShopStatus(shop, {
      inProgress: true,
      status: 'queued',
      message: `Queued (position ${this.queue.length})`,
      queuedAt: new Date()
    });

    // Start processing if not already running
    if (!this.processing) {
      this.startProcessing();
    }

    return {
      queued: true,
      jobId: job.id,
      position: this.queue.length,
      estimatedTime: this.queue.length * 30 // 30s per job estimate
    };
  }

  /**
   * Start processing the queue
   */
  async startProcessing() {
    if (this.processing) {
      dbLogger.warn('[QUEUE] ⚠️  Processing already running');
      return;
    }

    this.processing = true;
    dbLogger.info('[QUEUE] 🔄 Starting queue processing...');

    while (this.queue.length > 0) {
      const job = this.queue.shift(); // Get first job (FIFO)
      this.currentJob = job;

      try {
        dbLogger.info(`[QUEUE] 🔧 Processing job for shop: ${job.shop} (attempt ${job.attempts + 1}/${job.maxAttempts})`);
        
        // Update status to processing
        await this.updateShopStatus(job.shop, {
          inProgress: true,
          status: 'processing',
          message: 'Generating sitemap...',
          startedAt: new Date()
        });

        job.status = 'processing';
        job.startedAt = new Date();
        job.attempts++;

        // Execute the sitemap generation function
        const result = await job.generatorFn();

        // Job completed successfully
        job.status = 'completed';
        job.completedAt = new Date();
        job.result = result;

        dbLogger.info(`[QUEUE] ✅ Job completed for shop: ${job.shop}`, {
          duration: (new Date() - job.startedAt) / 1000,
          productCount: result.productCount
        });

        // Update shop status to completed
        await this.updateShopStatus(job.shop, {
          inProgress: false,
          status: 'completed',
          message: `Sitemap generated successfully (${result.productCount} products)`,
          completedAt: new Date(),
          lastError: null
        });

      } catch (error) {
        dbLogger.error(`[QUEUE] ❌ Job failed for shop: ${job.shop}`, error.message);

        job.status = 'failed';
        job.error = error.message;
        job.failedAt = new Date();

        // Retry logic
        if (job.attempts < job.maxAttempts) {
          dbLogger.warn(`[QUEUE] 🔄 Retrying job for shop: ${job.shop} (attempt ${job.attempts + 1}/${job.maxAttempts})`);
          
          // Re-add to queue for retry
          this.queue.push(job);
          
          await this.updateShopStatus(job.shop, {
            inProgress: true,
            status: 'retrying',
            message: `Retrying (attempt ${job.attempts + 1}/${job.maxAttempts})...`,
            lastError: error.message
          });
        } else {
          // Max attempts reached, mark as failed
          dbLogger.error(`[QUEUE] ❌ Job permanently failed for shop: ${job.shop} after ${job.maxAttempts} attempts`);
          
          await this.updateShopStatus(job.shop, {
            inProgress: false,
            status: 'failed',
            message: `Generation failed: ${error.message}`,
            lastError: error.message,
            failedAt: new Date()
          });
        }
      }

      this.currentJob = null;
    }

    this.processing = false;
    dbLogger.info('[QUEUE] ✅ Queue processing completed, queue is empty');
  }

  /**
   * Update shop status in MongoDB
   */
  async updateShopStatus(shop, statusUpdate) {
    try {
      await Shop.findOneAndUpdate(
        { shop },
        {
          $set: {
            'sitemapStatus.inProgress': statusUpdate.inProgress,
            'sitemapStatus.status': statusUpdate.status,
            'sitemapStatus.message': statusUpdate.message,
            'sitemapStatus.queuedAt': statusUpdate.queuedAt,
            'sitemapStatus.startedAt': statusUpdate.startedAt,
            'sitemapStatus.completedAt': statusUpdate.completedAt,
            'sitemapStatus.failedAt': statusUpdate.failedAt,
            'sitemapStatus.lastError': statusUpdate.lastError,
            'sitemapStatus.updatedAt': new Date()
          }
        },
        { upsert: true }
      );
    } catch (error) {
      dbLogger.error(`[QUEUE] Error updating shop status for ${shop}:`, error.message);
    }
  }

  /**
   * Get queue status for a shop
   */
  async getJobStatus(shop) {
    // Check if currently processing
    if (this.currentJob?.shop === shop) {
      return {
        status: 'processing',
        message: 'Generating sitemap...',
        position: 0,
        queueLength: this.queue.length
      };
    }

    // Check if in queue
    const jobIndex = this.queue.findIndex(job => job.shop === shop);
    if (jobIndex !== -1) {
      const job = this.queue[jobIndex];
      return {
        status: 'queued',
        message: `Queued (position ${jobIndex + 1} of ${this.queue.length})`,
        position: jobIndex + 1,
        queueLength: this.queue.length,
        estimatedTime: (jobIndex + 1) * 30
      };
    }

    // Check DB for last status
    try {
      const shopDoc = await Shop.findOne({ shop }).select('sitemapStatus').lean();
      if (shopDoc?.sitemapStatus) {
        return {
          status: shopDoc.sitemapStatus.status || 'idle',
          message: shopDoc.sitemapStatus.message || 'No generation in progress',
          lastUpdate: shopDoc.sitemapStatus.updatedAt,
          queueLength: this.queue.length
        };
      }
    } catch (error) {
      dbLogger.error(`[QUEUE] Error getting job status for ${shop}:`, error.message);
    }

    return {
      status: 'idle',
      message: 'No generation in progress',
      queueLength: this.queue.length
    };
  }

  /**
   * Get overall queue stats
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      currentJob: this.currentJob ? {
        shop: this.currentJob.shop,
        status: this.currentJob.status,
        startedAt: this.currentJob.startedAt,
        attempts: this.currentJob.attempts
      } : null,
      queuedJobs: this.queue.map(job => ({
        shop: job.shop,
        queuedAt: job.queuedAt,
        attempts: job.attempts
      }))
    };
  }
}

// Singleton instance
const sitemapQueue = new SitemapQueue();

export default sitemapQueue;

