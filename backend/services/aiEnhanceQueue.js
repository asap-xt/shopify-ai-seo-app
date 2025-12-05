// backend/services/aiEnhanceQueue.js
// Background job processing for AI Enhanced Add-ons
// Based on seoJobQueue.js pattern

import Shop from '../db/Shop.js';
import { dbLogger } from '../utils/logger.js';

class AIEnhanceQueue {
  constructor() {
    this.queue = []; // In-memory queue
    this.processing = false;
    this.currentJob = null;
  }

  /**
   * Add an AI Enhancement job to the queue
   * @param {string} shop - Shop domain
   * @param {Array} products - Array of { productId, languages, title }
   * @param {Function} enhanceFn - Function that enhances one product
   * @returns {Object} Job info
   */
  async addJob(shop, products, enhanceFn) {
    // Check if job already exists in queue
    const existingJob = this.queue.find(job => job.shop === shop);
    if (existingJob) {
      dbLogger.info(`[AI-ENHANCE-QUEUE] Job already queued for shop: ${shop}`);
      return {
        queued: false,
        message: 'Job already in queue',
        position: this.queue.indexOf(existingJob) + 1
      };
    }

    // Check if currently processing this shop
    if (this.currentJob?.shop === shop) {
      dbLogger.info(`[AI-ENHANCE-QUEUE] Job already processing for shop: ${shop}`);
      return {
        queued: false,
        message: 'Job already processing',
        position: 0
      };
    }

    // Create job
    const job = {
      id: `${shop}-aienhance-${Date.now()}`,
      shop,
      products,
      enhanceFn,
      status: 'queued',
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
    dbLogger.info(`[AI-ENHANCE-QUEUE] ✅ Job added for shop: ${shop}, ${products.length} products`);

    // Update shop status in DB
    await this.updateShopStatus(shop, {
      inProgress: true,
      status: 'queued',
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
    dbLogger.info('[AI-ENHANCE-QUEUE] 🔄 Starting queue processing...');

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      this.currentJob = job;

      try {
        dbLogger.info(`[AI-ENHANCE-QUEUE] 🔧 Processing job for shop: ${job.shop} (${job.totalProducts} products)`);
        
        job.status = 'processing';
        job.startedAt = new Date();

        // Process each product
        for (let i = 0; i < job.products.length; i++) {
          const productData = job.products[i];
          
          try {
            // Update status
            await this.updateShopStatus(job.shop, {
              inProgress: true,
              status: 'processing',
              message: `Enhancing ${job.processedProducts + 1}/${job.totalProducts}: ${productData.title || 'Product'}`,
              totalProducts: job.totalProducts,
              processedProducts: job.processedProducts,
              successfulProducts: job.successfulProducts,
              failedProducts: job.failedProducts,
              skippedProducts: job.skippedProducts
            });

            // Call the enhance function
            const result = await job.enhanceFn(productData);
            
            // Check result
            if (result.skipped) {
              job.skippedProducts++;
              if (result.reason) {
                job.skipReasons.push(`${productData.title}: ${result.reason}`);
              }
            } else if (result.success) {
              job.successfulProducts++;
            } else {
              job.failedProducts++;
              if (result.error || result.reason) {
                job.failReasons.push(`${productData.title}: ${result.error || result.reason}`);
              }
            }

          } catch (error) {
            dbLogger.error(`[AI-ENHANCE-QUEUE] Product failed: ${productData.productId}`, error.message);
            
            // Check for token/plan errors that should stop processing
            if (error.status === 402 || error.status === 403 || error.trialRestriction) {
              // Stop processing - token or plan error
              job.status = 'failed';
              job.error = error.message || 'Token or plan restriction';
              job.failedAt = new Date();
              
              await this.updateShopStatus(job.shop, {
                inProgress: false,
                status: 'failed',
                message: error.message || 'Token or plan restriction',
                lastError: error.message,
                failedAt: new Date(),
                totalProducts: job.totalProducts,
                processedProducts: job.processedProducts,
                successfulProducts: job.successfulProducts,
                failedProducts: job.failedProducts,
                skippedProducts: job.skippedProducts
              });
              
              break; // Stop processing this job
            }
            
            job.failedProducts++;
            job.failReasons.push(`${productData.title}: ${error.message}`);
          }

          job.processedProducts++;

          // Update progress every 2 products or on last product
          if (job.processedProducts % 2 === 0 || job.processedProducts === job.totalProducts) {
            await this.updateShopStatus(job.shop, {
              inProgress: true,
              status: 'processing',
              message: `Enhancing ${job.processedProducts}/${job.totalProducts}...`,
              totalProducts: job.totalProducts,
              processedProducts: job.processedProducts,
              successfulProducts: job.successfulProducts,
              failedProducts: job.failedProducts,
              skippedProducts: job.skippedProducts
            });
          }
        }

        // Check if job was stopped due to error
        if (job.status === 'failed') {
          this.currentJob = null;
          continue;
        }

        // Job completed
        job.status = 'completed';
        job.completedAt = new Date();

        const duration = (new Date() - job.startedAt) / 1000;
        dbLogger.info(`[AI-ENHANCE-QUEUE] ✅ Job completed for shop: ${job.shop}`, {
          duration,
          successful: job.successfulProducts,
          failed: job.failedProducts,
          skipped: job.skippedProducts
        });

        // Update shop status to completed
        await this.updateShopStatus(job.shop, {
          inProgress: false,
          status: 'completed',
          message: `Enhanced ${job.successfulProducts} products${job.skippedProducts > 0 ? ` (${job.skippedProducts} skipped)` : ''}${job.failedProducts > 0 ? ` (${job.failedProducts} failed)` : ''}`,
          completedAt: new Date(),
          lastError: null,
          totalProducts: job.totalProducts,
          processedProducts: job.processedProducts,
          successfulProducts: job.successfulProducts,
          failedProducts: job.failedProducts,
          skippedProducts: job.skippedProducts,
          skipReasons: job.skipReasons.slice(0, 10),
          failReasons: job.failReasons.slice(0, 10)
        });

      } catch (error) {
        dbLogger.error(`[AI-ENHANCE-QUEUE] ❌ Job failed for shop: ${job.shop}`, error.message);

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
          failedProducts: job.failedProducts,
          skippedProducts: job.skippedProducts
        });
      }

      this.currentJob = null;
    }

    this.processing = false;
    dbLogger.info('[AI-ENHANCE-QUEUE] ✅ Queue processing completed');
  }

