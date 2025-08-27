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

// Get shop from session (for controllers that use res.locals)
export function getShopFromSession(req) {
  return req.res?.locals?.shopify?.session?.shop || 
         req.query?.shop || 
         req.body?.shop || 
         null;
}

// GraphQL helper function for shop-level queries
export async function shopGraphQL(shop, query, variables = {}) {
  // First try to get token from session
  const sessionToken = req?.res?.locals?.shopify?.session?.accessToken;
  
  // Otherwise use environment token (single-tenant setup)
  const token = sessionToken || 
                process.env.SHOPIFY_ADMIN_API_TOKEN ||
                process.env.SHOPIFY_ACCESS_TOKEN ||
                process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;

  if (!token) {
    throw new Error('No Shopify Admin API token available');
  }

  const client = new shopify.clients.Graphql({ shop, accessToken: token });
  
  try {
    const response = await client.query({
      data: {
        query,
        variables
      }
    });
    
    if (response.body.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(response.body.errors)}`);
    }
    
    return response.body.data;
  } catch (error) {
    console.error('GraphQL query error:', error);
    throw error;
  }
}

export default shopify;