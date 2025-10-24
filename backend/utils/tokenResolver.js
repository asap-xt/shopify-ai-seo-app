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
  const token = await resolveAdminTokenForShop(shop);
  const apiVersion = process.env.SHOPIFY_API_VERSION?.trim() || '2025-07';
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  console.log(`[GRAPHQL] Making request to ${url}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
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