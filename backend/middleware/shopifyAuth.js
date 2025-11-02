// backend/middleware/shopifyAuth.js
// Public App Authentication Middleware using @shopify/shopify-api 11.14.1

import shopify from '../utils/shopifyApi.js';
import { resolveShopToken } from '../utils/tokenResolver.js';

// Middleware for OAuth authentication
export function authBegin() {
  return async (req, res, next) => {
    try {
      const middleware = await shopify.auth.begin({
        authPath: '/api/auth',
        callbackPath: '/api/auth/callback',
        afterAuth: async (ctx) => {
          const { session } = ctx;
          
          // Redirect to app after successful authentication
          const redirectUrl = `${process.env.APP_URL}/?shop=${session.shop}&host=${ctx.query.host}`;
          ctx.redirect(redirectUrl);
        }
      });
      return middleware(req, res, next);
    } catch (error) {
      console.error('[SHOPIFY-AUTH] Error in authBegin:', error);
      next(error);
    }
  };
}

// Middleware for OAuth callback
export function authCallback() {
  return async (req, res, next) => {
    try {
      const middleware = await shopify.auth.callback({
        afterAuth: async (ctx) => {
          const { session } = ctx;
          
          // CRITICAL: Save access token to MongoDB for our tokenResolver
          if (session.accessToken) {
            try {
              const Shop = (await import('../db/Shop.js')).default;
              
              // Ensure accessToken is always a string
              const accessTokenString = typeof session.accessToken === 'object' && session.accessToken.accessToken 
                ? session.accessToken.accessToken 
                : session.accessToken;
              
              await Shop.findOneAndUpdate(
                { shop: session.shop },
                {
                  shop: session.shop,
                  accessToken: accessTokenString,
                  scopes: session.scope,
                  useJWT: false, // This is traditional OAuth flow
                  installedAt: new Date(),
                  updatedAt: new Date()
                },
                { upsert: true, new: true }
              );
            } catch (error) {
              console.error('[SHOPIFY-AUTH] ❌ Failed to save access token to MongoDB:', error);
            }
          }
        }
      });
      return middleware(req, res, next);
    } catch (error) {
      console.error('[SHOPIFY-AUTH] Error in authCallback:', error);
      next(error);
    }
  };
}

// Middleware to ensure app is installed on shop
export function ensureInstalledOnShop() {
  return async (req, res, next) => {
    try {
      const middleware = await shopify.ensureInstalledOnShop();
      return middleware(req, res, next);
    } catch (error) {
      console.error('[SHOPIFY-AUTH] Error in ensureInstalledOnShop:', error);
      next(error);
    }
  };
}

// Middleware for session validation (replaces verifyRequest.js)
export function validateSession() {
  return async (req, res, next) => {
    try {
      // Get shop from query parameter
      const shop = req.query.shop;
      if (!shop) {
        return res.status(400).json({ error: 'Shop parameter required' });
      }

      // Load session from storage
      const session = await shopify.config.sessionStorage.loadSession(shop);
      if (!session || !session.accessToken) {
        return res.status(401).json({ error: 'App not installed or session expired' });
      }

      // Check if session is expired
      if (session.expires && new Date(session.expires) < new Date()) {
        return res.status(401).json({ error: 'Session expired' });
      }

      // Attach session to request
      req.shopifySession = session;
      req.shopDomain = session.shop;
      req.shopAccessToken = session.accessToken;

      // Attach to res.locals for compatibility
      res.locals.shopify = { session };

      next();
    } catch (error) {
      console.error('[SHOPIFY-AUTH] Session validation error:', error);
      return res.status(500).json({ error: 'Authentication error' });
    }
  };
}

// Middleware for embedded app session token validation
export function validateEmbeddedSession() {
  return async (req, res, next) => {
    try {
      const sessionToken = req.headers.authorization?.replace('Bearer ', '');
      
      if (!sessionToken) {
        return res.status(401).json({ error: 'Missing session token' });
      }

      // Verify session token with Shopify
      const session = await shopify.auth.validateSessionToken(sessionToken);
      if (!session) {
        return res.status(401).json({ error: 'Invalid session token' });
      }

      // Attach session to request
      req.shopifySession = session;
      req.shopDomain = session.shop;
      req.shopAccessToken = session.accessToken;

      // Attach to res.locals for compatibility
      res.locals.shopify = { session };

      console.log('[SHOPIFY-AUTH] Valid embedded session for shop:', session.shop);
      next();
    } catch (error) {
      console.error('[SHOPIFY-AUTH] Embedded session validation error:', error);
      return res.status(401).json({ error: 'Invalid session token' });
    }
  };
}

// Combined middleware using centralized token resolver
export function validateRequest() {
  return async (req, res, next) => {
    const shop = req.shopDomain || req.query.shop || req.body?.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter required' });
    }

    try {
      // Use centralized token resolver with id_token
      const accessToken = await resolveShopToken(shop, { idToken: req.idToken, requested: 'offline' });
      
      // Set session data
      req.shopifySession = {
        shop: shop,
        accessToken: accessToken,
        isOnline: false
      };
      req.shopDomain = shop;
      req.shopAccessToken = accessToken;
      
      res.locals.shopify = { 
        session: {
          shop: shop,
          accessToken: accessToken,
          isOnline: false,
          scope: '' // Could be enhanced to get from DB if needed
        }
      };

      console.log('[SHOPIFY-AUTH] Set real token for shop:', shop);
      next();
    } catch (error) {
      console.error('[SHOPIFY-AUTH] Error loading shop token:', error);
      return res.status(401).json({ error: `Authentication error: ${error.message}` });
    }
  };
}
