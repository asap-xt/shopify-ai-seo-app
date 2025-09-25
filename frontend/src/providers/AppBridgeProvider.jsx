// frontend/src/providers/AppBridgeProvider.jsx
// Public App - Always initialize App Bridge for embedded Shopify apps
import React, { useEffect, useState, createContext, useContext } from 'react';

// Създаваме Context за App Bridge
const AppBridgeContext = createContext(null);

export function useAppBridge() {
  const app = useContext(AppBridgeContext);
  if (!app) {
    console.warn('[useAppBridge] No App Bridge instance in context');
  }
  return app;
}

export default function ShopifyAppBridgeProvider({ children }) {
  const [ready, setReady] = useState(!!window.__SHOPIFY_API_KEY);
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const search = new URLSearchParams(window.location.search);
  const hostParam = search.get('host') || window.__SHOPIFY_HOST;

  console.log('[APP-BRIDGE-PROVIDER] Initializing with:', {
    host: hostParam ? 'Present' : 'Missing',
    shop: search.get('shop') ? 'Present' : 'Missing',
    ready: ready
  });
  
  console.log('[APP-BRIDGE-PROVIDER] Debug info:', {
    window__SHOPIFY_API_KEY: window.__SHOPIFY_API_KEY ? 'SET' : 'MISSING',
    window__SHOPIFY_API_KEY_value: window.__SHOPIFY_API_KEY,
  });

  useEffect(() => {
    if (window.__SHOPIFY_API_KEY) { 
      setReady(true); 
      return; 
    }
    
    // динамична инжекция на /app-bridge.js (ще сетне window.__SHOPIFY_API_KEY и __SHOPIFY_HOST)
    const s = document.createElement('script');
    s.src = `/app-bridge.js?${search.toString()}`;
    s.async = true;
    s.onload = () => setReady(true);
    s.onerror = () => setReady(false);
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, []);

  const apiKey = window.__SHOPIFY_API_KEY;

  useEffect(() => {
    if (!ready) return; // Изчакваме готовността
    
    if (!apiKey) {
      console.error('[APP-BRIDGE-PROVIDER] Missing API key - cannot initialize App Bridge');
      setError('Missing API key');
      setLoading(false);
      return;
    }

    if (!hostParam) {
      console.error('[APP-BRIDGE-PROVIDER] Missing host parameter - cannot initialize App Bridge');
      setError('Missing host parameter');
      setLoading(false);
      return;
    }

    import('@shopify/app-bridge').then(({ createApp }) => {
      const appInstance = createApp({
        apiKey,
        host: hostParam,
        forceRedirect: true
      });
      
      console.log('[APP-BRIDGE-PROVIDER] App Bridge instance created successfully');
      setApp(appInstance);
      window.__SHOPIFY_APP_BRIDGE__ = appInstance; // for backward compatibility
      setLoading(false);
    }).catch(err => {
      console.error('[APP-BRIDGE-PROVIDER] Failed to create app:', err);
      setError(err.message);
      setLoading(false);
    });
  }, [ready, apiKey, hostParam]);

  // Always render children, even if App Bridge is not ready yet
  return (
    <AppBridgeContext.Provider value={app}>
      {children}
    </AppBridgeContext.Provider>
  );
}