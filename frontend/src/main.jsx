import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import createApp from '@shopify/app-bridge';

const params = new URLSearchParams(window.location.search);
const host = params.get('host') || '';
const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY
  || document.querySelector('meta[name="shopify-api-key"]')?.content || '';

try {
  if (host && apiKey) {
    window.__APP_BRIDGE__ = createApp({ apiKey, host, forceRedirect: true });
  }
} catch (e) {
  console.warn('App Bridge init skipped:', e);
}

createRoot(document.getElementById('root')).render(<App />);
