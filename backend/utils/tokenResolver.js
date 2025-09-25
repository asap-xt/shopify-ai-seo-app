// backend/utils/tokenResolver.js
import fetch from 'node-fetch';

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

export async function invalidateShopToken(shopDomain) {
  try {
    const Shop = (await import('../db/Shop.js')).default;
    await Shop.updateOne({ shop: shopDomain }, { $unset: { accessToken: "" } });
    console.log('[TOKEN_RESOLVER] Invalidated stored token for', shopDomain);
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
export async function resolveShopToken(
  shopDomain,
  { idToken = null, requested = 'offline' } = {}
) {
  console.log('[TOKEN_RESOLVER] Resolving Admin token for:', shopDomain);
  const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;

  // 1) Try DB token if valid
  try {
    const Shop = (await import('../db/Shop.js')).default;
    const shopDoc = await Shop.findOne({ shop: shopDomain }).lean();
    if (shopDoc?.accessToken && isLikelyAdminToken(shopDoc.accessToken)) {
      console.log('[TOKEN_RESOLVER] Using valid stored Admin token from DB');
      return shopDoc.accessToken;
    } else if (shopDoc?.accessToken) {
      console.log('[TOKEN_RESOLVER] Found invalid token in DB:', shopDoc.accessToken.substring(0, 15) + '...');
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

    const url = `https://${shopDomain}/admin/oauth/access_token`;
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

    // Persist for future calls
    try {
      const Shop = (await import('../db/Shop.js')).default;
      await Shop.updateOne(
        { shop: shopDomain },
        { $set: { shop: shopDomain, accessToken: adminAccessToken, updatedAt: new Date() } },
        { upsert: true }
      );
      console.log('[TOKEN_RESOLVER] ✅ Persisted new Admin token to DB');
    } catch (e) {
      console.warn('[TOKEN_RESOLVER] Warning: failed to persist exchanged token:', e.message);
    }

    console.log('[TOKEN_RESOLVER] Token exchange OK');
    return adminAccessToken;
  } else {
    if (!idToken) console.log('[TOKEN_RESOLVER] No idToken provided for Token Exchange');
    if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) console.log('[TOKEN_RESOLVER] Missing SHOPIFY_API_KEY/SECRET');
  }

  // 3) Env fallback for dev/ops
  const envToken = process.env.SHOPIFY_ADMIN_API_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
  if (isLikelyAdminToken(envToken)) {
    console.log('[TOKEN_RESOLVER] Using env fallback Admin token');
    return envToken;
  }

  // 4) Nothing worked
  throw new Error('No valid Admin API token (DB invalid; no id_token to exchange).');
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
    console.log('[TOKEN_RESOLVER] Got 401, invalidating token and retrying...');
    // Invalidate and retry once via fresh exchange
    await invalidateShopToken(shop);
    token = await resolveShopToken(shop, { idToken, requested: 'offline' });
    res = await doFetch(token);
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