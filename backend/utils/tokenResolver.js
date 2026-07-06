// backend/utils/tokenResolver.js
// Unified token resolver that works consistently across all controllers

import fetch from 'node-fetch';
import { tokenLogger } from './logger.js';

let ShopModel = null;

async function loadShopModel() {
  if (ShopModel) return ShopModel;
  try {
    const mod = await import('../db/Shop.js');
    ShopModel = mod.default || mod.Shop || mod;
    return ShopModel;
  } catch (error) {
    tokenLogger.error('Failed to load Shop model:', error);
    throw new Error('Shop model not found');
  }
}

/** Heuristic: reject session tokens / placeholders stored by mistake */
export function isLikelyAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  // reject placeholders / JWTs
  if (token === 'jwt-pending') return false;
  if (token.includes('.')) return false; // JWT shape
  // sanity length (admin tokens are long)
  if (token.length < 24) return false;
  return true;
}

export async function invalidateShopToken(shopInput) {
  try {
    const shop = shopInput.toLowerCase().trim();
    if (!shop) {
      tokenLogger.warn('Cannot invalidate - invalid shop:', shopInput);
      return;
    }

    const Shop = await loadShopModel();
    await Shop.updateOne({ shop }, { $unset: { accessToken: "", appApiKey: "" } });
    tokenLogger.info('Invalidated stored token for', shop);
  } catch (e) {
    tokenLogger.warn('Failed to invalidate token:', e.message);
  }
}

/**
 * Refresh an EXPIRING offline access token using the stored refresh_token.
 * Works WITHOUT a user session — safe for background jobs, webhooks and schedulers.
 * Returns the new access token, or null if the shop has no refresh_token
 * (i.e. a legacy non-expiring token that doesn't need refreshing).
 */
export async function refreshOfflineToken(shopInput) {
  const shop = shopInput.toLowerCase().trim();
  const Shop = await loadShopModel();
  const shopRecord = await Shop.findOne({ shop }).lean().exec();
  const refreshToken = shopRecord?.refreshToken;
  if (!refreshToken) {
    tokenLogger.debug(`No refresh_token for ${shop} (legacy non-expiring token) — nothing to refresh`);
    return null;
  }

  const tokenUrl = `https://${shop}/admin/oauth/access_token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Offline token refresh failed: ${response.status} ${text}`);
  }

  const data = JSON.parse(text);
  if (!data.access_token) {
    throw new Error('No access_token in refresh response');
  }

  const now = Date.now();
  const update = {
    accessToken: data.access_token,
    appApiKey: process.env.SHOPIFY_API_KEY,
    needsTokenExchange: false,
    updatedAt: new Date()
  };
  if (data.expires_in) update.tokenExpiresAt = new Date(now + Number(data.expires_in) * 1000);
  // Shopify rotates the refresh_token on each refresh — persist the new one when returned.
  if (data.refresh_token) update.refreshToken = data.refresh_token;
  if (data.refresh_token_expires_in) update.refreshTokenExpiresAt = new Date(now + Number(data.refresh_token_expires_in) * 1000);

  await Shop.updateOne({ shop }, { $set: update });
  tokenLogger.info(`Refreshed offline token for ${shop}`);
  return data.access_token;
}

/**
 * Centralized token resolver for ALL Shopify GraphQL requests
 * This fixes the database schema mismatch and provides consistent authentication
 */
export async function resolveAdminTokenForShop(shop, options = {}) {
  if (!shop) {
    throw new Error('Shop domain is required');
  }

  const normalizedShop = shop.toLowerCase().trim();
  tokenLogger.debug(`Resolving token for shop: ${normalizedShop}`);

  try {
    const Shop = await loadShopModel();
    
    const shopRecord = await Shop.findOne({
      $or: [
        { shop: normalizedShop },
        { shopDomain: normalizedShop }
      ]
    }).lean().exec();

    if (shopRecord) {
      const token = shopRecord.accessToken || 
                   shopRecord.token || 
                   shopRecord.access_token;
      
      // Проверка за валиден токен
      if (token && String(token).trim() && token !== 'jwt-pending') {
        // Проверка дали токенът е за текущия API key
        if (shopRecord.appApiKey === process.env.SHOPIFY_API_KEY) {
          // Proactively refresh an expiring token that is at/near expiry (<2 min left).
          // Legacy non-expiring tokens have no tokenExpiresAt/refreshToken and skip this.
          if (shopRecord.refreshToken && shopRecord.tokenExpiresAt &&
              (new Date(shopRecord.tokenExpiresAt).getTime() - Date.now() < 120000)) {
            try {
              const refreshed = await refreshOfflineToken(normalizedShop);
              if (refreshed) return refreshed;
            } catch (e) {
              tokenLogger.warn(`Proactive token refresh failed for ${normalizedShop}: ${e.message} — falling back to stored token`);
            }
          }
          tokenLogger.debug(`Found valid token in DB for ${normalizedShop}`);
          return String(token).trim();
        } else {
          tokenLogger.warn(`Token found but for different API key for ${normalizedShop}`);
          throw new Error(`Token mismatch - app needs token exchange for shop: ${normalizedShop}`);
        }
      }

      if (shopRecord.needsTokenExchange || token === 'jwt-pending') {
        tokenLogger.debug(`Token exchange needed for ${normalizedShop}`);
        throw new Error(`Token exchange required for shop: ${normalizedShop}`);
      }
    }

    tokenLogger.debug(`No valid token found in DB for ${normalizedShop}`);
    throw new Error(`No valid access token found for shop: ${normalizedShop}`);

  } catch (dbError) {
    tokenLogger.error(`Database error for ${normalizedShop}:`, dbError);
    throw new Error(`Failed to retrieve access token for shop: ${normalizedShop}`);
  }
}

