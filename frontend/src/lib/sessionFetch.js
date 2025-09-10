// frontend/src/lib/sessionFetch.js
// Public App - Authenticated fetch for embedded Shopify apps.
// - Always tries to attach a session token from App Bridge.
// - For public apps, session tokens are required for all API calls.
// - Falls back gracefully for non-embedded scenarios.
//
// This ensures proper authentication for public app distribution.

let _app = null;

// Public App - Get App Bridge instance for session token management
async function getAppBridge(debug = false) {
  if (_app) return _app;
  
  // For public apps, we should always have App Bridge available
  // Check if it's already initialized globally
  if (window.__SHOPIFY_APP_BRIDGE__) {
    _app = window.__SHOPIFY_APP_BRIDGE__;
    if (debug) console.log('[SFETCH] Using global App Bridge instance');
    return _app;
  }
  
  try {
    const mod = await import(/* @vite-ignore */ '@shopify/app-bridge');
    const createApp = mod && (mod.default || mod);
    if (!createApp) {
      if (debug) console.error('[SFETCH] App Bridge module not available');
      return null;
    }

    const host = new URLSearchParams(window.location.search).get('host');
    const shop = new URLSearchParams(window.location.search).get('shop');
    
    // For public apps, we need API key
    const apiKey =
      (window.__SHOPIFY_API_KEY) ||
      (import.meta && import.meta.env && import.meta.env.VITE_SHOPIFY_API_KEY) ||
      (document.querySelector('meta[name="shopify-api-key"]')?.getAttribute('content')) ||
      null;

    if (!apiKey) {
      if (debug) console.error('[SFETCH] Missing API key for public app');
      return null;
    }

    // For public apps, we can use shop as fallback if host is missing
    const appHost = host || shop;
    if (!appHost) {
      if (debug) console.warn('[SFETCH] No host or shop parameter - may not be embedded');
      return null;
    }

    _app = createApp({ 
      apiKey, 
      host: appHost, 
      forceRedirect: false // Important for public apps
    });
    
    if (debug) console.log('[SFETCH] Public App - AppBridge created');
    return _app;
  } catch (err) {
    if (debug) console.error('[SFETCH] AppBridge creation failed:', err);
    return null;
  }
}

async function getTokenFromAppBridge(app, debug = false) {
  try {
    const mod = await import(/* @vite-ignore */ '@shopify/app-bridge/utilities');
    const getSessionToken = mod && mod.getSessionToken;
    if (!getSessionToken || !app) return null;
    const token = await getSessionToken(app); // must be fetched per request
    if (debug) console.log('[SFETCH] Got session token?', !!token, token ? `(len=${token.length}, head=${token.slice(0,10)}...)` : '');
    return token || null;
  } catch (err) {
    if (debug) console.error('[SFETCH] Token fetch failed:', err);
    return null;
  }
}

/**
 * makeSessionFetch() - Public App Version
 * Returns a function that:
 *  - Appends ?shop=... when `shop` is provided
 *  - Always tries to add Authorization: Bearer <token> from App Bridge
 *  - For public apps, session tokens are preferred over cookies
 *  - Falls back gracefully for non-embedded scenarios
 *  - Always attempts to return parsed JSON (with graceful fallback)
 */
export function makeSessionFetch({ debug } = {}) {
  const isDev = typeof import.meta !== 'undefined'
    ? (import.meta.env?.MODE !== 'production')
    : (process.env.NODE_ENV !== 'production');
  const dbg = debug ?? isDev;

  return async function sessionFetch(path, { method='GET', headers={}, body, shop } = {}) {
    const url = shop ? `${path}${path.includes('?') ? '&' : '?'}shop=${encodeURIComponent(shop)}` : path;

    // Best-effort: try AB token first
    const app = await getAppBridge(dbg);
    const token = app ? (await getTokenFromAppBridge(app, dbg)) : null;
    
    if (dbg) console.log('[SFETCH] Public App →', { url, method, shopParam: shop, hasToken: !!token, tokenHead: token ? token.slice(0,10) : null });

    const baseInit = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      credentials: 'include',             // keep legacy cookie flow working
      body: body ? JSON.stringify(body) : undefined,
    };

    const init = token
      ? { ...baseInit, headers: { ...baseInit.headers, Authorization: `Bearer ${token}` } }
      : baseInit;

    const rsp = await fetch(url, init);
    if (dbg) console.log('[SFETCH] Public App ← response', rsp.status, rsp.statusText, 'for', url);
    
    const text = await rsp.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text?.slice(0, 500) || 'Non-JSON response' }; }

    if (!rsp.ok) {
      const msg = data?.error || data?.message || `HTTP ${rsp.status}`;
      const err = new Error(msg);
      err.status = rsp.status;
      err.body = data;
      err.debug = {
        url,
        method,
        shopParam: shop,
        hasAuthHeader: !!init.headers.Authorization,
        tokenHead: token ? token.slice(0,10) : null,
      };
      if (dbg) console.error('[SFETCH] ! error', err);
      throw err;
    }
    return data;
  };
}