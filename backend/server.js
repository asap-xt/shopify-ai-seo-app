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
    
    // Skip authentication for public sitemap endpoints
    console.log('[API-RESOLVER] Checking if should skip auth...');
    console.log('[API-RESOLVER] URL contains /sitemap/public:', req.originalUrl.includes('/sitemap/public'));
    console.log('[API-RESOLVER] URL contains /sitemap/generate:', req.originalUrl.includes('/sitemap/generate'));
    console.log('[API-RESOLVER] URL contains /sitemap/view:', req.originalUrl.includes('/sitemap/view'));
    console.log('[API-RESOLVER] Method is GET:', req.method === 'GET');
    
    // Skip auth for all sitemap GET requests
    if (req.originalUrl.includes('/sitemap/') && req.method === 'GET') {
      console.log('[API-RESOLVER] Skipping authentication for public sitemap');
      return next();
    }
    
    // 1) resolve shop от различни места
    const headerShop = req.headers['x-shop'] || req.headers['x-shop-domain'] || null;
    const sessionShop = res.locals?.shopify?.session?.shop || null; // ако си ползвал validateAuthenticatedSession() по-нагоре
    
    // Extract shop from URL path if present (e.g., /api/languages/shop/shopname.myshopify.com or /api/store/public/shopname.myshopify.com)
    let shopFromPath = null;
    const pathMatch = req.originalUrl.match(/\/shop\/([^\/\?]+)/) || req.originalUrl.match(/\/public\/([^\/\?]+)/);
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


// App Proxy routes for sitemap (MUST be very early to avoid catch-all)


// Debug middleware
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});

