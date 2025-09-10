// frontend/src/lib/sessionFetch.js
// Safe authenticated fetch for embedded Shopify apps.
// - Tries to attach a session token from App Bridge (if available).
// - Falls back to plain fetch with credentials:'include' (so we don't break existing flows).
//
// This keeps changes minimal and prevents "Unauthorized: missing Shopify session" in most cases
// without forcing backend refactors.

let _app = null;

// Try to lazily create an App Bridge instance if @shopify/app-bridge is available.
// We DO NOT require a Provider; this is best-effort and safe to run even if AB isn't present.
async function getAppBridge() {
  if (_app) return _app;
  try {
    const mod = await import(/* @vite-ignore */ '@shopify/app-bridge');
    const createApp = mod && (mod.default || mod);
    if (!createApp) return null;

    const host = new URLSearchParams(window.location.search).get('host');
    // We try a few standard places for the API key so we don't break builds:
    const apiKey =
      (window.__SHOPIFY_API_KEY) ||
      (import.meta && import.meta.env && import.meta.env.VITE_SHOPIFY_API_KEY) ||
      (document.querySelector('meta[name="shopify-api-key"]')?.getAttribute('content')) ||
      null;

    if (!host || !apiKey) return null;

    _app = createApp({ apiKey, host, forceRedirect: false }); // IMPORTANT: Changed from true to false
    return _app;
  } catch {
    return null;
  }
}

async function getTokenFromAppBridge(app) {
  try {
    const mod = await import(/* @vite-ignore */ '@shopify/app-bridge/utilities');
    const getSessionToken = mod && mod.getSessionToken;
    if (!getSessionToken || !app) return null;
    const token = await getSessionToken(app); // must be fetched per request
    return token || null;
  } catch {
    return null;
  }
}

/**
 * makeSessionFetch()
 * Returns a function that:
 *  - Appends ?shop=... when `shop` is provided
 *  - Adds Authorization: Bearer <token> if we can get an AB token
 *  - Falls back to credentials:'include'
 *  - Always attempts to return parsed JSON (with graceful fallback)
 */
export function makeSessionFetch() {
  return async function sessionFetch(path, { method='GET', headers={}, body, shop } = {}) {
    const url = shop ? `${path}${path.includes('?') ? '&' : '?'}shop=${encodeURIComponent(shop)}` : path;

    // Best-effort: try AB token first
    const app = await getAppBridge();
    const token = app ? (await getTokenFromAppBridge(app)) : null;

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
    const text = await rsp.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text?.slice(0, 500) || 'Non-JSON response' }; }

    if (!rsp.ok) {
      const msg = data?.error || data?.message || `HTTP ${rsp.status}`;
      throw new Error(msg);
    }
    return data;
  };
}