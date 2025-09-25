// frontend/src/utils/api.js
// API helper във фронта (фиксира x is not a function + GET без JSON body)
import { getSessionToken } from '@shopify/app-bridge-utils';

// Get API key from multiple sources
const apiKey = window.__SHOPIFY_API_KEY || import.meta.env?.VITE_SHOPIFY_API_KEY;
const app = window.__SHOPIFY_APP_BRIDGE__;

export function useApi() {
  const search = new URLSearchParams(window.location.search);
  const shop = search.get('shop') || undefined;
  const idToken = search.get('id_token') || undefined;

  return async function api(path, { method = 'GET', params, body, headers } = {}) {
    const qs = new URLSearchParams({ ...(params || {}), ...(shop ? { shop } : {}) }).toString();
    const url = `${path}${qs ? (path.includes('?') ? '&' : '?') + qs : ''}`;

    // Get session token for authorization
    let authHeaders = {};
    if (app) {
      try {
        const sessionToken = await getSessionToken(app);
        authHeaders = { Authorization: `Bearer ${sessionToken}` };
      } catch (err) {
        console.warn('[API] Failed to get session token:', err);
      }
    }

    const res = await fetch(url, {
      method,
      headers: {
        ...(method !== 'GET' && { 'Content-Type': 'application/json' }),
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : authHeaders),
        ...headers,
      },
      body: method !== 'GET' && body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) throw new Error(await res.text().catch(()=>'Request failed'));
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  };
}

// Legacy functions for backward compatibility
export async function apiFetch(path, options = {}) {
  const api = useApi();
  return api(path, options);
}

export async function apiJson(path, options = {}) {
  const api = useApi();
  return api(path, options);
}

export async function apiPost(path, data, options = {}) {
  const api = useApi();
  return api(path, { method: 'POST', body: data, ...options });
}
