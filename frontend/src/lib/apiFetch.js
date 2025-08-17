// frontend/src/lib/apiFetch.js
import {authenticatedFetch} from '@shopify/app-bridge/utilities';

export function makeApiFetch(app) {
  const afetch = authenticatedFetch(app);

  return async function apiFetch(path, {method='GET', headers={}, body, shop} = {}) {
    const url = shop ? `${path}${path.includes('?') ? '&' : '?'}shop=${encodeURIComponent(shop)}` : path;

    const rsp = await afetch(url, {
      method,
      headers: {'Content-Type': 'application/json', ...headers},
      body: body ? JSON.stringify(body) : undefined,
    });

    // Ако бекендът върне 401/HTML, ще хванем това тук:
    const text = await rsp.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = {error: text?.slice(0,200)}; }

    if (!rsp.ok) {
      const msg = data?.error || data?.message || `HTTP ${rsp.status}`;
      throw new Error(msg);
    }
    return data;
  };
}
