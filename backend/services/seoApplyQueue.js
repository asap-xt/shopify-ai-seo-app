// backend/services/seoApplyQueue.js
// Background job processing for SEO Apply batch operations
// Based on sitemapQueue.js pattern

import Shop from '../db/Shop.js';
import { dbLogger } from '../utils/logger.js';

class SeoApplyQueue {
  constructor() {
    this.queue = []; // In-memory queue
    this.processing = false;
    this.currentJob = null;
  }

  /**
   * Add a SEO apply batch job to the queue
   * @param {string} shop - Shop domain
   * @param {Array} products - Array of { productId, results, options }
   * @param {Function} applyFn - Function that applies SEO for one product
   * @returns {Object} Job info
   */
  async addJob(shop, products, applyFn) {
    // Check if job already exists in queue
    const existingJob = this.queue.find(job => job.shop === shop);
    if (existingJob) {
      dbLogger.info(`[SEO-APPLY-QUEUE] Job already queued for shop: ${shop}`);
      return {
        queued: false,
        message: 'Job already in queue',
        position: this.queue.indexOf(existingJob) + 1
      };
    }

    // Check if currently processing this shop
    if (this.currentJob?.shop === shop) {
      dbLogger.info(`[SEO-APPLY-QUEUE] Job already processing for shop: ${shop}`);
      return {
        queued: false,
        message: 'Job already processing',
        position: 0
      };
    }

    // Create job
    const job = {
      id: `${shop}-apply-${Date.now()}`,
      shop,
      products,
      applyFn,
      status: 'queued',
      queuedAt: new Date(),
      totalProducts: products.length,
      processedProducts: 0,
      successfulProducts: 0,
      failedProducts: 0
    };

    this.queue.push(job);
    dbLogger.info(`[SEO-APPLY-QUEUE] ✅ Job added for shop: ${shop}, ${products.length} products`);

    // Update shop status in DB
    await this.updateShopStatus(shop, {
      inProgress: true,
      status: 'queued',
      message: `Queued (${products.length} products)`,
      queuedAt: new Date(),
      totalProducts: products.length,
      processedProducts: 0,
      successfulProducts: 0,
      failedProducts: 0
    });

    // Start processing if not already running
    if (!this.processing) {
      this.startProcessing();
    }

    return {
      queued: true,
      jobId: job.id,
      position: this.queue.length,
      totalProducts: products.length
    };
  }

  /**
   * Start processing the queue
   */
  async startProcessing() {
    if (this.processing) {
      return;
    }

    this.processing = true;
    dbLogger.info('[SEO-APPLY-QUEUE] 🔄 Starting queue processing...');

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      this.currentJob = job;

      try {
        dbLogger.info(`[SEO-APPLY-QUEUE] 🔧 Processing job for shop: ${job.shop} (${job.totalProducts} products)`);
        
        // Update status to processing
        await this.updateShopStatus(job.shop, {
          inProgress: true,
          status: 'processing',
          message: `Processing 0/${job.totalProducts} products...`,
          startedAt: new Date(),
          totalProducts: job.totalProducts,
          processedProducts: 0,
          successfulProducts: 0,
          failedProducts: 0
        });

        job.status = 'processing';
        job.startedAt = new Date();

        // Process each product
        for (let i = 0; i < job.products.length; i++) {
          const productData = job.products[i];
          
          try {
            await job.applyFn(productData);
            job.successfulProducts++;
          } catch (error) {
            dbLogger.error(`[SEO-APPLY-QUEUE] Product failed: ${productData.productId}`, error.message);
            job.failedProducts++;
          }

          job.processedProducts++;

          // Update progress every 5 products or on last product
          if (job.processedProducts % 5 === 0 || job.processedProducts === job.totalProducts) {
            await this.updateShopStatus(job.shop, {
              inProgress: true,
              status: 'processing',
              message: `Processing ${job.processedProducts}/${job.totalProducts} products...`,
              totalProducts: job.totalProducts,
              processedProducts: job.processedProducts,
              successfulProducts: job.successfulProducts,
              failedProducts: job.failedProducts
            });
          }
        }

        // Job completed
        job.status = 'completed';
        job.completedAt = new Date();

        const duration = (new Date() - job.startedAt) / 1000;
        dbLogger.info(`[SEO-APPLY-QUEUE] ✅ Job completed for shop: ${job.shop}`, {
          duration,
          successful: job.successfulProducts,
          failed: job.failedProducts
        });

        // Update shop status to completed
        await this.updateShopStatus(job.shop, {
          inProgress: false,
          status: 'completed',
          message: `Applied to ${job.successfulProducts} products${job.failedProducts > 0 ? ` (${job.failedProducts} failed)` : ''}`,
          completedAt: new Date(),
          lastError: null,
          totalProducts: job.totalProducts,
          processedProducts: job.processedProducts,
          successfulProducts: job.successfulProducts,
          failedProducts: job.failedProducts
        });

      } catch (error) {
        dbLogger.error(`[SEO-APPLY-QUEUE] ❌ Job failed for shop: ${job.shop}`, error.message);

        job.status = 'failed';
        job.error = error.message;
        job.failedAt = new Date();

        await this.updateShopStatus(job.shop, {
          inProgress: false,
          status: 'failed',
          message: `Failed: ${error.message}`,
          lastError: error.message,
          failedAt: new Date(),
          totalProducts: job.totalProducts,
          processedProducts: job.processedProducts,
          successfulProducts: job.successfulProducts,
          failedProducts: job.failedProducts
        });
      }

      this.currentJob = null;
    }

