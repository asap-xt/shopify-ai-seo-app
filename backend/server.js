// backend/server.js
// Express server for the Shopify AI SEO app (ESM).
// All comments are in English.

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Optional Mongo (only if MONGODB_URI provided)
import mongoose from 'mongoose';
import Shop from './db/Shop.js';
import { resolveShopToken } from './utils/tokenResolver.js';

// Shopify SDK for Public App
import { authBegin, authCallback, ensureInstalledOnShop, validateRequest } from './middleware/shopifyAuth.js';
import shopify from './utils/shopifyApi.js';

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
app.use(compression()); // Enable gzip compression
app.use(cookieParser());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---- Debug helper: виж какви сесии имаш за shop
app.get('/debug/sessions', async (req, res) => {
  const shop = req.query?.shop;
  if (!shop) return res.status(400).json({ error: 'Missing shop' });
  try {
    const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);
    return res.json({
      count: sessions?.length || 0,
      sessions: (sessions || []).map(s => ({
        id: s.id, shop: s.shop, isOnline: s.isOnline,
        updatedAt: s.updatedAt, hasToken: !!s.accessToken, scope: s.scope,
      })),
    });
  } catch (e) {
    console.error('[DEBUG/SESSIONS] error', e);
    return res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// ---- PER-SHOP TOKEN RESOLVER (за всички /api/**)
app.use('/api', async (req, res, next) => {
  try {
    console.log('[API-RESOLVER] ===== API MIDDLEWARE CALLED =====');
    console.log('[API-RESOLVER] URL:', req.originalUrl);
    console.log('[API-RESOLVER] Method:', req.method);
    
    // 1) resolve shop от различни места
    const headerShop = req.headers['x-shop'] || req.headers['x-shop-domain'] || null;
    const sessionShop = res.locals?.shopify?.session?.shop || null; // ако си ползвал validateAuthenticatedSession() по-нагоре
    
    // Extract shop from URL path if present (e.g., /api/languages/shop/shopname.myshopify.com)
    let shopFromPath = null;
    const pathMatch = req.originalUrl.match(/\/shop\/([^\/\?]+)/);
    if (pathMatch) {
      shopFromPath = pathMatch[1];
      console.log('[API-RESOLVER] Shop from path:', shopFromPath);
    }
    
    // Handle shop parameter - could be string or array if duplicated
    let shop = req.query?.shop || headerShop || req.body?.shop || sessionShop || shopFromPath || null;
    
    // If shop is an array (duplicated parameter), take the first valid one
    if (Array.isArray(shop)) {
      shop = shop.find(s => s && typeof s === 'string' && s.trim()) || shop[0];
      console.log('[API-RESOLVER] Shop was array, using first valid:', shop);
    }
    
    console.log('[API-RESOLVER] Resolved shop:', shop);
    if (!shop) return res.status(400).json({ error: 'Missing shop' });
    if (!req.query) req.query = {};
    if (!req.query.shop) req.query.shop = shop;

    // 2) Use centralized token resolver
    console.log('[API RESOLVER] Using centralized token resolver for shop:', shop);
    const accessToken = await resolveShopToken(shop);
    console.log('[API RESOLVER] Token resolved successfully');
    
    // Create session object with real token
    const session = {
      accessToken: accessToken,
      shop: shop,
      isOnline: false,
      scope: 'read_products,write_products,read_themes,write_themes,read_translations,write_translations,read_locales,read_metafields,read_metaobjects,write_metaobjects,read_content,write_content'
    };

    // 3) modern client за новите контролери
    res.locals.adminSession = session;
    res.locals.adminGraphql = new shopify.clients.Graphql({ session });
    res.locals.shop = shop;

    // 4) COMPAT: подай токена и на "legacy custom" код, който чете от env
    req.__origAdminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
    process.env.SHOPIFY_ADMIN_API_TOKEN = accessToken;
    const _end = res.end;
    res.end = function(...args) {
      process.env.SHOPIFY_ADMIN_API_TOKEN = req.__origAdminToken;
      return _end.apply(this, args);
    };

    // console.log('[API RESOLVER]', shop, best.accessToken.slice(0,12), 'isOnline=', best.isOnline);
    return next();
  } catch (e) {
    console.error('[API RESOLVER] error', e);
    return res.status(500).json({ error: 'Token resolver failed' });
  }
});

// ========= DEBUG + SHOP RESOLVER за /api/store =========
// Този middleware е премахнат защото се дублира с общия /api middleware по-горе

// Debug middleware
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});

