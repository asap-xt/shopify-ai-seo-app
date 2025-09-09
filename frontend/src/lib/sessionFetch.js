// frontend/src/lib/sessionFetch.js
import { getSessionToken } from '@shopify/app-bridge-utils';
import { createApp } from '@shopify/app-bridge';

let appBridgeInstance = null;

function getAppBridge() {
  if (appBridgeInstance) return appBridgeInstance;
  
  const host = new URLSearchParams(window.location.search).get('host');
  const apiKey = document.querySelector('meta[name="shopify-api-key"]')?.getAttribute('content');
  
  if (!host || !apiKey) {
    console.error('Missing host or API key for App Bridge');
    return null;
  }
  
  appBridgeInstance = createApp({
    apiKey,
    host,
    forceRedirect: true
  });
  
  return appBridgeInstance;
}

export async function sessionFetch(url, options = {}) {
  const app = getAppBridge();
  if (!app) {
    throw new Error('App Bridge not initialized');
  }
  
  try {
    const sessionToken = await getSessionToken(app);
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
        ...options.headers,
      },
    });
    
    if (response.status === 401) {
      // Token might be expired, redirect to auth
      const shop = new URLSearchParams(window.location.search).get('shop');
      window.location.href = `/auth?shop=${shop}`;
    }
    
    return response;
  } catch (error) {
    console.error('Session fetch error:', error);
    throw error;
  }
}