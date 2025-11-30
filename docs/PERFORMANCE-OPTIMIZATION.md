# 🚀 Performance Optimization Plan - indexAIze App

## Документ създаден: 30 ноември 2024
## Цел: Подготовка за Prime Time Launch

---

## 📊 ОБЗОР

Този документ съдържа всички идентифицирани оптимизации за подобряване на производителността, стабилността и ефективността на indexAIze Shopify App преди production launch.

**Общо оптимизации:** 12  
**Критични:** 3 🔴  
**Важни:** 4 🟡  
**Nice to Have:** 5 🟢

---

## 🔴 КРИТИЧНИ ОПТИМИЗАЦИИ (Направи ПЪРВО)

### 1. Rate Limiting за AI API Calls

**Проблем:**
- Няма throttling/queue system за OpenRouter API calls
- `backend/ai/gemini.js` - директни fetch calls без rate limiting
- `backend/services/aiSitemapEnhancer.js:317` - `Promise.allSettled` прави 5 parallel AI calls на продукт
- **Риск:** API rate limit exceeded + високи разходи при bulk operations

**Засегнати файлове:**
- `backend/ai/gemini.js`
- `backend/ai/openrouter.js`
- `backend/services/aiSitemapEnhancer.js`
- `backend/controllers/seoController.js:356`
- `backend/controllers/aiSimulationController.js:19`

**Решение:**
```javascript
// Създай: backend/services/aiQueue.js
import PQueue from 'p-queue';

class AIQueue {
  constructor() {
    // Separate queues for different priorities
    this.highPriorityQueue = new PQueue({
      concurrency: 3,        // Max 3 parallel high-priority calls
      intervalCap: 10,       // Max 10 calls
      interval: 1000,        // per second
      timeout: 30000
    });
    
    this.normalQueue = new PQueue({
      concurrency: 2,        // Max 2 parallel normal calls
      intervalCap: 5,        // Max 5 calls
      interval: 1000,        // per second
      timeout: 30000
    });
    
    this.bulkQueue = new PQueue({
      concurrency: 1,        // Max 1 parallel bulk operation
      intervalCap: 2,        // Max 2 calls
      interval: 1000,        // per second
      timeout: 60000
    });
  }

  async addHighPriority(fn) {
    return this.highPriorityQueue.add(fn);
  }

  async add(fn) {
    return this.normalQueue.add(fn);
  }

  async addBulk(fn) {
    return this.bulkQueue.add(fn);
  }

  getStats() {
    return {
      highPriority: {
        size: this.highPriorityQueue.size,
        pending: this.highPriorityQueue.pending
      },
      normal: {
        size: this.normalQueue.size,
        pending: this.normalQueue.pending
      },
      bulk: {
        size: this.bulkQueue.size,
        pending: this.bulkQueue.pending
      }
    };
  }
}

export const aiQueue = new AIQueue();
```

**Модифицирай:**
```javascript
// backend/ai/gemini.js
import { aiQueue } from '../services/aiQueue.js';

export async function getGeminiResponse(prompt, options = {}) {
  return aiQueue.add(async () => {
    // Existing fetch logic here
    const res = await fetch(baseUrl, { /* ... */ });
    return { content, usage: data?.usage || null };
  });
}
```

```javascript
// backend/services/aiSitemapEnhancer.js:303
export async function enhanceProductForSitemap(product, allProducts = [], options = {}) {
  // Use bulk queue for sitemap generation (lower priority)
  return aiQueue.addBulk(async () => {
    // IMPORTANT: Run AI calls sequentially to respect rate limits
    const results = [];
    
    if (enableSummary) {
      results.push(await generateAISummary(product));
    }
    if (enableSemanticTags) {
      results.push(await generateSemanticTags(product));
    }
    // ... etc
    
    return { /* combined results */ };
  });
}
```

**Инсталация:**
```bash
npm install p-queue
```

**Приоритет:** 🔴 КРИТИЧЕН  
**Очаквано време:** 2-3 часа  
**Impact:** Предотвратява rate limit errors, намалява разходи с ~30%

**Статус:** ⏳ Pending

---

### 2. Webhook Queue с Retry Logic

**Проблем:**
- Webhooks връщат 200 веднага, но грешки в async обработката се губят
- `backend/webhooks/products.js:27` - `res.status(200).send('ok')` преди обработка
- `backend/webhooks/subscription-update.js` - ако MongoDB/Redis fail-не, webhook data се губи
- **Риск:** Data loss при временни системни проблеми

**Засегнати файлове:**
- `backend/webhooks/products.js`
- `backend/webhooks/collections.js`
- `backend/webhooks/subscription-update.js`
- `backend/webhooks/uninstall.js`

