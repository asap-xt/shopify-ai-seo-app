import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Check if we're in the middle of OAuth flow
const urlParams = new URLSearchParams(window.location.search);
const isOAuthCallback = window.location.pathname === '/auth/callback';
const hasShop = urlParams.has('shop');
const hasHost = urlParams.has('host');

// During OAuth, let the backend handle it without React interference
if (isOAuthCallback) {
  console.log('[main.jsx] OAuth callback detected, letting backend handle...');
  // Don't render anything - let the OAuth redirect complete
} else if (hasShop && !hasHost) {
  // User is trying to install the app - redirect to OAuth
  console.log('[main.jsx] Installation flow detected, redirecting to OAuth...');
  const shop = urlParams.get('shop');
  window.location.href = `/auth?shop=${encodeURIComponent(shop)}`;
} else {
  // Normal embedded app flow - render the app
  console.log('[main.jsx] Normal app flow, rendering React app...');
  
  // Initialize App Bridge here only if we have host parameter
  if (hasHost) {
    import('@shopify/app-bridge').then(({ createApp }) => {
      try {
        const app = createApp({
          apiKey: '2749a2f6d38ff5796ed256b5c9dc70a1',
          host: urlParams.get('host'),
          forceRedirect: false  // Don't force redirect
        });
        
        // Store app instance globally if needed
        window.__SHOPIFY_APP_BRIDGE__ = app;
        console.log('[main.jsx] App Bridge initialized');
      } catch (error) {
        console.error('[main.jsx] App Bridge init error:', error);
      }
    });
  }
  
  createRoot(document.getElementById('root')).render(<App />);
}