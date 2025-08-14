import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider as PolarisAppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';

import { createApp } from '@shopify/app-bridge';
import { getSessionToken } from '@shopify/app-bridge/utilities';

import App from './App.jsx';

// Helpers
function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name) || '';
}

const host = getQueryParam('host');
const shop = getQueryParam('shop')?.replace(/^https?:\/\//, '');

// === App Bridge v4 init ===
export const appBridge = createApp({
  apiKey: import.meta.env.VITE_SHOPIFY_API_KEY,
  host,
});

// Helper за backend auth при нужда
export async function getIdToken() {
  try {
    return await getSessionToken(appBridge);
  } catch {
    return '';
  }
}

const Root = () => (
  <PolarisAppProvider i18n={{}}>
    <BrowserRouter>
      <App host={host} shop={shop} />
    </BrowserRouter>
  </PolarisAppProvider>
);

createRoot(document.getElementById('root')).render(<Root />);
