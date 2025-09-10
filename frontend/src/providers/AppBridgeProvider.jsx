// frontend/src/providers/AppBridgeProvider.jsx
import React, { useEffect } from 'react';

export default function ShopifyAppBridgeProvider({ children }) {
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host');
  const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY;

  console.log('[APP-BRIDGE-PROVIDER] Initializing with:', {
    host: host ? 'Present' : 'Missing',
    apiKey: apiKey ? 'Present' : 'Missing'
  });

  if (!host || !apiKey) {
    console.error('[APP-BRIDGE-PROVIDER] Missing host or apiKey');
    return <>{children}</>;
  }

  useEffect(() => {
    // Initialize App Bridge manually
    import('@shopify/app-bridge').then(({ createApp }) => {
      try {
        const app = createApp({
          apiKey,
          host,
          forceRedirect: false
        });
        
        // Store app instance globally
        window.__SHOPIFY_APP_BRIDGE__ = app;
        console.log('[APP-BRIDGE-PROVIDER] App Bridge initialized');
      } catch (error) {
        console.error('[APP-BRIDGE-PROVIDER] App Bridge init error:', error);
      }
    });
  }, [apiKey, host]);

  return <>{children}</>;
}