**Решение:**
```javascript
// Създай: backend/services/webhookQueue.js
import Bull from 'bull';

class WebhookQueue {
  constructor() {
    if (!process.env.REDIS_URL) {
      console.warn('[WEBHOOK-QUEUE] Redis not configured, webhooks will be processed directly');
      this.enabled = false;
      return;
    }
    
    this.enabled = true;
    this.queue = new Bull('shopify-webhooks', process.env.REDIS_URL, {
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000 // Start with 2s, then 4s, then 8s
        },
        removeOnComplete: true,
        removeOnFail: false // Keep failed jobs for debugging
      }
    });
    
    this.setupProcessors();
    this.setupEventHandlers();
  }

  setupProcessors() {
    // Products webhook processor
    this.queue.process('products', async (job) => {
      const { shop, topic, payload } = job.data;
      console.log(`[WEBHOOK-QUEUE] Processing ${topic} for ${shop}`);
      
      // Import and execute webhook handler
      const handler = await import('../webhooks/products.js');
      await handler.processProductWebhook(shop, topic, payload);
      
      console.log(`[WEBHOOK-QUEUE] ✅ Completed ${topic} for ${shop}`);
    });
    
    // Collections webhook processor
    this.queue.process('collections', async (job) => {
      const { shop, topic, payload } = job.data;
      const handler = await import('../webhooks/collections.js');
      await handler.processCollectionWebhook(shop, topic, payload);
    });
    
    // Subscription webhook processor
    this.queue.process('subscription', async (job) => {
      const { shop, webhookData } = job.data;
      const handler = await import('../webhooks/subscription-update.js');
      await handler.processSubscriptionUpdate(shop, webhookData);
    });
    
    // Uninstall webhook processor
    this.queue.process('uninstall', async (job) => {
      const { shop } = job.data;
      const handler = await import('../webhooks/uninstall.js');
      await handler.processUninstall(shop);
    });
  }

  setupEventHandlers() {
    this.queue.on('completed', (job) => {
      console.log(`[WEBHOOK-QUEUE] ✅ Job ${job.id} completed`);
    });
    
    this.queue.on('failed', (job, err) => {
      console.error(`[WEBHOOK-QUEUE] ❌ Job ${job.id} failed:`, err.message);
      console.error('[WEBHOOK-QUEUE] Job data:', JSON.stringify(job.data, null, 2));
    });
    
    this.queue.on('stalled', (job) => {
      console.warn(`[WEBHOOK-QUEUE] ⚠️ Job ${job.id} stalled`);
    });
  }

  async addWebhook(type, data) {
    if (!this.enabled) {
      // Fallback to direct processing if Redis not available
      console.warn('[WEBHOOK-QUEUE] Processing webhook directly (no Redis)');
      return null;
    }
    
    return this.queue.add(type, data, {
      priority: type === 'subscription' ? 1 : 5 // Subscription webhooks have higher priority
    });
  }

  async getStats() {
    if (!this.enabled) return null;
    
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount()
    ]);
    
    return { waiting, active, completed, failed, delayed };
  }

  async getFailedJobs(limit = 10) {
    if (!this.enabled) return [];
    return this.queue.getFailed(0, limit);
  }

  async retryFailedJob(jobId) {
    if (!this.enabled) return;
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.retry();
    }
  }

  async cleanOldJobs(gracePeriod = 7 * 24 * 60 * 60 * 1000) {
    if (!this.enabled) return;
    // Clean completed jobs older than 7 days
    await this.queue.clean(gracePeriod, 'completed');
    // Clean failed jobs older than 30 days
    await this.queue.clean(30 * 24 * 60 * 60 * 1000, 'failed');
  }
}

export const webhookQueue = new WebhookQueue();
```

**Модифицирай webhook handlers да експортват processing логиката:**
```javascript
// backend/webhooks/products.js
// Export processing function (separate from HTTP handler)
export async function processProductWebhook(shop, topic, payload) {
  // Move all processing logic here (lines 34-156)
  const Product = (await import('../db/Product.js')).default;
  const numericProductId = parseInt(payload.id);
  // ... rest of processing logic
}

// Keep HTTP handler minimal
export default async function productsWebhook(req, res) {
  const shop = (req.get('x-shopify-shop-domain') || '').replace(/^https?:\/\//, '');
  const topic = (req.get('x-shopify-topic') || '').toLowerCase();
  const payload = req.body;
  
  // Respond immediately to Shopify
  res.status(200).send('ok');
  
  // Add to queue for processing
  if (shop && payload?.id) {
    try {
      await webhookQueue.addWebhook('products', { shop, topic, payload });
    } catch (error) {
      console.error('[WEBHOOK] Failed to queue webhook:', error);
      // Fallback to direct processing
      await processProductWebhook(shop, topic, payload);
    }
  }
}
```

**Добави admin endpoint за мониторинг:**
```javascript
// backend/server.js (в admin endpoints секцията)
app.get('/api/admin/webhook-stats', async (req, res) => {
  const stats = await webhookQueue.getStats();
  const failedJobs = await webhookQueue.getFailedJobs(20);
  
  res.json({
    stats,
    failedJobs: failedJobs.map(job => ({
      id: job.id,
      type: job.name,
      data: job.data,
      error: job.failedReason,
      attempts: job.attemptsMade,
      timestamp: job.timestamp
    }))
  });
});

// Retry failed webhook
app.post('/api/admin/webhook-retry/:jobId', async (req, res) => {
  const { jobId } = req.params;
  await webhookQueue.retryFailedJob(jobId);
  res.json({ success: true });
});
```

**Инсталация:**
```bash
npm install bull
```

