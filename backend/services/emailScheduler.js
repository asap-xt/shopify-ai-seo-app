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

    // Daily onboarding emails check (every day at 10 AM)
    this.jobs.push(
      cron.schedule('0 10 * * *', async () => {
        console.log('⏰ Running daily onboarding check...');
        await this.checkOnboardingEmails();
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
   * Check and send onboarding emails
   */
  async checkOnboardingEmails() {
    try {
      const now = new Date();
      
      // Day 1 onboarding (24 hours after install)
      const day1Stores = await Shop.find({
        createdAt: {
          $gte: new Date(now - 25 * 60 * 60 * 1000), // 25 hours ago
          $lte: new Date(now - 23 * 60 * 60 * 1000)  // 23 hours ago
        }
      }).lean();

      for (const store of day1Stores) {
        const subscription = await Subscription.findOne({ shop: store.shop }).lean();
        await emailService.sendOnboardingEmail({ ...store, subscription }, 1);
        await this.delay(1000); // 1 second delay between emails
      }

      // Day 3 onboarding
      const day3Stores = await Shop.find({
        createdAt: {
          $gte: new Date(now - 73 * 60 * 60 * 1000),
          $lte: new Date(now - 71 * 60 * 60 * 1000)
        }
      }).lean();

      for (const store of day3Stores) {
        const subscription = await Subscription.findOne({ shop: store.shop }).lean();
        await emailService.sendOnboardingEmail({ ...store, subscription }, 3);
        await this.delay(1000);
      }

      // Day 7 onboarding
      const day7Stores = await Shop.find({
        createdAt: {
          $gte: new Date(now - 169 * 60 * 60 * 1000),
          $lte: new Date(now - 167 * 60 * 60 * 1000)
        }
      }).lean();

      for (const store of day7Stores) {
        const subscription = await Subscription.findOne({ shop: store.shop }).lean();
        await emailService.sendOnboardingEmail({ ...store, subscription }, 7);
        await this.delay(1000);
      }

      console.log('✅ Onboarding emails check completed');
    } catch (error) {
      console.error('❌ Onboarding emails error:', error);
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

