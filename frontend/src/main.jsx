// main.jsx — App Bridge instance (no React Provider) + Polaris wrapper
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider as PolarisAppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';

import { createApp } from '@shopify/app-bridge';
import { getSessionToken } from '@shopify/app-bridge/utilities';
import App from './App.jsx';

// Helper to read query params
function qp(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name) || '';
}

const host = qp('host');
const shop = qp('shop')?.replace(/^https?:\/\//, '');

// App Bridge config used by actions in App.jsx
const appBridgeConfig = {
  apiKey: import.meta.env.VITE_SHOPIFY_API_KEY,
  host,
  forceRedirect: true, // keep the app embedded inside Admin (iframe)
};

// Single App Bridge instance exported for actions API
export const appBridge = createApp(appBridgeConfig);

// Helper to fetch session token for API calls
export async function getIdToken() {
  try {
    return await getSessionToken(appBridge);
  } catch {
    return '';
  }
}

createRoot(document.getElementById('root')).render(
  <PolarisAppProvider i18n={{}}>
    <App host={host} shop={shop} />
  </PolarisAppProvider>
);
