// frontend/src/utils/api.js
// API wrapper that automatically includes fresh session tokens

const shopDomain = new URLSearchParams(location.search).get('shop');

export async function apiFetch(path, options = {}) {
  try {
    // Get fresh session token from App Bridge
    let idToken = null;
    if (window.shopify?.idToken) {
      idToken = await window.shopify.idToken();
    }
    
    const headers = new Headers(options.headers || {});
    
    // Add Authorization header with fresh session token
    if (idToken) {
      headers.set('Authorization', `Bearer ${idToken}`);
      console.log('[API_FETCH] Added Authorization header with session token');
    } else {
      console.warn('[API_FETCH] No session token available - Token Exchange may fail');
    }
    
    // Keep ?shop= in the URL for server convenience
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${sep}shop=${encodeURIComponent(shopDomain)}`;
    
    console.log('[API_FETCH] Making request to:', url);
    
    const response = await fetch(url, { 
      ...options, 
      headers 
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API_FETCH] Request failed:', response.status, errorText);
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }
    
    return response;
  } catch (error) {
    console.error('[API_FETCH] Error:', error);
    throw error;
  }
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
