// backend/utils/shopifyApi.js
// Public App Configuration with @shopify/shopify-api 11.14.1

import '@shopify/shopify-api/adapters/node'; // Required adapter for Node
import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
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

// Initialize Shopify SDK for Public App
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  hostName, // hostname only, no protocol or trailing slash
  scopes: (process.env.SHOPIFY_API_SCOPES || '').split(',').map(s => s.trim()).filter(Boolean),
  // Session storage for public app
  sessionStorage: {
    async storeSession(session) {
      // Store session in database
      const Shop = (await import('../db/Shop.js')).default;
      await Shop.findOneAndUpdate(
        { shop: session.shop },
        { 
          shop: session.shop,
          accessToken: session.accessToken,
          scope: session.scope,
          expires: session.expires,
          isOnline: session.isOnline,
          state: session.state,
          onlineAccessInfo: session.onlineAccessInfo
        },
        { upsert: true, new: true }
      );
      return true;
    },
    async loadSession(id) {
      // Load session from database
      const Shop = (await import('../db/Shop.js')).default;
      const shopRecord = await Shop.findOne({ shop: id });
      if (!shopRecord) return undefined;
      
      return new Session({
        id: shopRecord.shop,
        shop: shopRecord.shop,
        state: shopRecord.state,
        isOnline: shopRecord.isOnline,
        accessToken: shopRecord.accessToken,
        scope: shopRecord.scope,
        expires: shopRecord.expires,
        onlineAccessInfo: shopRecord.onlineAccessInfo
      });
    },
    async deleteSession(id) {
      // Delete session from database
      const Shop = (await import('../db/Shop.js')).default;
      await Shop.deleteOne({ shop: id });
      return true;
    },
    async deleteSessions(ids) {
      // Delete multiple sessions
      const Shop = (await import('../db/Shop.js')).default;
      await Shop.deleteMany({ shop: { $in: ids } });
      return true;
    },
    async findSessionsByShop(shop) {
      // Find sessions by shop
      const Shop = (await import('../db/Shop.js')).default;
      const shopRecord = await Shop.findOne({ shop });
      if (!shopRecord) return [];
      
      return [new Session({
        id: shopRecord.shop,
        shop: shopRecord.shop,
        state: shopRecord.state,
        isOnline: shopRecord.isOnline,
        accessToken: shopRecord.accessToken,
        scope: shopRecord.scope,
        expires: shopRecord.expires,
        onlineAccessInfo: shopRecord.onlineAccessInfo
      })];
    }
  }
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

// Get access token from session (public app approach)
export function getAccessTokenFromSession(req) {
  return req.res?.locals?.shopify?.session?.accessToken || null;
}

// GraphQL helper function for shop-level queries (public app)
export async function shopGraphQL(shop, query, variables = {}, accessToken = null) {
  // For public app, accessToken should come from session
  if (!accessToken) {
    throw new Error('Access token required for GraphQL queries in public app');
  }

  const client = new shopify.clients.Graphql({ shop, accessToken });
  
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

// REST API helper function (public app)
export async function shopRestAPI(shop, path, options = {}, accessToken = null) {
  if (!accessToken) {
    throw new Error('Access token required for REST API calls in public app');
  }

  const client = new shopify.clients.Rest({ shop, accessToken });
  
  try {
    const response = await client.get({ path, ...options });
    return response.body;
  } catch (error) {
    console.error('REST API error:', error);
    throw error;
  }
}

export default shopify;