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
    // TEST MODE: 10 minutes for testing, comment out for production
    this.testMode = process.env.DIGEST_TEST_MODE === 'true';
    this.testInterval = '*/10 * * * *'; // Every 10 minutes
    this.productionSchedule = '0 9 * * 1'; // Every Monday at 9 AM
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
      console.log(`[PRODUCT-DIGEST] 📧 Running digest job - ${modeLabel}`);
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
      // Find all shops with active subscriptions
      const shops = await Shop.find({
        isActive: true,
        accessToken: { $exists: true, $ne: null, $ne: 'jwt-pending' }
      }).lean();

      console.log(`[PRODUCT-DIGEST] Found ${shops.length} active shops`);

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

      // Skip if less than threshold (default: 5 products)
      const minThreshold = parseInt(process.env.DIGEST_MIN_THRESHOLD) || 5;
      if (changes.length < minThreshold && !this.testMode) {
        console.log(`[PRODUCT-DIGEST] Skipping ${shop.shop} - only ${changes.length} changes (threshold: ${minThreshold})`);
        return { success: true, skipped: true, reason: 'below_threshold' };
      }

      // Skip if no changes at all
      if (changes.length === 0) {
        console.log(`[PRODUCT-DIGEST] Skipping ${shop.shop} - no changes`);
        return { success: true, skipped: true, reason: 'no_changes' };
      }

      console.log(`[PRODUCT-DIGEST] Sending digest to ${shop.shop} with ${changes.length} products`);

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
        console.log(`[PRODUCT-DIGEST] ✅ Marked ${changes.length} changes as notified for ${shop.shop}`);
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
    console.log('[PRODUCT-DIGEST] 🧪 Manual trigger initiated');
    
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

