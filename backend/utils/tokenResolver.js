// backend/utils/tokenResolver.js
// Centralized token resolver for Shopify apps
// Implements Token Exchange for embedded apps to obtain Admin API access tokens.

import jwt from 'jsonwebtoken';

// Helper to verify and decode JWT tokens (session tokens from App Bridge)
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

// Extract shop from a verified JWT payload
export function extractShopFromJWT(decoded) {
  if (!decoded) return null;
  const dest = decoded.dest || decoded.iss || '';
  const m = dest.match(/https?:\/\/([a-zA-Z0-9-]+\.myshopify\.com)/);
  return m ? m[1] : null;
}

/**
 * Resolve an Admin API access token for a shop.
 * Strategy:
 *  1) If we already have a stored Admin token -> return it.
 *  2) Else, if an idToken (session token) is provided -> perform Token Exchange to get Admin token, store it, return it.
 *  3) Else, if env fallback token is present -> return it.
 *  4) Else, throw.
 *
 * @param {string} shopDomain e.g. "your-shop.myshopify.com"
 * @param {object} opts
 * @param {string|null} opts.idToken  Session token (id_token) from App Bridge / Authorization: Bearer
 * @param {'online'|'offline'} opts.requested Requested token type for exchange (default: 'offline')
 */
export async function resolveShopToken(shopDomain, { idToken = null, requested = 'offline' } = {}) {
  console.log('[TOKEN_RESOLVER] Resolving Admin token for:', shopDomain);
  const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env;

  // 1) Try cached/stored Admin token in Mongo
  try {
    const Shop = (await import('../db/Shop.js')).default;
    const shopDoc = await Shop.findOne({ shop: shopDomain }).lean();
    if (shopDoc?.accessToken) {
      console.log('[TOKEN_RESOLVER] Using stored Admin token from DB');
      return shopDoc.accessToken;
    }
  } catch (err) {
    console.warn('[TOKEN_RESOLVER] Could not read shop token from DB:', err.message);
  }

  // 2) Perform Token Exchange if idToken is available
  if (idToken && SHOPIFY_API_KEY && SHOPIFY_API_SECRET) {
    try {
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
      if (!adminAccessToken) {
        throw new Error('Token exchange response missing access_token');
      }

      // Persist token for future calls
      try {
        const Shop = (await import('../db/Shop.js')).default;
        await Shop.updateOne(
          { shop: shopDomain },
          { $set: { shop: shopDomain, accessToken: adminAccessToken, updatedAt: new Date() } },
          { upsert: true }
        );
      } catch (e) {
        console.warn('[TOKEN_RESOLVER] Warning: failed to persist exchanged token:', e.message);
      }

      console.log('[TOKEN_RESOLVER] Token exchange OK -> returning Admin token');
      return adminAccessToken;
    } catch (e) {
      console.error('[TOKEN_RESOLVER] Token exchange error:', e.message);
      // fall through to env fallback below
    }
  } else {
    if (!idToken) console.log('[TOKEN_RESOLVER] No idToken provided; cannot perform Token Exchange');
    if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) console.log('[TOKEN_RESOLVER] Missing SHOPIFY_API_KEY/SECRET');
  }

  // 3) Env fallback (development/ops)
  const envToken = process.env.SHOPIFY_ADMIN_API_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
  if (envToken) {
    console.log('[TOKEN_RESOLVER] Using env fallback Admin token');
    return envToken;
  }

  // 4) Nothing worked
  throw new Error('No valid Admin API access token. Install app or provide id_token for token exchange.');
}

// Legacy function for backward compatibility
export async function resolveAdminTokenForShop(shopDomain) {
  return resolveShopToken(shopDomain);
}