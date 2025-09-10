// frontend/src/main.jsx
// Public App - Always use App Bridge for embedded Shopify apps
import React from 'react';
import { createRoot } from 'react-dom/client';
import ShopifyAppBridgeProvider from './providers/AppBridgeProvider.jsx';
import App from './App.jsx';

function Root() {
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host');
  const shop = params.get('shop');
  
  console.log('[MAIN] Public App - Host:', host, 'Shop:', shop);
  console.log('[MAIN] Full URL:', window.location.href);
  
  // Public App: Always wrap with AppBridgeProvider for embedded apps
  // This ensures proper authentication and session management
  console.log('[MAIN] Rendering with AppBridgeProvider (Public App)');
  return (
    <ShopifyAppBridgeProvider>
      <App />
    </ShopifyAppBridgeProvider>
  );
}

createRoot(document.getElementById('root')).render(<Root />);