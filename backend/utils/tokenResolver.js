// backend/utils/tokenResolver.js
import fetch from 'node-fetch';
import { normalizeShop } from './normalizeShop.js';

function canon(shop) {
  if (Array.isArray(shop)) shop = shop[0];
  if (typeof shop === 'string') shop = shop.split(',')[0]; // безопасност
  return normalizeShop(shop);
}
import Shop from '../db/Shop.js'; // Директен import в началото на файла

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
    const shop = normalizeShop(shopInput);
    if (!shop) {
      console.warn('[TOKEN_RESOLVER] Cannot invalidate - invalid shop:', shopInput);
      return;
    }
    
    const Shop = (await import('../db/Shop.js')).default;
    await Shop.updateOne({ shop }, { $unset: { accessToken: "", appApiKey: "" } });
    console.log('[TOKEN_RESOLVER] Invalidated stored token for', shop);
  } catch (e) {
    console.warn('[TOKEN_RESOLVER] Failed to invalidate token:', e.message);
  }
}

/**
 * Resolve an Admin API access token for a shop.
 * Strategy:
 *   1) If DB token exists AND passes isLikelyAdminToken -> use it.
 *   2) Else, if idToken present -> Token Exchange -> persist -> return.
 *   3) Else, env fallback SHOPIFY_ADMIN_API_TOKEN (dev) -> return.
 *   4) Else throw.
 */
export async function resolveAccessToken(shop, idToken = null, forceExchange = false) {
  console.log('[TOKEN_RESOLVER] Strict resolve for:', shop);
  
  try {
    // Използвайте Shop директно
    const shopDoc = await Shop.findOne({ shop }).lean();
    
    // Ако имаме валиден токен и не форсираме exchange
    if (shopDoc?.accessToken && !forceExchange) {
      if (shopDoc.appApiKey === process.env.SHOPIFY_API_KEY && isLikelyAdminToken(shopDoc.accessToken)) {
        console.log('[TOKEN_RESOLVER] Using stored token, will validate...');
        // TODO: Add token validation here if needed
        return shopDoc.accessToken;
      }
    }
    
    // Ако имаме idToken, направете Token Exchange
    if (idToken) {
      console.log('[TOKEN_RESOLVER] Performing Token Exchange...');
      const newToken = await performTokenExchange(shop, idToken);
      if (newToken) {
        return newToken;
      }
    }
    
    // Fallback to env token if available (for development)
    if (process.env.SHOPIFY_ADMIN_API_TOKEN) {
      console.log('[TOKEN_RESOLVER] No DB token, using env fallback Admin token');
      return process.env.SHOPIFY_ADMIN_API_TOKEN;
    }
    
    throw new Error('No valid token and no idToken for exchange');
  } catch (err) {
    console.error('[TOKEN_RESOLVER] Error:', err);
    
    // Ако грешката е 401, изчисти невалидния токен от DB
    if (err.message.includes('401') || err.message.includes('Invalid API key')) {
      console.log('[TOKEN_RESOLVER] 401 error, clearing invalid token from DB');
      await invalidateShopToken(shop);
    }
    
    // Final fallback to env token if available (for development)
    if (process.env.SHOPIFY_ADMIN_API_TOKEN) {
      console.log('[TOKEN_RESOLVER] Using env fallback Admin token after error');
      return process.env.SHOPIFY_ADMIN_API_TOKEN;
    }
    
    throw err;
  }
}

