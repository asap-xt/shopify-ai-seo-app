// frontend/src/lib/sessionFetch.js
// Public App - Authenticated fetch for embedded Shopify apps.
// - For App Bridge v4, session tokens are handled differently
// - Falls back gracefully for non-embedded scenarios.

import { getSessionToken } from '@shopify/app-bridge-utils';

// Simplified for App Bridge v4 - no session token management needed
async function getAppBridge(debug = false) {
  if (debug) console.log('[SFETCH] App Bridge v4 - no session token management needed');
  return null; // App Bridge v4 doesn't need session token management
}

async function getTokenFromAppBridge(app, debug = false) {
  if (debug) console.log('[SFETCH] App Bridge v4 - no session token needed');
  return null; // App Bridge v4 doesn't use session tokens
}

// Public App - Authenticated fetch function (синхронна фабрика)
export function sessionFetch(shop) {
  return async (url, init) => {
    const token = await getSessionToken(); // App Bridge
    return fetch(url, {
      ...init,
      headers: { 
        ...(init?.headers || {}), 
        Authorization: `Bearer ${token}`, 
        'X-Shop-Domain': shop 
      },
    });
  };
}

// Legacy compatibility - синхронна фабрика
export function makeSessionFetch(debug = true) {
  if (debug) console.log('[SFETCH] Creating session fetch for App Bridge v4');
  
  return async (url, options = {}) => {
    console.log('[SFETCH] Fetching:', url, { ...options, body: undefined });
    
    // For App Bridge v4, we don't need session tokens
    // Just make a regular fetch request
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    console.log('[SFETCH] Response:', response.status, response.statusText);
    return response;
  };
}

// Legacy compatibility
export { getAppBridge, getTokenFromAppBridge };