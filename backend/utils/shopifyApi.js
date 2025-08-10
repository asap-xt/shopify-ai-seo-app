// backend/utils/shopifyApi.js

import '@shopify/shopify-api/adapters/node'; // <-- важно: адаптерът за Node
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import dotenv from 'dotenv';
dotenv.config();

/** Create a Shopify API client instance */
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  // hostName не е задължителен тук за REST клиента, но няма да пречи ако го подадеш
});

/** Fetch up to 250 products from Admin REST */
export async function fetchProducts(shop, accessToken) {
  const client = new shopify.clients.Rest({ shop, accessToken });
  const response = await client.get({
    path: 'products',
    query: { limit: 250 },
  });
  return response.body.products;
}

export default shopify;