async function performTokenExchange(shop, idToken) {
  try {
    console.log('[TOKEN_RESOLVER] Calling token exchange endpoint...');
    
    const response = await fetch(`${process.env.APP_URL}/token-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop, sessionToken: idToken })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[TOKEN_RESOLVER] Token exchange response:', data.status);
      
      // Изчакайте малко и вземете новия токен от DB
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const updatedShop = await Shop.findOne({ shop }).lean();
      if (updatedShop?.accessToken) {
        console.log('[TOKEN_RESOLVER] New token retrieved from DB');
        return updatedShop.accessToken;
      }
    }
    
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  } catch (err) {
    console.error('[TOKEN_RESOLVER] Token exchange error:', err);
    throw err;
  }
}

export async function resolveShopToken(
  shopInput,
  { idToken = null, requested = 'offline' } = {}
) {
  // Normalize shop domain (handles arrays, duplicates, validation)
  const shop = canon(shopInput);
  if (!shop) {
    throw new Error('Invalid shop domain: ' + JSON.stringify(shopInput));
  }
  
  console.log('[TOKEN_RESOLVER] Resolving Admin token for:', shop);
  const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;

  // 1) Try DB token if valid AND from current app
  try {
    const Shop = (await import('../db/Shop.js')).default;
    const shopDoc = await Shop.findOne({ shop }).lean();
    if (shopDoc?.accessToken && shopDoc.appApiKey === SHOPIFY_API_KEY && isLikelyAdminToken(shopDoc.accessToken)) {
      console.log('[TOKEN_RESOLVER] Using valid stored Admin token from DB (same app)');
      return shopDoc.accessToken;
    } else if (shopDoc?.accessToken) {
      console.log('[TOKEN_RESOLVER] Token API key:', shopDoc.appApiKey);
      console.log('[TOKEN_RESOLVER] Current API key:', SHOPIFY_API_KEY);
      
      if (shopDoc.appApiKey !== SHOPIFY_API_KEY) {
        console.log('[TOKEN_RESOLVER] Token from different app (API key mismatch), will exchange');
      } else {
        console.log('[TOKEN_RESOLVER] Found invalid token in DB:', shopDoc.accessToken.substring(0, 15) + '...');
      }
      console.log('[TOKEN_RESOLVER] Will perform Token Exchange instead');
    }
  } catch (err) {
    console.warn('[TOKEN_RESOLVER] Could not read shop token from DB:', err.message);
  }

  // 2) Token Exchange using session id_token (embedded recommended path)
  if (idToken && SHOPIFY_API_KEY && SHOPIFY_API_SECRET) {
    console.log('[TOKEN_RESOLVER] Performing Token Exchange with id_token...');
    const requested_token_type =
      requested === 'online'
        ? 'urn:shopify:params:oauth:token-type:online-access-token'
        : 'urn:shopify:params:oauth:token-type:offline-access-token';

    const url = new URL(`/admin/oauth/access_token`, `https://${shop}`).toString();
    const body = {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    const adminAccessToken = data.access_token;
    if (!isLikelyAdminToken(adminAccessToken)) {
      throw new Error('Token exchange returned an invalid/short token');
    }

    // Persist for future calls with appApiKey guard
    try {
      const Shop = (await import('../db/Shop.js')).default;
      await Shop.updateOne(
        { shop },
        { $set: { shop, accessToken: adminAccessToken, appApiKey: SHOPIFY_API_KEY, updatedAt: new Date() } },
        { upsert: true }
      );
      console.log('[TOKEN_RESOLVER] ✅ Persisted new Admin token to DB with appApiKey');
    } catch (e) {
      console.warn('[TOKEN_RESOLVER] Warning: failed to persist exchanged token:', e.message);
    }

    console.log('[TOKEN_RESOLVER] Token exchange OK');
    return adminAccessToken;
  } else {
    if (!idToken) console.log('[TOKEN_RESOLVER] No idToken provided for Token Exchange');
    if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) console.log('[TOKEN_RESOLVER] Missing SHOPIFY_API_KEY/SECRET');
  }

  // 3) Env fallback for dev/ops (only if explicitly allowed)
  const envToken = process.env.SHOPIFY_ADMIN_API_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
  if (isLikelyAdminToken(envToken)) {
    console.log('[TOKEN_RESOLVER] Using env fallback Admin token');
    return envToken;
  }

  // 4) Nothing worked
  throw new Error('No valid Admin API token (DB invalid; no id_token to exchange).');
}

/**
 * Strict version that requires id_token and never falls back to env token
 * Use this for critical operations that need proper scopes (like read_locales)
 */
export async function resolveAdminTokenOrThrow(shop, { idToken = null } = {}) {
  const normalizedShop = normalizeShop(shop);
  if (!normalizedShop) {
    throw new Error('Invalid shop domain: ' + JSON.stringify(shop));
  }
  
  console.log('[TOKEN_RESOLVER] Strict resolve for:', normalizedShop);
  const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;

  // 1) Try DB token if valid AND from current app
  try {
    const Shop = (await import('../db/Shop.js')).default;
    const shopDoc = await Shop.findOne({ shop: normalizedShop }).lean();
    if (shopDoc?.accessToken && shopDoc.appApiKey === SHOPIFY_API_KEY && isLikelyAdminToken(shopDoc.accessToken)) {
      console.log('[TOKEN_RESOLVER] Using valid stored Admin token from DB (same app)');
      return shopDoc.accessToken;
    }
  } catch (err) {
    console.warn('[TOKEN_RESOLVER] Could not read shop token from DB:', err.message);
  }

  // 2) Require id_token for Token Exchange (no env fallback)
  if (!idToken) {
    throw new Error('Missing id_token for token exchange (required for read_locales scope)');
  }

  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    throw new Error('Missing SHOPIFY_API_KEY/SECRET for token exchange');
  }

  console.log('[TOKEN_RESOLVER] Performing strict Token Exchange with id_token...');
  const requested_token_type = 'urn:shopify:params:oauth:token-type:offline-access-token';

  const url = new URL(`/admin/oauth/access_token`, `https://${normalizedShop}`).toString();
  const body = {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const adminAccessToken = data.access_token;
  if (!isLikelyAdminToken(adminAccessToken)) {
    throw new Error('Token exchange returned an invalid/short token');
  }

  // Persist for future calls with appApiKey guard
  try {
    const Shop = (await import('../db/Shop.js')).default;
    await Shop.updateOne(
      { shop: normalizedShop },
      { $set: { shop: normalizedShop, accessToken: adminAccessToken, appApiKey: SHOPIFY_API_KEY, updatedAt: new Date() } },
      { upsert: true }
    );
    console.log('[TOKEN_RESOLVER] ✅ Persisted new Admin token to DB with appApiKey (strict)');
  } catch (e) {
    console.warn('[TOKEN_RESOLVER] Warning: failed to persist exchanged token:', e.message);
  }

  console.log('[TOKEN_RESOLVER] Strict token exchange OK');
  return adminAccessToken;
}

/**
 * Helper: perform an Admin GraphQL call with auto-recover on 401.
 * If Shopify replies 401, we invalidate stored token and retry once via Token Exchange.
 */
export async function adminGraphQLWithRecover({
  shop,
  idToken,
  query,
  variables,
  apiVersion = '2025-07',
}) {
  const doFetch = async (adminAccessToken) => {
    const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': adminAccessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    return res;
  };

  // First attempt (uses DB token if present or exchanges)
  let token = await resolveShopToken(shop, { idToken, requested: 'offline' });
  let res = await doFetch(token);

  if (res.status === 401) {
    console.log('[TOKEN_RESOLVER] 401 received, invalidating token and retrying...');
    // Invalidate and retry once via fresh exchange
    await invalidateShopToken(shop);
    token = await resolveShopToken(shop, { idToken, requested: 'offline' });
    res = await doFetch(token);
  }

  if (res.status === 401) {
    throw new Error('Admin GraphQL 401 after refresh');
  }

  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

  if (!res.ok) {
    throw new Error(
      `GraphQL HTTP ${res.status} @ ${shop} :: ` + (payload?.errors ? JSON.stringify(payload) : text)
    );
  }
  return payload;
}

// Legacy function for backward compatibility
export async function resolveAdminTokenForShop(shopDomain) {
  return resolveShopToken(shopDomain);
}

// Helper functions for JWT handling (kept for compatibility)
import jwt from 'jsonwebtoken';

export function verifyAndDecodeJWT(token, secret) {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      clockTolerance: 5,
    });
    return decoded;
  } catch (e) {
    console.error('[TOKEN_RESOLVER] JWT verification failed:', e.message);
    return null;
  }
}

