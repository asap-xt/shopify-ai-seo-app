import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Debug App Bridge
console.log('=== main.jsx starting ===');
console.log('window.shopify:', window.shopify);
console.log('URL params:', window.location.search);

// Check if we're in embedded context
const url = new URL(window.location.href);
const host = url.searchParams.get('host');
const shop = url.searchParams.get('shop');
const embedded = url.searchParams.get('embedded');

// Debug params
console.log('Parsed params:', {
  host: host,
  shop: shop,
  embedded: embedded,
  session: url.searchParams.get('session')
});

// Decide what to render
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
      <p style={{ color: '#666', fontSize: '14px', marginTop: '20px' }}>
        Missing required parameters: host and shop
      </p>
    </div>
  );
} else {
  console.log('Rendering App with params:', { host, shop, embedded });
  
  try {
    const root = document.getElementById('root');
    if (!root) {
      throw new Error('Root element not found');
    }
    
    createRoot(root).render(<App />);
    console.log('App component rendered successfully');
  } catch (error) {
    console.error('Failed to render App:', error);
    document.body.innerHTML = `
      <div style="padding: 40px; text-align: center; font-family: sans-serif;">
        <h1>Error loading application</h1>
        <p style="color: red;">${error.message}</p>
        <pre style="text-align: left; background: #f5f5f5; padding: 20px; margin: 20px auto; max-width: 600px;">
${error.stack}
        </pre>
      </div>
    `;
  }
}

console.log('=== main.jsx completed ===');