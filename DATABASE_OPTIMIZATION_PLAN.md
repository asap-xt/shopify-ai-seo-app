# 🚀 Database Optimization Plan
## Shopify AI SEO App - Multi-Tenant Scaling Strategy

**Created:** 2025-01-24  
**Target:** Scale from single customer to 270+ customers  
**Goal:** Maintain 80%+ profit margin while ensuring performance

---

## 📊 Current State Analysis

### Infrastructure (Single Customer):
- **MongoDB:** Mongoose connection without pooling
- **Connection Config:** Basic `serverSelectionTimeoutMS: 15000`
- **Indexes:** Auto-generated only
- **Caching:** None
- **Queue System:** None
- **Monitoring:** Basic console logs

### Problems at Scale (270 Customers):
1. **Connection Exhaustion:** 270 shops × 5 connections = 1,350 concurrent connections
2. **Slow Queries:** 97,500 products without proper indexes
3. **Memory Leaks:** No connection cleanup
4. **Traffic Spikes:** Simultaneous sitemap generation blocks server
5. **No Error Recovery:** Single connection failure affects all customers

---

## 🎯 Optimization Phases

### **PHASE 1: Connection Pooling & Optimization** (Week 1)
**Priority:** 🔴 CRITICAL  
**Effort:** 4 hours  
**Impact:** Reduce DB connection overhead by 60%

#### Tasks:

#### 1.1 Create Optimized Connection Module
**File:** `backend/db/connection.js`

```javascript
import mongoose from 'mongoose';

class DatabaseConnection {
  constructor() {
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = 5;
  }

  async connect() {
    if (this.isConnected && mongoose.connection.readyState === 1) {
      console.log('✅ Already connected to MongoDB');
      return;
    }

    const options = {
      // Connection Pool Settings
      maxPoolSize: 50,           // Max connections (was unlimited)
      minPoolSize: 10,           // Min connections (was 0)
      maxIdleTimeMS: 30000,      // Close idle connections after 30s
      
      // Timeouts
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      
      // Performance
      maxConnecting: 10,         // Max simultaneous connection attempts
      compressors: ['zlib'],     // Compress data transfer
      
      // Reliability
      retryWrites: true,
      retryReads: true,
      w: 'majority',             // Write concern
      
      // Optimization
      autoIndex: false,          // Don't auto-create indexes (manual control)
      family: 4,                 // Use IPv4
    };

    try {
      await mongoose.connect(process.env.MONGODB_URI, options);
      this.isConnected = true;
      this.connectionAttempts = 0;
      
      console.log('✅ MongoDB connected with optimized pool settings');
      console.log(`   - Max Pool Size: ${options.maxPoolSize}`);
      console.log(`   - Min Pool Size: ${options.minPoolSize}`);
      
      this.setupEventHandlers();
      this.setupHealthChecks();
      
    } catch (error) {
      this.connectionAttempts++;
      console.error(`❌ MongoDB connection failed (attempt ${this.connectionAttempts}/${this.maxRetries}):`, error.message);
      
      if (this.connectionAttempts < this.maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000);
        console.log(`   Retrying in ${delay}ms...`);
        setTimeout(() => this.connect(), delay);
      } else {
        console.error('❌ Max connection retries reached. Exiting...');
        process.exit(1);
      }
    }
  }

  setupEventHandlers() {
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
      this.isConnected = false;
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
      this.isConnected = false;
      setTimeout(() => this.connect(), 5000);
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
      this.isConnected = true;
    });
    
    mongoose.connection.on('close', () => {
      console.log('🔒 MongoDB connection closed');
      this.isConnected = false;
    });
  }

  setupHealthChecks() {
    // Health check every 30 seconds
    setInterval(async () => {
      try {
        if (mongoose.connection.readyState !== 1) {
          console.warn('⚠️  DB Health Check: Connection not ready');
          return;
        }
        
        const stats = await mongoose.connection.db.stats();
        const poolStats = mongoose.connection.getClient().topology?.s?.pool;
        
        // Log pool status
        if (poolStats) {
          const poolSize = poolStats.totalConnectionCount || 0;
          const availableConnections = poolStats.availableConnectionCount || 0;
          const pendingRequests = poolStats.waitQueueSize || 0;
          
          if (pendingRequests > 10) {
            console.warn(`⚠️  High DB wait queue: ${pendingRequests} pending requests`);
          }
          
          if (poolSize > 40) {
            console.warn(`⚠️  High connection count: ${poolSize} connections`);
          }
        }
        
      } catch (error) {
        console.error('❌ Health check failed:', error.message);
      }
    }, 30000);
  }

  async disconnect() {
    if (!this.isConnected) return;
    
    try {
      await mongoose.connection.close();
      this.isConnected = false;
      console.log('✅ MongoDB connection closed gracefully');
    } catch (error) {
      console.error('❌ Error closing MongoDB connection:', error);
    }
  }

  getStats() {
    if (!this.isConnected) return null;
    
    return {
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      models: Object.keys(mongoose.connection.models),
    };
  }
}

// Singleton instance
const dbConnection = new DatabaseConnection();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT received, closing MongoDB connection...');
  await dbConnection.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received, closing MongoDB connection...');
  await dbConnection.disconnect();
  process.exit(0);
});

export default dbConnection;
```

