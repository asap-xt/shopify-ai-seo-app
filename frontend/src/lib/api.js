// frontend/src/lib/api.js
// Универсален fetch wrapper за обработка на token exchange

export async function apiFetch(url, options = {}) {
  const urlParams = new URLSearchParams(window.location.search);
  const shop = urlParams.get('shop');
  
  // Добави shop параметър ако го няма
  const finalUrl = shop && !url.includes('shop=') 
    ? `${url}${url.includes('?') ? '&' : '?'}shop=${encodeURIComponent(shop)}`
    : url;
  
  const response = await fetch(finalUrl, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  
  // Ако получим 202 - token exchange required
  if (response.status === 202) {
    const errorData = await response.json();
    if (errorData.error === 'token_exchange_required') {
      console.log('[API] Token exchange required, redirecting to OAuth...');
      window.location.href = `/auth?shop=${encodeURIComponent(shop)}`;
      throw new Error('Token exchange required - redirecting');
    }
  }
  
  return response;
}
