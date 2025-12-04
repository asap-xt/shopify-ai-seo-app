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
        await this.checkTokenPurchaseEmail();
      })
    );

    // App Store rating email check (every day at 10:00 UTC) - Day 6 after installation (144 hours)
    this.jobs.push(
      cron.schedule('0 10 * * *', async () => {
        await this.checkAppStoreRatingEmail();
      })
    );

    // REMOVED: Trial expiring check - replaced with in-app banner
    // REMOVED: Weekly digest - replaced with Weekly Product Digest
    // REMOVED: Re-engagement check - too aggressive

    this.isRunning = true;
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
      
      // Find stores installed 3-4 days ago (72-96 hours)
      // Check all stores from the last 24 hours that are now 3+ days old
      // This ensures we catch all stores regardless of installation time
      // EmailLog check prevents duplicates if a store was already processed
      const day3Stores = await Shop.find({
        createdAt: {
          $gte: new Date(now - 96 * 60 * 60 * 1000), // 4 days ago (96 hours)
          $lte: new Date(now - 72 * 60 * 60 * 1000)   // 3 days ago (72 hours)
        }
      }).lean();

      if (day3Stores.length === 0) {
        return;
      }

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
        } else {
          console.error(`[TOKEN-EMAIL] ❌ Failed for ${store.shop}:`, result.error);
        }
        await this.delay(1000); // 1 second delay between emails
      }

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
      
      // Find stores installed 6-7 days ago (144-168 hours)
      // Check all stores from the last 24 hours that are now 6+ days old
      // This ensures we catch all stores regardless of installation time
      // EmailLog check prevents duplicates if a store was already processed
      const day6Stores = await Shop.find({
        createdAt: {
          $gte: new Date(now - 168 * 60 * 60 * 1000), // 7 days ago (168 hours)
          $lte: new Date(now - 144 * 60 * 60 * 1000)   // 6 days ago (144 hours)
        }
      }).lean();

      if (day6Stores.length === 0) {
        return;
      }
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
        } else {
          console.error(`[APPSTORE-RATING] ❌ Failed for ${store.shop}:`, result.error);
        }
        await this.delay(1000); // 1 second delay between emails
      }

    } catch (error) {
      console.error('[APPSTORE-RATING] Error:', error);
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stopAll() {
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    this.isRunning = false;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new EmailScheduler();

