// frontend/src/utils/api.js
import createApp from '@shopify/app-bridge';
import { getSessionToken } from '@shopify/app-bridge-utils';

// Get API key from multiple sources
const apiKey = window.__SHOPIFY_API_KEY || import.meta.env.VITE_SHOPIFY_API_KEY;

const app = createApp({ 
  apiKey: apiKey, 
  host: new URLSearchParams(location.search).get('host') 
});
const shopDomain = new URLSearchParams(location.search).get('shop');

export async function apiFetch(path, options = {}) {
  const idToken = await getSessionToken(app);
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${idToken}`);
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${path}${sep}shop=${encodeURIComponent(shopDomain)}`, { ...options, headers });
}

// Helper for JSON responses
export async function apiJson(path, options = {}) {
  const response = await apiFetch(path, options);
  return response.json();
}

// Helper for POST requests
export async function apiPost(path, data, options = {}) {
  return apiFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: JSON.stringify(data),
    ...options
  });
}
