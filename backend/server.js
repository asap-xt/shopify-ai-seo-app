// backend/server.js
// Express server for the Shopify AI SEO app (ESM).
// All comments are in English.
// Force rebuild - temp comment

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Optional Mongo (only if MONGODB_URI provided)
import mongoose from 'mongoose';

// ---------------------------------------------------------------------------
// ESM __dirname
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Security (Shopify-embed friendly)
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: false, // real CSP is set below for frame-ancestors
    crossOriginEmbedderPolicy: false,
  })
);

// Allow embedding in Shopify Admin (required for embedded apps)
app.use((_, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    'frame-ancestors https://admin.shopify.com https://*.myshopify.com;'
  );
  next();
});

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---------------------------------------------------------------------------
/** Health / debug */
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));
app.get('/readyz', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

// ---------------------------------------------------------------------------
// Routers (mounted before static). These imports must exist in the project.
// ---------------------------------------------------------------------------
import authRouter from './auth.js';                      // mounts /auth
import tokenExchangeRouter from './token-exchange.js';   // mounts /token-exchange
import billingRouter from './billing.js';                // mounts /billing/*
import seoRouter from './controllers/seoController.js';  // mounts /plans/me, /seo/*
import languageRouter from './controllers/languageController.js';  // mounts /api/languages/*
import multiSeoRouter from './controllers/multiSeoController.js';  // mounts /api/seo/*
import debugRouter from './controllers/debugRouter.js';
import productsRouter from './controllers/productsController.js';
import sitemapRouter from './controllers/sitemapController.js';
import storeRouter from './controllers/storeController.js';
import schemaRouter from './controllers/schemaController.js';
import aiDiscoveryRouter from './controllers/aiDiscoveryController.js';
import aiEndpointsRouter from './controllers/aiEndpointsController.js';
import aiEnhanceRouter from './controllers/aiEnhanceController.js';
import advancedSchemaRouter from './controllers/advancedSchemaController.js';

// Mount core routers
app.use(authRouter);
app.use('/token-exchange', tokenExchangeRouter);
app.use('/billing', billingRouter);
app.use(seoRouter);
app.use('/api/languages', languageRouter); // -> /api/languages/product/:shop/:productId
app.use('/api/seo', multiSeoRouter); // -> /api/seo/generate-multi, /api/seo/apply-multi
app.use('/debug', debugRouter);
app.use('/api/products', productsRouter);
app.use(schemaRouter);
app.use('/api', aiDiscoveryRouter);
app.use(aiEndpointsRouter);
app.use('/ai-enhance', aiEnhanceRouter);
app.use('/api/schema', advancedSchemaRouter);

// Sitemap routes
app.use('/api/sitemap', sitemapRouter);

// Store metadata routes
app.use('/api/store', storeRouter);

// ---------------------------------------------------------------------------
// Optional routers / webhooks: mounted inside start() so we can import
// them conditionally without breaking the build if files are missing.
// ---------------------------------------------------------------------------
async function mountOptionalRouters(app) {
  // Webhook validator + product webhooks
  try {
    const { default: validateShopifyWebhook } = await import('./middleware/webhookValidator.js');
    const { default: productsWebhook } = await import('./webhooks/products.js');
    const { default: uninstallWebhook } = await import('./webhooks/uninstall.js');

    // Example webhook endpoints (adjust paths if your files expect different)
    app.post('/webhooks/products', validateShopifyWebhook, productsWebhook);
    app.post('/webhooks/app/uninstalled', validateShopifyWebhook, uninstallWebhook);
    console.log('✔ Webhooks mounted');
  } catch (e) {
    console.log('ℹ Webhooks not mounted (missing files or import error).', e?.message || '');
  }

  // Feed (optional drop-in)
  try {
    const { default: feedRouter } = await import('./controllers/feedController.js');
    app.use('/ai', feedRouter); // e.g. GET /ai/feed/catalog.ndjson
    console.log('✔ Feed controller mounted');
  } catch {
    // not present – skip
  }

  // Product sync admin endpoint (optional)
  try {
    const { syncProductsForShop } = await import('./controllers/productSync.js');
    app.post('/api/admin/sync', async (req, res) => {
      try {
        const { shop } = req.body || {};
        if (!shop) return res.status(400).json({ error: 'Missing shop' });
        const result = await syncProductsForShop(shop);
        res.status(200).json({ ok: true, result });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    console.log('✔ Product sync endpoint mounted');
  } catch {
    // not present – skip
  }
}

// Handle Shopify's app handle routing for embedded apps
app.get('/apps/new-ai-seo', (req, res) => {
  // Serve the same index.html for embedded app
  const distPath = path.join(__dirname, '..', 'frontend', 'dist');
  res.set('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com;');
  res.sendFile(path.join(distPath, 'index.html'));
});

app.get('/apps/new-ai-seo/*', (req, res) => {
  // Handle any sub-paths
  const distPath = path.join(__dirname, '..', 'frontend', 'dist');
  res.set('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com;');
  res.sendFile(path.join(distPath, 'index.html'));
});

// Handle Shopify's app handle routing for embedded apps
app.get('/apps/new-ai-seo', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com;');
  res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

app.get('/apps/new-ai-seo/*', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com;');
  res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

// ---------------------------------------------------------------------------
// Static frontend (Vite build). We never cache index.html.
// We DO NOT use a catch-all regex to avoid shadowing /auth and other APIs.
// ---------------------------------------------------------------------------
const distPath = path.join(__dirname, '..', 'frontend', 'dist');

// Serve assets (no index by default; SPA routes return it explicitly)
app.use(
  express.static(distPath, {
    index: false,
    etag: false,
    lastModified: false,
    maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0, // long-cache hashed assets
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store'); // HTML must always be fresh
      }
    },
  })
);

// Public sitemap route
app.get('/sitemap.xml', (req, res) => {
  const shop = req.query.shop || req.headers.host?.replace('.myshopify.com', '');
  if (!shop) {
    return res.status(400).send('Shop not specified');
  }
  // Redirect to the API endpoint
  res.redirect(`/api/sitemap/generate?shop=${encodeURIComponent(shop)}`);
});

// Serve index.html for SPA routes (including root with query params)
app.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(distPath, 'index.html'));
});

// Other SPA routes
const otherSpaRoutes = ['/dashboard', '/ai-seo', '/billing', '/settings', '/store-metadata'];
otherSpaRoutes.forEach((route) => {
  app.get(route, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(distPath, 'index.html'));
  });
});

