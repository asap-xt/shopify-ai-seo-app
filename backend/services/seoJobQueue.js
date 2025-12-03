// backend/services/seoJobQueue.js
// Background job processing for SEO Generate + Apply combined operations
// Based on sitemapQueue.js pattern

import Shop from '../db/Shop.js';
import { dbLogger } from '../utils/logger.js';

class SeoJobQueue {
  constructor() {
    this.queue = []; // In-memory queue
    this.processing = false;
    this.currentJob = null;
  }

  /**
   * Add a SEO generate+apply job to the queue
   * @param {string} shop - Shop domain
   * @param {Array} products - Array of { productId, languages, model }
   * @param {Function} generateFn - Function that generates SEO for one product
   * @param {Function} applyFn - Function that applies SEO for one product
   * @returns {Object} Job info
   */
  async addJob(shop, products, generateFn, applyFn) {
    // Check if job already exists in queue
    const existingJob = this.queue.find(job => job.shop === shop);
    if (existingJob) {
      dbLogger.info(`[SEO-JOB-QUEUE] Job already queued for shop: ${shop}`);
      return {
        queued: false,
        message: 'Job already in queue',
        position: this.queue.indexOf(existingJob) + 1
      };
    }

    // Check if currently processing this shop
    if (this.currentJob?.shop === shop) {
      dbLogger.info(`[SEO-JOB-QUEUE] Job already processing for shop: ${shop}`);
      return {
        queued: false,
        message: 'Job already processing',
        position: 0
      };
    }

    // Create job
    const job = {
      id: `${shop}-seo-${Date.now()}`,
      shop,
      products,
      generateFn,
      applyFn,
      status: 'queued',
      phase: null,
      queuedAt: new Date(),
      totalProducts: products.length,
      processedProducts: 0,
      successfulProducts: 0,
      failedProducts: 0,
      skippedProducts: 0,
      skipReasons: [],
      failReasons: []
    };

    this.queue.push(job);
    dbLogger.info(`[SEO-JOB-QUEUE] ✅ Job added for shop: ${shop}, ${products.length} products`);

    // Update shop status in DB
    await this.updateShopStatus(shop, {
      inProgress: true,
      status: 'queued',
      phase: null,
      message: `Queued (${products.length} products)`,
      queuedAt: new Date(),
      totalProducts: products.length,
      processedProducts: 0,
      successfulProducts: 0,
      failedProducts: 0,
      skippedProducts: 0
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
    dbLogger.info('[SEO-JOB-QUEUE] 🔄 Starting queue processing...');

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      this.currentJob = job;

      try {
        dbLogger.info(`[SEO-JOB-QUEUE] 🔧 Processing job for shop: ${job.shop} (${job.totalProducts} products)`);
        
        job.status = 'processing';
        job.startedAt = new Date();

        // Process each product: Generate then Apply
        for (let i = 0; i < job.products.length; i++) {
          const productData = job.products[i];
          
          try {
            // Phase 1: Generate
            job.phase = 'generate';
            await this.updateShopStatus(job.shop, {
              inProgress: true,
              status: 'generating',
              phase: 'generate',
              message: `Generating ${job.processedProducts + 1}/${job.totalProducts}...`,
              totalProducts: job.totalProducts,
              processedProducts: job.processedProducts,
              successfulProducts: job.successfulProducts,
              failedProducts: job.failedProducts,
              skippedProducts: job.skippedProducts
            });

            const generateResult = await job.generateFn(productData);
            
            // Check if skipped (already optimized)
            if (generateResult.skipped) {
              job.skippedProducts++;
              if (generateResult.reason) {
                job.skipReasons.push(`${productData.title || productData.productId}: ${generateResult.reason}`);
              }
              job.processedProducts++;
              continue;
            }

            // Check if generate failed
            if (!generateResult.success) {
              job.failedProducts++;
              if (generateResult.error || generateResult.reason) {
                job.failReasons.push(`${productData.title || productData.productId}: ${generateResult.error || generateResult.reason}`);
              }
              job.processedProducts++;
              continue;
            }

            // Phase 2: Apply
            job.phase = 'apply';
            await this.updateShopStatus(job.shop, {
              inProgress: true,
              status: 'applying',
              phase: 'apply',
              message: `Applying ${job.processedProducts + 1}/${job.totalProducts}...`,
              totalProducts: job.totalProducts,
              processedProducts: job.processedProducts,
              successfulProducts: job.successfulProducts,
              failedProducts: job.failedProducts,
              skippedProducts: job.skippedProducts
            });

            await job.applyFn(productData, generateResult.data);
            job.successfulProducts++;

          } catch (error) {
            dbLogger.error(`[SEO-JOB-QUEUE] Product failed: ${productData.productId}`, error.message);
            job.failedProducts++;
            job.failReasons.push(`${productData.title || productData.productId}: ${error.message}`);
          }

          job.processedProducts++;

          // Update progress every 3 products or on last product
          if (job.processedProducts % 3 === 0 || job.processedProducts === job.totalProducts) {
            await this.updateShopStatus(job.shop, {
              inProgress: true,
              status: job.phase === 'generate' ? 'generating' : 'applying',
              phase: job.phase,
              message: `${job.phase === 'generate' ? 'Generating' : 'Applying'} ${job.processedProducts}/${job.totalProducts}...`,
              totalProducts: job.totalProducts,
              processedProducts: job.processedProducts,
              successfulProducts: job.successfulProducts,
              failedProducts: job.failedProducts,
              skippedProducts: job.skippedProducts
            });
          }
        }

        // Job completed
        job.status = 'completed';
        job.completedAt = new Date();

        const duration = (new Date() - job.startedAt) / 1000;
        dbLogger.info(`[SEO-JOB-QUEUE] ✅ Job completed for shop: ${job.shop}`, {
          duration,
          successful: job.successfulProducts,
          failed: job.failedProducts,
          skipped: job.skippedProducts
        });

        // Update shop status to completed
        await this.updateShopStatus(job.shop, {
          inProgress: false,
          status: 'completed',
          phase: null,
          message: `Completed: ${job.successfulProducts} optimized${job.skippedProducts > 0 ? `, ${job.skippedProducts} skipped` : ''}${job.failedProducts > 0 ? `, ${job.failedProducts} failed` : ''}`,
          completedAt: new Date(),
          lastError: null,
          totalProducts: job.totalProducts,
          processedProducts: job.processedProducts,
          successfulProducts: job.successfulProducts,
          failedProducts: job.failedProducts,
          skippedProducts: job.skippedProducts,
          skipReasons: job.skipReasons.slice(0, 10), // Limit to 10 reasons
          failReasons: job.failReasons.slice(0, 10)
        });

      } catch (error) {
        dbLogger.error(`[SEO-JOB-QUEUE] ❌ Job failed for shop: ${job.shop}`, error.message);

        job.status = 'failed';
        job.error = error.message;
        job.failedAt = new Date();

        await this.updateShopStatus(job.shop, {
          inProgress: false,
          status: 'failed',
          phase: null,
          message: `Failed: ${error.message}`,
          lastError: error.message,
          failedAt: new Date(),
          totalProducts: job.totalProducts,
          processedProducts: job.processedProducts,
          successfulProducts: job.successfulProducts,
          failedProducts: job.failedProducts,
          skippedProducts: job.skippedProducts
        });
      }

      this.currentJob = null;
    }

    this.processing = false;
    dbLogger.info('[SEO-JOB-QUEUE] ✅ Queue processing completed');
  }

  /**
   * Update shop status in MongoDB
   */
  async updateShopStatus(shop, statusUpdate) {
    try {
      const updateFields = {
        'seoJobStatus.inProgress': statusUpdate.inProgress,
        'seoJobStatus.status': statusUpdate.status,
        'seoJobStatus.phase': statusUpdate.phase,
        'seoJobStatus.message': statusUpdate.message,
        'seoJobStatus.updatedAt': new Date()
      };

      if (statusUpdate.queuedAt !== undefined) updateFields['seoJobStatus.queuedAt'] = statusUpdate.queuedAt;
      if (statusUpdate.startedAt !== undefined) updateFields['seoJobStatus.startedAt'] = statusUpdate.startedAt;
      if (statusUpdate.completedAt !== undefined) updateFields['seoJobStatus.completedAt'] = statusUpdate.completedAt;
      if (statusUpdate.failedAt !== undefined) updateFields['seoJobStatus.failedAt'] = statusUpdate.failedAt;
      if (statusUpdate.lastError !== undefined) updateFields['seoJobStatus.lastError'] = statusUpdate.lastError;
      if (statusUpdate.totalProducts !== undefined) updateFields['seoJobStatus.totalProducts'] = statusUpdate.totalProducts;
      if (statusUpdate.processedProducts !== undefined) updateFields['seoJobStatus.processedProducts'] = statusUpdate.processedProducts;
      if (statusUpdate.successfulProducts !== undefined) updateFields['seoJobStatus.successfulProducts'] = statusUpdate.successfulProducts;
      if (statusUpdate.failedProducts !== undefined) updateFields['seoJobStatus.failedProducts'] = statusUpdate.failedProducts;
      if (statusUpdate.skippedProducts !== undefined) updateFields['seoJobStatus.skippedProducts'] = statusUpdate.skippedProducts;
      if (statusUpdate.skipReasons !== undefined) updateFields['seoJobStatus.skipReasons'] = statusUpdate.skipReasons;
      if (statusUpdate.failReasons !== undefined) updateFields['seoJobStatus.failReasons'] = statusUpdate.failReasons;

      await Shop.findOneAndUpdate(
        { shop },
        { $set: updateFields },
        { upsert: true }
      );
    } catch (error) {
      dbLogger.error(`[SEO-JOB-QUEUE] Error updating shop status for ${shop}:`, error.message);
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
        status: this.currentJob.status === 'processing' ? 
          (this.currentJob.phase === 'generate' ? 'generating' : 'applying') : 
          this.currentJob.status,
        phase: this.currentJob.phase,
        message: `${this.currentJob.phase === 'generate' ? 'Generating' : 'Applying'} ${this.currentJob.processedProducts}/${this.currentJob.totalProducts}...`,
        totalProducts: this.currentJob.totalProducts,
        processedProducts: this.currentJob.processedProducts,
        successfulProducts: this.currentJob.successfulProducts,
        failedProducts: this.currentJob.failedProducts,
        skippedProducts: this.currentJob.skippedProducts,
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
        phase: null,
        message: `Queued (position ${jobIndex + 1})`,
        totalProducts: job.totalProducts,
        processedProducts: 0,
        position: jobIndex + 1
      };
    }

    // Check DB for last status
    try {
      const shopDoc = await Shop.findOne({ shop }).select('seoJobStatus').lean();
      if (shopDoc?.seoJobStatus) {
        return {
          inProgress: shopDoc.seoJobStatus.inProgress || false,
          status: shopDoc.seoJobStatus.status || 'idle',
          phase: shopDoc.seoJobStatus.phase || null,
          message: shopDoc.seoJobStatus.message || null,
          totalProducts: shopDoc.seoJobStatus.totalProducts || 0,
          processedProducts: shopDoc.seoJobStatus.processedProducts || 0,
          successfulProducts: shopDoc.seoJobStatus.successfulProducts || 0,
          failedProducts: shopDoc.seoJobStatus.failedProducts || 0,
          skippedProducts: shopDoc.seoJobStatus.skippedProducts || 0,
          skipReasons: shopDoc.seoJobStatus.skipReasons || [],
          failReasons: shopDoc.seoJobStatus.failReasons || [],
          completedAt: shopDoc.seoJobStatus.completedAt || null
        };
      }
    } catch (error) {
      dbLogger.error(`[SEO-JOB-QUEUE] Error getting job status for ${shop}:`, error.message);
    }

    return {
      inProgress: false,
      status: 'idle',
      phase: null,
      message: null
    };
  }
}

// Singleton instance
const seoJobQueue = new SeoJobQueue();

export default seoJobQueue;