async function exchangeJWTForAccessToken(shop, jwtToken) {
  tokenLogger.info(`Exchanging JWT for access token: ${shop}`);
  
  const tokenUrl = `https://${shop}/admin/oauth/access_token`;
  const requestBody = {
    client_id: process.env.SHOPIFY_API_KEY,
    client_secret: process.env.SHOPIFY_API_SECRET,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: jwtToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token'
  };

  tokenLogger.debug(`Request URL: ${tokenUrl}`);
  tokenLogger.debug(`Request body keys:`, Object.keys(requestBody));

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  tokenLogger.debug(`Response status: ${response.status}`);
  tokenLogger.debug(`Response text: ${responseText}`);

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${responseText}`);
  }

  const tokenData = JSON.parse(responseText);
  
  if (!tokenData.access_token) {
    throw new Error('No access_token in token exchange response');
  }

  console.log(`[TOKEN_EXCHANGE] Success! Token starts with: ${tokenData.access_token.substring(0, 10)}...`);
  return tokenData.access_token;
}

/**
 * GraphQL query executor with proper error handling
 */
export async function executeShopifyGraphQL(shop, query, variables = {}) {
  const apiVersion = process.env.SHOPIFY_API_VERSION?.trim() || '2025-07';
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  async function attempt(token) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await response.text();
    return { response, text };
  }

  console.log(`[GRAPHQL] Making request to ${url}`);

  try {
    let token = await resolveAdminTokenForShop(shop);
    let { response, text } = await attempt(token);

    // Reactive refresh: an expired/invalid offline token returns 401. Refresh once and retry.
    if (response.status === 401) {
      tokenLogger.warn(`[GRAPHQL] 401 for ${shop} — attempting offline token refresh + retry`);
      const refreshed = await refreshOfflineToken(shop).catch((e) => {
        tokenLogger.error(`[GRAPHQL] Token refresh failed for ${shop}: ${e.message}`);
        return null;
      });
      if (refreshed) {
        ({ response, text } = await attempt(refreshed));
      }
    }

    if (!response.ok) {
      console.error(`[GRAPHQL] HTTP ${response.status} for ${shop}:`, text);
      throw new Error(`GraphQL HTTP error ${response.status}: ${text}`);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (parseError) {
      console.error(`[GRAPHQL] JSON parse error for ${shop}:`, text);
      throw new Error(`GraphQL response parse error: ${text}`);
    }

    // Check for GraphQL errors
    if (json.errors && json.errors.length > 0) {
      const errorMessage = json.errors.map(e => e.message).join('; ');
      console.error(`[GRAPHQL] GraphQL errors for ${shop}:`, json.errors);
      throw new Error(`GraphQL errors: ${errorMessage}`);
    }

    // Check for user errors in data
    const userErrors = [];
    function collectUserErrors(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(collectUserErrors);
        return;
      }
      if (obj.userErrors && Array.isArray(obj.userErrors)) {
        userErrors.push(...obj.userErrors);
      }
      Object.values(obj).forEach(collectUserErrors);
    }
    
    if (json.data) {
      collectUserErrors(json.data);
    }

    if (userErrors.length > 0) {
      console.error(`[GRAPHQL] User errors for ${shop}:`, userErrors);
      throw new Error(`GraphQL user errors: ${JSON.stringify(userErrors)}`);
    }

    console.log(`[GRAPHQL] Success for ${shop}`);
    return json.data;

  } catch (fetchError) {
    console.error(`[GRAPHQL] Fetch error for ${shop}:`, fetchError);
    throw fetchError;
  }
}

// Legacy compatibility functions
export async function resolveShopToken(shopInput, options = {}) {
  return resolveAdminTokenForShop(shopInput);
}

export async function resolveAdminToken(req, shop) {
  return resolveAdminTokenForShop(shop);
}

// Additional utility functions for compatibility
export async function resolveAdminTokenForShopLegacy(shopDomain) {
  return resolveAdminTokenForShop(shopDomain);
}