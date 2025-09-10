// frontend/src/providers/AppBridgeProvider.jsx
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
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host');
  const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY;

  console.log('[APP-BRIDGE-PROVIDER] Initializing with:', {
    host: host ? 'Present' : 'Missing',
    apiKey: apiKey ? 'Present' : 'Missing'
  });

  useEffect(() => {
    if (!host || !apiKey) {
      console.error('[APP-BRIDGE-PROVIDER] Missing host or apiKey');
      return;
    }

    import('@shopify/app-bridge').then(({ createApp }) => {
      const appInstance = createApp({
        apiKey,
        host,
        forceRedirect: false
      });
      
      console.log('[APP-BRIDGE-PROVIDER] App instance created');
      setApp(appInstance);
      window.__SHOPIFY_APP_BRIDGE__ = appInstance; // за backward compatibility
    }).catch(err => {
      console.error('[APP-BRIDGE-PROVIDER] Failed to create app:', err);
    });
  }, [apiKey, host]);

  if (!host || !apiKey) return null;

  return (
    <AppBridgeContext.Provider value={app}>
      {children}
    </AppBridgeContext.Provider>
  );
}