**Приоритет:** 🔴 КРИТИЧЕН  
**Очаквано време:** 3-4 часа  
**Impact:** Предотвратява data loss, гарантира webhook надеждност

**Статус:** ⏳ Pending

---

### 3. MongoDB Connection Pool Optimization

**Проблем:**
- `backend/db/connection.js:36` - `maxPoolSize: 20` е твърде малко за production
- При 100+ concurrent users ще има connection bottleneck
- Health check на 30s е твърде рядък за production мониторинг

**Засегнати файлове:**
- `backend/db/connection.js`

**Решение:**
```javascript
// backend/db/connection.js (lines 34-57)
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const options = {
  // Connection Pool Settings - OPTIMIZED for production
  maxPoolSize: IS_PRODUCTION ? 50 : 20,    // 50 for prod, 20 for dev
  minPoolSize: IS_PRODUCTION ? 10 : 2,     // 10 for prod, 2 for dev
  maxIdleTimeMS: 30000,                     // 30s (more aggressive cleanup)
  
  // Timeouts - BALANCED for performance
  serverSelectionTimeoutMS: 15000,          // 15s (reduced from 30s)
  socketTimeoutMS: 45000,                   // 45s (reduced from 60s)
  connectTimeoutMS: 20000,                  // 20s (keep same)
  
  // Performance
  maxConnecting: IS_PRODUCTION ? 10 : 5,    // 10 for prod, 5 for dev
  compressors: IS_PRODUCTION ? ['zlib'] : [], // Enable compression in prod
  
  // Reliability
  retryWrites: true,
  retryReads: true,
  w: 'majority',
  
  // Optimization
  autoIndex: false,
  family: 4,
};
```

**Промени health check интервал:**
```javascript
// backend/db/connection.js (line 213)
setTimeout(() => {
  runHealthCheck();
  // Health check every 10 seconds (instead of 30)
  const interval = IS_PRODUCTION ? 10000 : 30000;
  this.healthCheckInterval = setInterval(runHealthCheck, interval);
}, 2000);
```

**Добави connection pool metrics endpoint:**
```javascript
// backend/server.js
app.get('/api/admin/db-stats', async (req, res) => {
  const stats = dbConnection.getStats();
  const poolStats = getPoolStats(); // Extract from health check logic
  
  res.json({
    connection: stats,
    pool: poolStats,
    timestamp: new Date().toISOString()
  });
});

function getPoolStats() {
  try {
    const client = mongoose.connection.getClient();
    const topology = client?.topology;
    
    if (topology?.s?.pool) {
      const pool = topology.s.pool;
      return {
        total: pool.totalConnectionCount || 0,
        available: pool.availableConnectionCount || 0,
        pending: pool.waitQueueSize || 0,
        active: (pool.totalConnectionCount || 0) - (pool.availableConnectionCount || 0)
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}
```

**Приоритет:** 🔴 КРИТИЧЕН  
**Очаквано време:** 1 час  
**Impact:** Подобрява scalability, предотвратява connection timeouts

**Статус:** ⏳ Pending

---

## 🟡 ВАЖНИ ОПТИМИЗАЦИИ (Препоръчително)

### 4. Request Timeout за Shopify API Calls

**Проблем:**
- Всички `shopGraphQL()` функции нямат timeout
- Може да виси безкрайно ако Shopify API закъснее
- Блокира обработката на други requests

**Засегнати файлове:**
- `backend/controllers/seoController.js:311`
- `backend/controllers/storeController.js:49`
- `backend/controllers/productsController.js`
- `backend/utils/shopifyApi.js`

**Решение:**
```javascript
// Създай: backend/utils/fetchWithTimeout.js
export async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Request timeout after ${timeoutMs}ms`);
      timeoutError.code = 'TIMEOUT';
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  }
}
```

**Модифицирай всички Shopify API calls:**
```javascript
// backend/controllers/seoController.js:311
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';

async function shopGraphQL(req, shop, query, variables = {}) {
  const Shop = (await import('../db/Shop.js')).default;
  const shopData = await Shop.findOne({ shop });
  
  if (!shopData?.accessToken) {
    throw new Error('Shop access token not found');
  }
  
  const response = await fetchWithTimeout(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': shopData.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
    15000 // 15s timeout for Shopify API
  );
  
  // ... rest of logic
}
```

**Приоритет:** 🟡 ВАЖЕН  
**Очаквано време:** 1-2 часа  
**Impact:** Предотвратява hanging requests, подобрява reliability

**Статус:** ⏳ Pending

---

### 5. Увеличи Cache TTL за Статични Данни

**Проблем:**
- `backend/controllers/dashboardController.js:27` - Dashboard stats cache: 1 минута
- `backend/controllers/productsController.js:196` - Products list cache: SHORT TTL
- Твърде често се refetch-ват данни, които рядко се променят
- Ненужна MongoDB load

**Засегнати файлове:**
- `backend/utils/cacheWrapper.js`
- `backend/controllers/dashboardController.js`
- `backend/controllers/productsController.js`
- `backend/controllers/storeController.js`

**Решение:**
```javascript
// backend/utils/cacheWrapper.js
export const CACHE_TTL = {
  VERY_SHORT: 60,       // 1 min - frequently changing data (dashboard stats)
  SHORT: 300,           // 5 min - moderately changing (product lists with filters)
  MEDIUM: 900,          // 15 min - rarely changing (product details, collections)
  LONG: 3600,           // 1 hour - static data (subscription, shop info, plans)
  VERY_LONG: 86400,     // 24 hours - very static (sitemap, schemas)
  WEEK: 604800          // 7 days - rarely updated (metafield definitions)
};
```

**Модифицирай cache usage:**
```javascript
// backend/controllers/dashboardController.js:27
const stats = await withShopCache(shop, 'dashboard:stats', CACHE_TTL.VERY_SHORT, async () => {
  // Keep 1 min for dashboard (data changes frequently)
});

