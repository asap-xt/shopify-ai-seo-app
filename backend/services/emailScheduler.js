// backend/services/emailScheduler.js
// Email scheduler using node-cron for automated email campaigns

import cron from 'node-cron';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import emailService from './emailService.js';

class EmailScheduler {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
  }

  /**
   * Start all scheduled email jobs
   */
  startAll() {
    if (this.isRunning) {
      console.log('📧 Email scheduler already running');
      return;
    }

    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SENDGRID_API_KEY not set - email scheduler will not start');
      return;
    }

    console.log('📧 Starting email scheduler...');

    // Token purchase email check (every day at 10:00 UTC) - Day 3 after installation (72 hours)
    this.jobs.push(
      cron.schedule('0 10 * * *', async () => {
        console.log('⏰ Running token purchase email check...');
        await this.checkTokenPurchaseEmail();
      })
    );

    // App Store rating email check (every day at 10:00 UTC) - Day 6 after installation (144 hours)
    // TESTING: Changed to 8:50 EET (6:50 UTC) for testing. Change back to '0 10 * * *' for production.
    this.jobs.push(
      cron.schedule('50 6 * * *', async () => {
        console.log('⏰ Running app store rating email check...');
        await this.checkAppStoreRatingEmail();
      })
    );

    // Trial expiring check (every day at 9 AM)
    this.jobs.push(
      cron.schedule('0 9 * * *', async () => {
        console.log('⏰ Running trial expiring check...');
        await this.checkTrialExpiring();
      })
    );

    // Weekly digest (every Monday at 10 AM)
    this.jobs.push(
      cron.schedule('0 10 * * 1', async () => {
        console.log('⏰ Sending weekly digests...');
        await this.sendWeeklyDigests();
      })
    );

    // Re-engagement check (every day at 2 PM)
    this.jobs.push(
      cron.schedule('0 14 * * *', async () => {
        console.log('⏰ Running re-engagement check...');
        await this.checkInactiveUsers();
      })
    );

    this.isRunning = true;
    console.log('✅ Email scheduler started');
  }

  /**
   * Check and send token purchase email (Day 3 after installation - 72 hours)
   * Only sends if: 
   * - Installed exactly 72 hours ago (3 days)
   * - Token balance = 0
   * - Not unsubscribed
   * - Hasn't received this email before
   */
  async checkTokenPurchaseEmail() {
    try {
      const now = new Date();
      const EmailLog = (await import('../db/EmailLog.js')).default;
      const TokenBalance = (await import('../db/TokenBalance.js')).default;
      
      // Find stores installed exactly 72 hours ago (3 days)
      // Using a 2-hour window (71-73 hours) to account for cron timing variations
      const day3Stores = await Shop.find({
        createdAt: {
          $gte: new Date(now - 73 * 60 * 60 * 1000), // 73 hours ago
          $lte: new Date(now - 71 * 60 * 60 * 1000)  // 71 hours ago
        }
      }).lean();

      if (day3Stores.length === 0) {
        console.log('[TOKEN-EMAIL] No stores found installed 72 hours ago');
        return;
      }

      console.log(`[TOKEN-EMAIL] Checking ${day3Stores.length} stores installed 72 hours ago`);
      let sentCount = 0;
      let skippedCount = 0;

      for (const store of day3Stores) {
        // Check if email was already sent (prevent duplicates)
        const existingEmailLog = await EmailLog.findOne({
          shop: store.shop,
          type: 'token-purchase',
          status: 'sent'
        }).lean();
        
        if (existingEmailLog) {
          skippedCount++;
          continue;
        }
        
        // Check if user has unsubscribed from marketing emails
        const emailPrefs = store.emailPreferences || {};
        if (emailPrefs.marketingEmails === false) {
          skippedCount++;
          continue;
        }
        
        const subscription = await Subscription.findOne({ shop: store.shop }).lean();
        if (!subscription) {
          skippedCount++;
          continue;
        }

        // Check token balance - if balance > 0, skip email
        const tokenBalance = await TokenBalance.findOne({ shop: store.shop }).lean();
        const currentBalance = tokenBalance?.balance || 0;
        
        if (currentBalance > 0) {
          skippedCount++;
          continue;
        }

        // Send token purchase email
        const result = await emailService.sendTokenPurchaseEmail({ ...store, subscription });
        if (result.success) {
          sentCount++;
          console.log(`[TOKEN-EMAIL] ✅ Sent to ${store.shop}`);
        } else {
          console.error(`[TOKEN-EMAIL] ❌ Failed for ${store.shop}:`, result.error);
        }
        await this.delay(1000); // 1 second delay between emails
      }

      console.log(`[TOKEN-EMAIL] Completed: ${sentCount} sent, ${skippedCount} skipped`);
    } catch (error) {
      console.error('[TOKEN-EMAIL] Error:', error);
    }
  }

  /**
   * Check and send App Store rating email (Day 6 after installation - 144 hours)
   * Only sends if: 
   * - Installed exactly 144 hours ago (6 days)
   * - Subscription is active (after trial)
   * - Hasn't received this email before
   */
  async checkAppStoreRatingEmail() {
    try {
      const now = new Date();
      const EmailLog = (await import('../db/EmailLog.js')).default;
      
      // TESTING: Last 60 minutes (for testing only)
      // PRODUCTION: Find stores installed exactly 144 hours ago (6 days)
      // Change back to: $gte: new Date(now - 145 * 60 * 60 * 1000), $lte: new Date(now - 143 * 60 * 60 * 1000)
      const day6Stores = await Shop.find({
        createdAt: {
          $gte: new Date(now - 60 * 60 * 1000), // 60 minutes ago (testing)
          $lte: new Date(now)                    // Up to now (testing)
        }
      }).lean();

      if (day6Stores.length === 0) {
        console.log('[APPSTORE-RATING] No stores found installed in last 60 minutes');
        return;
      }

      console.log(`[APPSTORE-RATING] Checking ${day6Stores.length} stores installed in last 60 minutes`);
      let sentCount = 0;
      let skippedCount = 0;

      for (const store of day6Stores) {
        // Check if email was already sent (prevent duplicates)
        const existingEmailLog = await EmailLog.findOne({
          shop: store.shop,
          type: 'appstore-rating',
          status: 'sent'
        }).lean();
        
        if (existingEmailLog) {
          skippedCount++;
          continue;
        }
        
        // Check if user has unsubscribed from marketing emails
        const emailPrefs = store.emailPreferences || {};
        if (emailPrefs.marketingEmails === false) {
          skippedCount++;
          continue;
        }
        
        // Check if subscription is active (after trial)
        const subscription = await Subscription.findOne({ shop: store.shop }).lean();
        if (!subscription) {
          skippedCount++;
          continue;
        }
        
        // Only send if subscription is active (not cancelled, not pending)
        if (subscription.status !== 'active' || subscription.cancelledAt) {
          skippedCount++;
          continue;
        }

        // Send app store rating email
        const emailService = (await import('./emailService.js')).default;
        const result = await emailService.sendAppStoreRatingEmail({ ...store, subscription });
        if (result.success) {
          sentCount++;
          console.log(`[APPSTORE-RATING] ✅ Sent to ${store.shop}`);
        } else {
          console.error(`[APPSTORE-RATING] ❌ Failed for ${store.shop}:`, result.error);
        }
        await this.delay(1000); // 1 second delay between emails
      }

      console.log(`[APPSTORE-RATING] Completed: ${sentCount} sent, ${skippedCount} skipped`);
    } catch (error) {
      console.error('[APPSTORE-RATING] Error:', error);
    }
  }

  /**
   * Check trial expiring
   */
  async checkTrialExpiring() {
    try {
      const now = new Date();
      
      // 3 days before expiry
      const threeDaysBefore = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const subscriptions3Days = await Subscription.find({
        status: 'active',
        trialEndsAt: {
          $gte: now,
          $lte: threeDaysBefore
        }
      }).lean();

      for (const subscription of subscriptions3Days) {
        const store = await Shop.findOne({ shop: subscription.shop }).lean();
        if (store) {
          await emailService.sendTrialExpiringEmail({ ...store, subscription }, 3);
          await this.delay(1000);
        }
      }

      // 1 day before expiry
      const oneDayBefore = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
      const subscriptions1Day = await Subscription.find({
        status: 'active',
        trialEndsAt: {
          $gte: now,
          $lte: oneDayBefore
        }
      }).lean();

      for (const subscription of subscriptions1Day) {
        const store = await Shop.findOne({ shop: subscription.shop }).lean();
        if (store) {
          await emailService.sendTrialExpiringEmail({ ...store, subscription }, 1);
          await this.delay(1000);
        }
      }

      console.log('✅ Trial expiring check completed');
    } catch (error) {
      console.error('❌ Trial expiring check error:', error);
    }
  }

  /**
   * Send weekly digest
   */
  async sendWeeklyDigests() {
    try {
      const shops = await Shop.find({}).lean();

      for (const store of shops) {
        const subscription = await Subscription.findOne({ shop: store.shop }).lean();
        
        // Calculate weekly stats
        const weeklyStats = await this.calculateWeeklyStats(store.shop);
        
        await emailService.sendWeeklyDigest({ ...store, subscription }, weeklyStats);
        await this.delay(1000);
      }

      console.log('✅ Weekly digests sent');
    } catch (error) {
      console.error('❌ Weekly digest error:', error);
    }
  }

  /**
   * Check inactive users
   */
  async checkInactiveUsers() {
    try {
      const inactiveDays = 14; // 14 days inactive
      const inactiveDate = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

      const inactiveStores = await Shop.find({
        updatedAt: { $lte: inactiveDate }
      }).lean();

      for (const store of inactiveStores) {
        const subscription = await Subscription.findOne({ shop: store.shop }).lean();
        
        // Skip if subscription is cancelled
        if (subscription && subscription.status === 'cancelled') {
          continue;
        }

        const daysSinceActive = Math.floor((Date.now() - new Date(store.updatedAt)) / (1000 * 60 * 60 * 24));
        await emailService.sendReengagementEmail({ ...store, subscription }, daysSinceActive);
        await this.delay(1000);
      }

      console.log('✅ Inactive users check completed');
    } catch (error) {
      console.error('❌ Inactive users check error:', error);
    }
  }

  /**
   * Calculate weekly stats
   */
  async calculateWeeklyStats(shop) {
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Try to import Product model if it exists
      let productsOptimized = 0;
      let topProducts = [];
      
      try {
        const Product = (await import('../db/Product.js')).default;
        const products = await Product.find({
          shop,
          'seo.lastOptimized': { $gte: weekAgo }
        }).limit(5).select('title seo.lastOptimized').lean();
        
        productsOptimized = products.length;
        topProducts = products.map(p => p.title);
      } catch (e) {
        // Product model might not exist
        console.log('Product model not available for weekly stats');
      }

      // For now, return basic stats
      // In the future, you can add AI query tracking
      return {
        aiQueries: 0, // Can be calculated from AI query logs if you have them
        productsOptimized,
        topProducts,
        seoImprovement: '15%' // Calculate based on your metrics
      };
    } catch (error) {
      console.error('Error calculating weekly stats:', error);
      return {
        aiQueries: 0,
        productsOptimized: 0,
        topProducts: [],
        seoImprovement: '0%'
      };
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stopAll() {
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    this.isRunning = false;
    console.log('⏹️ Email scheduler stopped');
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new EmailScheduler();