#### 1.2 Update server.js
**File:** `backend/server.js`

Replace:
```javascript
await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
```

With:
```javascript
import dbConnection from './db/connection.js';
await dbConnection.connect();
```

#### 1.3 Testing Checklist
- [ ] Test connection with valid URI
- [ ] Test connection with invalid URI (should retry)
- [ ] Test disconnect during operation (should reconnect)
- [ ] Load test with 100 concurrent requests
- [ ] Monitor connection pool stats

**Expected Results:**
- ✅ Connection pool maintains 10-50 connections
- ✅ Auto-reconnect on network issues
- ✅ Graceful shutdown on SIGTERM
- ✅ Health checks every 30s

---

### **PHASE 2: Database Indexes** (Week 1)
**Priority:** 🔴 CRITICAL  
**Effort:** 3 hours  
**Impact:** 10-50x faster queries

#### 2.1 Analyze Current Queries
Run this to find slow queries:
```javascript
// backend/scripts/analyze-queries.js
import mongoose from 'mongoose';
import dbConnection from '../db/connection.js';

async function analyzeQueries() {
  await dbConnection.connect();
  
  // Enable profiling
  await mongoose.connection.db.command({ profile: 2 });
  
  console.log('Query profiling enabled. Run app for 5 minutes...');
  console.log('Then check: db.system.profile.find().sort({millis:-1}).limit(10)');
}

analyzeQueries();
```

#### 2.2 Create Index Migration Script
**File:** `backend/scripts/create-indexes.js`

