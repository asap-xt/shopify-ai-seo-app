import React from 'react';
import { createRoot } from 'react-dom/client';
import { createApp } from '@shopify/app-bridge';
import App from './App.jsx';

const url = new URL(window.location.href);
const host = url.searchParams.get('host');
const shop = url.searchParams.get('shop');

console.log('=== main.jsx starting ===');
console.log('Params:', { host, shop });

if (!host && !shop) {
  console.log('No host/shop params, showing install message');
  createRoot(document.getElementById('root')).render(
    <div style={{ 
      padding: '40px', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      textAlign: 'center'
    }}>
      <h2>Shopify App Installation Required</h2>
      <p>Please install this app from your Shopify Admin or Shopify Partners dashboard.</p>
    </div>
  );
} else {
  console.log('Initializing App Bridge...');
  
  /* ВРЕМЕННО КОМЕНТИРАНО
  const app = createApp({
    apiKey: '2749a2f6d38ff5796ed256b5c9dc70a1',
    host: host,
    forceRedirect: true
  });
  
  window.__SHOPIFY_APP_BRIDGE__ = app;
  */
  
  console.log('Rendering React app...');
  
  createRoot(document.getElementById('root')).render(<App />);
}

console.log('=== main.jsx completed ===');