// ---------------------------------------------------------------------------
/** Health / debug */
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));
app.get('/readyz', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

// ---------------------------------------------------------------------------
// Shopify OAuth Routes for Public App (moved to start function)
// ---------------------------------------------------------------------------

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

// Session validation endpoint (replaces old /api/auth)
app.post('/api/auth/session', validateRequest(), async (req, res) => {
  const { shop, host } = req.body;
  
  if (!shop || !host) {
    return res.status(400).json({ error: 'Missing shop or host' });
  }
  
  // Session is already validated by middleware
  res.json({ 
    success: true,
    shop: req.shopDomain,
    hasAccessToken: !!req.shopAccessToken
  });
});

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
        const result = await syncProductsForShop(req, shop);
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

// Handle Shopify's app routes - both by handle and by API key
app.get('/apps/:app_identifier', (req, res) => {
  console.log('[APP] Request for app:', req.params.app_identifier);
  res.set('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com;');
  res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

app.get('/apps/:app_identifier/*', (req, res) => {
  console.log('[APP] Request for app route:', req.url);
  res.set('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com;');
  res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

// ---------------------------------------------------------------------------
// Static frontend (Vite build). We never cache index.html.
// We DO NOT use a catch-all regex to avoid shadowing /auth and other APIs.
// ---------------------------------------------------------------------------
const distPath = path.join(__dirname, '..', 'frontend', 'dist');

console.log('[STATIC] Serving from:', distPath);
console.log('[STATIC] Files in dist:', fs.readdirSync(distPath));

// Блокирайте достъп до root index.html
app.use((req, res, next) => {
  // Блокирайте достъп до root index.html
  if (req.path === '/index.html' && !req.path.includes('/dist/')) {
    return res.status(404).send('Not found');
  }
  next();
});

// Handle root request - това е App URL endpoint-а
app.get('/', (req, res) => {
  const { shop, hmac, timestamp, host, embedded } = req.query;
  
  console.log('[APP URL] Request with params:', req.query);
  
  // Ако няма shop параметър, покажи install форма
  if (!shop) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Install NEW AI SEO</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #f4f6f8;
          }
          .container {
            text-align: center;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-width: 400px;
          }
          h1 { color: #202223; margin-bottom: 20px; }
          input {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 16px;
            box-sizing: border-box;
          }
          button {
            background: #008060;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            width: 100%;
            margin-top: 10px;
          }
          button:hover { background: #006e52; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Install NEW AI SEO</h1>
          <p>Enter your shop domain to install the app:</p>
          <form action="/auth" method="GET">
            <input 
              type="text" 
              name="shop" 
              placeholder="your-shop.myshopify.com" 
              required
              pattern=".*\\.myshopify\\.com$"
              title="Please enter a valid .myshopify.com domain"
            />
            <button type="submit">Install App</button>
          </form>
        </div>
      </body>
      </html>
    `);
  }
  
  // Ако има shop параметър и приложението НЕ е инсталирано, 
  // пренасочи към OAuth flow
  (async () => {
    try {
      const ShopModel = (await import('./db/Shop.js')).default;
      const existingShop = await ShopModel.findOne({ shop }).lean();
      
      if (!existingShop || !existingShop.accessToken) {
        // Приложението не е инсталирано - започни OAuth
        console.log('[APP URL] App not installed, redirecting to /auth');
        return res.redirect(`/auth?${new URLSearchParams(req.query).toString()}`);
      }
      
      // Приложението е инсталирано - сервирай embedded app
      console.log('[APP URL] App installed, serving embedded app');
      res.set('Cache-Control', 'no-store');
      res.sendFile(path.join(distPath, 'index.html'));
      
    } catch (err) {
      console.error('[APP URL] Error checking installation:', err);
      // При грешка, пробвай да сервираш приложението
      res.set('Cache-Control', 'no-store');
      res.sendFile(path.join(distPath, 'index.html'));
    }
  })();
});

// Serve assets with aggressive caching for production
app.use(
  express.static(distPath, {
    index: false,
    etag: false,
    lastModified: false,
    maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0, // 1 year cache in production
    setHeaders(res, filePath) {
      if (process.env.NODE_ENV === 'production') {
        // Cache JS/CSS files for 1 year in production
        if (filePath.match(/\.(js|css)$/)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        // Cache images for 1 year in production
        if (filePath.match(/\.(png|jpg|jpeg|gif|svg|ico)$/)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        // Cache fonts for 1 year in production
        if (filePath.match(/\.(woff|woff2|ttf|eot)$/)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      } else {
        // Development: disable caching for all files
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, private, no-transform');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        res.setHeader('Last-Modified', new Date().toUTCString());
        res.setHeader('ETag', `"${Date.now()}-${Math.random()}"`);
        res.setHeader('Vary', '*');
        res.setHeader('X-Cache-Bust', Date.now().toString());
        res.setHeader('X-Timestamp', Date.now().toString());
        res.setHeader('X-Random', Math.random().toString());
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

// Root route - serve the app
app.get('/', (req, res) => {
  console.log('[ROOT] Request with params:', req.query);
  // Променете условието - махнете проверката за embedded
  if (req.query.shop && req.query.host) {
    // Embedded app request - Cache busting for index.html
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });
    res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com;');
    res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  } else {
    // Non-embedded
    res.send('Please install this app from Shopify Admin');
  }
});

// Explicit SPA routes → serve fresh index.html
const spaRoutes = [
  '/', 
  '/dashboard', 
  '/ai-seo',
  '/ai-seo/products',
  '/ai-seo/collections',
  '/ai-seo/sitemap',
  '/ai-seo/store-metadata',
  '/ai-seo/schema-data',
  '/billing', 
  '/settings'
];

spaRoutes.forEach((route) => {
  app.get(route, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(distPath, 'index.html'));
  });
});

// Wildcard for all /ai-seo/* routes
app.get('/ai-seo*', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(distPath, 'index.html'));
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

    // Mount Shopify OAuth Routes
    app.use('/api/auth', authBegin());
    app.use('/api/auth/callback', authCallback());
    app.use('/api/auth', ensureInstalledOnShop());

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

// Catch-all for any unmatched routes - should be last
app.get('*', (req, res) => {
  console.log('[CATCH-ALL] ===== CATCH-ALL CALLED =====');
  console.log('[CATCH-ALL] Unmatched route:', req.url);
  console.log('[CATCH-ALL] Method:', req.method);
  // Check if it's an app request
  if (req.url.includes('/apps/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, private, no-transform');
    res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com;');
    res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  } else {
    res.status(404).send('Not found');
  }
});

start();

// ---------------------------------------------------------------------------
// Process safety logs
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));// Force rebuild 1757432718
