// Gets a Shopify session token via App Bridge (v4) for every backend call.
// Comments in English, as requested.

import createApp from "@shopify/app-bridge";
import { getSessionToken } from "@shopify/app-bridge/utilities";

function getApiKeyFromMeta() {
  const el = document.querySelector('meta[name="shopify-api-key"]');
  return el ? el.getAttribute("content") : "";
}

function getHostFromSearch() {
  const sp = new URLSearchParams(window.location.search);
  return sp.get("host") || "";
}

const app = createApp({
  apiKey: getApiKeyFromMeta(),
  host: getHostFromSearch(),
});

export async function getIdToken() {
  return await getSessionToken(app);
}
