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
function formatCollection(collection, shop, shopLanguages = ['en']) {
  const optimizedLanguages = collection.optimizedLanguages || shopLanguages;
  console.log(`[COLLECTIONS-GQL] Formatting collection "${collection.title}":`, {
    shopLanguages,
    collectionOptimizedLanguages: collection.optimizedLanguages,
    finalOptimizedLanguages: optimizedLanguages
  });
  
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
    shop: shop,
    // Add optimizedLanguages - use all available shop languages
    // In the future, this could be based on actual SEO data for each language
    optimizedLanguages: optimizedLanguages
  };
}

// GET /collections/list-graphql
router.get('/list-graphql', async (req, res) => {
  try {
    console.log(`[COLLECTIONS-GQL] Fetching collections via GraphQL for shop: ${req.auth.shop}`);
    
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
      console.log(`[COLLECTIONS-GQL] Found ${shopLanguages.length} shop languages: ${shopLanguages.join(',')}`);
    } catch (error) {
      console.error(`[COLLECTIONS-GQL] Error fetching shop languages:`, error.message);
    }
    
    const formattedCollections = collections.map(collection => 
      formatCollection(collection, req.auth.shop, shopLanguages)
    );
    
    // Debug: log first collection's optimizedLanguages
    if (formattedCollections.length > 0) {
      console.log(`[COLLECTIONS-GQL] First collection optimizedLanguages:`, formattedCollections[0].optimizedLanguages);
    }
    
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

// DELETE /collections/delete-seo
router.delete('/delete-seo', async (req, res) => {
  try {
    const { shop, collectionId, language } = req.body;
    
    console.log(`[COLLECTIONS-DELETE] Deleting SEO for shop: ${shop}, collection: ${collectionId}, language: ${language}`);
    
    if (!shop || !collectionId || !language) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: shop, collectionId, language'
      });
    }
    
    // Delete collection metafields for the specific language
    const deleteQuery = `
      mutation DeleteCollectionMetafields($id: ID!, $namespace: String!, $key: String!) {
        metafieldsDelete(metafieldIds: [$id]) {
          deletedIds
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    // Get collection metafields first to find the ones to delete
    const getMetafieldsQuery = `
      query GetCollectionMetafields($id: ID!) {
        collection(id: $id) {
          metafields(first: 50, namespace: "seo_ai") {
            edges {
              node {
                id
                namespace
                key
                value
              }
            }
          }
        }
      }
    `;
    
    // Get existing metafields
    const metafieldsData = await executeGraphQL(req, getMetafieldsQuery, { id: collectionId });
    const metafields = metafieldsData?.collection?.metafields?.edges || [];
    
    // Find metafields for the specific language
    const metafieldsToDelete = metafields
      .map(edge => edge.node)
      .filter(metafield => 
        metafield.key.includes(`_${language}`) || 
        metafield.key === `seo_title_${language}` ||
        metafield.key === `seo_description_${language}` ||
        metafield.key === `seo_bullets_${language}` ||
        metafield.key === `seo_faq_${language}`
      );
    
    console.log(`[COLLECTIONS-DELETE] Found ${metafieldsToDelete.length} metafields to delete for language ${language}`);
    
    // Delete each metafield
    const deleteResults = [];
    for (const metafield of metafieldsToDelete) {
      try {
        const deleteResult = await executeGraphQL(req, deleteQuery, {
          id: metafield.id,
          namespace: metafield.namespace,
          key: metafield.key
        });
        
        if (deleteResult?.metafieldsDelete?.userErrors?.length > 0) {
          console.error(`[COLLECTIONS-DELETE] Error deleting metafield ${metafield.id}:`, deleteResult.metafieldsDelete.userErrors);
        } else {
          console.log(`[COLLECTIONS-DELETE] Successfully deleted metafield ${metafield.id}`);
        }
        
        deleteResults.push(deleteResult);
      } catch (err) {
        console.error(`[COLLECTIONS-DELETE] Failed to delete metafield ${metafield.id}:`, err);
      }
    }
    
    return res.json({
      success: true,
      message: `Deleted SEO optimization for language ${language.toUpperCase()}`,
      deletedMetafields: metafieldsToDelete.length,
      shop,
      collectionId,
      language
    });

  } catch (error) {
    console.error('[COLLECTIONS-DELETE] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete SEO optimization',
      message: error.message
    });
  }
});

export default router;