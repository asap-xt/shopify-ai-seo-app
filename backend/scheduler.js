// scheduler.js
// Auto-sync jobs per plan. Uses valid cron expressions and also checks lastSyncAt
// to ensure each shop is synced no more frequently than its plan interval.
//
// Plans (as specified):
// - Starter: every 14 days
// - Professional: every 48 hours
// - Growth: every 24 hours
// - Growth Extra: every 12 hours
// - Enterprise: every 2 hours
//
// Notes:
// - We schedule separate cron tasks per plan using safe expressions.
// - We also gate each run by checking lastSyncAt vs a required interval (in hours).
// - Dynamic imports are used to avoid hard-coding your project structure.
// - If Subscription model or sync function are missing, we log and skip gracefully.

import cron from 'node-cron';

const TIMEZONE = 'UTC';

// Hours required between syncs for each plan
const REQUIRED_INTERVAL_HOURS = {
  'starter': 14 * 24,      // 14 days
  'professional': 48,      // 48 hours
  'growth': 24,            // 24 hours
  'growth extra': 12,      // 12 hours
  'enterprise': 2,         // 2 hours
};

// Valid cron schedules per plan (kept conservative and readable)
// - Enterprise: every 2 hours at minute 0
// - Growth Extra: every 12 hours at minute 0
// - Growth: daily at 03:00 UTC
// - Professional: every 2 days at 04:00 UTC
// - Starter: twice a month (1st and 15th) at 05:00 UTC (approx. every ~2 weeks)
const CRONS = {
  'enterprise':    '0 */2 * * *',
  'growth extra':  '0 */12 * * *',
  'growth':        '0 3 * * *',
  'professional':  '0 4 */2 * *',
  'starter':       '0 5 1,15 * *',
};

// Allow common variants of the plan field in DB
const PLAN_KEYS = {
  'starter':        ['starter', 'Starter'],
  'professional':   ['professional', 'Professional'],
  'growth':         ['growth', 'Growth'],
  'growth extra':   ['growth extra', 'growth_extra', 'Growth Extra', 'Growth_Extra'],
  'enterprise':     ['enterprise', 'Enterprise'],
};

let tasks = [];

/** Try to dynamically import the Subscription model from common locations. */
async function loadSubscriptionModel() {
  const candidates = [
    './db/Subscription.js',
    './models/Subscription.js',
    '../db/Subscription.js',
    '../models/Subscription.js',
  ];
  for (const p of candidates) {
    try {
      const mod = await import(p);
      return mod.default || mod.Subscription || mod;
    } catch {
      // try next
    }
  }
  return null;
}

/** Try to dynamically import a product/catalog sync function. */
async function loadSyncFn() {
  const candidates = [
    './controllers/productSync.js',
    './controllers/aiSync.js',
    './controllers/feedController.js',
  ];
  for (const p of candidates) {
    try {
      const mod = await import(p);
      const fn =
        mod.runAutosyncForShop ||
        mod.syncProductsForShop ||
        mod.rebuildFeedsForShop ||
        mod.default;
      if (typeof fn === 'function') return fn;
    } catch {
      // try next
    }
  }
  // Fallback no-op to keep the scheduler harmless if not wired yet
  return async function noop(shop) {
    console.log(`[scheduler] No sync function found — skipped for ${shop}`);
  };
}

/** Fetch all shop domains for the given plan key. */
async function queryShopsByPlan(Subscription, planKey) {
  const variants = PLAN_KEYS[planKey] || [planKey];
  try {
    // Assumes a schema with fields: { plan: String, shop: String }
    const docs = await Subscription.find({ plan: { $in: variants } }).lean();
    return (docs || []).map(d => d.shop).filter(Boolean);
  } catch (e) {
    console.error('[scheduler] Subscription.find error:', e.message);
    return [];
  }
}

/** Check if a given shop is due for sync based on lastSyncAt and required interval (in hours). */
function isDue(lastSyncAt, requiredHours) {
  if (!lastSyncAt) return true; // never synced before
  const last = new Date(lastSyncAt).getTime();
  if (Number.isNaN(last)) return true; // invalid date -> treat as due
  const now = Date.now();
  const diffHours = (now - last) / 36e5; // milliseconds to hours
  return diffHours >= requiredHours - 0.01; // small epsilon
}

/** Run autosync batch for all shops in a given plan. */
async function runBatch(planKey) {
  const requiredHours = REQUIRED_INTERVAL_HOURS[planKey] ?? 24;
  const Subscription = await loadSubscriptionModel();
  const syncFn = await loadSyncFn();

  if (!Subscription) {
    console.warn('[scheduler] Subscription model not found — autosync disabled for this tick.');
    return;
  }

  const shops = await queryShopsByPlan(Subscription, planKey);
  if (!shops.length) {
    console.log(`[scheduler] No shops for plan '${planKey}'`);
    return;
  }

  console.log(`[scheduler] Autosync start for '${planKey}' — shops: ${shops.length}`);
  for (const shop of shops) {
    try {
      // Re-read lastSyncAt for each shop (optional optimization)
      const doc = await Subscription.findOne({ shop }, { lastSyncAt: 1 }).lean().catch(() => null);
      const due = isDue(doc?.lastSyncAt, requiredHours);
      if (!due) {
        // Not due yet — skip quietly
        continue;
      }

      // Execute sync
      await syncFn(shop);

      // Persist lastSyncAt
      await Subscription.updateOne({ shop }, { $set: { lastSyncAt: new Date() } }).exec().catch(() => {});
      console.log(`[scheduler] Synced: ${shop}`);
    } catch (e) {
      console.error(`[scheduler] Sync failed for ${shop}:`, e.message);
    }
  }
  console.log(`[scheduler] Autosync done for '${planKey}'`);
}

/** Start all cron tasks for each plan. */
export function startScheduler() {
  if (String(process.env.SCHEDULER_DISABLED || '').toLowerCase() === 'true') {
    console.log('[scheduler] Disabled via SCHEDULER_DISABLED=true');
    return { stop: stopScheduler };
  }

  // Stop any previous tasks (hot-reload safety)
  for (const t of tasks) {
    try { t.stop(); } catch {}
  }
  tasks = [];

  // Schedule a cron task per plan
  for (const [planKey, expr] of Object.entries(CRONS)) {
    try {
      const task = cron.schedule(expr, () => runBatch(planKey), {
        scheduled: true,
        timezone: TIMEZONE,
      });
      tasks.push(task);
      console.log(`[scheduler] Scheduled '${planKey}' → ${expr} (${TIMEZONE})`);
    } catch (e) {
      console.error(`[scheduler] Failed to schedule '${planKey}':`, e.message);
    }
  }

  return { stop: stopScheduler };
}

/** Stop all cron tasks. */
export function stopScheduler() {
  for (const t of tasks) {
    try { t.stop(); } catch {}
  }
  tasks = [];
  console.log('[scheduler] Stopped all tasks');
}

/** Default export for `import startScheduler from './scheduler.js'` */
export default function defaultStart() {
  return startScheduler();
}
