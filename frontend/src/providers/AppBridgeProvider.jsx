// frontend/src/providers/AppBridgeProvider.jsx
// App Bridge init в embedded режим (без да разчитаме на Vite във production)
import React, { createContext, useContext } from 'react';
import { Provider as AppBridgeProvider } from '@shopify/app-bridge-react';

// Създаваме Context за App Bridge
const AppBridgeContext = createContext(null);

export function useAppBridge() {
  const app = useContext(AppBridgeContext);
  if (!app) {
    console.warn('[useAppBridge] No App Bridge instance in context');
  }
  return app;
}

export default function Bridge({ children }) {
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host');
  const apiKey = window.__SHOPIFY_API_KEY || import.meta?.env?.VITE_SHOPIFY_API_KEY;

  if (!apiKey) console.error('Missing API key for App Bridge');
  if (!host) console.error('Missing host param for App Bridge');

  return (
    <AppBridgeProvider config={{ apiKey, host, forceRedirect: true }}>
      <AppBridgeContext.Provider value={null}>
        {children}
      </AppBridgeContext.Provider>
    </AppBridgeProvider>
  );
}