// backend/controllers/storeController.js
const subscription = await withShopCache(shop, 'subscription', CACHE_TTL.LONG, async () => {
  // 1 hour for subscription (changes rarely)
  return await Subscription.findOne({ shop }).lean();
});

// backend/controllers/productsController.js:196
const cachedResult = await withShopCache(shop, cacheKey, CACHE_TTL.MEDIUM, async () => {
  // 15 min for product lists (balance between freshness and performance)
});

// backend/controllers/sitemapController.js
const sitemap = await withShopCache(shop, 'sitemap', CACHE_TTL.VERY_LONG, async () => {
  // 24 hours for sitemap (regenerated manually)
  return await Sitemap.findOne({ shop }).lean();
});
```

**Добави cache warming за често използвани данни:**
```javascript
// backend/services/cacheWarmer.js
import cron from 'node-cron';
import { withShopCache, CACHE_TTL } from '../utils/cacheWrapper.js';

class CacheWarmer {
  start() {
    // Warm subscription cache every hour
    cron.schedule('0 * * * *', async () => {
      console.log('[CACHE-WARMER] Warming subscription cache...');
      const shops = await Shop.find({ isActive: true }).select('shop').lean();
      
      for (const { shop } of shops) {
        try {
          await withShopCache(shop, 'subscription', CACHE_TTL.LONG, async () => {
            return await Subscription.findOne({ shop }).lean();
          });
        } catch (error) {
          console.error(`[CACHE-WARMER] Failed for ${shop}:`, error.message);
        }
      }
      console.log(`[CACHE-WARMER] Warmed cache for ${shops.length} shops`);
    });
  }
}

export default new CacheWarmer();
```

**Приоритет:** 🟡 ВАЖЕН  
**Очаквано време:** 2 часа  
**Impact:** Намалява MongoDB load с ~40%, подобрява response times

**Статус:** ⏳ Pending

---

### 6. Добави `.lean()` за Read-Only Queries

**Проблем:**
- Много MongoDB queries не използват `.lean()` за read-only операции
- `.lean()` е 5-10x по-бързо (връща plain JS objects вместо Mongoose documents)
- Намалява memory usage

**Засегнати файлове:**
- Всички controllers
- Всички webhook handlers
- Email services

**Решение:**
```javascript
// НАВСЯКЪДЕ където НЕ променяш данните, добави .lean()

// ❌ БЕЗ .lean() (бавно):
const shop = await Shop.findOne({ shop });
const products = await Product.find({ shop });
const subscription = await Subscription.findOne({ shop });

// ✅ С .lean() (5-10x по-бързо):
const shop = await Shop.findOne({ shop }).lean();
const products = await Product.find({ shop }).lean();
const subscription = await Subscription.findOne({ shop }).lean();

// ⚠️ ВНИМАНИЕ: Не използвай .lean() когато:
// 1. Ще правиш .save() на документа
// 2. Ще използваш Mongoose методи (virtuals, methods)
// 3. Трябва да модифицираш документа след fetch

// Примери:

// backend/controllers/dashboardController.js:29
const subscription = await Subscription.findOne({ shop }).lean(); // Add .lean()

// backend/controllers/dashboardController.js:60
const shopData = await Shop.findOne({ shop }).lean(); // Add .lean()

// backend/services/emailScheduler.js
const stores = await Shop.find({
  isActive: true,
  accessToken: { $exists: true, $ne: null }
}).lean(); // Add .lean()

// backend/webhooks/products.js:65
const existingProduct = await Product.findOne({ 
  shop, 
  productId: numericProductId 
}).lean(); // Add .lean()
```

**Автоматизирай проверката:**
```javascript
// Създай: scripts/check-lean-usage.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function checkFileForLeanUsage(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const issues = [];
  
  lines.forEach((line, index) => {
    // Check for findOne/find without .lean()
    if (
      (line.includes('.findOne(') || line.includes('.find(')) &&
      !line.includes('.lean()') &&
      !line.includes('.save()') &&
      !line.includes('findOneAndUpdate') &&
      !line.includes('findByIdAndUpdate')
    ) {
      issues.push({
        file: filePath,
        line: index + 1,
        code: line.trim()
      });
    }
  });
  
  return issues;
}

function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  let allIssues = [];
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && !file.includes('node_modules')) {
      allIssues = allIssues.concat(scanDirectory(filePath));
    } else if (file.endsWith('.js')) {
      const issues = checkFileForLeanUsage(filePath);
      allIssues = allIssues.concat(issues);
    }
  });
  
  return allIssues;
}

