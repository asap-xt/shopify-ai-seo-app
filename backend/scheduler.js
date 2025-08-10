// backend/scheduler.js
// Schedules auto-sync jobs per shop based on plan.
// Requires: node-cron, mongoose, our Subscription model and syncProductsForShop.

import cron from 'node-cron';
import Subscription from './db/Subscription.js';
import { syncProductsForShop } from './controllers/productSync.js';

const jobs = new Map();

/** Map plan -> cron expression */
function cronExprForPlan(plan) {
  switch ((plan || '').toLowerCase()) {
    case 'starter':        // once per 2 weeks
      return '0 0 */14 * *';
    case 'professional':   // every 48h
      return '0 0 */2 * *';
    case 'growth':         // every 24h
      return '0 0 * * *';
    case 'growth_extra':   // every 12h
      return '0 */12 * * *';
    case 'enterprise':     // every 2h
      return '0 */2 * * *';
    default:
      // safe default: daily
      return '0 1 * * *';
  }
}

/** Create/replace cron job for a shop */
function scheduleForShop(shop, plan) {
  const key = shop.toLowerCase();
  // Clear previous if exists
  const existing = jobs.get(key);
  if (existing) {
    existing.stop();
    jobs.delete(key);
  }

  const expr = cronExprForPlan(plan);
  const task = cron.schedule(expr, async () => {
    try {
      const count = await syncProductsForShop(shop);
      console.log(`🔁 Auto-sync done for ${shop} | products: ${count}`);
    } catch (e) {
      console.error(`Auto-sync error for ${shop}:`, e?.message || e);
    }
  }, { timezone: 'UTC' });

  jobs.set(key, task);
  console.log(`⏰ Scheduled sync for ${shop} at '${expr}' (plan: ${plan})`);
}

/** Public: start all jobs by reading current subscriptions */
export async function startScheduler() {
  // Load current subs and (re)create jobs
  const subs = await Subscription.find({}, { shop: 1, plan: 1 }).lean();
  if (!Array.isArray(subs)) return;

  subs.forEach(s => {
    if (s?.shop && s?.plan) scheduleForShop(s.shop, s.plan);
  });

  // Watch for future changes (optional, lightweight polling)
  // If you already update plan elsewhere, consider calling rescheduleForShop() from there.
  console.log('🗓️ Scheduler started with', subs.length, 'shops.');
}

/** Optional: programmatic reschedule after plan change */
export async function rescheduleForShop(shop) {
  const sub = await Subscription.findOne({ shop }, { plan: 1 }).lean();
  if (sub?.plan) scheduleForShop(shop, sub.plan);
}

/** Optional: stop everything (called on shutdown) */
export function stopScheduler() {
  for (const [key, job] of jobs.entries()) {
    try { job.stop(); } catch {}
    jobs.delete(key);
  }
  console.log('🛑 Scheduler stopped.');
}
