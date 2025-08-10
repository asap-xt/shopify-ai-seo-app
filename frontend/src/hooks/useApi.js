// frontend/src/hooks/useApi.js
export function useApi(shop) {
  const base = '';

  async function authHeaders() {
    try {
      if (window.shopify?.idToken) {
        const token = await window.shopify.idToken();
        if (token) return { Authorization: `Bearer ${token}` };
      }
    } catch (e) {
      // swallow; ще пробваме без токен (dev)
    }
    return {};
  }

  return {
    async get(path) {
      const headers = await authHeaders();
      const url = `${base}${path}${path.includes('?') ? '&' : '?'}shop=${encodeURIComponent(shop)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async post(path, body) {
      const headers = await authHeaders();
      headers['Content-Type'] = 'application/json';
      const url = `${base}${path}${path.includes('?') ? '&' : '?'}shop=${encodeURIComponent(shop)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body || {}),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };
}
