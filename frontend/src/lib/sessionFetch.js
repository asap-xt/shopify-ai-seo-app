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
    if (debug) console.log('[SFETCH] Getting token from App Bridge...', { app: !!app });
    const mod = await import(/* @vite-ignore */ '@shopify/app-bridge/utilities');
    const getSessionToken = mod && mod.getSessionToken;
    if (!getSessionToken || !app) {
      if (debug) console.log('[SFETCH] No getSessionToken or app:', { getSessionToken: !!getSessionToken, app: !!app });
      return null;
    }
    if (debug) console.log('[SFETCH] Calling getSessionToken...');
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
export function makeSessionFetch() {
  return async function sessionFetch(path, { method='GET', headers={}, body, shop, responseType='json' } = {}) {
    console.log('[SESSION-FETCH] Starting request:', { path, method, shop });
    const url = shop ? `${path}${path.includes('?') ? '&' : '?'}shop=${encodeURIComponent(shop)}` : path;

    const app = await getAppBridge();
    const token = app ? (await getTokenFromAppBridge(app)) : null;

    const baseInit = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    };

    const init = token
      ? { ...baseInit, headers: { ...baseInit.headers, Authorization: `Bearer ${token}` } }
      : baseInit;

    const rsp = await fetch(url, init);
    
    // Handle 304 Not Modified
    if (rsp.status === 304) {
      // Return cached content or empty string for text
      return responseType === 'text' ? '' : {};
    }
    
    const text = await rsp.text();
    console.log('[SESSION-FETCH] Response:', { status: rsp.status, text: text.slice(0, 200) });
    
    if (!rsp.ok) {
      let errorData;
      try { errorData = JSON.parse(text); } catch { errorData = { error: text || `HTTP ${rsp.status}` }; }
      const msg = errorData?.error || errorData?.message || `HTTP ${rsp.status}`;
      throw new Error(msg);
    }
    
    // If expecting text, return it directly
    if (responseType === 'text') {
      return text;
    }
    
    // Otherwise parse as JSON
    let data;
    try { data = text ? JSON.parse(text) : null; } 
    catch { data = { error: text?.slice(0, 500) || 'Non-JSON response' }; }
    
    return data;
  };
}