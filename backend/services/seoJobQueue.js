// backend/services/seoJobQueue.js
// Background job processing for SEO Generate + Apply combined operations
// Based on sitemapQueue.js pattern

import Shop from '../db/Shop.js';
import { dbLogger } from '../utils/logger.js';
import emailService from './emailService.js';

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
   * OPTIMIZED: Processes products in batches of 2 for ~2x speedup
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
        const startTime = Date.now();
        
        // Reset cancelled flag at start
        await Shop.findOneAndUpdate(
          { shop: job.shop },
          { $set: { 'seoJobStatus.cancelled': false } }
        );
        
        // Helper to check if job was cancelled
        const checkCancelled = async () => {
          try {
            const shopDoc = await Shop.findOne({ shop: job.shop }).select('seoJobStatus.cancelled').lean();
            return shopDoc?.seoJobStatus?.cancelled === true;
          } catch (err) {
            return false;
          }
        };
        
        // Helper to calculate and update progress
        const updateProgress = async (current, total) => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const avgTimePerProduct = current > 0 ? elapsed / current : 1.3; // Default estimate: 1.3s
          const remaining = Math.ceil((total - current) * avgTimePerProduct);
          
            await this.updateShopStatus(job.shop, {
              inProgress: true,
            status: 'processing',
            phase: 'processing',
            message: `Processing ${current}/${total} products`,
            totalProducts: total,
            processedProducts: current,
              successfulProducts: job.successfulProducts,
              failedProducts: job.failedProducts,
            skippedProducts: job.skippedProducts,
            progress: {
              current,
              total,
              percent: Math.round((current / total) * 100),
              elapsedSeconds: elapsed,
              remainingSeconds: remaining,
              startedAt: new Date(startTime)
            }
          });
        };

        // OPTIMIZATION: Process products in batches of 2 for parallel execution
        const BATCH_SIZE = 2;
        const BATCH_DELAY = 300; // ms between batches

        for (let batchStart = 0; batchStart < job.products.length; batchStart += BATCH_SIZE) {
          // Check for cancellation at start of each batch
          if (await checkCancelled()) {
            dbLogger.info(`[SEO-JOB-QUEUE] Job cancelled for shop: ${job.shop} after ${job.processedProducts} products`);
            throw new Error('CANCELLED_BY_USER');
          }
          
          const batch = job.products.slice(batchStart, batchStart + BATCH_SIZE);
          
          // Update progress before batch
          job.phase = 'processing';
          await updateProgress(job.processedProducts, job.totalProducts);

          // Process batch in parallel - each product goes through Generate then Apply
          const batchPromises = batch.map(async (productData) => {
            try {
              // Phase 1: Generate
            const generateResult = await job.generateFn(productData);
            
              // Check if skipped
            if (generateResult.skipped) {
                return { productData, skipped: true, reason: generateResult.reason };
            }

            // Check if generate failed
            if (!generateResult.success) {
                return { productData, failed: true, error: generateResult.error || generateResult.reason };
            }

            // Phase 2: Apply
              await job.applyFn(productData, generateResult.data);
              return { productData, success: true };

            } catch (error) {
              return { productData, failed: true, error: error.message };
            }
          });

          // Wait for all products in batch to complete
          const batchResults = await Promise.all(batchPromises);

          // Process batch results
          for (const result of batchResults) {
            if (result.skipped) {
              job.skippedProducts++;
              if (result.reason) {
                job.skipReasons.push(`${result.productData.title || result.productData.productId}: ${result.reason}`);
              }
            } else if (result.success) {
            job.successfulProducts++;
            } else if (result.failed) {
            job.failedProducts++;
              if (result.error) {
                job.failReasons.push(`${result.productData.title || result.productData.productId}: ${result.error}`);
              }
              dbLogger.error(`[SEO-JOB-QUEUE] Product failed: ${result.productData.productId}`, result.error);
          }
          job.processedProducts++;
          }

          // Small delay between batches
          if (batchStart + BATCH_SIZE < job.products.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
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
          skipped: job.skippedProducts,
          avgPerProduct: (duration / job.totalProducts).toFixed(2) + 's'
        });

        // Update shop status to completed
        await this.updateShopStatus(job.shop, {
          inProgress: false,
          status: 'completed',
          phase: null,
          message: `Completed: ${job.successfulProducts} optimized${job.skippedProducts > 0 ? `, ${job.skippedProducts} skipped` : ''}${job.failedProducts > 0 ? `, ${job.failedProducts} failed` : ''} in ${duration.toFixed(1)}s`,
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
        
        // Send email notification if job took more than 2 minutes
        if (duration > 120) {
          try {
            const shopDoc = await Shop.findOne({ shop: job.shop }).lean();
            if (shopDoc?.email) {
              await emailService.sendJobCompletedEmail(shopDoc, {
                type: 'seo',
                successful: job.successfulProducts,
                failed: job.failedProducts,
                skipped: job.skippedProducts,
                duration: duration,
                itemType: 'products',
                failReasons: job.failReasons?.slice(0, 5) || [],
                skipReasons: job.skipReasons?.slice(0, 5) || []
              });
            }
          } catch (emailErr) {
            dbLogger.error(`[SEO-JOB-QUEUE] Failed to send completion email: ${emailErr.message}`);
          }
        }

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
      
      // Enhanced progress tracking
      if (statusUpdate.progress) {
        updateFields['seoJobStatus.progress.current'] = statusUpdate.progress.current;
        updateFields['seoJobStatus.progress.total'] = statusUpdate.progress.total;
        updateFields['seoJobStatus.progress.percent'] = statusUpdate.progress.percent;
        updateFields['seoJobStatus.progress.elapsedSeconds'] = statusUpdate.progress.elapsedSeconds;
        updateFields['seoJobStatus.progress.remainingSeconds'] = statusUpdate.progress.remainingSeconds;
        updateFields['seoJobStatus.progress.startedAt'] = statusUpdate.progress.startedAt;
      }

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

