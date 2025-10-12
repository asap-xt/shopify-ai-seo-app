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
    console.log('[SFETCH] Fetching:', url, options);
    
    const { method = 'GET', headers = {}, body, responseType, ...otherOptions } = options;
    
    // For App Bridge v4, we don't need session tokens
    // Just make a regular fetch request
    const baseInit = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      credentials: 'include',
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    };

    const response = await fetch(url, baseInit);
    console.log('[SFETCH] Response:', response.status, response.statusText);
    
    // ===== КЛЮЧОВАТА ПРОМЯНА - ПАРСИРАЙ JSON! =====
    let data;
    
    if (responseType === 'text') {
      data = await response.text();
    } else {
      const text = await response.text();
      try { 
        data = text ? JSON.parse(text) : null; 
      } catch { 
        data = { error: text?.slice(0, 500) || 'Non-JSON response' }; 
      }
    }

    if (!response.ok) {
      // For 402 errors (insufficient tokens), preserve all response data
      if (response.status === 402 && data) {
        const error = new Error(data.error || data.message || 'Payment Required');
        error.status = 402;
        // Copy all fields from data to error object
        Object.assign(error, data);
        throw error;
      }
      
      // For other errors, throw simple message
      const msg = data?.error || data?.message || `HTTP ${response.status}`;
      const error = new Error(msg);
      error.status = response.status;
      throw error;
    }
    
    return data; // ВЪРНИ data, НЕ response!
  };
}

// Legacy compatibility
export { getAppBridge, getTokenFromAppBridge };