  /**
   * Update shop status in MongoDB
   */
  async updateShopStatus(shop, statusUpdate) {
    try {
      const updateFields = {
        'aiEnhanceJobStatus.inProgress': statusUpdate.inProgress,
        'aiEnhanceJobStatus.status': statusUpdate.status,
        'aiEnhanceJobStatus.message': statusUpdate.message,
        'aiEnhanceJobStatus.updatedAt': new Date()
      };

      if (statusUpdate.queuedAt !== undefined) updateFields['aiEnhanceJobStatus.queuedAt'] = statusUpdate.queuedAt;
      if (statusUpdate.startedAt !== undefined) updateFields['aiEnhanceJobStatus.startedAt'] = statusUpdate.startedAt;
      if (statusUpdate.completedAt !== undefined) updateFields['aiEnhanceJobStatus.completedAt'] = statusUpdate.completedAt;
      if (statusUpdate.failedAt !== undefined) updateFields['aiEnhanceJobStatus.failedAt'] = statusUpdate.failedAt;
      if (statusUpdate.lastError !== undefined) updateFields['aiEnhanceJobStatus.lastError'] = statusUpdate.lastError;
      if (statusUpdate.totalProducts !== undefined) updateFields['aiEnhanceJobStatus.totalProducts'] = statusUpdate.totalProducts;
      if (statusUpdate.processedProducts !== undefined) updateFields['aiEnhanceJobStatus.processedProducts'] = statusUpdate.processedProducts;
      if (statusUpdate.successfulProducts !== undefined) updateFields['aiEnhanceJobStatus.successfulProducts'] = statusUpdate.successfulProducts;
      if (statusUpdate.failedProducts !== undefined) updateFields['aiEnhanceJobStatus.failedProducts'] = statusUpdate.failedProducts;
      if (statusUpdate.skippedProducts !== undefined) updateFields['aiEnhanceJobStatus.skippedProducts'] = statusUpdate.skippedProducts;
      if (statusUpdate.skipReasons !== undefined) updateFields['aiEnhanceJobStatus.skipReasons'] = statusUpdate.skipReasons;
      if (statusUpdate.failReasons !== undefined) updateFields['aiEnhanceJobStatus.failReasons'] = statusUpdate.failReasons;

      await Shop.findOneAndUpdate(
        { shop },
        { $set: updateFields },
        { upsert: true }
      );
    } catch (error) {
      dbLogger.error(`[AI-ENHANCE-QUEUE] Error updating shop status for ${shop}:`, error.message);
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
        message: `Enhancing ${this.currentJob.processedProducts}/${this.currentJob.totalProducts}...`,
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
        message: `Queued (position ${jobIndex + 1})`,
        totalProducts: job.totalProducts,
        processedProducts: 0,
        position: jobIndex + 1
      };
    }

    // Check DB for last status
    try {
      const shopDoc = await Shop.findOne({ shop }).select('aiEnhanceJobStatus').lean();
      if (shopDoc?.aiEnhanceJobStatus) {
        return {
          inProgress: shopDoc.aiEnhanceJobStatus.inProgress || false,
          status: shopDoc.aiEnhanceJobStatus.status || 'idle',
          message: shopDoc.aiEnhanceJobStatus.message || null,
          totalProducts: shopDoc.aiEnhanceJobStatus.totalProducts || 0,
          processedProducts: shopDoc.aiEnhanceJobStatus.processedProducts || 0,
          successfulProducts: shopDoc.aiEnhanceJobStatus.successfulProducts || 0,
          failedProducts: shopDoc.aiEnhanceJobStatus.failedProducts || 0,
          skippedProducts: shopDoc.aiEnhanceJobStatus.skippedProducts || 0,
          skipReasons: shopDoc.aiEnhanceJobStatus.skipReasons || [],
          failReasons: shopDoc.aiEnhanceJobStatus.failReasons || [],
          completedAt: shopDoc.aiEnhanceJobStatus.completedAt || null
        };
      }
    } catch (error) {
      dbLogger.error(`[AI-ENHANCE-QUEUE] Error getting job status for ${shop}:`, error.message);
    }

    return {
      inProgress: false,
      status: 'idle',
      message: null
    };
  }
}

// Singleton instance
const aiEnhanceQueue = new AIEnhanceQueue();

export default aiEnhanceQueue;

