// backend/controllers/collectionsController.js
// Modern collections controller using token exchange

import express from 'express';
import { requireAuth, executeGraphQL } from '../middleware/modernAuth.js';

const router = express.Router();

// Apply authentication to all routes
router.use(requireAuth);

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

// Fetch all collections using pagination
async function fetchAllCollections(req) {
  const collections = [];
  let hasNextPage = true;
  let cursor = null;
  
  console.log(`[COLLECTIONS] Starting to fetch collections for ${req.auth.shop}`);
  
  while (hasNextPage) {
    try {
      const variables = { first: 50 };
      if (cursor) {
        variables.after = cursor;
      }
      
      const data = await executeGraphQL(req, COLLECTIONS_QUERY, variables);
      const collectionsData = data?.collections;
      
      if (!collectionsData) {
        console.error(`[COLLECTIONS] No collections data returned for ${req.auth.shop}`);
        break;
      }
      
      const edges = collectionsData.edges || [];
      console.log(`[COLLECTIONS] Fetched ${edges.length} collections for ${req.auth.shop}`);
      
      collections.push(...edges.map(edge => edge.node));
      
      hasNextPage = collectionsData.pageInfo?.hasNextPage || false;
      cursor = collectionsData.pageInfo?.endCursor || null;
      
      if (edges.length === 0) {
        hasNextPage = false;
      }
      
    } catch (error) {
      console.error(`[COLLECTIONS] Error fetching collections for ${req.auth.shop}:`, error.message);
      hasNextPage = false;
    }
  }
  
  console.log(`[COLLECTIONS] Total collections fetched for ${req.auth.shop}: ${collections.length}`);
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

// GET /collections/list-graphql
router.get('/list-graphql', async (req, res) => {
  try {
    console.log(`[COLLECTIONS-GQL] Fetching collections via GraphQL for shop: ${req.auth.shop}`);
    
    const collections = await fetchAllCollections(req);
    const formattedCollections = collections.map(collection => 
      formatCollection(collection, req.auth.shop)
    );
    
    return res.json({
      success: true,
      collections: formattedCollections,
      count: formattedCollections.length,
      shop: req.auth.shop,
      auth: {
        tokenType: req.auth.tokenType,
        source: req.auth.source
      }
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

// GET /collections/check-definitions
router.get('/check-definitions', async (req, res) => {
  try {
    console.log(`[COLLECTIONS] Checking definitions for shop: ${req.auth.shop}`);
    
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
    
    const data = await executeGraphQL(req, testQuery);
    const hasCollections = data?.collections?.edges?.length > 0;
    
    return res.json({
      success: true,
      hasCollections,
      shop: req.auth.shop,
      message: hasCollections ? 'Collections accessible' : 'No collections found',
      auth: {
        tokenType: req.auth.tokenType,
        source: req.auth.source
      }
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