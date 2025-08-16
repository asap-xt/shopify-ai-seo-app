import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import createApp from '@shopify/app-bridge';

// Read host/apiKey from the iframe URL (Shopify injects ?host=…)
const params = new URLSearchParams(window.location.search);
const host = params.get('host') || ''; // allow empty outside Admin for local preview
const apiKey =
  import.meta.env.VITE_SHOPIFY_API_KEY ||
  document.querySelector('meta[name="shopify-api-key"]')?.content ||
  '';

try {
  if (host && apiKey) {
    // Expose App Bridge globally (no react wrapper)
    window.__APP_BRIDGE__ = createApp({ apiKey, host, forceRedirect: true });
  }
} catch (e) {
  console.warn('App Bridge init skipped:', e);
}

createRoot(document.getElementById('root')).render(<App />);
