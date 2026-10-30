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

// ---------------------------------------------------------------------------
// Offline access tokens (expiring). Shopify requires expiring offline tokens for
// public apps from 2027-01-01. EVERY code path that obtains a token must go through
// these helpers so tokens are always requested with expiring=1 and stored consistently.
// Docs: shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
// ---------------------------------------------------------------------------

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const OFFLINE_TOKEN_TYPE = 'urn:shopify:params:oauth:token-type:offline-access-token';
const ID_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token';

function normalizeShopDomain(shopInput) {
  return String(shopInput || '').toLowerCase().trim();
}

/** POST to Shopify's token endpoint, form-encoded as documented. Throws with .code on error. */
async function postTokenEndpoint(shop, params) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams(params).toString()
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (!response.ok) {
    const err = new Error(`Shopify token endpoint ${response.status}: ${text}`);
    err.status = response.status;
    err.code = data?.error;
    throw err;
  }
  if (!data?.access_token) {
    throw new Error('No access_token in token endpoint response');
  }
  return data;
}

/**
 * Build a Shop update from a token endpoint response. Expiring tokens carry refresh data.
 * If Shopify returned a non-expiring token, stale refresh fields are cleared so nothing tries
 * to refresh with a refresh_token that doesn't belong to the stored access token.
 */
export function tokenUpdateFromResponse(data) {
  const now = Date.now();
  const expiring = !!data.refresh_token;
  const $set = {
    accessToken: data.access_token,
    appApiKey: process.env.SHOPIFY_API_KEY,
    tokenExpiring: expiring,
    needsTokenExchange: false,
    updatedAt: new Date()
  };
  if (data.scope) $set.scopes = data.scope;
  if (expiring) {
    $set.refreshToken = data.refresh_token;
    $set.tokenExpiresAt = data.expires_in ? new Date(now + Number(data.expires_in) * 1000) : null;
    $set.refreshTokenExpiresAt = data.refresh_token_expires_in
      ? new Date(now + Number(data.refresh_token_expires_in) * 1000)
      : null;
    return { $set };
  }
  return { $set, $unset: { refreshToken: '', tokenExpiresAt: '', refreshTokenExpiresAt: '' } };
}

/** Persist a token endpoint response for a shop (upsert). extraSet adds caller-specific fields. */
export async function saveTokenResponse(shopInput, data, extraSet = {}) {
  const shop = normalizeShopDomain(shopInput);
  const Shop = await loadShopModel();
  const update = tokenUpdateFromResponse(data);
  update.$set = { ...update.$set, ...extraSet, shop };
  await Shop.updateOne({ shop }, update, { upsert: true });
  return data.access_token;
}

/** Exchange a session ID token for an EXPIRING offline token. Returns the raw response. */
export async function exchangeIdTokenForOfflineToken(shopInput, idToken) {
  return postTokenEndpoint(normalizeShopDomain(shopInput), {
    client_id: process.env.SHOPIFY_API_KEY,
    client_secret: process.env.SHOPIFY_API_SECRET,
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: idToken,
    subject_token_type: ID_TOKEN_TYPE,
    requested_token_type: OFFLINE_TOKEN_TYPE,
    expiring: '1'
  });
}

/** Exchange an OAuth authorization code for an EXPIRING offline token. Returns the raw response. */
export async function exchangeAuthCodeForOfflineToken(shopInput, code) {
  return postTokenEndpoint(normalizeShopDomain(shopInput), {
    client_id: process.env.SHOPIFY_API_KEY,
    client_secret: process.env.SHOPIFY_API_SECRET,
    code,
    expiring: '1'
  });
}

/** Migrate a non-expiring offline token to an expiring pair. The old token is revoked by Shopify. */
async function migrateTokenValue(shop, nonExpiringToken) {
  return postTokenEndpoint(shop, {
    client_id: process.env.SHOPIFY_API_KEY,
    client_secret: process.env.SHOPIFY_API_SECRET,
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: nonExpiringToken,
    subject_token_type: OFFLINE_TOKEN_TYPE,
    requested_token_type: OFFLINE_TOKEN_TYPE,
    expiring: '1'
  });
}

