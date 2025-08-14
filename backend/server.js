// backend/server.js
// Entry for the app server (ESM). Serves API + webhooks + static frontend build.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Load env
dotenv.config();

// --- Import routers/controllers
// OAuth (Public distribution)
import authRouter from './auth.js';

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
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan('tiny'));

// --- Health
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// --- OAuth (Public distribution)
app.use(authRouter);

// --- Billing API
app.use('/billing', billing);

// --- SEO API
app.use('/seo', seoRouter);

// --- Webhooks
app.post('/webhooks/products/update', validateShopifyWebhook, productsWebhook);
app.post('/webhooks/app/uninstalled', validateShopifyWebhook, uninstallWebhook);

// --- Optional: test product sync manually
app.get('/sync-products/:shop', async (req, res) => {
  const { shop } = req.params;
  await syncProductsForShop(shop);
  res.status(200).json({ message: `Products synced for shop ${shop}` });
});

// --- Serve frontend build
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist', 'index.html'));
});

// --- Start server & scheduler
const PORT = process.env.PORT || 8080;
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => {
      console.log(`✓ Server listening on port ${PORT}`);
      startScheduler();
    });
  })
  .catch((err) => console.error(err));
