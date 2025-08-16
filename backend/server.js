// backend/server.js
// App server (ESM). Serves API + webhooks + static frontend build (SPA).

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

// --- Normalize app URLs (avoid trailing slashes that break Shopify redirects)
const normalizeUrl = (url) => (url ? url.replace(/\/+$/, '') : '');
process.env.APP_URL = normalizeUrl(process.env.APP_URL);
process.env.BASE_URL = normalizeUrl(process.env.BASE_URL);
process.env.HOST = normalizeUrl(process.env.HOST);
process.env.SHOPIFY_APP_URL = normalizeUrl(process.env.SHOPIFY_APP_URL);

// DEBUG: Log all environment URLs
console.log('[ENV CHECK] URLs:', {
  APP_URL: process.env.APP_URL,
  BASE_URL: process.env.BASE_URL,
  HOST: process.env.HOST,
  SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ? 'SET' : 'NOT SET',
  SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET ? 'SET' : 'NOT SET',
});

// Routers / controllers
import authRouter from './auth.js';                      // OAuth (Public)
import tokenExchangeRouter from './token-exchange.js';   // ✅ ADD TOKEN EXCHANGE
import billing from './billing.js';                      // Billing API
import seoRouter from './controllers/seoController.js';  // SEO routes
import validateShopifyWebhook from './middleware/webhookValidator.js';
import productsWebhook from './webhooks/products.js';
import uninstallWebhook from './webhooks/uninstall.js';
import { syncProductsForShop } from './controllers/productSync.js';
import { startScheduler } from './scheduler.js';

// Optional CSP helper (must allow embedding)
import csp from './middleware/csp.js';

const app = express();

// ---- Security: allow embedding inside Shopify Admin (iframe)
app.use(csp);
app.use((req, res, next) => {
  // Keep this header explicit. Helmet CSP is disabled below to avoid overrides.
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
  );
  res.removeHeader('X-Frame-Options'); // obsolete with CSP, but some proxies still add it
  next();
});

// Base hardening
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));

// Request log with more details for debugging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));
app.use(cookieParser());

// JSON parser all but webhooks
app.use((req, res, next) => {
  if (req.path.startsWith('/webhooks/')) {
    // За webhooks - запазваме raw body
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      req.rawBody = data;
      try {
        req.body = data ? JSON.parse(data) : {};
      } catch {
        req.body = {};
      }
      next();
    });
  } else {
    // За всичко друго - нормален JSON parser
    express.json({ limit: '2mb' })(req, res, next);
  }
});

// ---- Health
app.get('/health', (_req, res) => res.status(200).json({ status: 'OK' }));

// ---- Debug routes (always include for troubleshooting)
app.get('/debug/ping', (_req, res) => res.status(200).json({ ok: true }));

app.get('/debug/routes', (_req, res) => {
  const routes = [];
  const stack = app._router?.stack || [];
  for (const layer of stack) {
    if (layer.route?.path) {
      const methods = Object.keys(layer.route.methods);
      routes.push({ methods, path: layer.route.path });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      for (const r of layer.handle.stack) {
        if (r.route?.path) {
          const methods = Object.keys(r.route.methods);
          routes.push({ methods, path: r.route.path });
        }
      }
    }
  }
  res.status(200).json({ routes });
});

// ---- DEBUG: Log all incoming requests for troubleshooting
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, {
    query: req.query,
    headers: {
      host: req.get('host'),
      referer: req.get('referer'),
      'user-agent': req.get('user-agent'),
    }
  });
  next();
});

// ---- APIs (mount BEFORE static)
app.use(authRouter);                        // OAuth (kept at root so /auth/* works)
app.use('/token-exchange', tokenExchangeRouter);  // ✅ MOUNT TOKEN EXCHANGE
app.use('/billing', billing);               // Billing actions
app.use('/seo', seoRouter);                 // SEO API

// ---- Webhooks
app.post('/webhooks/products/update', validateShopifyWebhook, productsWebhook);
app.post('/webhooks/app/uninstalled', validateShopifyWebhook, uninstallWebhook);

// Manual product sync (dev only)
if (process.env.NODE_ENV !== 'production') {
  app.get('/sync-products/:shop', async (req, res) => {
    const { shop } = req.params;
    await syncProductsForShop(shop);
    res.status(200).json({ message: `Products synced for shop ${shop}` });
  });
}

// ---- Static frontend build (SPA)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../frontend/dist');

// List built assets (dev aid)
if (process.env.NODE_ENV !== 'production') {
  app.get('/debug/assets', (_req, res) => {
    try {
      const files = fs.readdirSync(distPath);
      res.json({ distExists: true, files });
    } catch {
      res.json({ distExists: false, files: [] });
    }
  });
}

// Serve static files (no index by default; SPA handled below)
app.use(
  express.static(distPath, {
    index: false,
    maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  })
);

// Explicit SPA routes that should return index.html
const spaRoutes = ['/', '/dashboard', '/ai-seo', '/billing', '/settings'];
spaRoutes.forEach((route) => {
  app.get(route, (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
});

// Generic SPA fallback: anything that is not API/webhooks/debug/assets
app.get(/^\/(?!api\/|webhooks\/|debug\/|assets\/|seo\/|billing\/|auth\/|token-exchange\/).*/i, (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ---- Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ---- Start server (then async-connect to Mongo)
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✔ Server listening on port ${PORT}`);
  console.log(`✔ Auth endpoint: ${process.env.APP_URL}/auth`);
  console.log(`✔ Token exchange endpoint: ${process.env.APP_URL}/token-exchange`);
  try {
    startScheduler();
  } catch (e) {
    console.error('Scheduler start error:', e);
  }
});

// Mongo connect (non-blocking)
mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Last-resort 404 (should rarely trigger thanks to SPA fallback)
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl}`);
  res.status(404).send('Not found by backend');
});

// Safety logs
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));