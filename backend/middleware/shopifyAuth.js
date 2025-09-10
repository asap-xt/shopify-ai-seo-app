// backend/middleware/shopifyAuth.js
// Public App Authentication Middleware using @shopify/shopify-api 11.14.1

import shopify from '../utils/shopifyApi.js';

// Middleware for OAuth authentication
export function authBegin() {
  return shopify.auth.begin({
    authPath: '/api/auth',
    callbackPath: '/api/auth/callback',
    afterAuth: async (ctx) => {
      const { session } = ctx;
      console.log('[SHOPIFY-AUTH] OAuth completed for shop:', session.shop);
      
      // Redirect to app after successful authentication
      const redirectUrl = `${process.env.APP_URL}/?shop=${session.shop}&host=${ctx.query.host}`;
      ctx.redirect(redirectUrl);
    }
  });
}

// Middleware for OAuth callback
export function authCallback() {
  return shopify.auth.callback({
    afterAuth: async (ctx) => {
      const { session } = ctx;
      console.log('[SHOPIFY-AUTH] Session stored for shop:', session.shop);
    }
  });
}

// Middleware to ensure app is installed on shop
export function ensureInstalledOnShop() {
  return shopify.ensureInstalledOnShop();
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
        console.log('[SHOPIFY-AUTH] No valid session found for shop:', shop);
        return res.status(401).json({ error: 'App not installed or session expired' });
      }

      // Check if session is expired
      if (session.expires && new Date(session.expires) < new Date()) {
        console.log('[SHOPIFY-AUTH] Session expired for shop:', shop);
        return res.status(401).json({ error: 'Session expired' });
      }

      // Attach session to request
      req.shopifySession = session;
      req.shopDomain = session.shop;
      req.shopAccessToken = session.accessToken;

      // Attach to res.locals for compatibility
      res.locals.shopify = { session };

      console.log('[SHOPIFY-AUTH] Valid session for shop:', shop);
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

// Combined middleware that tries both approaches
export function validateRequest() {
  return async (req, res, next) => {
    // First try embedded session token (for embedded app requests)
    const sessionToken = req.headers.authorization?.replace('Bearer ', '');
    
    if (sessionToken) {
      try {
        const session = await shopify.auth.validateSessionToken(sessionToken);
        if (session) {
          req.shopifySession = session;
          req.shopDomain = session.shop;
          req.shopAccessToken = session.accessToken;
          res.locals.shopify = { session };
          console.log('[SHOPIFY-AUTH] Valid embedded session for shop:', session.shop);
          return next();
        }
      } catch (error) {
        console.log('[SHOPIFY-AUTH] Embedded session validation failed, trying shop session');
      }
    }

    // Fallback to shop-based session validation
    const shop = req.query.shop || req.body.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter required' });
    }

    try {
      const session = await shopify.config.sessionStorage.loadSession(shop);
      if (!session || !session.accessToken) {
        return res.status(401).json({ error: 'App not installed or session expired' });
      }

      req.shopifySession = session;
      req.shopDomain = session.shop;
      req.shopAccessToken = session.accessToken;
      res.locals.shopify = { session };

      console.log('[SHOPIFY-AUTH] Valid shop session for shop:', shop);
      next();
    } catch (error) {
      console.error('[SHOPIFY-AUTH] Shop session validation error:', error);
      return res.status(500).json({ error: 'Authentication error' });
    }
  };
}
