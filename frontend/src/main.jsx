import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Debug App Bridge
console.log('window.shopify:', window.shopify);
console.log('URL params:', window.location.search);

// Check if we're in embedded context
const url = new URL(window.location.href);
const host = url.searchParams.get('host');
const shop = url.searchParams.get('shop');
const embedded = url.searchParams.get('embedded');

// Провери дали embedded параметрите са налице
console.log('host:', url.searchParams.get('host'));
console.log('shop:', url.searchParams.get('shop'));
console.log('session:', url.searchParams.get('session'));

// If we're opening the app directly without required params
if (!host && !shop) {
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
  // Normal render for embedded app
  createRoot(document.getElementById('root')).render(<App />);
}