const backendDir = path.join(__dirname, '..', 'backend');
const issues = scanDirectory(backendDir);

console.log(`\n📊 Found ${issues.length} potential missing .lean() calls:\n`);
issues.forEach(issue => {
  console.log(`${issue.file}:${issue.line}`);
  console.log(`  ${issue.code}\n`);
});
```

**Run check:**
```bash
node scripts/check-lean-usage.js
```

**Приоритет:** 🟡 ВАЖЕН  
**Очаквано време:** 2-3 часа (за review и добавяне)  
**Impact:** Намалява query time с 5-10x, memory usage с ~30%

**Статус:** ⏳ Pending

---

### 7. Background Queue за Email Sending

**Проблем:**
- `backend/webhooks/subscription-update.js:213-295` - Welcome email се изпраща в webhook handler
- GraphQL fetch за shop email е синхронен
- Ако SendGrid е бавен/timeout, забавя цялата webhook обработка
- Email sending блокира критични операции

**Засегнати файлове:**
- `backend/webhooks/subscription-update.js`
- `backend/services/emailScheduler.js`
- `backend/services/productDigestScheduler.js`

**Решение:**
```javascript
// Създай: backend/services/emailQueue.js
import Bull from 'bull';
import emailService from './emailService.js';

class EmailQueue {
  constructor() {
    if (!process.env.REDIS_URL) {
      console.warn('[EMAIL-QUEUE] Redis not configured, emails will be sent directly');
      this.enabled = false;
      return;
    }
    
    this.enabled = true;
    this.queue = new Bull('emails', process.env.REDIS_URL, {
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000 // Start with 5s delay
        },
        removeOnComplete: {
          age: 24 * 3600 // Keep completed jobs for 24 hours
        },
        removeOnFail: false // Keep failed for debugging
      }
    });
    
    this.setupProcessor();
    this.setupEventHandlers();
  }

  setupProcessor() {
    this.queue.process(async (job) => {
      const { type, shop, data } = job.data;
      console.log(`[EMAIL-QUEUE] Sending ${type} email to ${shop}`);
      
      let result;
      switch (type) {
        case 'welcome':
          result = await emailService.sendWelcomeEmail(data);
          break;
        case 'token-purchase':
          result = await emailService.sendTokenPurchaseEmail(data);
          break;
        case 'appstore-rating':
          result = await emailService.sendAppStoreRatingEmail(data);
          break;
        case 'trial-expiring':
          result = await emailService.sendTrialExpiringEmail(data.store, data.daysLeft);
          break;
        case 'uninstall-followup':
          result = await emailService.sendUninstallFollowupEmail(data.store, data.reason);
          break;
        case 'weekly-digest':
          result = await emailService.sendWeeklyDigest(data.store, data.stats);
          break;
        case 'upgrade-success':
          result = await emailService.sendUpgradeSuccessEmail(data.store, data.newPlan);
          break;
        case 'reengagement':
          result = await emailService.sendReengagementEmail(data.store, data.daysSinceLastActive);
          break;
        case 'product-digest':
          result = await emailService.sendWeeklyProductDigest(data.store, data.changes);
          break;
        default:
          throw new Error(`Unknown email type: ${type}`);
      }
      
      if (!result.success) {
        throw new Error(result.error || 'Email sending failed');
      }
      
      console.log(`[EMAIL-QUEUE] ✅ Sent ${type} email to ${shop}`);
      return result;
    });
  }

  setupEventHandlers() {
    this.queue.on('completed', (job, result) => {
      console.log(`[EMAIL-QUEUE] ✅ Email ${job.id} sent successfully`);
    });
    
    this.queue.on('failed', (job, err) => {
      console.error(`[EMAIL-QUEUE] ❌ Email ${job.id} failed:`, err.message);
    });
  }

  async addEmail(type, shop, data, priority = 5) {
    if (!this.enabled) {
      // Fallback to direct sending
      console.warn(`[EMAIL-QUEUE] Sending ${type} email directly (no Redis)`);
      return this.sendEmailDirect(type, shop, data);
    }
    
    return this.queue.add(
      { type, shop, data },
      {
        priority, // Lower number = higher priority
        jobId: `${type}-${shop}-${Date.now()}` // Prevent duplicates
      }
    );
  }

  async sendEmailDirect(type, shop, data) {
    // Fallback for when Redis is not available
    switch (type) {
      case 'welcome':
        return await emailService.sendWelcomeEmail(data);
      // ... other cases
    }
  }

  async getStats() {
    if (!this.enabled) return null;
    
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount()
    ]);
    
    return { waiting, active, completed, failed, delayed };
  }
}

