// backend/services/productDigestScheduler.js
// Sends weekly product digest emails to active shops

import cron from 'node-cron';
import mongoose from 'mongoose';
import Shop from '../db/Shop.js';
import ProductChangeLog from '../db/ProductChangeLog.js';
import emailService from './emailService.js';

class ProductDigestScheduler {
  constructor() {
    this.jobs = [];
    // Test mode: DIGEST_TEST_MODE=true (default: false for production)
    // Set DIGEST_TEST_MODE=true in staging Railway environment
    this.testMode = process.env.DIGEST_TEST_MODE === 'true';
    this.testInterval = '*/10 * * * *'; // Every 10 minutes
    this.productionSchedule = '0 9 * * 1'; // Every Monday at 9 AM UTC
  }

  /**
   * Start the digest scheduler
   */
  start() {
    if (!mongoose.connection.readyState) {
      console.warn('[PRODUCT-DIGEST] ⚠️ MongoDB not connected - scheduler will not start');
      return;
    }

    if (!process.env.SENDGRID_API_KEY) {
      console.warn('[PRODUCT-DIGEST] ⚠️ SENDGRID_API_KEY not set - scheduler will not start');
      return;
    }

    const schedule = this.testMode ? this.testInterval : this.productionSchedule;
    const modeLabel = this.testMode ? 'TEST MODE (10 min)' : 'PRODUCTION (Weekly Monday 9AM)';

    // Weekly digest job
    const digestJob = cron.schedule(schedule, async () => {
      await this.sendDigests();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.push(digestJob);
    console.log(`[PRODUCT-DIGEST] ✅ Scheduler started - ${modeLabel}`);
    console.log(`[PRODUCT-DIGEST] Schedule: ${schedule}`);
  }

  /**
   * Send digests to all eligible shops
   */
  async sendDigests() {
    try {
      // Find all shops with valid access tokens (active installations)
      const shops = await Shop.find({
        accessToken: { $exists: true, $ne: null, $ne: '', $ne: 'jwt-pending' }
      }).lean();

      let sent = 0;
      let skipped = 0;
      let errors = 0;

      for (const shop of shops) {
        try {
          const result = await this.sendDigestForShop(shop);
          if (result.success) {
            if (result.skipped) {
              skipped++;
            } else {
              sent++;
            }
          } else {
            errors++;
          }
        } catch (error) {
          console.error(`[PRODUCT-DIGEST] Error for ${shop.shop}:`, error.message);
          errors++;
        }
      }

      console.log(`[PRODUCT-DIGEST] ✅ Digest job complete: ${sent} sent, ${skipped} skipped, ${errors} errors`);
    } catch (error) {
      console.error('[PRODUCT-DIGEST] ❌ Digest job error:', error);
    }
  }

  /**
   * Send digest for a single shop
   */
  async sendDigestForShop(shop) {
    try {
      // Get unnotified product changes for this shop
      const changes = await ProductChangeLog.find({
        shop: shop.shop,
        notified: false,
        needsAttention: true
      })
      .sort({ createdAt: -1 })
      .limit(50) // Max 50 products per digest
      .lean();

      // Calculate dynamic threshold based on total products (10% of total, min 2, max 10)
      const Product = (await import('../db/Product.js')).default;
      const totalProducts = await Product.countDocuments({ shop: shop.shop });
      
      let minThreshold;
      if (this.testMode) {
        minThreshold = 1; // Test mode: always 1
      } else if (process.env.DIGEST_MIN_THRESHOLD) {
        minThreshold = parseInt(process.env.DIGEST_MIN_THRESHOLD); // Manual override
      } else {
        // Dynamic: 10% of total products, minimum 2, maximum 10
        const dynamicThreshold = Math.ceil(totalProducts * 0.1);
        minThreshold = Math.max(2, Math.min(10, dynamicThreshold));
      }
      
      if (changes.length < minThreshold) {
        return { success: true, skipped: true, reason: 'below_threshold' };
      }
      
      // Skip if no changes at all
      if (changes.length === 0) {
        return { success: true, skipped: true, reason: 'no_changes' };
      }

      // Send email
      const result = await emailService.sendWeeklyProductDigest(shop, changes);

      if (result.success && !result.skipped) {
        // Mark changes as notified
        await ProductChangeLog.updateMany(
          {
            shop: shop.shop,
            _id: { $in: changes.map(c => c._id) }
          },
          {
            $set: {
              notified: true,
              notifiedAt: new Date()
            }
          }
        );
        // Marked changes as notified
      }

      return result;
    } catch (error) {
      console.error(`[PRODUCT-DIGEST] Error sending digest for ${shop.shop}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    console.log('[PRODUCT-DIGEST] ⏹️ Scheduler stopped');
  }

  /**
   * Manual trigger for testing
   */
  async triggerNow(shopDomain = null) {
    if (shopDomain) {
      // Send for specific shop
      const shop = await Shop.findOne({ shop: shopDomain }).lean();
      if (!shop) {
        console.error(`[PRODUCT-DIGEST] Shop not found: ${shopDomain}`);
        return { success: false, error: 'Shop not found' };
      }
      return await this.sendDigestForShop(shop);
    } else {
      // Send for all shops
      await this.sendDigests();
      return { success: true };
    }
  }
}

export default new ProductDigestScheduler();

