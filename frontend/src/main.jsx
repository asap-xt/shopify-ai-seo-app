import React, { useMemo, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Get URL parameters
const params = new URLSearchParams(window.location.search);
const host = params.get('host');
const shop = params.get('shop');

// Check if we're embedded in Shopify Admin
const embedded = params.get('embedded') === '1';

console.log('[MAIN] Public App - Host:', host, 'Shop:', shop);
console.log('[MAIN] Full URL:', window.location.href);

function ShopifyAppWrapper() {
  const [isReady, setIsReady] = useState(false);
  
  // Get API key from various sources
  const apiKey = useMemo(() => {
    // First try window object (injected by server)
    if (window.__SHOPIFY_API_KEY) {
      console.log('[MAIN] Using injected API key');
      return window.__SHOPIFY_API_KEY;
    }
    
    // Then try environment variable
    if (import.meta.env.VITE_SHOPIFY_API_KEY) {
      console.log('[MAIN] Using env API key');
      return import.meta.env.VITE_SHOPIFY_API_KEY;
    }
    
    // Try to get from meta tag
    const metaTag = document.querySelector('meta[name="shopify-api-key"]');
    if (metaTag) {
      console.log('[MAIN] Using meta tag API key');
      return metaTag.getAttribute('content');
    }
    
    console.error('[MAIN] No API key found!');
    return null;
  }, []);
  
  useEffect(() => {
    // Give a moment for any async operations
    setTimeout(() => setIsReady(true), 100);
  }, []);
  
  // If not embedded or missing required params, show error
  if (!embedded || !host || !shop) {
    console.log('[MAIN] Not embedded or missing params');
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h1>Error: App must be loaded from Shopify Admin</h1>
        <p>Shop: {shop || 'Missing'}</p>
        <p>Host: {host || 'Missing'}</p>
        <p>Embedded: {embedded ? 'Yes' : 'No'}</p>
        <a href={`https://admin.shopify.com/store/${shop?.replace('.myshopify.com', '')}/apps`}>
          Go to Shopify Admin
        </a>
      </div>
    );
  }
  
  // If API key is missing, show error
  if (!apiKey) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h1>Configuration Error</h1>
        <p>Shopify API key is not configured.</p>
        <p>Please contact support.</p>
      </div>
    );
  }
  
  console.log('[MAIN] App config:', { 
    apiKey: apiKey ? 'SET' : 'MISSING', 
    host: host ? 'SET' : 'MISSING',
    shop: shop ? 'SET' : 'MISSING'
  });
  
  if (!isReady) {
    return <div>Loading...</div>;
  }
  
  // In App Bridge v4, we don't need Provider - just render the app directly
  return <App />;
}

// Render the app
createRoot(document.getElementById('root')).render(<ShopifyAppWrapper />);