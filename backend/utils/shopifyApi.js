// backend/utils/shopifyApi.js

import '@shopify/shopify-api/adapters/node'; // Required adapter for Node
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import dotenv from 'dotenv';
dotenv.config();

// Build hostName from env (accept a few names) and sanitize
function getHostName() {
  const raw =
    process.env.APP_URL ||
    process.env.SHOPIFY_APP_URL ||
    process.env.BASE_URL ||
    process.env.HOST ||
    '';
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const hostName = getHostName();
if (!hostName) {
  // Won't crash, but SDK init will if hostName is empty; warn loudly
  console.warn('⚠️ APP_URL / SHOPIFY_APP_URL / BASE_URL / HOST is not set. Please set your public app URL in Railway.');
}

// Initialize Shopify SDK
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  hostName, // hostname only, no protocol or trailing slash
});

// Fetch up to 250 products from Admin REST
export async function fetchProducts(shop, accessToken) {
  const client = new shopify.clients.Rest({ shop, accessToken });
  const response = await client.get({
    path: 'products',
    query: { limit: 250 },
  });
  return response.body.products;
}

export default shopify;
