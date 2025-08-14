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
import authRouter from './auth.js';                      // OAuth (Public)
import billing from './billing.js';                      // Billing API
import seoRouter from './controllers/seoController.js';  // SEO routes
import validateShopifyWebhook from './middleware/webhookValidator.js';
import productsWebhook from './webhooks/products.js';
import uninstallWebhook from './webhooks/uninstall.js';
import { syncProductsForShop } from './controllers/productSync.js';
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

// Важно: изключваме helmet.contentSecurityPolicy, за да не override-не горния хедър
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan('tiny'));

// --- Health
app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

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

// --- Start server FIRST, then connect Mongo (to avoid Railway 502 if DB is slow)
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`✓ Server listening on port ${PORT}`);
  // стартирaме scheduler след старта, за да не блокираме boot-а
  try { startScheduler(); } catch (e) { console.error('Scheduler start error:', e); }
});

// --- Connect Mongo (async, non-blocking)
mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// --- Safety: log unhandled promise rejections / exceptions
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
