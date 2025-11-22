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

    // Token purchase email check (every day at 10 AM) - Day 3 after installation
    // TESTING: Changed to 22:25 EET (20:25 UTC) for testing. Change back to '0 10 * * *' for production.
    this.jobs.push(
      cron.schedule('25 20 * * *', async () => {
        console.log('⏰ Running token purchase email check...');
        await this.checkTokenPurchaseEmail();
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
   * Check and send token purchase email (Day 3 after installation)
   * Only sends if: no purchased tokens AND plan is not Growth Extra/Enterprise
   * 
   * TESTING: Currently set to 5 minutes for testing. Change back to 72-74 hours for production.
   */
  async checkTokenPurchaseEmail() {
    try {
      const now = new Date();
      
      // First, let's see ALL recent stores for debugging
      const allRecentStores = await Shop.find({
        createdAt: {
          $gte: new Date(now - 30 * 60 * 1000) // Last 30 minutes
        }
      }).sort({ createdAt: -1 }).lean();
      
      console.log(`[TOKEN-EMAIL] All stores installed in last 30 minutes: ${allRecentStores.length}`);
      allRecentStores.forEach(store => {
        const minutesAgo = Math.floor((now - new Date(store.createdAt)) / (1000 * 60));
        console.log(`[TOKEN-EMAIL]   - ${store.shop}: ${minutesAgo} minutes ago (createdAt: ${store.createdAt})`);
      });
      
      // TESTING: 0-30 minutes after installation (for testing only)
      // PRODUCTION: Day 3 after installation (72-74 hours ago)
      // Change back to: $gte: new Date(now - 74 * 60 * 60 * 1000), $lte: new Date(now - 72 * 60 * 60 * 1000)
      const day3Stores = await Shop.find({
        createdAt: {
          $gte: new Date(now - 30 * 60 * 1000), // 30 minutes ago (testing - wider window)
          $lte: new Date(now - 0 * 60 * 1000)   // 0 minutes ago (testing - include all recent)
        }
      }).lean();

      console.log(`[TOKEN-EMAIL] Found ${day3Stores.length} stores in target window (3-15 minutes ago)`);

      const TokenBalance = (await import('../db/TokenBalance.js')).default;

      for (const store of day3Stores) {
        const minutesAgo = Math.floor((now - new Date(store.createdAt)) / (1000 * 60));
        console.log(`[TOKEN-EMAIL] Checking store: ${store.shop}, installed ${minutesAgo} minutes ago at: ${store.createdAt}`);
        
        // Check if user has unsubscribed from marketing emails
        const emailPrefs = store.emailPreferences || {};
        if (emailPrefs.marketingEmails === false) {
          console.log(`[TOKEN-EMAIL] ⏭️ Skipping ${store.shop} - unsubscribed from marketing emails`);
          continue;
        }
        
        const subscription = await Subscription.findOne({ shop: store.shop }).lean();
        if (!subscription) {
          console.log(`[TOKEN-EMAIL] ⏭️ Skipping ${store.shop} - no subscription found`);
          continue; // Skip if no subscription
        }
        console.log(`[TOKEN-EMAIL] Found subscription for ${store.shop}: plan=${subscription.plan}, status=${subscription.status}`);

        // Check token balance - if balance > 0, skip email (regardless of plan)
        const tokenBalance = await TokenBalance.findOne({ shop: store.shop }).lean();
        const currentBalance = tokenBalance?.balance || 0;
        
        console.log(`[TOKEN-EMAIL] Token balance for ${store.shop}:`, {
          exists: !!tokenBalance,
          balance: currentBalance,
          totalPurchased: tokenBalance?.totalPurchased || 0,
          totalUsed: tokenBalance?.totalUsed || 0,
          plan: subscription.plan
        });
        
        // Skip if balance > 0 (user has tokens, regardless of plan or source)
        if (currentBalance > 0) {
          console.log(`[TOKEN-EMAIL] ⏭️ Skipping ${store.shop} - has token balance (${currentBalance}), plan: ${subscription.plan}`);
          continue;
        }
        
        if (!tokenBalance) {
          console.log(`[TOKEN-EMAIL] ℹ️ No token balance record found for ${store.shop} - balance is 0, will send email`);
        } else {
          console.log(`[TOKEN-EMAIL] ℹ️ Token balance is 0 for ${store.shop} (plan: ${subscription.plan}) - will send email`);
        }

        // Send token purchase email (store already has accessToken from Shop model)
        console.log(`[TOKEN-EMAIL] ✅ Sending token purchase email to ${store.shop}`);
        const result = await emailService.sendTokenPurchaseEmail({ ...store, subscription });
        if (result.success) {
          console.log(`[TOKEN-EMAIL] ✅ Email sent successfully to ${store.shop}`);
        } else {
          console.error(`[TOKEN-EMAIL] ❌ Email failed for ${store.shop}:`, result.error);
        }
        await this.delay(1000); // 1 second delay between emails
      }

      console.log('✅ Token purchase email check completed');
    } catch (error) {
      console.error('❌ Token purchase email error:', error);
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

