// backend/middleware/modernAuth.js
// Modern authentication middleware using session tokens + token exchange

import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION, RequestedTokenType } from '@shopify/shopify-api';
import Shop from '../db/Shop.js';

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  hostName: process.env.APP_URL?.replace(/^https?:\/\//, '').replace(/\/$/, ''),
});

/**
 * Extract session token from request
 */
function extractSessionToken(req) {
  // Try Authorization header first (App Bridge sends it here)
  const authHeader = req.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  // Fallback to body or query
  return req.body?.sessionToken || req.query?.sessionToken || req.body?.id_token || req.query?.id_token;
}

/**
 * Extract shop from request
 */
function extractShop(req) {
  return req.query.shop || 
         req.body?.shop || 
         req.params?.shop ||
         req.get('x-shopify-shop-domain');
}

/**
 * Get offline access token via token exchange
 */
async function getOfflineTokenViaExchange(shop, sessionToken) {
  try {
    const result = await shopify.auth.tokenExchange({
      shop,
      sessionToken,
      requestedTokenType: RequestedTokenType.OfflineAccessToken,
    });

    // Store the token (extract accessToken from Session object)
    const tokenString = result.session?.accessToken || result.accessToken || result;
    await Shop.findOneAndUpdate(
      { shop },
      { 
        shop, 
        accessToken: tokenString, 
        updatedAt: new Date(),
        tokenType: 'offline',
        authMethod: 'token_exchange'
      },
      { upsert: true, new: true }
    );

    return tokenString;

  } catch (error) {
    console.error(`[TOKEN_EXCHANGE] Failed for ${shop}:`, error.message);
    throw error;
  }
}

/**
 * Get online access token via token exchange  
 */
async function getOnlineTokenViaExchange(shop, sessionToken) {
  try {
    const result = await shopify.auth.tokenExchange({
      shop,
      sessionToken,
      requestedTokenType: RequestedTokenType.OnlineAccessToken,
    });

    return result.session?.accessToken || result.accessToken || result;

  } catch (error) {
    console.error(`[TOKEN_EXCHANGE] Online token failed for ${shop}:`, error.message);
    throw error;
  }
}

/**
 * Get cached offline token from database
 */
async function getCachedOfflineToken(shop) {
  try {
    const shopRecord = await Shop.findOne({ shop }).lean();
    if (shopRecord?.accessToken && shopRecord.authMethod === 'token_exchange') {
      return shopRecord.accessToken;
    }
    return null;
  } catch (error) {
    console.error(`[CACHE] Error getting cached token for ${shop}:`, error.message);
    return null;
  }
}

/**
 * Resolve access token for API calls
 * Priority: 1) Cached offline token, 2) Token exchange with session token
 */
export async function resolveAccessToken(req) {
  const shop = extractShop(req);
  if (!shop) {
    throw new Error('Shop parameter is required');
  }

  const sessionToken = extractSessionToken(req);
  
  // First try cached offline token
  const cachedToken = await getCachedOfflineToken(shop);
  if (cachedToken) {
    return {
      shop,
      accessToken: cachedToken,
      tokenType: 'offline',
      source: 'cached'
    };
  }

  // If we have session token, try token exchange, but fallback to cached if it fails
  if (sessionToken) {
    try {
      const accessToken = await getOfflineTokenViaExchange(shop, sessionToken);
      return {
        shop,
        accessToken,
        tokenType: 'offline', 
        source: 'token_exchange'
      };
    } catch (exchangeError) {
      // Fallback to any cached token (even if not from token_exchange)
      const fallbackToken = await Shop.findOne({ shop }).lean();
      if (fallbackToken?.accessToken) {
        return {
          shop,
          accessToken: fallbackToken.accessToken,
          tokenType: 'offline',
          source: 'fallback_cached'
        };
      }
      
      // If no fallback available, re-throw the original error
      throw exchangeError;
    }
  }

  throw new Error(`No authentication available for shop: ${shop}`);
}

/**
 * Authentication middleware
 */
export function requireAuth(req, res, next) {
  resolveAccessToken(req)
    .then(({ shop, accessToken, tokenType, source }) => {
      // Attach auth info to request
      req.auth = {
        shop,
        accessToken,
        tokenType,
        source
      };
      next();
    })
    .catch(error => {
      console.error('[AUTH] Authentication failed:', error.message);
      
      // For embedded apps, return 401 with specific header so App Bridge can retry
      if (extractSessionToken(req)) {
        res.set('X-Shopify-Retry-Invalid-Session-Request', '1');
        return res.status(401).json({
          error: 'Authentication failed',
          message: error.message,
          requiresReauth: true
        });
      }
      
      return res.status(401).json({
        error: 'Authentication required',
        message: error.message
      });
    });
}

/**
 * GraphQL helper that uses resolved auth
 */
export async function executeGraphQL(req, query, variables = {}) {
  if (!req.auth) {
    throw new Error('Request not authenticated - use requireAuth middleware first');
  }

  const { shop, accessToken } = req.auth;
  const url = `https://${shop}/admin/api/${LATEST_API_VERSION}/graphql.json`;

  console.log(`[GRAPHQL] Making request to ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  
  if (!response.ok) {
    console.error(`[GRAPHQL] HTTP ${response.status} for ${shop}:`, text);
    throw new Error(`GraphQL HTTP error ${response.status}: ${text}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (parseError) {
    console.error(`[GRAPHQL] Parse error for ${shop}:`, text);
    throw new Error(`GraphQL response parse error: ${text}`);
  }

  if (json.errors?.length) {
    const errorMessage = json.errors.map(e => e.message).join('; ');
    console.error(`[GRAPHQL] GraphQL errors for ${shop}:`, json.errors);
    throw new Error(`GraphQL errors: ${errorMessage}`);
  }

  console.log(`[GRAPHQL] Success for ${shop}`);
  return json.data;
}
