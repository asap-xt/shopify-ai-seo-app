import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import dotenv from 'dotenv';
dotenv.config();

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  hostName: process.env.APP_URL.replace(/^https?:\/\//, ''),
});

// Извлича всички продукти (до 250)
export async function fetchProducts(shop, accessToken) {
  const client = new shopify.clients.Rest({ shop, accessToken });
  const response = await client.get({
    path: 'products',
    query: { limit: 250 },
  });
  return response.body.products;
}