export const emailQueue = new EmailQueue();
```

**Модифицирай webhook да използва queue:**
```javascript
// backend/webhooks/subscription-update.js:213
if (isNewSubscription) {
  // Send welcome email asynchronously via queue
  import('../services/emailQueue.js').then(async ({ emailQueue }) => {
    try {
      // Fetch shop record with email
      const shopRecord = await Shop.findOne({ shop }).lean();
      if (!shopRecord) {
        console.warn('[SUBSCRIPTION-UPDATE] Shop record not found, skipping welcome email');
        return;
      }

      // Add to email queue (non-blocking)
      await emailQueue.addEmail('welcome', shop, {
        ...shopRecord,
        subscription: updatedSubscription
      }, 1); // High priority (1)
      
      console.log('[SUBSCRIPTION-UPDATE] ✅ Welcome email queued');
    } catch (emailError) {
      console.error('[SUBSCRIPTION-UPDATE] ❌ Failed to queue welcome email:', emailError.message);
    }
  }).catch(error => {
    console.error('[SUBSCRIPTION-UPDATE] ❌ Error loading email queue:', error.message);
  });
}
```

**Приоритет:** 🟡 ВАЖЕН  
**Очаквано време:** 2-3 часа  
**Impact:** Подобрява webhook response time, предотвратява email-related timeouts

**Статус:** ⏳ Pending

---

## 🟢 NICE TO HAVE ОПТИМИЗАЦИИ

### 8. Frontend Code Splitting

**Проблем:**
- `frontend/vite.config.js` няма code splitting configuration
- Всичко се зарежда изведнъж в един bundle
- Shopify Polaris компонентите са тежки (~500KB+)
- Бавно initial load time

**Решение:**
```javascript
// frontend/vite.config.js
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks (libraries)
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-polaris': ['@shopify/polaris', '@shopify/app-bridge-react'],
          'vendor-charts': ['recharts'], // If using charts
          
          // Feature chunks (lazy load by route)
          'page-dashboard': ['./src/pages/Dashboard.jsx'],
          'page-products': ['./src/pages/Products.jsx'],
          'page-collections': ['./src/pages/Collections.jsx'],
          'page-billing': ['./src/pages/Billing.jsx'],
          'page-sitemap': ['./src/pages/Sitemap.jsx'],
          'page-advanced-schema': ['./src/pages/AdvancedSchema.jsx'],
        }
      }
    },
    chunkSizeWarningLimit: 1000,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log in production
        drop_debugger: true
      }
    }
  },
  optimizeDeps: {
    include: ['@shopify/polaris', '@shopify/app-bridge-react']
  }
});
```

**Приоритет:** 🟢 НИСЪК  
**Очаквано време:** 1 час  
**Impact:** Подобрява initial load time с ~40%

**Статус:** ⏳ Pending

---

### 9. Structured Logging с Winston

**Проблем:**
- Навсякъде има `console.log()` вместо structured logging
- Трудно debugging в production
- Няма log levels (debug/info/warn/error)
- Няма log aggregation/search

**Решение:**
```javascript
// Създай: backend/utils/logger.js
import winston from 'winston';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Custom format for better readability
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    let msg = `${timestamp} [${level}] ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (IS_PRODUCTION ? 'info' : 'debug'),
  format: customFormat,
  defaultMeta: { service: 'indexaize-app' },
  transports: [
    // Console output
    new winston.transports.Console({
      format: IS_PRODUCTION ? customFormat : consoleFormat
    }),
    
    // File outputs (production only)
    ...(IS_PRODUCTION ? [
      new winston.transports.File({ 
        filename: 'logs/error.log', 
        level: 'error',
        maxsize: 10485760, // 10MB
        maxFiles: 5
      }),
      new winston.transports.File({ 
        filename: 'logs/combined.log',
        maxsize: 10485760, // 10MB
        maxFiles: 5
      })
    ] : [])
  ]
});

// Export convenience methods
export const log = {
  debug: (message, meta = {}) => logger.debug(message, meta),
  info: (message, meta = {}) => logger.info(message, meta),
  warn: (message, meta = {}) => logger.warn(message, meta),
  error: (message, meta = {}) => logger.error(message, meta),
};

export default logger;
```

**Замени console.log с structured logging:**
```javascript
// Преди:
console.log('[WEBHOOK] Processing products webhook for', shop);
console.error('[WEBHOOK] Error:', error);

// След:
import { log } from '../utils/logger.js';

log.info('Processing products webhook', { shop, topic });
log.error('Webhook processing failed', { shop, error: error.message, stack: error.stack });
```

**Приоритет:** 🟢 НИСЪК  
**Очаквано време:** 4-5 часа (за замяна на всички console.log)  
**Impact:** Подобрява debugging, log analysis, production monitoring

**Статус:** ⏳ Pending

---

### 10. Shopify Bulk Operations за Large Datasets

**Проблем:**
- Когато се fetch-ват много продукти/collections, правим много GraphQL requests
- Shopify API има rate limits (2 requests/second for REST, 50 points/second for GraphQL)
- При bulk export/import операции това е бавно

