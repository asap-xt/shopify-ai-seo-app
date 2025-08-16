// frontend/src/main.jsx
// Expose getIdToken() that returns a Shopify session token via App Bridge.
// Comments are in English, as requested.

import createApp from "@shopify/app-bridge";
import { getSessionToken } from "@shopify/app-bridge/utilities";

// Read API key from <meta name="shopify-api-key"> (already in your index.html)
function getApiKeyFromMeta() {
  const el = document.querySelector('meta[name="shopify-api-key"]');
  return el ? el.getAttribute("content") : "";
}

// 'host' must come from the URL query (?host=...)
function getHostFromSearch() {
  const sp = new URLSearchParams(window.location.search);
  return sp.get("host") || "";
}

// Create a single App Bridge instance
const app = createApp({
  apiKey: getApiKeyFromMeta(),
  host: getHostFromSearch(),
});

// Exported function used by App.jsx
export async function getIdToken() {
  // Returns a short-lived Shopify session token (JWT)
  return await getSessionToken(app);
}
