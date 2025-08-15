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

dotenv.config();

// --- Normalize APP URLs (remove trailing slash if present)
const normalizeUrl = (url) => url?.replace(/\/+$/, '') || '';
process.env.APP_URL = normalizeUrl(process.env.APP_URL);
process.env.BASE_URL = normalizeUrl(process.env.BASE_URL);
process.env.HOST = normalizeUrl(process.env.HOST);
process.env.SHOPIFY_APP_URL = normalizeUrl(process.env.SHOPIFY_APP_URL);

// Debug log normalized URLs
console.log('[URL CONFIG]', {
  APP_URL: process.env.APP_URL,
  BASE_URL: process.env.BASE_URL,
  HOST: process.env.HOST,
  SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL
});

import authRouter from './auth.js';                      // OAuth (Public)
import billing from './billing.js';                      // Billing API
import seoRouter from './controllers/seoController.js';  // SEO routes
import validateShopifyWebhook from './middleware/webhookValidator.js';
import productsWebhook from './webhooks/products.js';
import uninstallWebhook from './webhooks/uninstall.js';
import { syncProductsForShop } from './controllers/productSync.js';
import { startScheduler } from './scheduler.js';

const app = express();

// Allow embedding in Shopify Admin (CSP frame-ancestors)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors https://admin.shopify.com https://*.myshopify.com;");
  res.removeHeader('X-Frame-Options');
  next();
});

// Disable helmet CSP so it doesn't override the header above
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));

// Verbose request logger (in addition to morgan)
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.originalUrl}`);
  next();
});

// RAW BODY for webhooks (must be BEFORE express.json)
app.use((req, res, next) => {
  if (!req.path.startsWith('/webhooks/')) return next();
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    try { req.body = data ? JSON.parse(data) : {}; } catch { req.body = {}; }
    next();
  });
});

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan('tiny'));

// --- Debug endpoints
app.get('/debug/ping', (_req, res) => res.status(200).json({ ok: true }));
app.get('/debug/routes', (_req, res) => {
  const routes = [];
  const stack = app._router?.stack || [];
  for (const layer of stack) {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods).filter(Boolean);
      routes.push({ methods, path: layer.route.path });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      for (const r of layer.handle.stack) {
        if (r.route?.path) {
          const methods = Object.keys(r.route.methods).filter(Boolean);
          routes.push({ methods, path: r.route.path });
        }
      }
    }
  }
  res.status(200).json({ routes });
});

// Health
app.get('/health', (_req, res) => res.status(200).json({ status: 'OK' }));

// OAuth (Public distribution) – mount WITHOUT prefix so /auth works
app.use(authRouter);

// Billing & SEO APIs
app.use('/billing', billing);
app.use('/seo', seoRouter);

// Webhooks
app.post('/webhooks/products/update', validateShopifyWebhook, productsWebhook);
app.post('/webhooks/app/uninstalled', validateShopifyWebhook, uninstallWebhook);

// Manual product sync (debug)
app.get('/sync-products/:shop', async (req, res) => {
  const { shop } = req.params;
  await syncProductsForShop(shop);
  res.status(200).json({ message: `Products synced for shop ${shop}` });
});

// Serve frontend build
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, '../frontend/dist');

app.get('/debug/assets', (_req, res) => {
  try {
    const fs = require('fs');
    const files = fs.readdirSync(distPath);
    res.json({ distExists: true, files });
  } catch {
    res.json({ distExists: false, files: [] });
  }
});

app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start server FIRST, then connect Mongo
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✓ Server listening on port ${PORT}`);
  try { startScheduler(); } catch (e) { console.error('Scheduler start error:', e); }
});

// Connect Mongo (async, non-blocking)
mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Global 404 handler
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl}`);
  res.status(404).send('Not found by backend');
});

// Safety logs
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
