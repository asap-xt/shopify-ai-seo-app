// frontend/src/utils/api.js
// Мини фикc за фронта – клиент, който връща функция, не Promise
import { getSessionToken } from '@shopify/app-bridge-utils';

// Get API key from multiple sources
const apiKey = window.__SHOPIFY_API_KEY || import.meta.env?.VITE_SHOPIFY_API_KEY;
// App Bridge is initialized by React Provider, not via window
// We'll get session token via getSessionToken from app-bridge-utils
const app = null; // Will be passed via context or created dynamically

export function createApiClient() {
  const qs = new URLSearchParams(window.location.search);
  const shopParam = qs.get('shop') || undefined;
  const idToken   = qs.get('id_token') || undefined;

  return async function api(path, { method = 'GET', params, body, headers } = {}) {
    // Сглоби URL без да дублираш 'shop'
    const url = new URL(path, window.location.origin);
    const p = new URLSearchParams(params || {});
    const pathHasShopInSegment = /\/shop\/[^/?]+/.test(url.pathname);
    const queryAlreadyHasShop = url.searchParams.has('shop') || p.has('shop');

    if (!pathHasShopInSegment && !queryAlreadyHasShop && shopParam) {
      p.set('shop', shopParam);
    }
    if ([...p.keys()].length) {
      url.search = (url.search ? url.search + '&' : '?') + p.toString();
    }

    const h = { ...headers };
    if (idToken) h.Authorization = `Bearer ${idToken}`;
    if (method !== 'GET' && !h['Content-Type']) h['Content-Type'] = 'application/json';

    // Get session token for authorization (App Bridge v4 doesn't need app instance)
    if (!idToken) {
      try {
        // App Bridge v4: getSessionToken() works without app instance
        const sessionToken = await getSessionToken();
        if (sessionToken) {
          h.Authorization = `Bearer ${sessionToken}`;
        }
      } catch (err) {
        // Session token not available - continue without it
        // This is normal for non-embedded apps or during initial load
        console.warn('[API] Failed to get session token (this is OK):', err.message);
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: h,
      body: method !== 'GET' && body ? JSON.stringify(body) : undefined,
    });
    
    if (!res.ok) {
      // Try to parse error response
      let errorData;
      const contentType = res.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        try {
          errorData = await res.json();
        } catch {
          errorData = { error: await res.text().catch(() => res.statusText) };
        }
      } else {
        errorData = { error: await res.text().catch(() => res.statusText) };
      }
      
      // For 402 errors, preserve all response data
      if (res.status === 402 && errorData) {
        const error = new Error(errorData.error || errorData.message || 'Payment Required');
        error.status = 402;
        // Copy all fields from errorData to error object
        Object.assign(error, errorData);
        throw error;
      }
      
      // For other errors, throw simple message
      const error = new Error(errorData.error || errorData.message || res.statusText);
      error.status = res.status;
      throw error;
    }
    
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  };
}

// Legacy functions for backward compatibility
export function useApi() {
  return createApiClient();
}

export async function apiFetch(path, options = {}) {
  const api = createApiClient();
  return api(path, options);
}

export async function apiJson(path, options = {}) {
  const api = createApiClient();
  return api(path, options);
}

export async function apiPost(path, data, options = {}) {
  const api = createApiClient();
  return api(path, { method: 'POST', body: data, ...options });
}