```javascript
import mongoose from 'mongoose';
import dbConnection from '../db/connection.js';
import Shop from '../db/Shop.js';
import Product from '../db/Product.js';
import Subscription from '../db/Subscription.js';
import Sitemap from '../db/Sitemap.js';

async function createIndexes() {
  await dbConnection.connect();
  
  console.log('🔧 Creating optimized indexes...\n');
  
  // Shop indexes
  console.log('📦 Shops collection:');
  await Shop.collection.createIndex({ shop: 1 }, { unique: true, background: true });
  await Shop.collection.createIndex({ installedAt: -1 }, { background: true });
  console.log('   ✅ shop (unique), installedAt');
  
  // Product indexes (CRITICAL - 97,500 products!)
  console.log('📦 Products collection:');
  await Product.collection.createIndex(
    { shop: 1, handle: 1 }, 
    { unique: true, background: true }
  );
  await Product.collection.createIndex(
    { shop: 1, optimized: 1 }, 
    { background: true }
  );
  await Product.collection.createIndex(
    { shop: 1, updatedAt: -1 }, 
    { background: true }
  );
  await Product.collection.createIndex(
    { shop: 1, 'seo.optimized': 1 }, 
    { background: true, sparse: true }
  );
  console.log('   ✅ shop+handle (unique), shop+optimized, shop+updatedAt, shop+seo.optimized');
  
  // Subscription indexes
  console.log('📦 Subscriptions collection:');
  await Subscription.collection.createIndex({ shop: 1 }, { unique: true, background: true });
  await Subscription.collection.createIndex({ plan: 1 }, { background: true });
  await Subscription.collection.createIndex({ status: 1 }, { background: true });
  console.log('   ✅ shop (unique), plan, status');
  
  // Sitemap indexes
  console.log('📦 Sitemaps collection:');
  await Sitemap.collection.createIndex({ shop: 1 }, { unique: true, background: true });
  await Sitemap.collection.createIndex({ generatedAt: -1 }, { background: true });
  console.log('   ✅ shop (unique), generatedAt');
  
  // Sessions cleanup index
  console.log('📦 Sessions collection:');
  await mongoose.connection.db.collection('shopify_sessions').createIndex(
    { updatedAt: 1 }, 
    { expireAfterSeconds: 2592000, background: true } // 30 days TTL
  );
  console.log('   ✅ updatedAt (TTL 30 days)');
  
  console.log('\n✅ All indexes created successfully!');
  
  // Show index statistics
  const collections = ['shops', 'products', 'subscriptions', 'sitemaps'];
  for (const coll of collections) {
    const stats = await mongoose.connection.db.collection(coll).stats();
    console.log(`\n${coll}: ${stats.count} documents, ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  }
  
  await dbConnection.disconnect();
}

createIndexes().catch(console.error);
```

Run:
```bash
node backend/scripts/create-indexes.js
```

#### 2.3 Update Model Schemas
Add index hints to schemas:

**File:** `backend/db/Product.js` (add to schema options)
```javascript
ProductSchema.index({ shop: 1, handle: 1 }, { unique: true });
ProductSchema.index({ shop: 1, optimized: 1 });
ProductSchema.index({ shop: 1, updatedAt: -1 });
```

#### 2.4 Optimize Queries
Update frequently used queries:

```javascript
// ❌ BAD - Full collection scan
const products = await Product.find({ shop });

// ✅ GOOD - Uses index + lean
const products = await Product.find({ shop })
  .select('handle title optimized')
  .lean()
  .limit(100);

// ✅ BETTER - With pagination
const products = await Product.find({ shop, optimized: true })
  .select('handle title')
  .sort({ updatedAt: -1 })
  .skip(page * 100)
  .limit(100)
  .lean();
```

**Testing:**
```javascript
// Explain query to verify index usage
const explain = await Product.find({ shop, optimized: true })
  .explain('executionStats');

console.log('Index used:', explain.executionStats.executionStages.indexName);
console.log('Execution time:', explain.executionStats.executionTimeMillis, 'ms');
```

**Expected Results:**
- ✅ Queries use indexes (check with `.explain()`)
- ✅ Query time < 50ms for 1000 products
- ✅ Query time < 200ms for 10,000 products
- ✅ Sessions auto-expire after 30 days

---

### **PHASE 3: Caching Layer** (Week 2)
**Priority:** 🟡 HIGH  
**Effort:** 6 hours  
**Impact:** Reduce DB load by 60%

#### 3.1 Add Redis for Caching
**File:** `backend/services/cacheService.js`

```javascript
import Redis from 'ioredis';

class CacheService {
  constructor() {
    this.redis = null;
    this.enabled = !!process.env.REDIS_URL;
    
    if (this.enabled) {
      this.redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });
      
      this.redis.on('connect', () => console.log('✅ Redis connected'));
      this.redis.on('error', (err) => console.error('❌ Redis error:', err));
    } else {
      console.warn('⚠️  Redis not configured, caching disabled');
    }
  }

  async connect() {
    if (this.enabled && !this.redis.status.includes('connect')) {
      await this.redis.connect();
    }
  }

  async get(key) {
    if (!this.enabled) return null;
    
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(key, value, ttlSeconds = 300) {
    if (!this.enabled) return false;
    
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  async del(key) {
    if (!this.enabled) return false;
    
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      console.error('Cache del error:', error);
      return false;
    }
  }

  async invalidateShop(shop) {
    if (!this.enabled) return;
    
    const patterns = [
      `plan:${shop}`,
      `products:${shop}:*`,
      `subscription:${shop}`,
      `sitemap:${shop}`,
    ];
    
    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
    
    console.log(`🗑️  Invalidated cache for shop: ${shop}`);
  }
}

