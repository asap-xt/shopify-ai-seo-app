import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider as PolarisAppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';

import App from './App.jsx';

// Helper to read ?host= & ?shop=
function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name) || '';
}

const host = getQueryParam('host');
const shop = getQueryParam('shop')?.replace(/^https?:\/\//, '');

const Root = () => (
  <PolarisAppProvider i18n={{}}>
    <BrowserRouter>
      <App host={host} shop={shop} />
    </BrowserRouter>
  </PolarisAppProvider>
);

createRoot(document.getElementById('root')).render(<Root />);
