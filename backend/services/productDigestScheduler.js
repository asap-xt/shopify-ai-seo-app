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

    } catch (error) {
      console.error('[PRODUCT-DIGEST] ❌ Digest job error:', error);
    }
  }

  /**
   * Send digest for a single shop
   */
  async sendDigestForShop(shop) {
    try {
      // Check if user has unsubscribed from marketing emails
      const emailPrefs = shop.emailPreferences || {};
      if (emailPrefs.marketingEmails === false) {
        return { success: true, skipped: true, reason: 'unsubscribed' };
      }

      // Get unnotified product changes for this shop
      const changes = await ProductChangeLog.find({
        shop: shop.shop,
        notified: false,
        needsAttention: true
      })
      .sort({ createdAt: -1 })
      .limit(50) // Max 50 products per digest
      .lean();

      // Calculate progressive threshold based on catalog size
      // Smaller catalogs need higher % of changes, larger ones lower %
      // Threshold never drops when catalog grows (no-drop rule)
      const Product = (await import('../db/Product.js')).default;
      const totalProducts = await Product.countDocuments({ shop: shop.shop });
      
      let minThreshold;
      if (this.testMode) {
        minThreshold = 1; // Test mode: always 1
      } else if (process.env.DIGEST_MIN_THRESHOLD) {
        minThreshold = parseInt(process.env.DIGEST_MIN_THRESHOLD); // Manual override
      } else {
        minThreshold = this.calculateProgressiveThreshold(totalProducts);
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
   * Calculate progressive threshold based on catalog size
   * 
   * Tiers:
   *   ≤10 products:   20% of catalog
   *   11-50 products:  15% of catalog
   *   51-100 products: 10% of catalog
   *   101-200 products: 5% of catalog
   *   201+ products:    1% of catalog
   * 
   * Rules:
   *   - Minimum threshold: 1 (always notify if at least 1 change)
   *   - Maximum threshold: 20 (don't require 50 changes for huge catalogs)
   *   - No-drop rule: threshold never decreases as catalog grows
   *     (each tier's result is at least as high as the max of the previous tier boundary)
   */
  calculateProgressiveThreshold(totalProducts) {
    let tierThreshold;

    if (totalProducts <= 10) {
      tierThreshold = Math.ceil(totalProducts * 0.20);
    } else if (totalProducts <= 50) {
      // No-drop: at tier boundary 10→11, previous tier gives ceil(10*0.20)=2
      tierThreshold = Math.max(2, Math.ceil(totalProducts * 0.15));
    } else if (totalProducts <= 100) {
      // No-drop: at tier boundary 50→51, previous tier gives ceil(50*0.15)=8
      tierThreshold = Math.max(8, Math.ceil(totalProducts * 0.10));
    } else if (totalProducts <= 200) {
      // No-drop: at tier boundary 100→101, previous tier gives ceil(100*0.10)=10
      tierThreshold = Math.max(10, Math.ceil(totalProducts * 0.05));
    } else {
      // No-drop: at tier boundary 200→201, previous tier gives ceil(200*0.05)=10
      tierThreshold = Math.max(10, Math.ceil(totalProducts * 0.01));
    }

    // Global bounds: min 1, max 20
    return Math.max(1, Math.min(20, tierThreshold));
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
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