// Debug: list all mounted routes
app.get('/debug/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((layer) => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      routes.push({ methods, path: layer.route.path });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      for (const r of layer.handle.stack) {
        if (r.route?.path) {
          const methods = Object.keys(r.route.methods).filter((m) => r.route.methods[m]);
          routes.push({ methods, path: r.route.path });
        }
      }
    }
  });
  res.status(200).json({ routes });
});

// Тестови endpoint за промяна на план (само за development)
app.post('/test/set-plan', async (req, res) => {
  const { shop, plan } = req.body;
  
  console.log('[TEST-PLAN] Request:', { shop, plan });
  
  if (!shop || !plan) {
    return res.status(400).json({ error: 'Missing shop or plan' });
  }
  
  try {
    const { default: Subscription } = await import('./db/Subscription.js');
    
    // Нормализираме плана
    const normalizedPlan = plan === 'growth_extra' ? 'growth extra' : plan;
    console.log('[TEST-PLAN] Normalized plan:', normalizedPlan);
    
    const result = await Subscription.findOneAndUpdate(
      { shop },
      {
        shop,
        plan: normalizedPlan,
        startedAt: new Date(),
        queryLimit: 
          plan === 'enterprise' ? 10000 :
          plan === 'growth_extra' || plan === 'growth extra' ? 4000 :
          plan === 'growth' ? 1500 :
          plan === 'professional' ? 600 : 50,
        productLimit:
          plan === 'enterprise' ? 10000 :
          plan === 'growth_extra' || plan === 'growth extra' ? 2000 :
          plan === 'growth' ? 1000 :
          plan === 'professional' ? 300 : 150
      },
      { upsert: true, new: true }
    );
    
    console.log('[TEST-PLAN] Database result:', {
      shop: result.shop,
      plan: result.plan,
      queryLimit: result.queryLimit,
      productLimit: result.productLimit
    });
    
    // Изчистваме кеша
    try {
      const { default: aiDiscoveryService } = await import('./services/aiDiscoveryService.js');
      if (aiDiscoveryService?.cache) {
        aiDiscoveryService.cache.clear();
        console.log('[TEST-PLAN] Cache cleared successfully');
      }
    } catch (e) {
      console.log('[TEST-PLAN] Cache clear failed:', e.message);
    }
    
    res.json({ success: true, message: `Plan set to ${plan}`, debug: { normalizedPlan, result } });
  } catch (error) {
    console.error('[TEST-PLAN] Error setting plan:', error);
    res.status(500).json({ error: 'Failed to set plan' });
  }
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ---------------------------------------------------------------------------
// Startup: optional Mongo, mount optional routers, start scheduler, listen
// ---------------------------------------------------------------------------
import { startScheduler } from './scheduler.js';

const PORT = process.env.PORT || 8080;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

async function start() {
  try {
    // Optional Mongo (connect if provided)
    if (process.env.MONGODB_URI) {
      mongoose.set('strictQuery', false);
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
      console.log('✔ Mongo connected');
    } else {
      console.log('ℹ No MONGODB_URI provided — skipping Mongo connection');
    }

    // Mount optional routers before listening
    await mountOptionalRouters(app);

    app.listen(PORT, () => {
      console.log(`✔ Server listening on ${PORT}`);
      console.log(`✔ App URL: ${APP_URL}`);
      console.log(`✔ Auth endpoint: ${APP_URL}/auth`);
      console.log(`✔ Token exchange endpoint: ${APP_URL}/token-exchange`);
      try {
        startScheduler?.();
      } catch (e) {
        console.error('Scheduler start error:', e);
      }
    });
  } catch (e) {
    console.error('Fatal startup error:', e);
    process.exit(1);
  }
}

start();

// ---------------------------------------------------------------------------
// Process safety logs
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));