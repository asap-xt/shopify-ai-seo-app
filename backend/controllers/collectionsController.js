// backend/controllers/collectionsController.js
// Fixed collections controller using centralized token resolver

import express from 'express';
import { executeShopifyGraphQL } from '../utils/tokenResolver.js';

const router = express.Router();

// GraphQL query for fetching collections
const COLLECTIONS_QUERY = `
  query GetCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges {
        node {
          id
          handle
          title
          description
          descriptionHtml
          updatedAt
          image {
            id
            url
            altText
          }
          productsCount
          seo {
            title
            description
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Helper to normalize shop domain
function normalizeShop(shop) {
  if (!shop) return null;
  const s = String(shop).trim();
  if (/^https?:\/\//.test(s)) {
    const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return u.toLowerCase();
  }
  if (!/\.myshopify\.com$/i.test(s)) return `${s.toLowerCase()}.myshopify.com`;
  return s.toLowerCase();
}

// Fetch all collections using pagination
async function fetchAllCollections(shop) {
  const collections = [];
  let hasNextPage = true;
  let cursor = null;
  
  console.log(`[COLLECTIONS] Starting to fetch collections for ${shop}`);
  
  while (hasNextPage) {
    try {
      const variables = { first: 50 };
      if (cursor) {
        variables.after = cursor;
      }
      
      const data = await executeShopifyGraphQL(shop, COLLECTIONS_QUERY, variables);
      const collectionsData = data?.collections;
      
      if (!collectionsData) {
        console.error(`[COLLECTIONS] No collections data returned for ${shop}`);
        break;
      }
      
      const edges = collectionsData.edges || [];
      console.log(`[COLLECTIONS] Fetched ${edges.length} collections for ${shop}`);
      
      collections.push(...edges.map(edge => edge.node));
      
      hasNextPage = collectionsData.pageInfo?.hasNextPage || false;
      cursor = collectionsData.pageInfo?.endCursor || null;
      
      if (edges.length === 0) {
        hasNextPage = false;
      }
      
    } catch (error) {
      console.error(`[COLLECTIONS] Error fetching collections for ${shop}:`, error.message);
      hasNextPage = false;
    }
  }
  
  console.log(`[COLLECTIONS] Total collections fetched for ${shop}: ${collections.length}`);
  return collections;
}

// Format collection data
function formatCollection(collection, shop) {
  return {
    id: collection.id,
    handle: collection.handle,
    title: collection.title || '',
    description: collection.description || '',
    descriptionHtml: collection.descriptionHtml || '',
    productsCount: collection.productsCount || 0,
    image: collection.image ? {
      id: collection.image.id,
      url: collection.image.url,
      altText: collection.image.altText || ''
    } : null,
    seo: {
      title: collection.seo?.title || collection.title,
      description: collection.seo?.description || collection.description
    },
    updatedAt: collection.updatedAt,
    shop: shop
  };
}

// GET /collections/list-graphql?shop=...
router.get('/list-graphql', async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ error: 'Missing or invalid shop parameter' });
    }

    console.log(`[COLLECTIONS-GQL] Fetching collections via GraphQL for shop: ${shop}`);

    const collections = await fetchAllCollections(shop);
    const formattedCollections = collections.map(collection => 
      formatCollection(collection, shop)
    );

    return res.json({
      success: true,
      collections: formattedCollections,
      count: formattedCollections.length,
      shop: shop
    });

  } catch (error) {
    console.error('[COLLECTIONS-GQL] Error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to fetch collections',
      message: error.message 
    });
  }
});

// GET /collections/check-definitions?shop=...
router.get('/check-definitions', async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ error: 'Missing or invalid shop parameter' });
    }

    console.log(`[COLLECTIONS] Checking definitions for shop: ${shop}`);

    // Simple query to check if we can access collections
    const testQuery = `
      query TestCollectionsAccess {
        collections(first: 1) {
          edges {
            node {
              id
              title
            }
          }
        }
      }
    `;

    const data = await executeShopifyGraphQL(shop, testQuery);
    const hasCollections = data?.collections?.edges?.length > 0;

    return res.json({
      success: true,
      hasCollections,
      shop: shop,
      message: hasCollections ? 'Collections accessible' : 'No collections found'
    });

  } catch (error) {
    console.error('[COLLECTIONS] Check definitions error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to check collections access',
      message: error.message 
    });
  }
});

export default router;