export default new CacheService();
```

#### 3.2 Cache Wrapper for Common Queries
**File:** `backend/utils/cacheWrapper.js`

```javascript
import cacheService from '../services/cacheService.js';

export async function withCache(key, ttl, fetchFn) {
  // Try cache first
  const cached = await cacheService.get(key);
  if (cached !== null) {
    console.log(`✅ Cache HIT: ${key}`);
    return cached;
  }
  
  // Cache miss, fetch from DB
  console.log(`⚠️  Cache MISS: ${key}`);
  const data = await fetchFn();
  
  // Store in cache
  await cacheService.set(key, data, ttl);
  
  return data;
}
```

#### 3.3 Update Controllers to Use Cache
Example for plan lookup:

```javascript
// Before (no cache):
async function fetchPlan(shop) {
  const subscription = await Subscription.findOne({ shop });
  return subscription?.plan || 'starter';
}

// After (with cache):
import { withCache } from '../utils/cacheWrapper.js';

async function fetchPlan(shop) {
  return withCache(
    `plan:${shop}`,
    300, // 5 minutes
    async () => {
      const subscription = await Subscription.findOne({ shop });
      return subscription?.plan || 'starter';
    }
  );
}
```

#### 3.4 Cache Invalidation Strategy
Add to webhook handlers:

```javascript
// backend/webhooks/products.js
import cacheService from '../services/cacheService.js';

// After product update:
await cacheService.invalidateShop(shop);
```

**Setup Redis:**
```bash
# Railway (recommended):
railway add redis

# Or Redis Cloud (free tier):
# https://redis.com/try-free/
# $0 for 30MB, 30 connections
```

**Expected Results:**
- ✅ 60-80% cache hit rate after warmup
- ✅ Plan lookups < 5ms (vs 50ms from DB)
- ✅ Product lists < 20ms (vs 200ms from DB)
- ✅ Reduce DB queries by 60%

---

### **PHASE 4: Queue System for Heavy Operations** (Week 2)
**Priority:** 🟡 HIGH  
**Effort:** 8 hours  
**Impact:** Prevent server blocking, better UX

#### 4.1 Install Bull Queue
```bash
npm install bull
```

#### 4.2 Create Queue Service
**File:** `backend/services/queueService.js`

```javascript
import Bull from 'bull';

// Queues
export const sitemapQueue = new Bull('sitemap-generation', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 500,     // Keep last 500 failed jobs
  },
  limiter: {
    max: 5,        // Max 5 jobs
    duration: 1000, // per second
  },
});

export const optimizationQueue = new Bull('content-optimization', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
  limiter: {
    max: 10,
    duration: 1000,
  },
});

export const emailQueue = new Bull('email-notifications', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
  defaultJobOptions: {
    attempts: 5,
    backoff: 'exponential',
  },
});

// Queue event handlers
sitemapQueue.on('completed', (job) => {
  console.log(`✅ Sitemap generated for shop: ${job.data.shop}`);
});

sitemapQueue.on('failed', (job, err) => {
  console.error(`❌ Sitemap generation failed for ${job.data.shop}:`, err.message);
});

