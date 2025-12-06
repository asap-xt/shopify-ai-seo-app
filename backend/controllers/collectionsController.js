// backend/controllers/collectionsController.js
// Modern collections controller using token exchange

import express from 'express';
import { requireAuth, executeGraphQL } from '../middleware/modernAuth.js';
import { withShopCache, CACHE_TTL } from '../utils/cacheWrapper.js';

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
          productsCount {
            count
          }
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
  
  return collections;
}

// Format collection data
function formatCollection(collection, shop, shopLanguages = ['en']) {
  const optimizedLanguages = collection.optimizedLanguages || shopLanguages;
  
  return {
    id: collection.id,
    handle: collection.handle,
    title: collection.title || '',
    description: collection.description || '',
    descriptionHtml: collection.descriptionHtml || '',
    productsCount: collection.productsCount?.count || 0,
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
    shop: shop,
    // Add optimizedLanguages - use all available shop languages
    // In the future, this could be based on actual SEO data for each language
    optimizedLanguages: optimizedLanguages
  };
}

// GET /collections/list-graphql
router.get('/list-graphql', async (req, res) => {
  try {
    const shop = req.auth.shop;
    
    // Generate unique cache key
    const cacheKey = `collections:list:all`;
    
    // Try to get from cache first
    const cachedResult = await withShopCache(shop, cacheKey, CACHE_TTL.SHORT, async () => {
      const collections = await fetchAllCollections(req);
      
      // Get shop languages dynamically
      const Q_SHOP_LOCALES = `
        query ShopLocales {
          shopLocales {
            locale
            primary
            published
          }
        }
      `;
      
      let shopLanguages = ['en']; // fallback
      try {
        const shopData = await executeGraphQL(req, Q_SHOP_LOCALES);
        const shopLocales = shopData?.shopLocales || [];
        shopLanguages = shopLocales
          .filter(l => l.published)
          .map(l => l.locale)
          .filter(Boolean);
      } catch (error) {
        console.error(`[COLLECTIONS-GQL] Error fetching shop languages:`, error.message);
      }
      
      const formattedCollections = collections.map(collection => 
        formatCollection(collection, shop, shopLanguages)
      );
      
      return {
        success: true,
        collections: formattedCollections,
        count: formattedCollections.length,
        shop: shop
      };
    });
    
    // NOTE: AI-enhanced flag is NOT added here - frontend uses /collections/list-graphql from seoController.js
    // This endpoint is kept for future use but currently not used by frontend
    
    // Return cached or fresh data
    return res.json({
      ...cachedResult,
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
      definitions: [], // Frontend expects this array
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
      message: error.message,
      definitions: [] // Frontend expects this even on error
    });
  }
});

// POST /api/collections/sync
router.post('/sync', async (req, res) => {
  try {
    const allCollections = [];
    let hasNextPage = true;
    let cursor = null;
    
    // Fetch all collections using pagination
    while (hasNextPage) {
      const variables = { first: 50 };
      if (cursor) {
        variables.after = cursor;
      }
      
      const data = await executeGraphQL(req, COLLECTIONS_QUERY, variables);
      const collectionsData = data?.collections;
      
      if (!collectionsData) break;
      
      const edges = collectionsData.edges || [];
      
      allCollections.push(...edges.map(edge => edge.node));
      
      hasNextPage = collectionsData.pageInfo?.hasNextPage || false;
      cursor = collectionsData.pageInfo?.endCursor || null;
      
      if (edges.length === 0) break;
    }

    return res.json({
      success: true,
      collectionsCount: allCollections.length,
      shop: req.auth.shop,
      message: `Successfully synced ${allCollections.length} collections`
    });

  } catch (error) {
    console.error(`[COLLECTIONS_SYNC] Error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Collection sync failed',
      shop: req.auth.shop
    });
  }
});

export default router;