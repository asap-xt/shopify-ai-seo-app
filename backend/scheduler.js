// backend/scheduler.js

import cron from 'node-cron';
import Subscription from './db/models/Subscription.js';
import { syncProductsForShop } from './controllers/productSync.js';

/**
 * Scheduler: sets up cron jobs per shop based on subscription plan.
 */
export default {
  start: async () => {
    try {
      const subs = await Subscription.find({});
      subs.forEach(sub => {
        const shop = sub.shop;
        const cronExpr = getCronExpression(sub.plan);
        if (!cronExpr) return;

        cron.schedule(cronExpr, async () => {
          try {
            const count = await syncProductsForShop(shop);
            console.log(`🔄 Auto-synced ${count} products for ${shop} (plan: ${sub.plan})`);
          } catch (err) {
            console.error(`❌ Sync error for ${shop}:`, err);
          }
        });

        console.log(`⏰ Scheduled sync for ${shop} at '${cronExpr}' (plan: ${sub.plan})`);
      });
    } catch (error) {
      console.error('❌ Scheduler start error:', error);
    }
  }
};

/**
 * Map subscription plan to cron expression.
 */
function getCronExpression(plan) {
  switch (plan) {
    case 'starter':        return '0 0 */14 * *';  // at midnight every 14 days
    case 'professional':   return '0 0 */2 * *';   // at midnight every 2 days
    case 'growth':         return '0 0 * * *';     // at midnight every day
    case 'growth-extra':   return '0 */12 * * *';  // every 12 hours
    case 'enterprise':     return '0 */2 * * *';   // every 2 hours
    default:               return null;
  }
}