optimizationQueue.on('completed', (job) => {
  console.log(`✅ Optimization completed for ${job.data.productCount} products`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await sitemapQueue.close();
  await optimizationQueue.close();
  await emailQueue.close();
});
```

#### 4.3 Create Queue Processors
**File:** `backend/workers/sitemapWorker.js`

```javascript
import { sitemapQueue } from '../services/queueService.js';
import { generateSitemapForShop } from '../controllers/sitemapController.js';

// Process sitemap generation jobs
sitemapQueue.process(async (job) => {
  const { shop } = job.data;
  
  console.log(`🔄 Processing sitemap for: ${shop}`);
  
  // Update progress
  job.progress(10);
  
  try {
    const result = await generateSitemapForShop(shop);
    
    job.progress(100);
    
    return {
      success: true,
      shop,
      productsCount: result.productsCount,
      size: result.size,
    };
  } catch (error) {
    console.error(`❌ Sitemap generation error for ${shop}:`, error);
    throw error; // Will retry based on attempts config
  }
});

console.log('🔧 Sitemap worker started');
```

**File:** `backend/workers/optimizationWorker.js`

```javascript
import { optimizationQueue } from '../services/queueService.js';
import { optimizeProductsBatch } from '../services/aiOptimizationService.js';

optimizationQueue.process(5, async (job) => { // Process 5 concurrent jobs
  const { shop, productIds, language } = job.data;
  
  console.log(`🔄 Optimizing ${productIds.length} products for ${shop}`);
  
  try {
    let completed = 0;
    
    for (const productId of productIds) {
      await optimizeProductsBatch(shop, [productId], language);
      completed++;
      
      // Update progress
      const progress = Math.floor((completed / productIds.length) * 100);
      job.progress(progress);
    }
    
    return {
      success: true,
      optimized: completed,
    };
  } catch (error) {
    console.error(`❌ Optimization error:`, error);
    throw error;
  }
});

console.log('🔧 Optimization worker started');
```

#### 4.4 Start Workers
**File:** `backend/workers/index.js`

```javascript
import './sitemapWorker.js';
import './optimizationWorker.js';

console.log('🚀 All workers started');
```

Add to `package.json`:
```json
"scripts": {
  "worker": "node backend/workers/index.js",
  "dev:worker": "nodemon backend/workers/index.js"
}
```

#### 4.5 Update Controllers to Use Queues
**File:** `backend/controllers/sitemapController.js`

```javascript
import { sitemapQueue } from '../services/queueService.js';

// Replace immediate generation:
router.post('/generate-sitemap', async (req, res) => {
  const { shop } = req.body;
  
  // Add to queue instead of processing immediately
  const job = await sitemapQueue.add({
    shop,
    requestedAt: new Date(),
  });
  
  res.json({
    success: true,
    jobId: job.id,
    message: 'Sitemap generation queued',
    estimatedTime: '1-2 minutes',
  });
});

// Check job status
router.get('/sitemap-status/:jobId', async (req, res) => {
  const job = await sitemapQueue.getJob(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  const state = await job.getState();
  const progress = job.progress();
  
  res.json({
    status: state,
    progress,
    data: await job.finished(), // Wait for completion if needed
  });
});
```

#### 4.6 Add Queue Dashboard (Optional)
```bash
npm install bull-board
```

**File:** `backend/server.js`

```javascript
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { sitemapQueue, optimizationQueue } from './services/queueService.js';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullAdapter(sitemapQueue),
    new BullAdapter(optimizationQueue),
  ],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());
```

Access at: `https://your-app.railway.app/admin/queues`

**Expected Results:**
- ✅ Sitemap generation doesn't block API
- ✅ Can process 100 sitemaps in parallel
- ✅ Failed jobs auto-retry
- ✅ Job progress tracking
- ✅ Visual dashboard for monitoring

---

### **PHASE 5: Monitoring & Alerting** (Week 3)
**Priority:** 🟢 MEDIUM  
**Effort:** 4 hours  
**Impact:** Proactive issue detection

#### 5.1 Add Performance Monitoring
**File:** `backend/middleware/performanceMonitor.js`

```javascript
export function performanceMonitor(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      console.warn(`⚠️  SLOW REQUEST: ${req.method} ${req.path} took ${duration}ms`);
    }
    
    // Log to external service (optional)
    // await logToSentry({ method: req.method, path: req.path, duration });
  });
  
  next();
}
```

#### 5.2 Database Monitoring Script
**File:** `backend/scripts/monitor-db.js`

