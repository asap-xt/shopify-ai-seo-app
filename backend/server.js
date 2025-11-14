    // backend/server.js
    // Express server for the Shopify AI SEO app (ESM).
    // All comments are in English.
    // Railway trigger: GDPR webhook fix + AI enhanced product tracking

    import 'dotenv/config';
    import express from 'express';
    import helmet from 'helmet';
    import cors from 'cors';
    import morgan from 'morgan';
    import cookieParser from 'cookie-parser';
    import compression from 'compression';
    import path from 'path';
    import { fileURLToPath } from 'url';
    import fs from 'fs';
    import { buildSchema, graphql } from 'graphql';
    import { getPlansMeForShop } from './controllers/seoController.js';
    import aiSimulationController from './controllers/aiSimulationController.js';
    import aiTestingController from './controllers/aiTestingController.js';
    import { logger, dbLogger } from './utils/logger.js';

    // Optional Mongo (only if MONGODB_URI provided)
    import mongoose from 'mongoose';
    import Shop from './db/Shop.js';
    import {
      resolveShopToken
    } from './utils/tokenResolver.js';
    import { attachIdToken } from './middleware/attachIdToken.js';
    import { attachShop } from './middleware/attachShop.js';
    import { normalizeShop } from './utils/normalizeShop.js';

    // Shopify SDK for Public App
    import { authBegin, authCallback, ensureInstalledOnShop, validateRequest } from './middleware/shopifyAuth.js';
    import shopify from './utils/shopifyApi.js';

    // ---------------------------------------------------------------------------
    // ESM __dirname
    // ---------------------------------------------------------------------------
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // ---------------------------------------------------------------------------
    // App configuration constants
    // ---------------------------------------------------------------------------
    const PORT = process.env.PORT || 8080;
    const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

    // ---------------------------------------------------------------------------
    const app = express();
    app.set('trust proxy', 1);

    // --- Test plan overrides (in-memory) ---
    const planOverrides = new Map(); // key: shop, value: 'starter'|'professional'|'growth'|'growth_extra'|'enterprise'
    app.locals.planOverrides = planOverrides;

    app.locals.setPlanOverride = (shop, plan) => {
      if (!shop) {
        return null;
      }
      if (!plan) {
        planOverrides.delete(shop);
        return null;
      }
      planOverrides.set(shop, plan);
      return plan;
    };

    app.locals.getPlanOverride = (shop) => {
      if (!shop) {
        return null;
      }
      const override = planOverrides.get(shop) || null;
      return override;
    };

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
        'frame-ancestors https://admin.shopify.com https://*.myshopify.com; frame-src \'self\' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com https://youtu.be'
      );
      next();
    });

    // ---------------------------------------------------------------------------
    // Core middleware
    // ---------------------------------------------------------------------------
    app.use(cors({ origin: true, credentials: true }));
    app.use(compression()); // Enable gzip compression
    app.use(cookieParser());

    // Горещ фикc за дублиран shop параметър (много рано, преди attachShop)
    app.use((req, _res, next) => {
      // 1) Нормализирай shop от query/body към 1 брой низ
      if (Array.isArray(req.query.shop)) req.query.shop = req.query.shop[0];
      if (Array.isArray(req.body?.shop)) req.body.shop = req.body.shop[0];
      // 2) Премахни дублиране на 'shop' при вътрешни пренасочвания
      if (typeof req.query.shop === 'string') {
        const s = req.query.shop.split(',')[0].trim();
        if (s !== req.query.shop) req.query.shop = s; // хваща и 'a,b'
      }
      next();
    });

    // Премахни application/json за GET/HEAD, за да не се парсва тяло
    app.use((req, res, next) => {
      if ((req.method === 'GET' || req.method === 'HEAD') &&
          req.headers['content-type']?.includes('application/json')) {
        delete req.headers['content-type'];
      }
      next();
    });

    // GDPR webhooks need raw body for HMAC validation
    // Must be BEFORE express.json() middleware
    app.use('/webhooks/customers', express.raw({ type: 'application/json' }), (req, res, next) => {
      // Store raw body for HMAC validation
      req.rawBody = req.body.toString('utf8');
      // Parse JSON for convenience
      try {
        req.body = JSON.parse(req.rawBody);
      } catch (e) {
        req.body = {};
      }
      next();
    });

    app.use('/webhooks/shop', express.raw({ type: 'application/json' }), (req, res, next) => {
      // Store raw body for HMAC validation
      req.rawBody = req.body.toString('utf8');
      // Parse JSON for convenience
      try {
        req.body = JSON.parse(req.rawBody);
      } catch (e) {
        req.body = {};
      }
      next();
    });

    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Централизиран JSON parse error handler
    app.use((err, req, res, next) => {
      if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
      }
      next(err);
    });

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

      // Debug route to check shop tokens
      app.get('/debug/shop-token', attachShop, async (req, res) => {
        const shop = req.shopDomain;
        if (!shop) return res.json({ error: 'Missing shop param' });
        
        try {
          const Shop = await import('./db/Shop.js');
          const shopDoc = await Shop.default.findOne({ shop }).lean();
          
          res.json({
            found: !!shopDoc,
            shop: shopDoc?.shop,
            hasToken: !!shopDoc?.accessToken,
            tokenType: shopDoc?.accessToken?.substring(0, 10),
            tokenLength: shopDoc?.accessToken?.length,
            useJWT: shopDoc?.useJWT,
            hasJWTToken: !!shopDoc?.jwtToken,
            jwtTokenPrefix: shopDoc?.jwtToken?.substring(0, 20),
            plan: shopDoc?.plan,
            createdAt: shopDoc?.createdAt,
            installedAt: shopDoc?.installedAt
          });
        } catch (err) {
          res.json({ error: err.message });
        }
      });

      // Debug route to delete shop record (force reinstall)
      app.delete('/debug/shop-token', attachShop, async (req, res) => {
        const shop = req.shopDomain;
        if (!shop) return res.json({ error: 'Missing shop param' });
        
        try {
          const Shop = await import('./db/Shop.js');
          const result = await Shop.default.deleteOne({ shop });
          
          res.json({
            success: true,
            shop: shop,
            deleted: result.deletedCount > 0,
            message: result.deletedCount > 0 ? 'Shop record deleted - app needs to be reinstalled' : 'Shop record not found'
          });
        } catch (err) {
          res.json({ error: err.message });
        }
      });

    // Quick sanity endpoint: confirms we can exchange the session token for an Admin API token
    app.get('/api/whoami', attachShop, async (req, res) => {
      try {
        const shop = req.shopDomain;
        const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
        const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const idToken = req.query.id_token || bearerToken || null;

        if (!shop) return res.status(400).json({ error: 'Missing ?shop=' });

        const adminAccessToken = await resolveShopToken(shop, { idToken, requested: 'offline' });
        const tokenPreview = adminAccessToken
          ? `${adminAccessToken.slice(0, 6)}…${adminAccessToken.slice(-4)}`
          : null;

        res.json({ shop, tokenPreview });
      } catch (e) {
        console.error('[WHOAMI] Error:', e?.message || e);
        res.status(401).json({ error: 'Unable to resolve Admin API token', detail: e.message });
      }
    });

    // DEBUG: Log all incoming requests
    // Normalize shop domain for all requests
    app.use(attachShop);

    // make id_token available to every API handler via req.idToken
    app.use('/api', attachIdToken);
    app.use('/plans', attachIdToken);
    app.use('/collections', attachIdToken);

    // ---- PER-SHOP TOKEN RESOLVER (за всички /api/**)
    app.use('/api', async (req, res, next) => {
      try {
        // Skip authentication for public sitemap endpoints и token exchange
        if ((req.originalUrl.includes('/sitemap/') || 
            req.originalUrl.includes('/debug/') ||
            req.originalUrl.includes('/token-exchange')) && req.method === 'GET') {
          return next();
        }
        
        const shop = req.shopDomain;
        
        if (!shop) return res.status(400).json({ error: 'Missing or invalid shop domain' });
        
        try {
          // Опитай се да получиш токен
          const accessToken = await resolveShopToken(shop, { idToken: req.idToken, requested: 'offline' });
          
          // Успех - създай session
          const session = {
            accessToken: accessToken,
            shop: shop,
            isOnline: false,
            scope: 'read_products,write_products,read_themes,read_translations,write_translations,read_locales,read_metafields,read_metaobjects,write_metaobjects,read_content,write_content'
          };

          res.locals.adminSession = session;
          res.locals.adminGraphql = new shopify.clients.Graphql({ session });
          res.locals.shop = shop;

          return next();
          
        } catch (tokenError) {
          
          // Ако грешката е "Token exchange required", върни специален код
          if (tokenError.message.includes('Token exchange required') || 
              tokenError.message.includes('Token exchange needed')) {
            return res.status(202).json({ 
              error: 'token_exchange_required', 
              shop: shop,
              message: 'Frontend should perform token exchange first'
            });
          }
          
          // Други грешки
          return res.status(500).json({ error: 'Token resolver failed', details: tokenError.message });
        }
      } catch (e) {
        console.error('[API RESOLVER] error', e);
        return res.status(500).json({ error: 'Token resolver failed' });
      }
    });

    // ========= DEBUG + SHOP RESOLVER за /api/store =========
    // Този middleware е премахнат защото се дублира с общия /api middleware по-горе


    // App Proxy routes for sitemap (MUST be very early to avoid catch-all)


    // ---------------------------------------------------------------------------
    /** Health / debug */
    app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));
    app.get('/readyz', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

    // TEST ENDPOINT - Set token balance for testing
    // Requires TEST_SECRET for security (works in production with secret)
    app.post('/test/set-token-balance', async (req, res) => {
      // Security check: require test secret
      const testSecret = req.headers['x-test-secret'] || req.body.testSecret;
      const expectedSecret = process.env.TEST_SECRET || 'dev-test-secret';
      
      if (testSecret !== expectedSecret) {
        return res.status(403).json({ 
          error: 'Unauthorized. Requires X-Test-Secret header or testSecret in body.' 
        });
      }
      
      try {
        const { shop, balance } = req.body;
        
        if (!shop) {
          return res.status(400).json({ error: 'Shop parameter required' });
        }
        
        const TokenBalance = (await import('./db/TokenBalance.js')).default;
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        
        const oldBalance = tokenBalance.balance;
        tokenBalance.balance = balance !== undefined ? balance : 0;
        await tokenBalance.save();
        
        res.json({ 
          success: true, 
          shop,
          oldBalance,
          newBalance: tokenBalance.balance,
          message: `Balance updated: ${oldBalance} → ${tokenBalance.balance}`
        });
      } catch (error) {
        console.error('[TEST] Error setting token balance:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // TEST ENDPOINT - Get token balance for testing
    app.get('/test/get-token-balance', async (req, res) => {
      const testSecret = req.headers['x-test-secret'] || req.query.testSecret;
      const expectedSecret = process.env.TEST_SECRET || 'dev-test-secret';
      
      if (testSecret !== expectedSecret) {
        return res.status(403).json({ 
          error: 'Unauthorized. Requires X-Test-Secret header or testSecret query param.' 
        });
      }
      
      try {
        const shop = req.query.shop;
        
        if (!shop) {
          return res.status(400).json({ error: 'Shop parameter required' });
        }
        
        const TokenBalance = (await import('./db/TokenBalance.js')).default;
        const tokenBalance = await TokenBalance.findOne({ shop });
        
        if (!tokenBalance) {
          return res.json({ 
            success: true,
            shop,
            exists: false,
            message: 'No token balance found for this shop'
          });
        }
        
        res.json({ 
          success: true,
          shop,
          exists: true,
          balance: tokenBalance.balance,
          totalPurchased: tokenBalance.totalPurchased,
          totalUsed: tokenBalance.totalUsed,
          lastPurchase: tokenBalance.lastPurchase
        });
      } catch (error) {
        console.error('[TEST] Error getting token balance:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Test sitemap endpoint
    app.get('/test-sitemap.xml', (req, res) => {
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.send('<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>https://test.com</loc></url></urlset>');
    });

    // Test MongoDB connection
    app.get('/test-mongo', async (req, res) => {
      try {
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
    // Removed - Public App doesn't create fake tokens

    // Removed - Public App doesn't need fake shop deletion

    // Removed - Public App uses real OAuth flow only

    // Generate direct OAuth URL for testing
    app.get('/generate-oauth-url', (req, res) => {
      try {
        const shop = req.query.shop || 'asapxt-teststore.myshopify.com';
        const state = 'test-state-' + Date.now();
        
        const oauthUrl = `https://${shop}/admin/oauth/authorize?` + new URLSearchParams({
          client_id: process.env.SHOPIFY_API_KEY,
          scope: process.env.SHOPIFY_API_SCOPES || 'read_products,write_products',
          redirect_uri: `${process.env.APP_URL}/auth/callback`,
          state: state
        }).toString();
        
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
    import billingRouter from './billing/billingRoutes.js';  // mounts /billing/* (NEW: GraphQL-based)
    import seoRouter from './controllers/seoController.js';  // mounts /seo/* (plans/me е премахнат)
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

    // Import new middleware and controllers
    import { attachShop as attachShopFromApiResolver, apiResolver } from './middleware/apiResolver.js';
    import collectionsRouter from './controllers/collectionsController.js';
    import dashboardRouter from './controllers/dashboardController.js';

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
    app.use('/auth', authRouter);
    app.use('/token-exchange', tokenExchangeRouter);
    app.use('/billing', billingRouter);  // Handles both /billing/* and /api/billing/*
    app.use('/api/billing', billingRouter);  // API routes for billing
    app.use(seoRouter);
    app.use('/api/languages', languageRouter); // -> /api/languages/product/:shop/:productId
    app.use('/api/seo', multiSeoRouter); // -> /api/seo/generate-multi, /api/seo/apply-multi

    // --- Minimal GraphQL endpoint for test plan overrides ---
    const schema = buildSchema(`
      enum PlanEnum { starter professional growth growth_extra enterprise }
      type PlansMe {
        shop: String! 
        plan: String
        planKey: String
        priceUsd: Float
        product_limit: Int
        collection_limit: Int
        language_limit: Int
        providersAllowed: [String!]
        modelsSuggested: [String!]
        autosyncCron: String
        trial: TrialInfo
        subscriptionStatus: String
      }
      type TrialInfo {
        active: Boolean!
        ends_at: String
        days_left: Int
      }
      type SitemapResult {
        success: Boolean!
        message: String!
        shop: String!
      }
      
      type ProductEdge {
        node: Product!
        cursor: String!
      }
      
      type ProductConnection {
        edges: [ProductEdge!]!
        pageInfo: PageInfo!
      }
      
      type Product {
        id: ID!
        title: String!
      }
      
      type CollectionEdge {
        node: Collection!
        cursor: String!
      }
      
      type CollectionConnection {
        edges: [CollectionEdge!]!
        pageInfo: PageInfo!
      }
      
      type Collection {
        id: ID!
        title: String!
      }
      
      type PageInfo {
        hasNextPage: Boolean!
        hasPreviousPage: Boolean!
      }
      
      type StoreMetadata {
        shopName: String
        description: String
        shortDescription: String
        seoMetadata: String
        aiMetadata: String
        organizationSchema: String
        # localBusinessSchema: String # DISABLED - not relevant for online stores
      }
      
      type WelcomePage {
        title: String
        content: String
      }
      
      type Query {
        # optional: ако решиш да четеш плана през GraphQL в бъдеще
        plansMe(shop: String!): PlansMe!
        # check for generated data
        products(shop: String!, first: Int): ProductConnection!
        collections(shop: String!, first: Int): CollectionConnection!
        storeMetadata(shop: String!): StoreMetadata
        welcomePage(shop: String!): WelcomePage
      }
      type Mutation {
        # set plan override (null plan = clear override)
        setPlanOverride(shop: String!, plan: PlanEnum): PlansMe!
        # regenerate sitemap in background
        regenerateSitemap(shop: String!): SitemapResult!
      }
    `);

    const root = {
      async plansMe({ shop }, ctx) {
        // Една и съща бизнес-логика като REST-а:
        return await getPlansMeForShop(ctx.app, (shop || '').toLowerCase());
      },

      async setPlanOverride({ shop, plan }, ctx) {
        const { req, app } = ctx;
        const sessionShop = req.query?.shop || req.body?.shop || req.headers['x-shop'] || null;
        if (sessionShop && sessionShop !== shop) throw new Error('Shop mismatch');
        app.locals.setPlanOverride(shop, plan || null);
        return await getPlansMeForShop(app, (shop || '').toLowerCase());
      },

      async regenerateSitemap({ shop }, ctx) {
        try {
          console.log('[GRAPHQL] ===== REGENERATE SITEMAP MUTATION CALLED =====');
          console.log('[GRAPHQL] Shop:', shop);
          console.log('[GRAPHQL] enableAIEnhancement: true');
          
          // === TRIAL RESTRICTION CHECK ===
          const { default: Subscription } = await import('./db/Subscription.js');
          const subscription = await Subscription.findOne({ shop });
          
          const now = new Date();
          const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
          
          const planKey = (subscription?.plan || 'starter').toLowerCase().replace(/\s+/g, '_');
          const includedTokensPlans = ['growth_extra', 'enterprise'];
          const hasIncludedTokens = includedTokensPlans.includes(planKey);
          
          // Import isBlockedInTrial
          const { isBlockedInTrial } = await import('./billing/tokenConfig.js');
          const feature = 'ai-sitemap-optimized';
          
          // CRITICAL: Block during trial ONLY for plans with included tokens
          if (hasIncludedTokens && inTrial && isBlockedInTrial(feature)) {
            throw new Error('TRIAL_RESTRICTION: AI-Optimized Sitemap is locked during trial period. Activate your plan to unlock.');
          }
          
          // Import the core sitemap generation logic
          const { generateSitemapCore } = await import('./controllers/sitemapController.js');
          console.log('[GRAPHQL] ✅ generateSitemapCore imported successfully');
          
          // ===== CRITICAL: AI Enhancement enabled from Settings =====
          // When called from Settings, we enable AI enhancement (real-time AI calls)
          // This is the ONLY place where AI enhancement happens
          // The Sitemap page (Search Optimization for AI) generates BASIC sitemap only
          console.log('[GRAPHQL] 🚀 Starting background sitemap generation...');
          generateSitemapCore(shop, { enableAIEnhancement: true })
            .then((result) => {
              console.log('[GRAPHQL] ✅ Background sitemap generation completed successfully!');
              console.log('[GRAPHQL] Result:', result);
            })
            .catch((error) => {
              console.error('[GRAPHQL] ❌ Background sitemap generation failed:', error);
              console.error('[GRAPHQL] Error stack:', error.stack);
            });
          
          // Return immediately
          console.log('[GRAPHQL] 📤 Returning immediate success response');
          return {
            success: true,
            message: 'AI-Optimized Sitemap regeneration started in background',
            shop: shop
          };
          
        } catch (error) {
          console.error('[GRAPHQL] ❌ Error starting sitemap regeneration:', error);
          console.error('[GRAPHQL] Error stack:', error.stack);
          return {
            success: false,
            message: error.message,
            shop: shop
          };
        }
      },

      async products({ shop, first = 1 }, ctx) {
        try {
          const { normalizeShop } = await import('./utils/shop.js');
          const { executeShopifyGraphQL } = await import('./utils/tokenResolver.js');
          
          const normalizedShop = normalizeShop(shop);
          if (!normalizedShop) {
            throw new Error('Invalid shop parameter');
          }
          
          const productsQuery = `
            query($first: Int!) {
              products(first: $first, query: "status:active") {
                edges {
                  node {
                    id
                    title
                  }
                  cursor
                }
                pageInfo {
                  hasNextPage
                }
              }
            }
          `;
          
          const data = await executeShopifyGraphQL(normalizedShop, productsQuery, { first });
          
          return {
            edges: data.products.edges.map(edge => ({
              node: {
                id: edge.node.id,
                title: edge.node.title
              },
              cursor: edge.cursor
            })),
            pageInfo: {
              hasNextPage: data.products.pageInfo.hasNextPage,
              hasPreviousPage: false
            }
          };
          
        } catch (error) {
          console.error('[GRAPHQL] Error checking products:', error);
          return {
            edges: [],
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false
            }
          };
        }
      },

      async collections({ shop, first = 1 }, ctx) {
        try {
          const { normalizeShop } = await import('./utils/shop.js');
          const { executeShopifyGraphQL } = await import('./utils/tokenResolver.js');
          
          const normalizedShop = normalizeShop(shop);
          if (!normalizedShop) {
            throw new Error('Invalid shop parameter');
          }
          
          const collectionsQuery = `
            query($first: Int!) {
              collections(first: $first) {
                edges {
                  node {
                    id
                    title
                  }
                  cursor
                }
                pageInfo {
                  hasNextPage
                }
              }
            }
          `;
          
          const data = await executeShopifyGraphQL(normalizedShop, collectionsQuery, { first });
          
          return {
            edges: data.collections.edges.map(edge => ({
              node: {
                id: edge.node.id,
                title: edge.node.title
              },
              cursor: edge.cursor
            })),
            pageInfo: {
              hasNextPage: data.collections.pageInfo.hasNextPage,
              hasPreviousPage: false
            }
          };
          
        } catch (error) {
          console.error('[GRAPHQL] Error checking collections:', error);
          return {
            edges: [],
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false
            }
          };
        }
      },

      async storeMetadata({ shop }, ctx) {
        try {
          const { normalizeShop } = await import('./utils/shop.js');
          const { executeShopifyGraphQL } = await import('./utils/tokenResolver.js');
          
          const normalizedShop = normalizeShop(shop);
          if (!normalizedShop) {
            throw new Error('Invalid shop parameter');
          }
          
          const shopQuery = `
            query {
              shop {
                name
                description
                metafield(namespace: "ai_seo_store", key: "seo_metadata") {
                  value
                }
                organizationMetafield: metafield(namespace: "ai_seo_store", key: "organization_schema") {
                  value
                }
                aiMetafield: metafield(namespace: "ai_seo_store", key: "ai_metadata") {
                  value
                }
              }
            }
          `;
          
          const data = await executeShopifyGraphQL(normalizedShop, shopQuery);
          
          // Check if any AI metadata exists
          const hasSeoMetadata = !!data.shop?.metafield?.value;
          const hasOrganizationMetadata = !!data.shop?.organizationMetafield?.value;
          const hasAiMetadata = !!data.shop?.aiMetafield?.value;
          // const hasLocalBusinessMetadata = !!data.shop?.localBusinessMetafield?.value; // DISABLED
          
          const hasAnyMetadata = hasSeoMetadata || hasOrganizationMetadata || hasAiMetadata; // || hasLocalBusinessMetadata;
          
          return {
            shopName: hasAnyMetadata ? data.shop?.name : null,
            description: hasSeoMetadata ? JSON.parse(data.shop?.metafield?.value || '{}').metaDescription || data.shop?.description : null,
            shortDescription: hasSeoMetadata ? JSON.parse(data.shop?.metafield?.value || '{}').shortDescription || null : null,
            seoMetadata: data.shop?.metafield?.value || null,
            aiMetadata: data.shop?.aiMetafield?.value || null,
            organizationSchema: data.shop?.organizationMetafield?.value || null
            // localBusinessSchema: data.shop?.localBusinessMetafield?.value || null // DISABLED - not relevant for online stores
          };
          
        } catch (error) {
          console.error('[GRAPHQL] Error checking store metadata:', error);
          return {
            shopName: null,
            description: null
          };
        }
      },

      async welcomePage({ shop }, ctx) {
        try {
          // For now, return a simple welcome page structure
          // In the future, this could check for actual generated welcome page content
          return {
            title: `Welcome to ${shop}`,
            content: `Welcome to our store!`
          };
          
        } catch (error) {
          console.error('[GRAPHQL] Error checking welcome page:', error);
          return {
            title: null,
            content: null
          };
        }
      }
    };

    app.post('/graphql', express.json(), async (req, res) => {
      try {
        const { query, variables } = req.body || {};
        
        if (!query) {
          console.error(`[DEBUG] GraphQL error: No query provided`);
          return res.status(400).json({ errors: [{ message: 'No query provided' }] });
        }
        
        const result = await graphql({
          schema,
          source: query,
          rootValue: root,
          contextValue: { req, res, app },
          variableValues: variables || {},
        });
        
        if (result.errors?.length) {
          console.error(`[DEBUG] GraphQL errors:`, result.errors);
          res.status(400).json(result);
        } else {
          res.json(result);
        }
      } catch (e) {
        console.error(`[DEBUG] GraphQL exception:`, e);
        res.status(500).json({ errors: [{ message: e.message || 'GraphQL error' }] });
      }
    });
    app.use('/debug', debugRouter);
    app.use('/api/products', productsRouter);
    app.use('/api/dashboard', dashboardRouter);
    app.use(schemaRouter);
    app.use('/api', aiDiscoveryRouter);
    app.use(aiEndpointsRouter);
    app.use('/ai-enhance', aiEnhanceRouter);
    app.use('/api/schema', advancedSchemaRouter);
    app.use('/api/ai', aiSimulationController);
    app.use('/api', aiTestingController);


    // Mount the new controllers with fixed authentication
    app.use('/api/collections', collectionsRouter);

    // Sitemap routes
    app.use('/api/sitemap', sitemapRouter);




    // Store metadata routes
    app.use('/api/store', storeRouter);

    // ---------------------------------------------------------------------------
    // Webhook registration endpoint
    // ---------------------------------------------------------------------------
    app.post('/api/admin/register-webhooks', attachShop, async (req, res) => {
      try {
        const shop = req.shopDomain || req.query.shop;
        
        if (!shop) {
          return res.status(400).json({ 
            error: 'Missing shop parameter',
            debug: {
              shopDomain: req.shopDomain,
              queryShop: req.query.shop,
              bodyShop: req.body?.shop
            }
          });
        }
        
        const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
        
        const { registerAllWebhooks } = await import('./utils/webhookRegistration.js');
        const results = await registerAllWebhooks(req, shop, appUrl);
        
        res.json({ 
          success: true, 
          shop,
          appUrl,
          results 
        });
      } catch (error) {
        console.error('[WEBHOOK-REGISTER-ENDPOINT] Error:', error);
        res.status(500).json({ 
          error: error.message,
          stack: error.stack,
          success: false 
        });
      }
    });

    // List registered webhooks (for debugging)
    app.get('/api/admin/list-webhooks', attachShop, apiResolver, async (req, res) => {
      try {
        const shop = req.shopDomain || req.query.shop;
        
        if (!shop) {
          return res.status(400).json({ error: 'Missing shop parameter' });
        }
        
        // Use req.session which is set by apiResolver after token exchange
        if (!req.session) {
          return res.status(401).json({ error: 'No session - authentication failed' });
        }
        
        const { makeShopifyGraphQLRequest } = await import('./utils/shopifyGraphQL.js');
        
        const query = `
          query {
            webhookSubscriptions(first: 50) {
              edges {
                node {
                  id
                  topic
                  endpoint {
                    __typename
                    ... on WebhookHttpEndpoint {
                      callbackUrl
                    }
                  }
                }
              }
            }
          }
        `;
        
        const result = await makeShopifyGraphQLRequest(shop, req.session.accessToken, query);
        
        res.json({
          success: true,
          shop,
          webhooks: result?.webhookSubscriptions?.edges || []
        });
      } catch (error) {
        console.error('[LIST-WEBHOOKS-ENDPOINT] Error:', error);
        res.status(500).json({ 
          error: error.message 
        });
      }
    });

    // ---------------------------------------------------------------------------
    // Optional routers / webhooks: mounted inside start() so we can import
    // them conditionally without breaking the build if files are missing.
    // ---------------------------------------------------------------------------
    async function mountOptionalRouters(app) {
      // GDPR Compliance Webhooks (mandatory for Shopify App Store)
      // 3 separate endpoints matching shopify.app.toml URIs
      try {
        // Use createRequire to load CommonJS module in ES Module context
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const gdprCompliance = require('./webhooks/gdpr-compliance.cjs');
        
        app.use('/webhooks', gdprCompliance);
        console.log('✔ GDPR compliance webhooks mounted:');
        console.log('  - POST /webhooks/customers/data_request');
        console.log('  - POST /webhooks/customers/redact');
        console.log('  - POST /webhooks/shop/redact');
      } catch (e) {
        console.error('⚠ GDPR webhooks failed to mount:', e?.message || '');
      }

      // Webhook validator + product webhooks
      try {
        const { default: validateShopifyWebhook } = await import('./middleware/webhookValidator.js');
        const { default: productsWebhook } = await import('./webhooks/products.js');
        const { default: uninstallWebhook } = await import('./webhooks/uninstall.js');
        const { default: collectionsWebhook } = await import('./webhooks/collections.js');
        const { default: subscriptionUpdateWebhook } = await import('./webhooks/subscription-update.js');
        const { default: subscriptionBillingWebhook } = await import('./webhooks/subscription-billing.js');

        // Example webhook endpoints (adjust paths if your files expect different)
        app.post('/webhooks/products', validateShopifyWebhook, productsWebhook);
        app.post('/webhooks/collections', validateShopifyWebhook, collectionsWebhook);
        app.post('/webhooks/app/uninstalled', validateShopifyWebhook, uninstallWebhook);
        app.post('/webhooks/subscription/update', validateShopifyWebhook, subscriptionUpdateWebhook);
        app.post('/webhooks/subscription/billing', validateShopifyWebhook, subscriptionBillingWebhook);
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


      // Debug endpoint to check token validity
      app.get('/api/debug/token/:shop', async (req, res) => {
        try {
          const shop = req.params.shop;
          const { resolveShopToken } = await import('./utils/tokenResolver.js');
          const Shop = (await import('./db/Shop.js')).default;
          
          // Get token from DB
          const shopDoc = await Shop.findOne({ shop }).lean();
          
          // Try to resolve token
          const token = await resolveShopToken(shop);
          
          // Test token with simple GraphQL query
          const testQuery = `query { shop { name } }`;
          const testRes = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': token,
            },
            body: JSON.stringify({ query: testQuery }),
          });
          
          const testData = await testRes.json();
          
          res.json({
            shop,
            tokenInDB: !!shopDoc?.accessToken,
            tokenType: typeof token,
            tokenPrefix: token ? token.substring(0, 10) + '...' : null,
            appApiKey: shopDoc?.appApiKey,
            currentAppKey: process.env.SHOPIFY_API_KEY,
            keyMatch: shopDoc?.appApiKey === process.env.SHOPIFY_API_KEY,
            testStatus: testRes.status,
            testSuccess: testRes.ok,
            testData: testData?.data ? 'SUCCESS' : testData?.errors || 'UNKNOWN'
          });
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      });

      // Debug endpoint to force token refresh
      app.post('/api/debug/refresh-token/:shop', async (req, res) => {
        try {
          const shop = req.params.shop;
          const { invalidateShopToken, resolveShopToken } = await import('./utils/tokenResolver.js');
          
          // Clear old token
          await invalidateShopToken(shop);
          
          // Try to get new token (will fail without idToken, but clears cache)
          try {
            const newToken = await resolveShopToken(shop, { requested: 'offline' });
            res.json({ success: true, hasNewToken: !!newToken });
          } catch (e) {
            res.json({ success: true, cleared: true, note: 'Token cleared, need idToken for new one' });
          }
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      });
    }


    // Handle Shopify's app routes - both by handle and by API key
    app.get('/apps/:app_identifier', (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com; frame-src \'self\' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com https://youtu.be');
      res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
    });

    app.get('/apps/:app_identifier/*', (req, res, next) => {
      // Skip our App Proxy routes
      if (req.params.app_identifier === 'new-ai-seo') {
        return next();
      }
      
      res.set('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com; frame-src \'self\' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com https://youtu.be');
      res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
    });

    // ---------------------------------------------------------------------------
    // Static frontend (Vite build). We never cache index.html.
    // We DO NOT use a catch-all regex to avoid shadowing /auth and other APIs.
    // ---------------------------------------------------------------------------
    const distPath = path.join(__dirname, '..', 'frontend', 'dist');

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
      
      // If no shop parameter, show install form
      if (!shop) {
        let html = `
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
            <script>
              window.__SHOPIFY_API_KEY = '${process.env.SHOPIFY_API_KEY}';
            </script>
            <meta name="shopify-api-key" content="${process.env.SHOPIFY_API_KEY}">
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
        `;
        return res.send(html);
      }
      
      // Set proper headers for embedded apps
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        'Content-Security-Policy': "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://partners.shopify.com; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com https://youtu.be",
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      
      try {
        const ShopModel = (await import('./db/Shop.js')).default;
        let existingShop = await ShopModel.findOne({ shop }).lean();
        
        // Handle JWT token if present
        if (id_token) {
          if (!existingShop || !existingShop.accessToken || existingShop.accessToken === 'jwt-pending' || 
              existingShop.appApiKey !== process.env.SHOPIFY_API_KEY) {
            // НАПРАВИ TOKEN EXCHANGE ВЕДНАГА НА СЪРВЪРА
            try {
              const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  client_id: process.env.SHOPIFY_API_KEY,
                  client_secret: process.env.SHOPIFY_API_SECRET,
                  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
                  subject_token: id_token,
                  subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
                  requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token'
                }),
              });

              if (tokenResponse.ok) {
                const tokenData = await tokenResponse.json();
                const accessToken = tokenData.access_token;
                
                if (accessToken) {
                  // Запази в базата данни
                  await ShopModel.findOneAndUpdate(
                    { shop },
                    { 
                      shop, 
                      accessToken,
                      appApiKey: process.env.SHOPIFY_API_KEY,
                      useJWT: true,
                      needsTokenExchange: false,
                      installedAt: new Date(),
                      updatedAt: new Date() 
                    },
                    { upsert: true, new: true }
                  );
                } else {
                  console.error('[APP URL] No access token in response');
                }
              } else {
                const errorText = await tokenResponse.text();
                console.error('[APP URL] Token exchange failed:', tokenResponse.status, errorText);
              }
            } catch (error) {
              console.error('[APP URL] Token exchange error:', error);
            }
          }
          
          // For embedded apps, we use Token Exchange to get Admin API access tokens
          // The tokenResolver will handle JWT -> Admin token exchange automatically
          if (id_token || embedded === '1') {
              
              const indexPath = path.join(distPath, 'index.html');
              let html = fs.readFileSync(indexPath, 'utf8');
          
              // Inject version for cache busting
              const appVersion = Date.now();
              html = html.replace(/%BUILD_TIME%/g, appVersion);
              html = html.replace(/%CACHE_BUST%/g, appVersion);
              
              // Inject the Shopify API key and other data into the HTML
              const apiKey = process.env.SHOPIFY_API_KEY || '';
              
              // First, replace the placeholder in the existing meta tag
              html = html.replace(/%VITE_SHOPIFY_API_KEY%/g, apiKey);
              
              // Find the closing </head> tag and inject our script before it
              const headEndIndex = html.indexOf('</head>');
              
              if (headEndIndex !== -1) {
                const injection = `
                  <script>
                    window.__SHOPIFY_API_KEY = '${apiKey}';
                    window.__SHOPIFY_SHOP = '${shop}';
                    window.__SHOPIFY_HOST = '${host || ''}';
                  </script>
                  <meta name="shopify-api-key" content="${apiKey}">
                `;
                html = html.slice(0, headEndIndex) + injection + html.slice(headEndIndex);
              } else {
                console.error('[SERVER] Could not find </head> tag in HTML!');
              }
          
          return res.send(html);
        }
        
      } // End of if (id_token) block
        
        // No JWT token and app not installed - redirect to OAuth
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
      res.json({ 
        status: 'ok',
        app: 'NEW AI SEO',
        version: '1.0.0'
      });
    });

    // Или може да търси health endpoint
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        timestamp: Date.now()
      });
    });

    // Debug route за да видим всички заявки
    app.use((req, res, next) => {
      if (req.headers.referer && req.headers.referer.includes('partners.shopify.com')) {
        // Partners request detected
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
      '/settings',
      '/ai-testing',
      '/billing',
      '/clean-uninstall'
    ];

      spaRoutes.forEach((route) => {
        app.get(route, (_req, res) => {
          res.set('Cache-Control', 'no-store');
          let html = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8');
          
          // Inject API key
          const apiKey = process.env.SHOPIFY_API_KEY || '';
          // First, replace the placeholder in the existing meta tag
          html = html.replace(/%VITE_SHOPIFY_API_KEY%/g, apiKey);
          const headEndIndex = html.indexOf('</head>');
          if (headEndIndex !== -1) {
            const injection = `
            <script>
              window.__SHOPIFY_API_KEY = '${apiKey}';
            </script>
            <meta name="shopify-api-key" content="${apiKey}">
          `;
            html = html.slice(0, headEndIndex) + injection + html.slice(headEndIndex);
          }
          
          res.send(html);
        });
      });

    // Wildcard for all /ai-seo/* routes (but not /apps/* routes)
    app.get('/ai-seo*', (req, res, next) => {
      // Skip /apps/* routes
      if (req.path.startsWith('/apps/')) {
        return next();
      }
      res.set('Cache-Control', 'no-store');
      let html = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8');
      
      // Inject API key
      const apiKey = process.env.SHOPIFY_API_KEY || '';
      // First, replace the placeholder in the existing meta tag
      html = html.replace('%VITE_SHOPIFY_API_KEY%', apiKey);
      const headEndIndex = html.indexOf('</head>');
      if (headEndIndex !== -1) {
        const injection = `
          <script>
            window.__SHOPIFY_API_KEY = '${apiKey}';
          </script>
          <meta name="shopify-api-key" content="${apiKey}">
        `;
        html = html.slice(0, headEndIndex) + injection + html.slice(headEndIndex);
      }
      
      res.send(html);
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

    // Старият /test/set-plan endpoint е премахнат - използваме GraphQL версията

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

    async function start() {
      try {
        // MongoDB Connection with optimized pooling (PHASE 1 - COMPLETE ✅)
        if (process.env.MONGODB_URI) {
          mongoose.set('strictQuery', false);
          
          dbLogger.info('🚀 Connecting with optimized connection pooling...');
          const { default: dbConnection, setupShutdownHandlers } = await import('./db/connection.js');
          setupShutdownHandlers(); // Setup SIGTERM/SIGINT handlers
          await dbConnection.connect();
          
          // Create database indexes for optimal query performance (PHASE 2)
          dbLogger.info('📇 Starting PHASE 2: Database Indexes...');
          const { createAllIndexes } = await import('./db/indexes.js');
          await createAllIndexes();
        } else {
          console.log('ℹ No MONGODB_URI provided — skipping Mongo connection');
        }

      // DEBUG ENDPOINTS (MUST be first, before all other middleware)
      app.get('/debug/env', (req, res) => {
        const key = process.env.SHOPIFY_API_KEY || '';
        res.json({
          ok: true,
          SHOPIFY_API_KEY_present: Boolean(key),
          SHOPIFY_API_KEY_len: key.length,
          SHOPIFY_API_KEY_preview: key ? `${key.slice(0,4)}…${key.slice(-4)}` : null,
          NODE_ENV: process.env.NODE_ENV || null,
          embedded: true
        });
      });

      // Database Indexes Status Endpoint (PHASE 2 - Verification)
      app.get('/debug/indexes', async (req, res) => {
        try {
          const { getIndexStats } = await import('./db/indexes.js');
          const stats = await getIndexStats();
          
          if (!stats) {
            return res.status(500).json({ error: 'Failed to fetch index stats' });
          }
          
          res.json({
            phase: 'PHASE 2: Database Indexes',
            status: 'active',
            indexes: stats,
            message: 'Indexes created successfully!'
          });
        } catch (error) {
          res.status(500).json({ 
            error: 'Failed to get index stats', 
            message: error.message 
          });
        }
      });
      
      // Redis Cache Status Endpoint (PHASE 3 - Verification)
      app.get('/debug/cache', async (req, res) => {
        try {
          const cacheService = (await import('./services/cacheService.js')).default;
          const stats = await cacheService.getStats();
          
          if (!stats) {
            return res.json({
              phase: 'PHASE 3: Redis Caching',
              status: 'disabled',
              message: 'Redis not configured. Add REDIS_URL environment variable.',
              enabled: false
            });
          }
          
          res.json({
            phase: 'PHASE 3: Redis Caching',
            status: 'active',
            enabled: true,
            stats,
            message: 'Redis caching is operational!'
          });
        } catch (error) {
          res.status(500).json({ 
            error: 'Failed to get cache stats', 
            message: error.message 
          });
        }
      });

      app.get('/debug/whoami', (req, res) => {
        const fromQuery = req.query.shop;
        const fromHost = (()=>{
          try {
            const host = req.query.host;
            if (!host) return null;
            const decoded = Buffer.from(host, 'base64').toString('utf8');
            const m = decoded.match(/store\/([^/?]+)/);
            return m ? `${m[1]}.myshopify.com` : null;
          } catch { return null; }
        })();
        const shop = normalizeShop(fromQuery || fromHost || req.session?.shop);
        res.json({ ok:true, shop, raw: { query: req.query.shop, host: req.query.host }});
      });

      // App Bridge JavaScript injection endpoint
      app.get('/app-bridge.js', (req, res) => {
        const { shop } = req.query;
        let { host } = req.query;
        // ако host липсва, конструираме го от shop
        if (!host && shop) {
          host = Buffer.from(`${shop}/admin`, 'utf8').toString('base64');
        }
        const apiKey = process.env.SHOPIFY_API_KEY || '';
        res.type('application/javascript').send(`
          window.__SHOPIFY_API_KEY = ${JSON.stringify(apiKey)};
          window.__SHOPIFY_SHOP = ${JSON.stringify(shop || null)};
          window.__SHOPIFY_HOST = ${JSON.stringify(host || null)};
        `);
      });

      // APP PROXY ROUTES (MUST be first, before all other middleware)
      app.use('/apps/new-ai-seo', appProxyRouter);

        // PUBLIC SITEMAP ENDPOINTS (MUST be before authentication middleware)
        // Direct public sitemap endpoint - no authentication required
        app.get('/public-sitemap', async (req, res) => {
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
            
            // Get saved sitemap with content
            const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
            
            if (!sitemapDoc || !sitemapDoc.content) {
              return res.status(404).send(`
    Sitemap not found for shop: ${shop}

    To generate a sitemap:
    1. Install the NEW AI SEO app in your Shopify admin
    2. Go to the Sitemap section and click "Generate Sitemap"
    3. Your sitemap will be available at this URL

    App URL: https://indexaize-aiseo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
              `);
            }
            
            // Serve the saved sitemap
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
        // Simple public sitemap endpoint - no authentication required
        app.get('/sitemap.xml', async (req, res) => {
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
            
            // Get saved sitemap with content
            const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
            
            if (!sitemapDoc || !sitemapDoc.content) {
              return res.status(404).send(`
    Sitemap not found for shop: ${shop}

    To generate a sitemap:
    1. Install the NEW AI SEO app in your Shopify admin
    2. Go to the Sitemap section and click "Generate Sitemap"
    3. Your sitemap will be available at this URL

    App URL: https://indexaize-aiseo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
              `);
            }
            
            // Serve the saved sitemap
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
        
        // Products sitemap endpoint (alias for /sitemap.xml for AI Testing compatibility)
        app.get('/sitemap_products.xml', async (req, res) => {
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
              console.error('[PRODUCTS_SITEMAP] Missing shop parameter');
              return res.status(400).send('Missing shop parameter. Use: ?shop=your-shop.myshopify.com');
            }
            
            // Get saved sitemap with content
            const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
            
            if (!sitemapDoc || !sitemapDoc.content) {
              return res.status(404).type('text/plain').send('Sitemap not found for this shop. Please generate it first.');
            }
            
            // Serve sitemap XML
            res.type('application/xml; charset=utf-8');
            res.send(sitemapDoc.content);
            
          } catch (error) {
            console.error('[PRODUCTS_SITEMAP] Error:', error);
            return res.status(500).send(`Failed to serve sitemap: ${error.message}`);
          }
        });
        
        // Alternative public sitemap endpoint
        app.get('/public-sitemap.xml', async (req, res) => {
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
            
            // Get saved sitemap with content
            const sitemapDoc = await Sitemap.findOne({ shop }).select('+content').lean().exec();
            
            if (!sitemapDoc || !sitemapDoc.content) {
              return res.status(404).send(`
    Sitemap not found for shop: ${shop}

    To generate a sitemap:
    1. Install the NEW AI SEO app in your Shopify admin
    2. Go to the Sitemap section and click "Generate Sitemap"
    3. Your sitemap will be available at this URL

    App URL: https://indexaize-aiseo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
              `);
            }
            
            // Serve the saved sitemap
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

    // Contact Support route - MUST be before catch-all
    app.get('/contact-support', (req, res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, private, no-transform');
      res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com; frame-src \'self\' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com https://youtu.be');
      res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
    });

    // Catch-all for any unmatched routes - MUST be last
    app.get('*', (req, res) => {
      // Check if it's an app request
      if (req.url.includes('/apps/')) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, private, no-transform');
        res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com; frame-src \'self\' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com https://youtu.be');
        let html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'), 'utf8');
        
        // Inject API key
        const apiKey = process.env.SHOPIFY_API_KEY || '';
        // First, replace the placeholder in the existing meta tag
        html = html.replace('%VITE_SHOPIFY_API_KEY%', apiKey);
        const headEndIndex = html.indexOf('</head>');
        if (headEndIndex !== -1) {
          const injection = `
            <script>
              window.__SHOPIFY_API_KEY = '${apiKey}';
            </script>
            <meta name="shopify-api-key" content="${apiKey}">
          `;
          html = html.slice(0, headEndIndex) + injection + html.slice(headEndIndex);
        }
        
        res.send(html);
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

    // Debug endpoint to check token validity
    app.get('/debug/check-token/:shop', async (req, res) => {
      try {
        const shop = req.params.shop;
        const Shop = (await import('./db/Shop.js')).default;
        const shopDoc = await Shop.findOne({ shop }).lean();
        
        if (!shopDoc) {
          return res.json({ error: 'Shop not found' });
        }
        
        // Проверете токена
        const token = shopDoc.accessToken;
        const tokenInfo = {
          exists: !!token,
          startsWithShpua: token?.startsWith('shpua_'),
          startsWithShpat: token?.startsWith('shpat_'),
          length: token?.length,
          apiKey: shopDoc.appApiKey,
          currentApiKey: process.env.SHOPIFY_API_KEY,
          apiKeyMatch: shopDoc.appApiKey === process.env.SHOPIFY_API_KEY,
          lastUpdated: shopDoc.updatedAt
        };
        
        // Тествайте токена
        const testQuery = `{ shop { name } }`;
        try {
          const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: testQuery })
          });
          
          const result = await response.json();
          tokenInfo.testResult = {
            status: response.status,
            ok: response.ok,
            data: result
          };
        } catch (err) {
          tokenInfo.testError = err.message;
        }
        
        res.json(tokenInfo);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Debug endpoint to force token refresh
    app.post('/force-token-refresh/:shop', async (req, res) => {
      try {
        const shop = req.params.shop;
        const Shop = (await import('./db/Shop.js')).default;
        
        // Изтрийте стария токен
        await Shop.findOneAndUpdate(
          { shop },
          { 
            $unset: { accessToken: 1, appApiKey: 1 },
            $set: { needsTokenExchange: true }
          }
        );
        
        res.json({ 
          success: true, 
          message: 'Token cleared. Next request will trigger token exchange.' 
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // ---------------------------------------------------------------------------
    // Process safety logs
    // ---------------------------------------------------------------------------
    process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
    process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));// Force rebuild 1757432718
// Trigger Railway redeploy - Sun Nov  9 08:54:49 EET 2025
