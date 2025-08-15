import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider as PolarisAppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';

import { createApp } from '@shopify/app-bridge';
import { getSessionToken } from '@shopify/app-bridge/utilities';

import App from './App.jsx';

// helper за параметри
function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name) || '';
}

// извличаме host/shop за App Bridge
const host = getQueryParam('host');
const shop = getQueryParam('shop')?.replace(/^https?:\/\//, '');

export const appBridge = createApp({
  apiKey: import.meta.env.VITE_SHOPIFY_API_KEY,
  host,
  forceRedirect: true, // гарантира, че ако е извън iframe, ще влезе в Admin
});

export async function getIdToken() {
  try {
    return await getSessionToken(appBridge);
  } catch {
    return '';
  }
}

const Root = () => (
  <PolarisAppProvider i18n={{}}>
    <App host={host} shop={shop} />
  </PolarisAppProvider>
);

createRoot(document.getElementById('root')).render(<Root />);