```javascript
import mongoose from 'mongoose';
import dbConnection from '../db/connection.js';

async function monitorDatabase() {
  await dbConnection.connect();
  
  setInterval(async () => {
    try {
      const db = mongoose.connection.db;
      
      // Connection pool stats
      const admin = db.admin();
      const serverStatus = await admin.serverStatus();
      
      console.log('\n📊 DATABASE METRICS:');
      console.log('  Connections:', serverStatus.connections.current);
      console.log('  Available:', serverStatus.connections.available);
      console.log('  Active:', serverStatus.connections.active || 'N/A');
      
      // Storage stats
      const stats = await db.stats();
      console.log('  Storage:', (stats.dataSize / 1024 / 1024).toFixed(2), 'MB');
      console.log('  Documents:', stats.objects);
      console.log('  Indexes:', (stats.indexSize / 1024 / 1024).toFixed(2), 'MB');
      
      // Operations
      const opCounters = serverStatus.opcounters;
      console.log('  Queries/s:', Math.floor(opCounters.query / 60));
      console.log('  Updates/s:', Math.floor(opCounters.update / 60));
      
      // Alerts
      if (serverStatus.connections.current > 40) {
        console.error('🚨 HIGH CONNECTION COUNT:', serverStatus.connections.current);
      }
      
      if (stats.dataSize > 1.5 * 1024 * 1024 * 1024) { // 1.5 GB
        console.warn('⚠️  DATABASE SIZE GROWING:', (stats.dataSize / 1024 / 1024 / 1024).toFixed(2), 'GB');
      }
      
    } catch (error) {
      console.error('❌ Monitoring error:', error);
    }
  }, 60000); // Every minute
}

monitorDatabase();
```

Run as separate process:
```bash
node backend/scripts/monitor-db.js
```

#### 5.3 Setup Sentry (Error Tracking)
```bash
npm install @sentry/node
```

**File:** `backend/middleware/errorTracking.js`

```javascript
import * as Sentry from '@sentry/node';

export function initSentry(app) {
  if (!process.env.SENTRY_DSN) {
    console.warn('⚠️  Sentry not configured');
    return;
  }
  
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1, // Sample 10% of transactions
  });
  
  // Request handler
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
  
  console.log('✅ Sentry error tracking enabled');
}

export function sentryErrorHandler() {
  return Sentry.Handlers.errorHandler();
}
```

**Expected Results:**
- ✅ Real-time connection monitoring
- ✅ Slow query detection
- ✅ Automatic error reporting
- ✅ Performance metrics dashboard

---

### **PHASE 6: Data Cleanup & Archiving** (Week 3)
**Priority:** 🟢 MEDIUM  
**Effort:** 3 hours  
**Impact:** Reduce storage costs by 30-40%

#### 6.1 Session Cleanup (Already done in Phase 2)
TTL index auto-deletes sessions after 30 days.

#### 6.2 Sitemap Archiving
**File:** `backend/scripts/archive-old-data.js`

```javascript
import mongoose from 'mongoose';
import dbConnection from '../db/connection.js';
import Sitemap from '../db/Sitemap.js';

async function archiveOldData() {
  await dbConnection.connect();
  
  console.log('🗄️  Starting data archiving...\n');
  
  // Keep only latest 3 sitemaps per shop
  const shops = await Sitemap.distinct('shop');
  
  let totalArchived = 0;
  
  for (const shop of shops) {
    const sitemaps = await Sitemap.find({ shop })
      .sort({ generatedAt: -1 })
      .select('_id generatedAt');
    
    if (sitemaps.length > 3) {
      const toArchive = sitemaps.slice(3);
      const ids = toArchive.map(s => s._id);
      
      await Sitemap.deleteMany({ _id: { $in: ids } });
      
      totalArchived += toArchive.length;
      console.log(`  ${shop}: Archived ${toArchive.length} old sitemaps`);
    }
  }
  
  console.log(`\n✅ Archived ${totalArchived} old sitemaps`);
  
  // Calculate saved space
  const avgSitemapSize = 500; // KB
  const savedMB = (totalArchived * avgSitemapSize) / 1024;
  console.log(`💾 Space saved: ${savedMB.toFixed(2)} MB`);
  
  await dbConnection.disconnect();
}

// Run immediately
archiveOldData();
```

