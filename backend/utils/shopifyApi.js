// backend/utils/shopifyApi.js

import '@shopify/shopify-api/adapters/node'; // Required adapter for Node
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import { MongoDBSessionStorage } from '@shopify/shopify-app-session-storage-mongodb';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Build hostName from env (accept a few names) and sanitize
function getHostName() {
  const raw =
    process.env.APP_URL ||
    process.env.SHOPIFY_APP_URL ||
    process.env.BASE_URL ||
    process.env.HOST ||
    '';
  console.log('[SHOPIFY-API] Raw URL:', raw);
  const result = raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
  console.log('[SHOPIFY-API] HostName:', result);
  return result;
}

const hostName = getHostName();
console.log('[SHOPIFY-API] Final hostName:', hostName);
if (!hostName) {
  // Won't crash, but SDK init will if hostName is empty; warn loudly
  console.warn('⚠️ APP_URL / SHOPIFY_APP_URL / BASE_URL / HOST is not set. Please set your public app URL in Railway.');
}

// Create session storage
let sessionStorage;

// CRITICAL FIX: MongoDBSessionStorage causes timeout on Railway
// Use memory storage instead (sessions are temporary for OAuth flow only)
// MongoDB is used for permanent data (Shop, Subscription, Products, etc.)
if (false && process.env.MONGODB_URI) {
  // DISABLED: MongoDBSessionStorage has connection issues on Railway
  sessionStorage = new MongoDBSessionStorage(
    process.env.MONGODB_URI
  );
  console.log('✅ Using MongoDB session storage');
} else {
  // Fallback to memory storage (not recommended for production)
  console.warn('⚠️ Using memory session storage - sessions will be lost on restart!');
  
  // Simple memory storage implementation
  const sessions = new Map();
  sessionStorage = {
    async loadSession(id) {
      console.log('[SESSION] Loading session:', id);
      const session = sessions.get(id);
      return session || null;
    },
    async storeSession(session) {
      console.log('[SESSION] Storing session:', session.id);
      sessions.set(session.id, session);
      return true;
    },
    async deleteSession(id) {
      console.log('[SESSION] Deleting session:', id);
      return sessions.delete(id);
    },
    async deleteSessions(ids) {
      console.log('[SESSION] Deleting sessions:', ids);
      ids.forEach(id => sessions.delete(id));
      return true;
    },
    async findSessionsByShop(shop) {
      console.log('[SESSION] Finding sessions for shop:', shop);
      const shopSessions = [];
      sessions.forEach((session, id) => {
        if (session.shop === shop) {
          shopSessions.push(session);
        }
      });
      return shopSessions;
    }
  };
}

// Initialize Shopify SDK
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  hostName, // hostname only, no protocol or trailing slash
  sessionStorage, // Add session storage
});

// Fetch up to 250 products from Admin GraphQL
export async function fetchProducts(shop, accessToken) {
  const client = new shopify.clients.Graphql({ shop, accessToken });
  
  // GraphQL query that matches the REST API response structure
  const query = `
    query GetProducts($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
        edges {
          cursor
          node {
            id
            title
            handle
            body_html: descriptionHtml
            vendor
            product_type: productType
            created_at: createdAt
            updated_at: updatedAt
            published_at: publishedAt
            published_scope: publishedScope
            tags
            status
            admin_graphql_api_id: id
            
            variants(first: 100) {
              edges {
                node {
                  id
                  product_id: productId
                  title
                  price
                  sku
                  position
                  inventory_policy: inventoryPolicy
                  inventory_quantity: inventoryQuantity
                  inventory_management: inventoryManagement
                  fulfillment_service: fulfillmentService
                  taxable
                  barcode
                  grams
                  weight
                  weight_unit: weightUnit
                  created_at: createdAt
                  updated_at: updatedAt
                  requires_shipping: requiresShipping
                  admin_graphql_api_id: id
                  
                  inventory_item: inventoryItem {
                    id
                    tracked
                  }
                  
                  selected_options: selectedOptions {
                    name
                    value
                  }
                }
              }
            }
            
            images(first: 50) {
              edges {
                node {
                  id
                  product_id: productId
                  position
                  created_at: createdAt
                  updated_at: updatedAt
                  alt: altText
                  width
                  height
                  src: url
                  admin_graphql_api_id: id
                }
              }
            }
            
            options {
              id
              product_id: productId
              name
              position
              values
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const allProducts = [];
  let hasNextPage = true;
  let cursor = null;
  const pageSize = 50; // GraphQL typically handles 50-100 items well per page

  // Paginate through all products
  while (hasNextPage && allProducts.length < 250) {
    const response = await client.request(query, {
      variables: {
        first: Math.min(pageSize, 250 - allProducts.length),
        after: cursor
      }
    });

    const products = response?.data?.products || { edges: [], pageInfo: {} };
    
    // Transform GraphQL response to REST format
    for (const edge of products.edges) {
      const node = edge.node;
      
      // Transform variants from edges to array
      const variants = (node.variants?.edges || []).map(v => {
        const variant = v.node;
        // Convert selected_options to option1, option2, option3
        const options = variant.selected_options || [];
        const variantRest = {
          ...variant,
          option1: options[0]?.value || null,
          option2: options[1]?.value || null,
          option3: options[2]?.value || null,
        };
        delete variantRest.selected_options;
        delete variantRest.productId; // Remove the GraphQL field
        
        // Convert inventory_item object to inventory_item_id
        if (variant.inventory_item) {
          variantRest.inventory_item_id = extractNumericId(variant.inventory_item.id);
          delete variantRest.inventory_item;
        }
        
        // Convert GraphQL ID to numeric ID
        variantRest.id = extractNumericId(variant.id);
        variantRest.product_id = extractNumericId(node.id);
        
        return variantRest;
      });
      
      // Transform images from edges to array
      const images = (node.images?.edges || []).map(i => {
        const image = i.node;
        return {
          ...image,
          id: extractNumericId(image.id),
          product_id: extractNumericId(node.id),
        };
      });
      
      // Transform options
      const options = (node.options || []).map(opt => ({
        ...opt,
        id: extractNumericId(opt.id),
        product_id: extractNumericId(node.id),
      }));
      
      // Build the REST-formatted product
      const restProduct = {
        id: extractNumericId(node.id),
        title: node.title,
        handle: node.handle,
        body_html: node.body_html,
        vendor: node.vendor,
        product_type: node.product_type,
        created_at: node.created_at,
        updated_at: node.updated_at,
        published_at: node.published_at,
        published_scope: node.published_scope || 'web',
        tags: node.tags.join(', '), // REST returns comma-separated string
        status: node.status,
        admin_graphql_api_id: node.admin_graphql_api_id,
        variants,
        images,
        options,
        image: images[0] || null, // REST includes the first image as 'image'
      };
      
      allProducts.push(restProduct);
    }
    
    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  return allProducts;
}

// Helper function to extract numeric ID from GraphQL GID
function extractNumericId(gid) {
  if (!gid) return null;
  const match = String(gid).match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export default shopify;