    this.processing = false;
    dbLogger.info('[SEO-APPLY-QUEUE] ✅ Queue processing completed');
  }

  /**
   * Update shop status in MongoDB
   */
  async updateShopStatus(shop, statusUpdate) {
    try {
      const updateFields = {
        'applyStatus.inProgress': statusUpdate.inProgress,
        'applyStatus.status': statusUpdate.status,
        'applyStatus.message': statusUpdate.message,
        'applyStatus.updatedAt': new Date()
      };

      // Only set these if provided
      if (statusUpdate.queuedAt !== undefined) updateFields['applyStatus.queuedAt'] = statusUpdate.queuedAt;
      if (statusUpdate.startedAt !== undefined) updateFields['applyStatus.startedAt'] = statusUpdate.startedAt;
      if (statusUpdate.completedAt !== undefined) updateFields['applyStatus.completedAt'] = statusUpdate.completedAt;
      if (statusUpdate.failedAt !== undefined) updateFields['applyStatus.failedAt'] = statusUpdate.failedAt;
      if (statusUpdate.lastError !== undefined) updateFields['applyStatus.lastError'] = statusUpdate.lastError;
      if (statusUpdate.totalProducts !== undefined) updateFields['applyStatus.totalProducts'] = statusUpdate.totalProducts;
      if (statusUpdate.processedProducts !== undefined) updateFields['applyStatus.processedProducts'] = statusUpdate.processedProducts;
      if (statusUpdate.successfulProducts !== undefined) updateFields['applyStatus.successfulProducts'] = statusUpdate.successfulProducts;
      if (statusUpdate.failedProducts !== undefined) updateFields['applyStatus.failedProducts'] = statusUpdate.failedProducts;

      await Shop.findOneAndUpdate(
        { shop },
        { $set: updateFields },
        { upsert: true }
      );
    } catch (error) {
      dbLogger.error(`[SEO-APPLY-QUEUE] Error updating shop status for ${shop}:`, error.message);
    }
  }

  /**
   * Get job status for a shop
   */
  async getJobStatus(shop) {
    // Check if currently processing
    if (this.currentJob?.shop === shop) {
      return {
        inProgress: true,
        status: 'processing',
        message: `Processing ${this.currentJob.processedProducts}/${this.currentJob.totalProducts} products...`,
        totalProducts: this.currentJob.totalProducts,
        processedProducts: this.currentJob.processedProducts,
        successfulProducts: this.currentJob.successfulProducts,
        failedProducts: this.currentJob.failedProducts,
        position: 0
      };
    }

    // Check if in queue
    const jobIndex = this.queue.findIndex(job => job.shop === shop);
    if (jobIndex !== -1) {
      const job = this.queue[jobIndex];
      return {
        inProgress: true,
        status: 'queued',
        message: `Queued (position ${jobIndex + 1})`,
        totalProducts: job.totalProducts,
        processedProducts: 0,
        position: jobIndex + 1
      };
    }

    // Check DB for last status
    try {
      const shopDoc = await Shop.findOne({ shop }).select('applyStatus').lean();
      if (shopDoc?.applyStatus) {
        return {
          inProgress: shopDoc.applyStatus.inProgress || false,
          status: shopDoc.applyStatus.status || 'idle',
          message: shopDoc.applyStatus.message || null,
          totalProducts: shopDoc.applyStatus.totalProducts || 0,
          processedProducts: shopDoc.applyStatus.processedProducts || 0,
          successfulProducts: shopDoc.applyStatus.successfulProducts || 0,
          failedProducts: shopDoc.applyStatus.failedProducts || 0,
          completedAt: shopDoc.applyStatus.completedAt || null
        };
      }
    } catch (error) {
      dbLogger.error(`[SEO-APPLY-QUEUE] Error getting job status for ${shop}:`, error.message);
    }

    return {
      inProgress: false,
      status: 'idle',
      message: null
    };
  }
}

// Singleton instance
const seoApplyQueue = new SeoApplyQueue();

export default seoApplyQueue;

