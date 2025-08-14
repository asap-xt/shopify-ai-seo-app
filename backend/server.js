// backend/server.js
// Entry for the app server (ESM). Serves API + webhooks + static frontend build.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Load env
dotenv.config();

// --- Import routers/controllers
// Shopify Managed Installation (token exchange)
import tokenExchange from './token-exchange.js';

// Billing API (plans, subscribe, plan info, reset)
import billing from './billing.js';

// SEO routes (POST /seo/product/:productId, etc.)
import seoRouter from './controllers/seoController.js';

// Webhook validator & handlers
import validateShopifyWebhook from './middleware/webhookValidator.js';
import productsWebhook from './webhooks/products.js';
import uninstallWebhook from './webhooks/uninstall.js';

// Optional: manual product-sync test endpoint
import { syncProductsForShop } from './controllers/productSync.js';

// Scheduler (auto sync per plan)
import { startScheduler } from './scheduler.js';

// --- App init
const app = express();

// --- BEGIN: Embed security headers (allow Shopify Admin to embed the app) ---
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
  );
  res.removeHeader('X-Frame-Options');
  next();
});
// --- END: Embed security headers ---

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// --- Health
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// --- Token exchange (Shopify-managed installation)
app.use('/token-exchange', tokenExchange);

// --- Billing API
app.use('/billing', billing);

// --- SEO API
app.use('/seo', seoRouter);

// --- Webhooks
app.post('/webhooks/products/update', validateShopifyWebhook, productsWebhook);
app.post('/webhooks/app/uninstalled', validateShopifyWebhook, uninstallWebhook);

// --- Test sync endpoint (manual trigger): /test-sync?shop=your-shop.myshopify.com
app.get('/test-sync', async (req, res) => {
  try {
    const shop = (req.query.shop || '').replace(/^https?:\/\//, '');
    if (!shop) return res.status(400).send('Missing ?shop= param');
    const count = await syncProductsForShop(shop);
    res.send(`✅ Synced ${count} products for ${shop}`);
  } catch (e) {
    console.error('Sync error:', e);
    res.status(500).send(`❌ Sync error: ${e.message}`);
  }
});

// --- MongoDB connect + start scheduler only once DB is up
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || 'seo-app';

async function connectMongo() {
  if (!MONGODB_URI) {
    console.warn('⚠️  MONGODB_URI is not set. The app will run but DB operations will fail.');
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI, {
      dbName: DB_NAME,
      serverSelectionTimeoutMS: 10000,
    });
    console.log('✅ Connected to MongoDB');

    // start scheduled jobs after DB is ready
    try {
      await startScheduler();
    } catch (err) {
      console.error('❌ Scheduler start error:', err);
    }
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    // Do not exit in Railway; let the platform restart if needed
  }
}
connectMongo();

// --- Static frontend (Polaris app) from /frontend/dist
// IMPORTANT: place AFTER API routes and BEFORE the catch-all.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDir = path.resolve(__dirname, '../frontend/dist');
app.use(express.static(frontendDir));

// Catch-all for client-side routing, but DO NOT intercept API/webhooks
app.get('*', (req, res, next) => {
  const p = req.path || '';
  if (
    p.startsWith('/webhooks') ||
    p.startsWith('/billing') ||
    p.startsWith('/seo') ||
    p.startsWith('/token-exchange') ||
    p.startsWith('/health') ||
    p.startsWith('/test-sync')
  ) {
    return next();
  }
  return res.sendFile(path.join(frontendDir, 'index.html'));
});

// --- Start server
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
