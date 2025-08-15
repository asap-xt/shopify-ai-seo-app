// main.jsx — App Bridge instance (no React Provider) + Polaris wrapper
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider as PolarisAppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';

import { createApp } from '@shopify/app-bridge';
import { getSessionToken } from '@shopify/app-bridge/utilities';

import App from './App.jsx';

// --- helpers ---
function qp(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name) || '';
}

const host = qp('host');
const shop = qp('shop')?.replace(/^https?:\/\//, '');

// App Bridge config (used by NavigationMenu actions in App.jsx)
const appBridgeConfig = {
  apiKey: import.meta.env.VITE_SHOPIFY_API_KEY,
  host,
  // Ensures the app stays embedded inside Shopify Admin (iframe)
  forceRedirect: true,
};

// Create a single App Bridge instance and export it for actions usage
export const appBridge = createApp(appBridgeConfig);

// Export a helper to fetch a fresh session token (used by API calls)
export async function getIdToken() {
  try {
    return await getSessionToken(appBridge);
  } catch {
    return '';
  }
}

const Root = () => (
  // Polaris styling & i18n (Shopify Admin provides fonts/reset)
  <PolarisAppProvider i18n={{}}>
    <App host={host} shop={shop} />
  </PolarisAppProvider>
);

createRoot(document.getElementById('root')).render(<Root />);