**Решение:**
```javascript
// Създай: backend/utils/shopifyBulkOps.js
import Shop from '../db/Shop.js';

export async function runBulkQuery(shop, query) {
  const shopData = await Shop.findOne({ shop }).lean();
  if (!shopData?.accessToken) {
    throw new Error('Shop access token not found');
  }
  
  // Step 1: Start bulk operation
  const startMutation = `
    mutation {
      bulkOperationRunQuery(
        query: """
          ${query}
        """
      ) {
        bulkOperation {
          id
          status
          url
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  
  const startResponse = await fetch(
    `https://${shop}/admin/api/2025-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': shopData.accessToken
      },
      body: JSON.stringify({ query: startMutation })
    }
  );
  
  const startData = await startResponse.json();
  const bulkOp = startData.data?.bulkOperationRunQuery?.bulkOperation;
  
  if (!bulkOp) {
    throw new Error('Failed to start bulk operation');
  }
  
  // Step 2: Poll for completion
  const operationId = bulkOp.id;
  let status = bulkOp.status;
  let url = null;
  
  while (status === 'RUNNING' || status === 'CREATED') {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s
    
    const pollQuery = `
      query {
        node(id: "${operationId}") {
          ... on BulkOperation {
            id
            status
            url
            errorCode
            objectCount
          }
        }
      }
    `;
    
    const pollResponse = await fetch(
      `https://${shop}/admin/api/2025-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': shopData.accessToken
        },
        body: JSON.stringify({ query: pollQuery })
      }
    );
    
    const pollData = await pollResponse.json();
    const operation = pollData.data?.node;
    
    status = operation.status;
    url = operation.url;
    
    if (status === 'FAILED') {
      throw new Error(`Bulk operation failed: ${operation.errorCode}`);
    }
  }
  
  // Step 3: Download results
  if (!url) {
    return [];
  }
  
  const dataResponse = await fetch(url);
  const jsonlData = await dataResponse.text();
  
  // Parse JSONL format (one JSON object per line)
  const results = jsonlData
    .trim()
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  
  return results;
}

// Example usage:
export async function bulkFetchAllProducts(shop) {
  const query = `
    {
      products {
        edges {
          node {
            id
            title
            handle
            description
            productType
            tags
            vendor
            variants {
              edges {
                node {
                  id
                  title
                  price
                  sku
                }
              }
            }
          }
        }
      }
    }
  `;
  
  return runBulkQuery(shop, query);
}
```

**Използвай за initial sync:**
```javascript
// backend/controllers/productsController.js
router.post('/bulk-sync', async (req, res) => {
  const shop = req.auth.shop;
  
  log.info('Starting bulk product sync', { shop });
  
  try {
    // Use bulk operation instead of paginated GraphQL
    const products = await bulkFetchAllProducts(shop);
    
    log.info('Bulk sync completed', { shop, count: products.length });
    
    // Save to MongoDB
    for (const product of products) {
      await Product.findOneAndUpdate(
        { shop, productId: product.id },
        { ...product, syncedAt: new Date() },
        { upsert: true }
      );
    }
    
    res.json({ success: true, count: products.length });
  } catch (error) {
    log.error('Bulk sync failed', { shop, error: error.message });
    res.status(500).json({ error: error.message });
  }
});
```

**Приоритет:** 🟢 НИСЪК  
**Очаквано време:** 3-4 часа  
**Impact:** Подобрява initial sync time с ~10x за stores с 1000+ products

**Статус:** ⏳ Pending

---

### 11. Event Listener Cleanup

**Проблем:**
- `backend/db/connection.js:84-105` добавя event listeners без cleanup
- Ако connection се reconnect-ва често, натрупват се listeners
- Potential memory leak

**Решение:**
```javascript
// backend/db/connection.js:84
setupEventHandlers() {
  // CRITICAL: Remove old listeners first to prevent duplicates
  mongoose.connection.removeAllListeners('error');
  mongoose.connection.removeAllListeners('disconnected');
  mongoose.connection.removeAllListeners('reconnected');
  mongoose.connection.removeAllListeners('close');
  
  // Then add new ones
  mongoose.connection.on('error', (err) => {
    dbLogger.error('❌ MongoDB connection error:', err.message);
    this.isConnected = false;
  });
  
  mongoose.connection.on('disconnected', () => {
    dbLogger.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
    this.isConnected = false;
    // Prevent multiple reconnect attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
  });
  
  mongoose.connection.on('reconnected', () => {
    dbLogger.info('✅ MongoDB reconnected');
    this.isConnected = true;
  });
  
  mongoose.connection.on('close', () => {
    dbLogger.info('🔒 MongoDB connection closed');
    this.isConnected = false;
    // Clear reconnect timeout on manual close
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  });
}
```

**Приоритет:** 🟢 НИСЪК  
**Очаквано време:** 30 минути  
**Impact:** Предотвратява memory leaks при reconnections

**Статус:** ⏳ Pending

---

### 12. GraphQL Query Optimization

**Проблем:**
- Някои GraphQL queries fetch-ват повече данни от нужното
- `backend/controllers/productsController.js` fetch-ва всички полета, дори когато не се използват

**Решение:**
```javascript
// Оптимизирай GraphQL queries да fetch-ват само нужните полета

// Преди (fetch всичко):
const query = `
  query($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          handle
          description
          productType
          tags
          vendor
          images(first: 10) { ... }
          variants(first: 50) { ... }
          metafields(first: 50) { ... }
        }
      }
    }
  }
`;

// След (fetch само нужното):
const PRODUCT_LIST_QUERY = `
  query($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          handle
          productType
          tags
          featuredImage {
            url
          }
        }
      }
    }
  }
`;

