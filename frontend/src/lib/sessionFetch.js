// frontend/src/lib/sessionFetch.js
// Public App - Authenticated fetch for embedded Shopify apps.
// - For App Bridge v4, session tokens are handled differently
// - Falls back gracefully for non-embedded scenarios.

import { getSessionToken } from '@shopify/app-bridge-utils';
import { devLog } from '../utils/devLog.js';

// Simplified for App Bridge v4 - no session token management needed
async function getAppBridge(debug = false) {
  if (debug) devLog('[SFETCH] App Bridge v4 - no session token management needed');
  return null; // App Bridge v4 doesn't need session token management
}

async function getTokenFromAppBridge(app, debug = false) {
  if (debug) devLog('[SFETCH] App Bridge v4 - no session token needed');
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

// Helper: delay function
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Legacy compatibility - синхронна фабрика with retry logic
export function makeSessionFetch(debug = true) {
  if (debug) devLog('[SFETCH] Creating session fetch for App Bridge v4');
  
  return async (url, options = {}) => {
    devLog('[SFETCH] Fetching:', url, options);
    
    const { method = 'GET', headers = {}, body, responseType, ...otherOptions } = options;
    
    // For App Bridge v4, we don't need session tokens
    // Just make a regular fetch request
    const baseInit = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      credentials: 'include',
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    };

    // Retry logic for CORS/network errors during initial load
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second
    
    let lastError = null;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, baseInit);
        devLog('[SFETCH] Response:', response.status, response.statusText);
        
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
        
      } catch (error) {
        lastError = error;
        
        // Don't retry for specific HTTP errors (4xx except 408, 429)
        if (error.status && error.status >= 400 && error.status < 500 && 
            error.status !== 408 && error.status !== 429) {
          throw error;
        }
        
        // Check if it's a CORS/network error (no status means fetch failed)
        const isCorsOrNetworkError = !error.status && (
          error.message?.includes('Failed to fetch') ||
          error.message?.includes('NetworkError') ||
          error.message?.includes('CORS') ||
          error.name === 'TypeError'
        );
        
        if (isCorsOrNetworkError && attempt < MAX_RETRIES) {
          devLog(`[SFETCH] CORS/Network error on attempt ${attempt}, retrying in ${RETRY_DELAY}ms...`);
          await delay(RETRY_DELAY * attempt); // Exponential backoff
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError || new Error('Request failed after retries');
  };
}

// Legacy compatibility
export { getAppBridge, getTokenFromAppBridge };