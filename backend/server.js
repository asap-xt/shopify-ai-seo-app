// backend/server.js
// Express server for the Shopify AI SEO app (ESM).
// All comments are in English.

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
const app = express();
app.set('trust proxy', 1);

// --- Test plan overrides (in-memory) ---
const planOverrides = new Map(); // key: shop, value: 'starter'|'professional'|'growth'|'growth_extra'|'enterprise'
app.locals.planOverrides = planOverrides;

app.locals.setPlanOverride = (shop, plan) => {
  console.log(`[DEBUG] setPlanOverride called with shop: ${shop}, plan: ${plan}`);
  if (!shop) {
    console.log(`[DEBUG] No shop provided, returning null`);
    return null;
  }
  if (!plan) {
    console.log(`[DEBUG] No plan provided, deleting override for shop: ${shop}`);
    planOverrides.delete(shop);
    return null;
  }
  console.log(`[DEBUG] Setting override for shop: ${shop} -> plan: ${plan}`);
  planOverrides.set(shop, plan);
  console.log(`[DEBUG] Current overrides:`, Array.from(planOverrides.entries()));
  return plan;
};

app.locals.getPlanOverride = (shop) => {
  console.log(`[DEBUG] getPlanOverride called with shop: ${shop}`);
  if (!shop) {
    console.log(`[DEBUG] No shop provided, returning null`);
    return null;
  }
  const override = planOverrides.get(shop) || null;
  console.log(`[DEBUG] Found override for shop ${shop}:`, override);
  console.log(`[DEBUG] Current overrides:`, Array.from(planOverrides.entries()));
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

// Normalize shop domain for all requests
app.use(attachShop);

// make id_token available to every API handler via req.idToken
app.use('/api', attachIdToken);
app.use('/plans', attachIdToken);
app.use('/collections', attachIdToken);

// ---- PER-SHOP TOKEN RESOLVER (за всички /api/**)
app.use('/api', async (req, res, next) => {
  try {
    console.log('[API-RESOLVER] ===== API MIDDLEWARE CALLED =====');
    console.log('[API-RESOLVER] URL:', req.originalUrl);
    console.log('[API-RESOLVER] Method:', req.method);
    
    // Skip authentication for public sitemap endpoints и token exchange
    if ((req.originalUrl.includes('/sitemap/') || 
         req.originalUrl.includes('/debug/') ||
         req.originalUrl.includes('/token-exchange')) && req.method === 'GET') {
      console.log('[API-RESOLVER] Skipping authentication for public endpoint');
      return next();
    }
    
    const shop = req.shopDomain;
    console.log('[API-RESOLVER] Using normalized shop:', shop);
    
    if (!shop) return res.status(400).json({ error: 'Missing or invalid shop domain' });
    
    try {
      // Опитай се да получиш токен
      const accessToken = await resolveShopToken(shop, { idToken: req.idToken, requested: 'offline' });
      
      // Успех - създай session
      const session = {
        accessToken: accessToken,
        shop: shop,
        isOnline: false,
        scope: 'read_products,write_products,read_themes,write_themes,read_translations,write_translations,read_locales,read_metafields,read_metaobjects,write_metaobjects,read_content,write_content'
      };

      res.locals.adminSession = session;
      res.locals.adminGraphql = new shopify.clients.Graphql({ session });
      res.locals.shop = shop;

      return next();
      
    } catch (tokenError) {
      console.log('[API-RESOLVER] Token error:', tokenError.message);
      
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
// Removed - Public App doesn't create fake tokens

// Removed - Public App doesn't need fake shop deletion

// Removed - Public App uses real OAuth flow only

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
import { attachShop as attachShopFromApiResolver } from './middleware/apiResolver.js';
import collectionsRouter from './controllers/collectionsController.js';

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
app.use('/billing', billingRouter);
app.use(seoRouter);
app.use('/api/languages', languageRouter); // -> /api/languages/product/:shop/:productId
app.use('/api/seo', multiSeoRouter); // -> /api/seo/generate-multi, /api/seo/apply-multi

// --- Minimal GraphQL endpoint for test plan overrides ---
const schema = buildSchema(`
  enum PlanEnum { starter professional growth growth_extra enterprise }
  type PlansMe {
    shop: String! 
    plan: String!
    planKey: String
    priceUsd: Float
    ai_queries_used: Int
    ai_queries_limit: Int
    product_limit: Int
    providersAllowed: [String!]
    modelsSuggested: [String!]
    autosyncCron: String
    trial: TrialInfo
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
      console.log('[GRAPHQL] Background sitemap regeneration requested for shop:', shop);
      
      // Import the core sitemap generation logic
      const { generateSitemapCore } = await import('./controllers/sitemapController.js');
      
      // Call the core function directly without Express req/res
      generateSitemapCore(shop)
        .then((result) => {
          console.log('[GRAPHQL] Background sitemap generation completed:', result);
        })
        .catch((error) => {
          console.error('[GRAPHQL] Background sitemap generation failed:', error);
        });
      
      // Return immediately
      return {
        success: true,
        message: 'Sitemap regeneration started in background',
        shop: shop
      };
      
    } catch (error) {
      console.error('[GRAPHQL] Error starting sitemap regeneration:', error);
      return {
        success: false,
        message: error.message,
        shop: shop
      };
    }
  },

  async products({ shop, first = 1 }, ctx) {
    try {
      console.log('[GRAPHQL] Checking products for shop:', shop);
      
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
      console.log('[GRAPHQL] Checking collections for shop:', shop);
      
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
      console.log('[GRAPHQL] Checking store metadata for shop:', shop);
      
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
      
      console.log('[GRAPHQL] Store metadata check:', {
        shop: normalizedShop,
        hasSeoMetadata,
        hasOrganizationMetadata,
        hasAiMetadata,
        hasAnyMetadata
      });
      
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
      console.log('[GRAPHQL] Checking welcome page for shop:', shop);
      
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
    console.log(`[DEBUG] GraphQL request - query:`, query);
    console.log(`[DEBUG] GraphQL request - variables:`, variables);
    console.log(`[DEBUG] GraphQL request - body:`, req.body);
    
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
    
    console.log(`[DEBUG] GraphQL result:`, result);
    
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
app.use(schemaRouter);
app.use('/api', aiDiscoveryRouter);
app.use(aiEndpointsRouter);
app.use('/ai-enhance', aiEnhanceRouter);
app.use('/api/schema', advancedSchemaRouter);
app.use('/api/ai', aiSimulationController);

// Mount the new controllers with fixed authentication
app.use('/collections', collectionsRouter);

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
          console.log('[SERVER INJECTED] API Key:', window.__SHOPIFY_API_KEY ? 'SET' : 'MISSING');
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
      console.log('[APP URL] Found id_token, processing JWT flow...');
      
      if (!existingShop || !existingShop.accessToken || existingShop.accessToken === 'jwt-pending' || 
          existingShop.appApiKey !== process.env.SHOPIFY_API_KEY) {
        console.log('[APP URL] No valid access token found, performing immediate token exchange...');
        
        // НАПРАВИ TOKEN EXCHANGE ВЕДНАГА НА СЪРВЪРА
        try {
          console.log('[APP URL] Exchanging JWT for access token:', shop);
          
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

          console.log('[APP URL] Token exchange response status:', tokenResponse.status);
          
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
              
              console.log('[APP URL] ✅ Token exchange successful, access token saved');
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
      
      console.log('[APP URL] Serving embedded app with token exchange completed');
    }
    
        console.log('[APP URL] Processing embedded app with JWT token');
        
        // For embedded apps, we use Token Exchange to get Admin API access tokens
        // The tokenResolver will handle JWT -> Admin token exchange automatically
        if (id_token || embedded === '1') {
          console.log('[APP URL] Serving embedded app - Token Exchange will handle authentication');
          
          const indexPath = path.join(distPath, 'index.html');
          let html = fs.readFileSync(indexPath, 'utf8');
      
          // Inject version for cache busting
          const appVersion = Date.now();
          html = html.replace(/%BUILD_TIME%/g, appVersion);
          html = html.replace(/%CACHE_BUST%/g, appVersion);
          console.log('[SERVER] Cache bust version:', appVersion);
          
          // Inject the Shopify API key and other data into the HTML
          const apiKey = process.env.SHOPIFY_API_KEY || '';
          console.log('[SERVER] API Key from env:', apiKey ? 'SET' : 'MISSING');
          console.log('[SERVER] API Key length:', apiKey.length);
          console.log('[SERVER] HTML before injection length:', html.length);
          
          // First, replace the placeholder in the existing meta tag
          console.log('[SERVER] Before placeholder replacement - contains placeholder:', html.includes('%VITE_SHOPIFY_API_KEY%'));
          console.log('[SERVER] API Key to inject:', apiKey ? 'SET (' + apiKey.length + ' chars)' : 'MISSING');
          html = html.replace(/%VITE_SHOPIFY_API_KEY%/g, apiKey);
          console.log('[SERVER] After placeholder replacement - contains placeholder:', html.includes('%VITE_SHOPIFY_API_KEY%'));
          console.log('[SERVER] After placeholder replacement - contains API key:', html.includes(apiKey));
          console.log('[SERVER] Replaced VITE_SHOPIFY_API_KEY placeholder');
          
          // Find the closing </head> tag and inject our script before it
          const headEndIndex = html.indexOf('</head>');
          console.log('[SERVER] Head end index:', headEndIndex);
          
          if (headEndIndex !== -1) {
            const injection = `
              <script>
                console.log('[SERVER INJECTED] Starting injection...');
                window.__SHOPIFY_API_KEY = '${apiKey}';
                window.__SHOPIFY_SHOP = '${shop}';
                window.__SHOPIFY_HOST = '${host || ''}';
                console.log('[SERVER INJECTED] API Key:', window.__SHOPIFY_API_KEY ? 'SET' : 'MISSING');
                console.log('[SERVER INJECTED] API Key value:', window.__SHOPIFY_API_KEY);
                console.log('[SERVER INJECTED] Shop:', window.__SHOPIFY_SHOP);
                console.log('[SERVER INJECTED] Host:', window.__SHOPIFY_HOST);
                console.log('[SERVER INJECTED] Injection complete!');
              </script>
              <meta name="shopify-api-key" content="${apiKey}">
              <script>
                // Test if injection worked
                setTimeout(() => {
                  console.log('[SERVER INJECTED] Delayed check - API Key:', window.__SHOPIFY_API_KEY ? 'SET' : 'MISSING');
                }, 100);
              </script>
            `;
            html = html.slice(0, headEndIndex) + injection + html.slice(headEndIndex);
            console.log('[SERVER] HTML after injection length:', html.length);
            console.log('[SERVER] Injection added successfully');
          } else {
            console.error('[SERVER] Could not find </head> tag in HTML!');
          }
      
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
          console.log('[SERVER INJECTED] API Key:', window.__SHOPIFY_API_KEY ? 'SET' : 'MISSING');
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
        console.log('[SERVER INJECTED] API Key:', window.__SHOPIFY_API_KEY ? 'SET' : 'MISSING');
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

  // DEBUG ENDPOINTS (MUST be first, before all other middleware)
  console.log('[SERVER] Registering debug endpoints...');
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
          console.log('[SERVER INJECTED] API Key:', window.__SHOPIFY_API_KEY ? 'SET' : 'MISSING');
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