// ---------------------------------------------------------------------------
/** Health / debug */
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));
app.get('/readyz', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

// Test sitemap endpoint
app.get('/test-sitemap.xml', (req, res) => {
  console.log('[TEST_SITEMAP] Test sitemap endpoint called!');
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.send('<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>https://test.com</loc></url></urlset>');
});

// Test MongoDB connection
app.get('/test-mongo', async (req, res) => {
  try {
    console.log('[TEST_MONGO] Testing MongoDB connection...');
    const Sitemap = (await import('./db/Sitemap.js')).default;
    const Shop = (await import('./db/Shop.js')).default;
    
    const sitemapCount = await Sitemap.countDocuments();
    const shopCount = await Shop.countDocuments();
    
    // Get all shops
    const shops = await Shop.find({}).lean();
    
    res.json({ 
      success: true, 
      message: 'MongoDB connected', 
      sitemapCount: sitemapCount,
      shopCount: shopCount,
      shops: shops.map(s => ({ shop: s.shop, hasAccessToken: !!s.accessToken, createdAt: s.createdAt }))
    });
  } catch (error) {
    console.error('[TEST_MONGO] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Create test shop record
app.get('/create-test-shop', async (req, res) => {
  try {
    console.log('[CREATE_TEST_SHOP] Creating test shop record...');
    const Shop = (await import('./db/Shop.js')).default;
    
    const shop = req.query.shop || 'asapxt-teststore.myshopify.com';
    const accessToken = 'test-token-' + Date.now();
    
    const savedShop = await Shop.findOneAndUpdate(
      { shop }, 
      { 
        shop, 
        accessToken, 
        scopes: 'read_products,write_products', 
        installedAt: new Date() 
      }, 
      { upsert: true, new: true }
    );
    
    console.log('[CREATE_TEST_SHOP] Created shop:', savedShop);
    
    res.json({ 
      success: true, 
      message: 'Test shop record created', 
      shop: savedShop
    });
  } catch (error) {
    console.error('[CREATE_TEST_SHOP] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Delete test shop record
app.get('/delete-test-shop', async (req, res) => {
  try {
    console.log('[DELETE_TEST_SHOP] Deleting test shop record...');
    const Shop = (await import('./db/Shop.js')).default;
    
    const shop = req.query.shop || 'asapxt-teststore.myshopify.com';
    
    const deletedShop = await Shop.findOneAndDelete({ shop });
    
    console.log('[DELETE_TEST_SHOP] Deleted shop:', deletedShop);
    
    res.json({ 
      success: true, 
      message: 'Test shop record deleted', 
      shop: deletedShop
    });
  } catch (error) {
    console.error('[DELETE_TEST_SHOP] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Test OAuth callback endpoint
app.get('/test-oauth-callback', async (req, res) => {
  try {
    console.log('[TEST_OAUTH_CALLBACK] Testing OAuth callback...');
    
    // Simulate OAuth callback with test parameters
    const testParams = {
      code: 'test-code-' + Date.now(),
      hmac: 'test-hmac-' + Date.now(),
      shop: 'asapxt-teststore.myshopify.com',
      state: 'test-state-' + Date.now(),
      host: 'YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvYXNhcHh0LXRlc3RzdG9yZQ'
    };
    
    console.log('[TEST_OAUTH_CALLBACK] Test params:', testParams);
    
    // Make internal request to OAuth callback
    const callbackUrl = `/auth/callback?${new URLSearchParams(testParams).toString()}`;
    console.log('[TEST_OAUTH_CALLBACK] Callback URL:', callbackUrl);
    
    res.json({ 
      success: true, 
      message: 'OAuth callback test endpoint created', 
      callbackUrl: callbackUrl,
      testParams: testParams
    });
  } catch (error) {
    console.error('[TEST_OAUTH_CALLBACK] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Generate direct OAuth URL for testing
app.get('/generate-oauth-url', (req, res) => {
  try {
    console.log('[GENERATE_OAUTH_URL] Generating direct OAuth URL...');
    
    const shop = req.query.shop || 'asapxt-teststore.myshopify.com';
    const state = 'test-state-' + Date.now();
    
    const oauthUrl = `https://${shop}/admin/oauth/authorize?` + new URLSearchParams({
      client_id: process.env.SHOPIFY_API_KEY,
      scope: process.env.SHOPIFY_API_SCOPES || 'read_products,write_products',
      redirect_uri: `${process.env.APP_URL}/auth/callback`,
      state: state
    }).toString();
    
    console.log('[GENERATE_OAUTH_URL] Generated OAuth URL:', oauthUrl);
    
    res.json({ 
      success: true, 
      message: 'Direct OAuth URL generated', 
      oauthUrl: oauthUrl,
      shop: shop,
      state: state,
      redirectUri: `${process.env.APP_URL}/auth/callback`
    });
  } catch (error) {
    console.error('[GENERATE_OAUTH_URL] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Simple test endpoint without any imports
app.get('/simple-test', (req, res) => {
  console.log('[SIMPLE_TEST] Simple test endpoint called!');
  res.json({ 
    success: true, 
    message: 'Simple test endpoint works!',
    timestamp: new Date().toISOString(),
    url: req.url,
    method: req.method
  });
});

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
import appProxyRouter from './controllers/appProxyController.js';
import publicSitemapRouter from './controllers/publicSitemapController.js';
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
app.use('/api/store', (req, res, next) => {
  console.log('[STORE-ROUTER] Request to:', req.method, req.url);
  console.log('[STORE-ROUTER] Full path:', req.path);
  console.log('[STORE-ROUTER] Params:', req.params);
  console.log('[STORE-ROUTER] Query:', req.query);
  next();
}, storeRouter);

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

app.get('/apps/:app_identifier/*', (req, res, next) => {
  console.log('[APP] Request for app route:', req.url);
  
  // Skip our App Proxy routes
  if (req.params.app_identifier === 'new-ai-seo') {
    console.log('[APP] Skipping new-ai-seo app proxy route');
    return next();
  }
  
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

// Handle root request - this is the App URL endpoint
app.get('/', async (req, res) => {
  const { shop, hmac, timestamp, host, embedded, id_token } = req.query;
  
  console.log('[APP URL] Request with params:', req.query);
  console.log('[APP URL] Headers:', req.headers);
  
  // If no shop parameter, show install form
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
  
  // Set proper headers for embedded apps
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'X-Frame-Options': 'ALLOWALL',
    'Content-Security-Policy': "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://partners.shopify.com",
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  
  try {
    const ShopModel = (await import('./db/Shop.js')).default;
    console.log('[APP URL] Looking for shop:', shop);
    let existingShop = await ShopModel.findOne({ shop }).lean();
    console.log('[APP URL] Found shop:', !!existingShop);
    
    // Handle JWT token if present
    if (id_token) {
      console.log('[APP URL] Found id_token, handling JWT flow...');
      
      // Create or update shop record with JWT token
      if (!existingShop) {
        // Create new shop record
        existingShop = await ShopModel.create({
          shop,
          accessToken: 'jwt-pending',
          jwtToken: id_token,
          useJWT: true,
          installedAt: new Date(),
          scopes: 'read_products,write_products,read_themes,write_themes,read_translations,write_translations,read_locales,read_metafields,write_metafields,read_metaobjects,write_metaobjects'
        });
        console.log('[APP URL] Created new shop with JWT');
      } else {
        // Update existing shop with JWT token
        existingShop = await ShopModel.findOneAndUpdate(
          { shop },
          { 
            jwtToken: id_token,
            useJWT: true,
            updatedAt: new Date()
          },
          { new: true }
        ).lean();
        console.log('[APP URL] Updated existing shop with JWT');
      }
    }
    
    // Always serve the app if we have JWT token
    if (id_token || (existingShop && existingShop.accessToken)) {
      console.log('[APP URL] Serving embedded app');
      const indexPath = path.join(distPath, 'index.html');
      const html = fs.readFileSync(indexPath, 'utf8');
      return res.send(html);
    }
    
    // No JWT token and app not installed - redirect to OAuth
    console.log('[APP URL] App not installed, redirecting to /auth');
    
    // Handle Partners Dashboard redirect specially
    if (req.headers.referer && req.headers.referer.includes('partners.shopify.com')) {
      const authUrl = `/auth?${new URLSearchParams(req.query).toString()}`;
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Installing...</title>
          <script>
            if (window.top !== window.self) {
              window.top.location.href = '${authUrl}';
            } else {
              window.location.href = '${authUrl}';
            }
          </script>
        </head>
        <body>
          <p>Redirecting to installation...</p>
        </body>
        </html>
      `);
    }
    
    return res.redirect(`/auth?${new URLSearchParams(req.query).toString()}`);
    
  } catch (err) {
    console.error('[APP URL] Error:', err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Error</title>
      </head>
      <body>
        <h1>Error loading app</h1>
        <p>${err.message}</p>
        <p>Please try again or contact support.</p>
      </body>
      </html>
    `);
  }
});

// Partners може да очаква /api endpoint
app.get('/api', (req, res) => {
  console.log('[API] Partners check:', req.query);
  res.json({ 
    status: 'ok',
    app: 'NEW AI SEO',
    version: '1.0.0'
  });
});

// Или може да търси health endpoint
app.get('/health', (req, res) => {
  console.log('[HEALTH] Check from:', req.headers.referer);
  res.json({ 
    status: 'healthy',
    timestamp: Date.now()
  });
});

// Debug route за да видим всички заявки
app.use((req, res, next) => {
  if (req.headers.referer && req.headers.referer.includes('partners.shopify.com')) {
    console.log('[PARTNERS REQUEST]', {
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      headers: {
        'user-agent': req.headers['user-agent'],
        'referer': req.headers.referer,
        'x-frame-options': req.headers['x-frame-options']
      }
    });
  }
  next();
});






// Explicit SPA routes → serve fresh index.html
const spaRoutes = [
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

// Wildcard for all /ai-seo/* routes (but not /apps/* routes)
app.get('/ai-seo*', (req, res, next) => {
  // Skip /apps/* routes
  if (req.path.startsWith('/apps/')) {
    return next();
  }
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

    // APP PROXY ROUTES (MUST be first, before all other middleware)
    console.log('[SERVER] Registering App Proxy routes...');
    app.use('/apps/new-ai-seo', appProxyRouter);

    // PUBLIC SITEMAP ENDPOINTS (MUST be before authentication middleware)
    console.log('[SERVER] Registering public sitemap endpoints...');
    
    // Direct public sitemap endpoint - no authentication required
    app.get('/public-sitemap', async (req, res) => {
      console.log('[PUBLIC_SITEMAP_DIRECT] ===== PUBLIC SITEMAP DIRECT REQUEST =====');
      console.log('[PUBLIC_SITEMAP_DIRECT] Query:', req.query);
      
      try {
        // Import required modules
        const Sitemap = (await import('./db/Sitemap.js')).default;
        
        // Helper function to normalize shop
        function normalizeShop(s) {
          if (!s) return null;
          s = String(s).trim().toLowerCase();
          if (/^https?:\/\//.test(s)) {
            const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
            return u.toLowerCase();
          }
          if (!/\.myshopify\.com$/i.test(s)) return s.toLowerCase() + '.myshopify.com';
          return s.toLowerCase();
        }
        
        const shop = normalizeShop(req.query.shop);
        if (!shop) {
          console.error('[PUBLIC_SITEMAP_DIRECT] Missing shop parameter');
          return res.status(400).send('Missing shop parameter. Use: ?shop=your-shop.myshopify.com');
        }
        
        console.log('[PUBLIC_SITEMAP_DIRECT] Processing for shop:', shop);
        
        // Get saved sitemap with content
        const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
        console.log('[PUBLIC_SITEMAP_DIRECT] Found sitemap:', !!sitemapDoc);
        
        if (!sitemapDoc || !sitemapDoc.content) {
          console.log('[PUBLIC_SITEMAP_DIRECT] No sitemap found, returning instructions');
          return res.status(404).send(`
Sitemap not found for shop: ${shop}

To generate a sitemap:
1. Install the NEW AI SEO app in your Shopify admin
2. Go to the Sitemap section and click "Generate Sitemap"
3. Your sitemap will be available at this URL

App URL: https://new-ai-seo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
          `);
        }
        
        // Serve the saved sitemap
        console.log('[PUBLIC_SITEMAP_DIRECT] Serving sitemap for shop:', shop);
        res.set({
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=21600', // 6 hours
          'Last-Modified': new Date(sitemapDoc.generatedAt).toUTCString(),
          'X-Sitemap-Cache': 'HIT',
          'X-Sitemap-Generated': sitemapDoc.generatedAt,
          'X-Sitemap-Products': sitemapDoc.productCount?.toString() || '0'
        });
        res.send(sitemapDoc.content);
        
      } catch (error) {
        console.error('[PUBLIC_SITEMAP_DIRECT] Error:', error);
        return res.status(500).send(`Failed to serve sitemap: ${error.message}`);
      }
    });

    // Mount Shopify OAuth Routes
    app.use('/api/auth', authBegin());
    app.use('/api/auth/callback', authCallback());
    app.use('/api/auth', ensureInstalledOnShop());

    // Mount optional routers before listening
    await mountOptionalRouters(app);


    // Serve assets with aggressive caching for production (MUST be before catch-all)
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
            res.setHeader('X-Build-Time', new Date().toISOString());
          }
        },
      })
    );

    // Public sitemap endpoints (MUST be before catch-all)
    console.log('[SERVER] Registering public sitemap endpoints...');
    
    // Simple public sitemap endpoint - no authentication required
    app.get('/sitemap.xml', async (req, res) => {
      console.log('[PUBLIC_SITEMAP] ===== PUBLIC SITEMAP REQUEST =====');
      console.log('[PUBLIC_SITEMAP] Query:', req.query);
      
      try {
        // Import required modules
        const Sitemap = (await import('./db/Sitemap.js')).default;
        
        // Helper function to normalize shop
        function normalizeShop(s) {
          if (!s) return null;
          s = String(s).trim().toLowerCase();
          if (/^https?:\/\//.test(s)) {
            const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
            return u.toLowerCase();
          }
          if (!/\.myshopify\.com$/i.test(s)) return s.toLowerCase() + '.myshopify.com';
          return s.toLowerCase();
        }
        
        const shop = normalizeShop(req.query.shop);
        if (!shop) {
          console.error('[PUBLIC_SITEMAP] Missing shop parameter');
          return res.status(400).send('Missing shop parameter. Use: ?shop=your-shop.myshopify.com');
        }
        
        console.log('[PUBLIC_SITEMAP] Processing for shop:', shop);
        
        // Get saved sitemap with content
        const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
        console.log('[PUBLIC_SITEMAP] Found sitemap:', !!sitemapDoc);
        
        if (!sitemapDoc || !sitemapDoc.content) {
          console.log('[PUBLIC_SITEMAP] No sitemap found, returning instructions');
          return res.status(404).send(`
Sitemap not found for shop: ${shop}

To generate a sitemap:
1. Install the NEW AI SEO app in your Shopify admin
2. Go to the Sitemap section and click "Generate Sitemap"
3. Your sitemap will be available at this URL

App URL: https://new-ai-seo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
          `);
        }
        
        // Serve the saved sitemap
        console.log('[PUBLIC_SITEMAP] Serving sitemap for shop:', shop);
        res.set({
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=21600', // 6 hours
          'Last-Modified': new Date(sitemapDoc.generatedAt).toUTCString(),
          'X-Sitemap-Cache': 'HIT',
          'X-Sitemap-Generated': sitemapDoc.generatedAt,
          'X-Sitemap-Products': sitemapDoc.productCount?.toString() || '0'
        });
        res.send(sitemapDoc.content);
        
      } catch (error) {
        console.error('[PUBLIC_SITEMAP] Error:', error);
        return res.status(500).send(`Failed to serve sitemap: ${error.message}`);
      }
    });
    
    // Alternative public sitemap endpoint
    app.get('/public-sitemap.xml', async (req, res) => {
      console.log('[PUBLIC_SITEMAP_ALT] ===== ALTERNATIVE PUBLIC SITEMAP REQUEST =====');
      console.log('[PUBLIC_SITEMAP_ALT] Query:', req.query);
      
      try {
        // Import required modules
        const Sitemap = (await import('./db/Sitemap.js')).default;
        
        // Helper function to normalize shop
        function normalizeShop(s) {
          if (!s) return null;
          s = String(s).trim().toLowerCase();
          if (/^https?:\/\//.test(s)) {
            const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
            return u.toLowerCase();
          }
          if (!/\.myshopify\.com$/i.test(s)) return s.toLowerCase() + '.myshopify.com';
          return s.toLowerCase();
        }
        
        const shop = normalizeShop(req.query.shop);
        if (!shop) {
          console.error('[PUBLIC_SITEMAP_ALT] Missing shop parameter');
          return res.status(400).send('Missing shop parameter. Use: ?shop=your-shop.myshopify.com');
        }
        
        console.log('[PUBLIC_SITEMAP_ALT] Processing for shop:', shop);
        
        // Get saved sitemap with content
        const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
        console.log('[PUBLIC_SITEMAP_ALT] Found sitemap:', !!sitemapDoc);
        
        if (!sitemapDoc || !sitemapDoc.content) {
          console.log('[PUBLIC_SITEMAP_ALT] No sitemap found, returning instructions');
          return res.status(404).send(`
Sitemap not found for shop: ${shop}

To generate a sitemap:
1. Install the NEW AI SEO app in your Shopify admin
2. Go to the Sitemap section and click "Generate Sitemap"
3. Your sitemap will be available at this URL

App URL: https://new-ai-seo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
          `);
        }
        
        // Serve the saved sitemap
        console.log('[PUBLIC_SITEMAP_ALT] Serving sitemap for shop:', shop);
        res.set({
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=21600', // 6 hours
          'Last-Modified': new Date(sitemapDoc.generatedAt).toUTCString(),
          'X-Sitemap-Cache': 'HIT',
          'X-Sitemap-Generated': sitemapDoc.generatedAt,
          'X-Sitemap-Products': sitemapDoc.productCount?.toString() || '0'
        });
        res.send(sitemapDoc.content);
        
      } catch (error) {
        console.error('[PUBLIC_SITEMAP_ALT] Error:', error);
        return res.status(500).send(`Failed to serve sitemap: ${error.message}`);
      }
    });

    // Catch-all for any unmatched routes - MUST be last
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
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));// Force rebuild 1757432718
