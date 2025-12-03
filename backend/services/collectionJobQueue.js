// backend/services/collectionJobQueue.js
// Background job processing for Collection SEO (Generate + Apply) and AI Enhancement
// Based on seoJobQueue.js pattern

import Shop from '../db/Shop.js';
import { dbLogger } from '../utils/logger.js';

class CollectionJobQueue {
  constructor() {
    this.queue = []; // In-memory queue
    this.processing = false;
    this.currentJob = null;
  }

  /**
   * Add a Collection SEO job to the queue
   * @param {string} shop - Shop domain
   * @param {Array} collections - Array of { collectionId, languages, title }
   * @param {string} jobType - 'seo' or 'aiEnhance'
   * @param {Function} processFn - Function that processes one collection
   * @returns {Object} Job info
   */
  async addJob(shop, collections, jobType, processFn) {
    const statusField = jobType === 'aiEnhance' ? 'collectionAiEnhanceJobStatus' : 'collectionSeoJobStatus';
    
    // Check if job already exists in queue
    const existingJob = this.queue.find(job => job.shop === shop && job.jobType === jobType);
    if (existingJob) {
      dbLogger.info(`[COLLECTION-QUEUE] ${jobType} job already queued for shop: ${shop}`);
      return {
        queued: false,
        message: 'Job already in queue',
        position: this.queue.indexOf(existingJob) + 1
      };
    }

    // Check if currently processing this shop with same job type
    if (this.currentJob?.shop === shop && this.currentJob?.jobType === jobType) {
      dbLogger.info(`[COLLECTION-QUEUE] ${jobType} job already processing for shop: ${shop}`);
      return {
        queued: false,
        message: 'Job already processing',
        position: 0
      };
    }

    // Create job
    const job = {
      id: `${shop}-collection-${jobType}-${Date.now()}`,
      shop,
      collections,
      jobType,
      processFn,
      statusField,
      status: 'queued',
      queuedAt: new Date(),
      totalCollections: collections.length,
      processedCollections: 0,
      successfulCollections: 0,
      failedCollections: 0,
      skippedCollections: 0
    };

    this.queue.push(job);
    dbLogger.info(`[COLLECTION-QUEUE] ✅ ${jobType} job added for shop: ${shop}, ${collections.length} collections`);

    // Update shop status in DB
    await this.updateShopStatus(shop, statusField, {
      inProgress: true,
      status: 'queued',
      message: `Queued (${collections.length} collections)`,
      queuedAt: new Date(),
      totalCollections: collections.length,
      processedCollections: 0,
      successfulCollections: 0,
      failedCollections: 0,
      skippedCollections: 0
    });

    // Start processing if not already running
    if (!this.processing) {
      this.startProcessing();
    }

    return {
      queued: true,
      jobId: job.id,
      position: this.queue.length,
      totalCollections: collections.length
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
    dbLogger.info('[COLLECTION-QUEUE] 🔄 Starting queue processing...');

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      this.currentJob = job;

      try {
        dbLogger.info(`[COLLECTION-QUEUE] 🔧 Processing ${job.jobType} job for shop: ${job.shop} (${job.totalCollections} collections)`);
        
        job.status = 'processing';
        job.startedAt = new Date();

        // Process each collection
        for (let i = 0; i < job.collections.length; i++) {
          const collectionData = job.collections[i];
          
          try {
            // Update status
            await this.updateShopStatus(job.shop, job.statusField, {
              inProgress: true,
              status: 'processing',
              message: `Processing ${job.processedCollections + 1}/${job.totalCollections}: ${collectionData.title || 'Collection'}`,
              totalCollections: job.totalCollections,
              processedCollections: job.processedCollections,
              successfulCollections: job.successfulCollections,
              failedCollections: job.failedCollections,
              skippedCollections: job.skippedCollections
            });

            // Call the process function
            const result = await job.processFn(collectionData);
            
            // Check result
            if (result.skipped) {
              job.skippedCollections++;
            } else if (result.success) {
              job.successfulCollections++;
            } else {
              job.failedCollections++;
            }

          } catch (error) {
            dbLogger.error(`[COLLECTION-QUEUE] Collection failed: ${collectionData.collectionId}`, error.message);
            
            // Check for token/plan errors that should stop processing
            if (error.status === 402 || error.status === 403 || error.trialRestriction) {
              job.status = 'failed';
              job.error = error.message || 'Token or plan restriction';
              job.failedAt = new Date();
              
              await this.updateShopStatus(job.shop, job.statusField, {
                inProgress: false,
                status: 'failed',
                message: error.message || 'Token or plan restriction',
                lastError: error.message,
                failedAt: new Date(),
                totalCollections: job.totalCollections,
                processedCollections: job.processedCollections,
                successfulCollections: job.successfulCollections,
                failedCollections: job.failedCollections,
                skippedCollections: job.skippedCollections
              });
              
              break; // Stop processing this job
            }
            
            job.failedCollections++;
          }

          job.processedCollections++;

          // Update progress every 2 collections or on last collection
          if (job.processedCollections % 2 === 0 || job.processedCollections === job.totalCollections) {
            await this.updateShopStatus(job.shop, job.statusField, {
              inProgress: true,
              status: 'processing',
              message: `Processing ${job.processedCollections}/${job.totalCollections}...`,
              totalCollections: job.totalCollections,
              processedCollections: job.processedCollections,
              successfulCollections: job.successfulCollections,
              failedCollections: job.failedCollections,
              skippedCollections: job.skippedCollections
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
        dbLogger.info(`[COLLECTION-QUEUE] ✅ ${job.jobType} job completed for shop: ${job.shop}`, {
          duration,
          successful: job.successfulCollections,
          failed: job.failedCollections,
          skipped: job.skippedCollections
        });

        const statusMessage = job.jobType === 'aiEnhance' 
          ? `Enhanced ${job.successfulCollections} collections`
          : `Optimized ${job.successfulCollections} collections`;

        await this.updateShopStatus(job.shop, job.statusField, {
          inProgress: false,
          status: 'completed',
          message: `${statusMessage}${job.skippedCollections > 0 ? ` (${job.skippedCollections} skipped)` : ''}${job.failedCollections > 0 ? ` (${job.failedCollections} failed)` : ''}`,
          completedAt: new Date(),
          lastError: null,
          totalCollections: job.totalCollections,
          processedCollections: job.processedCollections,
          successfulCollections: job.successfulCollections,
          failedCollections: job.failedCollections,
          skippedCollections: job.skippedCollections
        });

      } catch (error) {
        dbLogger.error(`[COLLECTION-QUEUE] ❌ ${job.jobType} job failed for shop: ${job.shop}`, error.message);

        job.status = 'failed';
        job.error = error.message;
        job.failedAt = new Date();

        await this.updateShopStatus(job.shop, job.statusField, {
          inProgress: false,
          status: 'failed',
          message: `Failed: ${error.message}`,
          lastError: error.message,
          failedAt: new Date(),
          totalCollections: job.totalCollections,
          processedCollections: job.processedCollections,
          successfulCollections: job.successfulCollections,
          failedCollections: job.failedCollections,
          skippedCollections: job.skippedCollections
        });
      }

      this.currentJob = null;
    }

    this.processing = false;
    dbLogger.info('[COLLECTION-QUEUE] ✅ Queue processing completed');
  }

  /**
   * Update shop status in MongoDB
   */
  async updateShopStatus(shop, statusField, statusUpdate) {
    try {
      const updateFields = {};
      updateFields[`${statusField}.inProgress`] = statusUpdate.inProgress;
      updateFields[`${statusField}.status`] = statusUpdate.status;
      updateFields[`${statusField}.message`] = statusUpdate.message;
      updateFields[`${statusField}.updatedAt`] = new Date();

      if (statusUpdate.queuedAt !== undefined) updateFields[`${statusField}.queuedAt`] = statusUpdate.queuedAt;
      if (statusUpdate.startedAt !== undefined) updateFields[`${statusField}.startedAt`] = statusUpdate.startedAt;
      if (statusUpdate.completedAt !== undefined) updateFields[`${statusField}.completedAt`] = statusUpdate.completedAt;
      if (statusUpdate.failedAt !== undefined) updateFields[`${statusField}.failedAt`] = statusUpdate.failedAt;
      if (statusUpdate.lastError !== undefined) updateFields[`${statusField}.lastError`] = statusUpdate.lastError;
      if (statusUpdate.totalCollections !== undefined) updateFields[`${statusField}.totalCollections`] = statusUpdate.totalCollections;
      if (statusUpdate.processedCollections !== undefined) updateFields[`${statusField}.processedCollections`] = statusUpdate.processedCollections;
      if (statusUpdate.successfulCollections !== undefined) updateFields[`${statusField}.successfulCollections`] = statusUpdate.successfulCollections;
      if (statusUpdate.failedCollections !== undefined) updateFields[`${statusField}.failedCollections`] = statusUpdate.failedCollections;
      if (statusUpdate.skippedCollections !== undefined) updateFields[`${statusField}.skippedCollections`] = statusUpdate.skippedCollections;

      await Shop.findOneAndUpdate(
        { shop },
        { $set: updateFields },
        { upsert: true }
      );
    } catch (error) {
      dbLogger.error(`[COLLECTION-QUEUE] Error updating shop status for ${shop}:`, error.message);
    }
  }

  /**
   * Get job status for a shop
   */
  async getJobStatus(shop, jobType) {
    const statusField = jobType === 'aiEnhance' ? 'collectionAiEnhanceJobStatus' : 'collectionSeoJobStatus';
    
    // Check if currently processing
    if (this.currentJob?.shop === shop && this.currentJob?.jobType === jobType) {
      return {
        inProgress: true,
        status: 'processing',
        message: `Processing ${this.currentJob.processedCollections}/${this.currentJob.totalCollections}...`,
        totalCollections: this.currentJob.totalCollections,
        processedCollections: this.currentJob.processedCollections,
        successfulCollections: this.currentJob.successfulCollections,
        failedCollections: this.currentJob.failedCollections,
        skippedCollections: this.currentJob.skippedCollections,
        position: 0
      };
    }

    // Check if in queue
    const jobIndex = this.queue.findIndex(job => job.shop === shop && job.jobType === jobType);
    if (jobIndex !== -1) {
      const job = this.queue[jobIndex];
      return {
        inProgress: true,
        status: 'queued',
        message: `Queued (position ${jobIndex + 1})`,
        totalCollections: job.totalCollections,
        processedCollections: 0,
        position: jobIndex + 1
      };
    }

    // Check DB for last status
    try {
      const shopDoc = await Shop.findOne({ shop }).select(statusField).lean();
      const status = shopDoc?.[statusField];
      if (status) {
        return {
          inProgress: status.inProgress || false,
          status: status.status || 'idle',
          message: status.message || null,
          totalCollections: status.totalCollections || 0,
          processedCollections: status.processedCollections || 0,
          successfulCollections: status.successfulCollections || 0,
          failedCollections: status.failedCollections || 0,
          skippedCollections: status.skippedCollections || 0,
          completedAt: status.completedAt || null
        };
      }
    } catch (error) {
      dbLogger.error(`[COLLECTION-QUEUE] Error getting job status for ${shop}:`, error.message);
    }

    return {
      inProgress: false,
      status: 'idle',
      message: null
    };
  }
}

// Singleton instance
const collectionJobQueue = new CollectionJobQueue();

export default collectionJobQueue;

