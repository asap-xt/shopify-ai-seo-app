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
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host');
  const shop = params.get('shop');
  const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY;

  console.log('[APP-BRIDGE-PROVIDER] Public App - Initializing with:', {
    host: host ? 'Present' : 'Missing',
    shop: shop ? 'Present' : 'Missing',
    apiKey: apiKey ? 'Present' : 'Missing'
  });

  useEffect(() => {
    // Public App: Always try to initialize App Bridge
    // Even if host is missing, we should still attempt initialization
    if (!apiKey) {
      console.error('[APP-BRIDGE-PROVIDER] Missing API key - cannot initialize App Bridge');
      setError('Missing API key');
      setLoading(false);
      return;
    }

    // For public apps, we need host parameter for embedded apps
    if (!host) {
      console.warn('[APP-BRIDGE-PROVIDER] No host parameter - app may not be embedded');
      // Still try to initialize for non-embedded scenarios
    }

    import('@shopify/app-bridge').then(({ createApp }) => {
      const appInstance = createApp({
        apiKey,
        host: host || shop, // Use shop as fallback if host is missing
        forceRedirect: false // Important for public apps
      });
      
      console.log('[APP-BRIDGE-PROVIDER] Public App - App instance created');
      setApp(appInstance);
      window.__SHOPIFY_APP_BRIDGE__ = appInstance; // for backward compatibility
      setLoading(false);
    }).catch(err => {
      console.error('[APP-BRIDGE-PROVIDER] Failed to create app:', err);
      setError(err.message);
      setLoading(false);
    });
  }, [apiKey, host, shop]);

  // Public App: Always render children, even if App Bridge fails
  // This ensures the app can still function in non-embedded scenarios
  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    console.warn('[APP-BRIDGE-PROVIDER] App Bridge initialization failed:', error);
    // Still render children for graceful degradation
  }

  return (
    <AppBridgeContext.Provider value={app}>
      {children}
    </AppBridgeContext.Provider>
  );
}