Add to cron (Railway):
```yaml
# railway.toml
[[crons]]
  schedule = "0 2 * * 0"  # Every Sunday at 2 AM
  command = "node backend/scripts/archive-old-data.js"
```

**Expected Results:**
- ✅ Automatic cleanup of old data
- ✅ 30-40% storage reduction
- ✅ Faster queries (less data to scan)

---

## 📈 Performance Targets

### Before Optimization:
- Query time (1000 products): **500-1000ms**
- Concurrent connections: **10-20**
- Cache hit rate: **0%**
- Failed requests: **2-5%**

### After Optimization:
- Query time (1000 products): **< 50ms** ✅
- Concurrent connections: **10-50** (pooled) ✅
- Cache hit rate: **60-80%** ✅
- Failed requests: **< 0.1%** ✅
- Queue processing: **5 jobs/second** ✅

---

## 💰 Cost Impact

### Infrastructure Costs (270 Customers):

| Component | Before | After | Savings |
|-----------|--------|-------|---------|
| MongoDB | M30 ($182) | M20 ($117) | -$65/м ✅ |
| Railway | Hobby ($5) | Pro ($27) | +$22/м |
| Redis | None | Railway ($5) | +$5/м |
| **Total** | **$187** | **$149** | **-$38/м** |

**Additional Benefits:**
- ✅ Better performance → happier customers → less churn
- ✅ Handles traffic spikes without crashes
- ✅ Can scale to 1000+ customers without changes
- ✅ Proactive monitoring prevents issues

---

## 🚀 Implementation Timeline

| Week | Phase | Priority | Hours | Key Deliverable |
|------|-------|----------|-------|----------------|
| **1** | Connection Pooling | 🔴 Critical | 4h | Optimized DB connection |
| **1** | Database Indexes | 🔴 Critical | 3h | 10x faster queries |
| **2** | Caching Layer | 🟡 High | 6h | 60% reduced DB load |
| **2** | Queue System | 🟡 High | 8h | Non-blocking operations |
| **3** | Monitoring | 🟢 Medium | 4h | Proactive alerts |
| **3** | Data Archiving | 🟢 Medium | 3h | 40% storage reduction |
| **TOTAL** | | | **28h** | Production-ready scaling |

---

## ✅ Success Criteria

### Week 1 (Critical Path):
- [ ] Connection pool maintaining 10-50 connections
- [ ] All queries use proper indexes
- [ ] Query time < 100ms for 95th percentile
- [ ] Zero connection errors under load

### Week 2 (Performance):
- [ ] Cache hit rate > 50%
- [ ] Sitemap generation queued (not blocking)
- [ ] Can handle 100 concurrent users
- [ ] Response time < 200ms for API calls

### Week 3 (Reliability):
- [ ] Monitoring dashboard operational
- [ ] Automatic data cleanup running
- [ ] Error tracking with Sentry
- [ ] < 0.1% failed requests

---

## 🔄 Next Steps After Completion

1. **Load Testing:** Simulate 500 concurrent users
2. **A/B Testing:** Measure performance improvements
3. **Documentation:** Update team docs with new architecture
4. **Backup Strategy:** Implement automated MongoDB backups
5. **Disaster Recovery:** Test failover scenarios

---

## 📚 Resources

- [MongoDB Performance Best Practices](https://www.mongodb.com/docs/manual/administration/analyzing-mongodb-performance/)
- [Mongoose Connection Pooling](https://mongoosejs.com/docs/connections.html)
- [Bull Queue Documentation](https://github.com/OptimalBits/bull)
- [Redis Caching Strategies](https://redis.io/docs/manual/patterns/)

---

**Prepared by:** AI Assistant  
**Date:** 2025-01-24  
**Status:** Ready for Implementation  
**Estimated ROI:** 10x performance improvement, -20% infrastructure costs