/**
 * Migrate the STORED token if it is (or may be) non-expiring. Works without a user session.
 * Shopify rejects already-expiring or revoked tokens with invalid_subject_token, which is
 * harmless: the check time is recorded so the scheduler backs off.
 */
export async function migrateLegacyOfflineToken(shopInput) {
  const shop = normalizeShopDomain(shopInput);
  const Shop = await loadShopModel();
  const rec = await Shop.findOne({ shop }).lean().exec();
  if (!rec?.accessToken || rec.tokenExpiring === true) {
    return { migrated: false, reason: 'not_needed' };
  }
  try {
    const data = await migrateTokenValue(shop, rec.accessToken);
    await saveTokenResponse(shop, data, { tokenMigrationCheckedAt: new Date() });
    tokenLogger.info(`Migrated non-expiring offline token to expiring for ${shop}`);
    return { migrated: true };
  } catch (e) {
    await Shop.updateOne({ shop }, { $set: { tokenMigrationCheckedAt: new Date() } });
    tokenLogger.warn(`Offline token migration not applied for ${shop}: ${e.code || e.message}`);
    return { migrated: false, reason: e.code || e.message };
  }
}

/**
 * One-time cleanup run on app load (needs a session ID token). Shopify keeps at most one
 * non-expiring offline token per app and store, and it may no longer be the one in our DB.
 * A non-expiring exchange returns that token (or mints one); migrating it immediately revokes
 * it and yields an expiring pair. Either way no live non-expiring token remains afterwards.
 * Returns the saved access token, or null if the cleanup already ran or failed.
 */
export async function retireLegacyOfflineToken(shopInput, idToken) {
  const shop = normalizeShopDomain(shopInput);
  const Shop = await loadShopModel();
  const rec = await Shop.findOne({ shop }).lean().exec();
  if (rec?.legacyTokenRetiredAt) return null;

  let legacy;
  try {
    legacy = await postTokenEndpoint(shop, {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: idToken,
      subject_token_type: ID_TOKEN_TYPE,
      requested_token_type: OFFLINE_TOKEN_TYPE
    });
  } catch (e) {
    if (e.status === 400) {
      // Definitive rejection: Shopify no longer issues non-expiring tokens here → nothing to retire
      await Shop.updateOne({ shop }, { $set: { legacyTokenRetiredAt: new Date() } });
      tokenLogger.info(`No legacy non-expiring token to retire for ${shop} (${e.code || e.status})`);
    } else {
      tokenLogger.warn(`Legacy token retirement deferred for ${shop}: ${e.message}`);
    }
    return null;
  }

  try {
    const data = legacy.refresh_token ? legacy : await migrateTokenValue(shop, legacy.access_token);
    const token = await saveTokenResponse(shop, data, {
      legacyTokenRetiredAt: new Date(),
      tokenMigrationCheckedAt: new Date()
    });
    tokenLogger.info(`Retired legacy non-expiring offline token for ${shop}`);
    return token;
  } catch (e) {
    tokenLogger.warn(`Legacy token retirement failed for ${shop} (will retry next load): ${e.code || e.message}`);
    return null;
  }
}

/**
 * Refresh an EXPIRING offline access token using the stored refresh_token.
 * Works WITHOUT a user session — safe for background jobs, webhooks and schedulers.
 * Returns the new access token, or null if the shop has no refresh_token
 * (i.e. a legacy non-expiring token that doesn't need refreshing).
 */
export async function refreshOfflineToken(shopInput) {
  const shop = normalizeShopDomain(shopInput);
  const Shop = await loadShopModel();
  const shopRecord = await Shop.findOne({ shop }).lean().exec();
  const refreshToken = shopRecord?.refreshToken;
  if (!refreshToken) {
    tokenLogger.debug(`No refresh_token for ${shop} (legacy non-expiring token) — nothing to refresh`);
    return null;
  }

  // Shopify rotates the refresh_token on each refresh — saveTokenResponse persists the new one.
  const data = await postTokenEndpoint(shop, {
    client_id: process.env.SHOPIFY_API_KEY,
    client_secret: process.env.SHOPIFY_API_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  const token = await saveTokenResponse(shop, data);
  tokenLogger.info(`Refreshed offline token for ${shop}`);
  return token;
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