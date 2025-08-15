// main.jsx — App Bridge instance (no React Provider) + Polaris wrapper
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider as PolarisAppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';

import { createApp } from '@shopify/app-bridge';
import { getSessionToken } from '@shopify/app-bridge/utilities';
import App from './App.jsx';

// Read query params from the Admin iframe URL
function qp(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name) || '';
}

const host = qp('host');

// App Bridge config used by <ui-nav-menu> and TitleBar
const appBridgeConfig = {
  apiKey: import.meta.env.VITE_SHOPIFY_API_KEY,
  host,
  forceRedirect: true, // keep the app embedded inside Admin (iframe)
};

// Create a single App Bridge instance for the whole app
export const appBridge = createApp(appBridgeConfig);

// Export a helper to fetch a fresh session token for backend calls
export async function getIdToken() {
  try {
    return await getSessionToken(appBridge);
  } catch {
    return '';
  }
}

createRoot(document.getElementById('root')).render(
  <PolarisAppProvider i18n={{}}>
    <App />
  </PolarisAppProvider>
);
