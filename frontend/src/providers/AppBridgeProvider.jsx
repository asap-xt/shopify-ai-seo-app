import React, {useEffect} from 'react'

export default function ShopifyAppBridgeProvider({children}) {
  const params = new URLSearchParams(window.location.search)
  const host = params.get('host')
  const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY

  // If no host (opened standalone), don't initialize
  if (!host || !apiKey) return children

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
        console.log('[AppBridgeProvider] App Bridge initialized');
      } catch (error) {
        console.error('[AppBridgeProvider] App Bridge init error:', error);
      }
    });
  }, [apiKey, host]);

  return children
}