export function extractShopFromJWT(decoded) {
  if (!decoded) return null;
  const dest = decoded.dest || decoded.iss || '';
  const m = dest.match(/https?:\/\/([a-zA-Z0-9-]+\.myshopify\.com)/);
  return m ? m[1] : null;
}

// New simplified token resolver for Admin API calls
export async function resolveAdminToken(req, shop) {
  shop = canon(shop); // гарантира низ, не масив
  if (!shop) throw new Error('resolveAdminToken: missing shop');
  if (req._resolvedAdminToken && req._resolvedAdminTokenShop === shop) {
    return req._resolvedAdminToken;
  }

  const idToken = req.idToken; // от attachIdToken
  const apiKey = process.env.SHOPIFY_API_KEY;
  const secret = process.env.SHOPIFY_API_SECRET;
  const url = `https://${shop}/admin/oauth/access_token`;

  // 1) Ако имаме id_token -> винаги обменяме
  if (idToken) {
    const body = {
      client_id: apiKey,
      client_secret: secret,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text().catch(()=>'');
      throw new Error(`Token exchange failed: ${r.status} ${t}`);
    }
    const json = await r.json();
    req._resolvedAdminToken = json.access_token;
    req._resolvedAdminTokenShop = shop;
    return json.access_token;
  }

  // 2) Без id_token – вземи токен от DB за ТАЗИ app (appApiKey match). Без match -> грешка.
  const saved = await Shop.findOne({ shop, appApiKey: apiKey }).lean();
  if (saved?.accessToken) {
    req._resolvedAdminToken = saved.accessToken;
    req._resolvedAdminTokenShop = shop;
    return saved.accessToken;
  }
  throw new Error('No admin token available. Provide Authorization: Bearer <id_token>.');
}