const PRODUCT_DETAILS_QUERY = `
  query($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      description
      productType
      tags
      vendor
      images(first: 10) {
        edges {
          node {
            url
            altText
          }
        }
      }
      variants(first: 50) {
        edges {
          node {
            id
            title
            price
            sku
          }
        }
      }
      metafields(first: 50, namespace: "indexaize") {
        edges {
          node {
            key
            value
            type
          }
        }
      }
    }
  }
`;
```

**Приоритет:** 🟢 НИСЪК  
**Очаквано време:** 2 часа  
**Impact:** Намалява Shopify API response size с ~50%, подобрява response time

**Статус:** ⏳ Pending

---

## 📈 ПРИОРИТИЗАЦИЯ И ВРЕМЕВА РАМКА

### Phase 1: Критични оптимизации (1-2 седмици)
- [ ] #1: Rate Limiting за AI API Calls (2-3 часа)
- [ ] #2: Webhook Queue с Retry Logic (3-4 часа)
- [ ] #3: MongoDB Connection Pool Optimization (1 час)

**Total Phase 1:** ~6-8 часа работа  
**Impact:** Предотвратява критични production issues

---

### Phase 2: Важни оптимизации (1 седмица)
- [ ] #4: Request Timeout за Shopify API (1-2 часа)
- [ ] #5: Увеличи Cache TTL (2 часа)
- [ ] #6: Добави `.lean()` навсякъде (2-3 часа)
- [ ] #7: Background Queue за Email (2-3 часа)

**Total Phase 2:** ~7-10 часа работа  
**Impact:** Значително подобрява performance и reliability

---

### Phase 3: Nice to Have (опционално, след launch)
- [ ] #8: Frontend Code Splitting (1 час)
- [ ] #9: Structured Logging (4-5 часа)
- [ ] #10: Shopify Bulk Operations (3-4 часа)
- [ ] #11: Event Listener Cleanup (30 мин)
- [ ] #12: GraphQL Query Optimization (2 часа)

**Total Phase 3:** ~10-13 часа работа  
**Impact:** Подобрява developer experience и long-term maintainability

---

## 📊 ОЧАКВАН IMPACT

### Performance Improvements:
- **Response Time:** ↓ 40-60% (чрез caching, .lean(), connection pooling)
- **Database Load:** ↓ 50-70% (чрез caching, query optimization)
- **Memory Usage:** ↓ 30-40% (чрез .lean(), memory leak fixes)
- **API Costs:** ↓ 30% (чрез rate limiting, smarter caching)

### Reliability Improvements:
- **Webhook Success Rate:** ↑ 99.9% (чрез retry queue)
- **Email Delivery Rate:** ↑ 99.5% (чрез background queue)
- **Timeout Errors:** ↓ 90% (чрез request timeouts)
- **Rate Limit Errors:** ↓ 100% (чрез AI queue)

### Scalability:
- **Concurrent Users:** 20 → 200+ (чрез connection pooling)
- **Products per Shop:** 1K → 50K+ (чрез bulk operations)
- **Requests per Second:** 10 → 100+ (чрез caching)

---

## 🔍 МОНИТОРИНГ И МЕТРИКИ

### Добави Production Monitoring:

```javascript
// backend/server.js - Admin monitoring endpoints

// System health
app.get('/api/admin/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: dbConnection.isReady() ? 'connected' : 'disconnected',
    redis: await cacheService.isConnected() ? 'connected' : 'disconnected',
    queues: {
      webhooks: await webhookQueue.getStats(),
      emails: await emailQueue.getStats(),
      ai: aiQueue.getStats()
    }
  };
  
  res.json(health);
});

// Performance metrics
app.get('/api/admin/metrics', async (req, res) => {
  const metrics = {
    database: {
      pool: getPoolStats(),
      queries: getQueryStats()
    },
    cache: {
      hits: await cacheService.getHits(),
      misses: await cacheService.getMisses(),
      hitRate: await cacheService.getHitRate()
    },
    api: {
      shopify: getShopifyAPIStats(),
      openrouter: getOpenRouterAPIStats()
    }
  };
  
  res.json(metrics);
});
```

---

## ✅ CHECKLIST ЗА ВСЯКА ОПТИМИЗАЦИЯ

Преди да маркираш нещо като "завършено":

- [ ] Код имплементиран и тестван локално
- [ ] Unit tests добавени (ако е приложимо)
- [ ] Тествано на staging environment
- [ ] Performance metrics измерени (преди/след)
- [ ] Документация обновена
- [ ] Code review направен
- [ ] Deployed на production
- [ ] Production monitoring показва подобрение

---

## 📝 NOTES

- Винаги тествай на staging преди production
- Измервай metrics преди и след всяка промяна
- Rollback plan за всяка критична промяна
- Документирай всички env variables и config changes
- Комуникирай с team преди breaking changes

---

## 🎯 NEXT STEPS

1. **Review този документ** и определи приоритети
2. **Започни с Phase 1** (критични оптимизации)
3. **Измери baseline metrics** преди да правиш промени
4. **Имплементирай една оптимизация наведнъж**
5. **Тествай и измервай impact**
6. **Продължи със следващата**

---

**Документ създаден:** 30 ноември 2024  
**Последна промяна:** 30 ноември 2024  
**Автор:** AI Assistant  
**Статус:** 🏗️ In Progress

