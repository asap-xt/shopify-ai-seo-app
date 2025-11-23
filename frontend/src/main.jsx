// CRITICAL: Log immediately when this file loads (before any imports)
// FORCE REBUILD: 2025-11-19 23:05 - Remove IIFE, use direct top-level code for ES modules
// In ES modules, top-level code executes immediately

import React, { useMemo, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { devLog, devError } from './utils/devLog.js';

// Get URL parameters
const params = new URLSearchParams(window.location.search);
const host = params.get('host');
const shop = params.get('shop');

// Check if we're embedded in Shopify Admin
const embedded = params.get('embedded') === '1';

devLog('[MAIN] Public App - Host:', host, 'Shop:', shop);
devLog('[MAIN] Full URL:', window.location.href);

function ShopifyAppBridgeWrapper() {
  const [isReady, setIsReady] = useState(false);
  
      // Get API key from various sources
      const apiKey = useMemo(() => {
        devLog('[MAIN] Checking for API key...');
        devLog('[MAIN] window.__SHOPIFY_API_KEY:', window.__SHOPIFY_API_KEY);
        devLog('[MAIN] import.meta.env.VITE_SHOPIFY_API_KEY:', import.meta.env.VITE_SHOPIFY_API_KEY);
        
        // First try window object (injected by server)
        if (window.__SHOPIFY_API_KEY) {
          devLog('[MAIN] Using injected API key:', window.__SHOPIFY_API_KEY);
          return window.__SHOPIFY_API_KEY;
        }
        
        // Then try environment variable
        if (import.meta.env.VITE_SHOPIFY_API_KEY) {
          devLog('[MAIN] Using env API key:', import.meta.env.VITE_SHOPIFY_API_KEY);
          return import.meta.env.VITE_SHOPIFY_API_KEY;
        }
        
        // Try to get from meta tag
        const metaTag = document.querySelector('meta[name="shopify-api-key"]');
        devLog('[MAIN] Meta tag found:', !!metaTag);
        if (metaTag) {
          const content = metaTag.getAttribute('content');
          devLog('[MAIN] Using meta tag API key:', content);
          return content;
        }
        
        devError('[MAIN] No API key found!');
        devError('[MAIN] Available window properties:', Object.keys(window).filter(k => k.includes('SHOPIFY')));
        return null;
      }, []);
  
  useEffect(() => {
    // Give a moment for any async operations
    setTimeout(() => setIsReady(true), 100);
  }, []);
  
  // If not embedded or missing required params, show error
  if (!embedded || !host || !shop) {
    devLog('[MAIN] Not embedded or missing params');
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
  
  devLog('[MAIN] App config:', { 
    apiKey: apiKey ? 'SET' : 'MISSING', 
    host: host ? 'SET' : 'MISSING',
    shop: shop ? 'SET' : 'MISSING'
  });
  
  if (!isReady) {
    return <div>Loading...</div>;
  }
  
  // App Bridge v4 doesn't need Provider - it's initialized via script tag in HTML
  // getSessionToken() works without Provider because App Bridge is global
  devLog('[MAIN] Rendering App, apiKey:', apiKey ? `${apiKey.substring(0, 8)}...` : 'MISSING', 'host:', host);
  return <App />;
}

// Render the app
devLog('[MAIN] ===== ATTEMPTING TO RENDER APP =====');
devLog('[MAIN] root element exists:', !!document.getElementById('root'));

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    devError('[MAIN] ❌ Root element not found!');
  } else {
    devLog('[MAIN] ✅ Root element found, creating React root...');
    const root = createRoot(rootElement);
    devLog('[MAIN] ✅ React root created, rendering component...');
    root.render(<ShopifyAppBridgeWrapper />);
    devLog('[MAIN] ✅ Component rendered successfully!');
  }
} catch (error) {
  devError('[MAIN] ❌ ERROR RENDERING APP:', error);
  devError('[MAIN] Error stack:', error.stack);
}