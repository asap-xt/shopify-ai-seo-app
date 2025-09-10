// frontend/src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import ShopifyAppBridgeProvider from './providers/AppBridgeProvider.jsx';
import App from './App.jsx';

function Root() {
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host');
  
  console.log('[MAIN] Host parameter:', host);
  console.log('[MAIN] Full URL:', window.location.href);
  
  // ВАЖНО: Винаги обвивайте с Provider когато има host
  if (host) {
    console.log('[MAIN] Rendering with AppBridgeProvider');
    return (
      <ShopifyAppBridgeProvider>
        <App />
      </ShopifyAppBridgeProvider>
    );
  }
  
  console.log('[MAIN] Rendering without AppBridgeProvider');
  return <App />;
}

createRoot(document.getElementById('root')).render(<Root />);