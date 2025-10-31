// backend/services/syncService.js
// Store sync service using Shopify GraphQL API

import Product from '../db/Product.js';
import Collection from '../db/Collection.js';
import Shop from '../db/Shop.js';

/**
 * Sync products from Shopify using GraphQL
 * @param {Function} adminGraphql - GraphQL client function
 * @param {string} shop - Shop domain
 * @param {Function} progressCallback - Optional callback for progress updates
 */
export async function syncProducts(adminGraphql, shop, progressCallback = null) {
  let allProducts = [];
  let hasNextPage = true;
  let cursor = null;
  let pageCount = 0;

  console.log(`[SYNC] Starting products sync for ${shop}`);

  while (hasNextPage) {
    pageCount++;
    
    const query = `
      query GetProducts($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              handle
              description
              status
              totalInventory
              createdAt
              publishedAt
              updatedAt
              featuredImage {
                url
                altText
              }
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
              metafields(first: 50, namespace: "seo_ai") {
                edges {
                  node {
                    id
                    namespace
                    key
                    value
                    type
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await adminGraphql(query, { cursor });
    const { products } = response || {};

    if (!products || !products.edges) {
      console.error('[SYNC] Invalid response from Shopify GraphQL');
      break;
    }

    allProducts = allProducts.concat(products.edges);
    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;

    if (progressCallback) {
      progressCallback({
        type: 'products',
        current: allProducts.length,
        message: `Fetched ${allProducts.length} products...`
      });
    }

    console.log(`[SYNC] Fetched page ${pageCount}, total products: ${allProducts.length}`);
  }

  // Save products to database
  console.log(`[SYNC] Saving ${allProducts.length} products to database...`);
  
  for (const { node: product } of allProducts) {
    try {
      // Process metafields to determine optimization status
      const seoStatus = processMetafields(product.metafields);
      // Normalize IDs (Shopify returns GID like gid://shopify/Product/12345)
      const numericId = typeof product.id === 'string' ? product.id.split('/').pop() : null;
      
      await Product.findOneAndUpdate(
        { 
          shop, 
          shopifyProductId: product.id 
        },
        {
          shop,
          shopifyProductId: product.id,
          gid: product.id,
          productId: numericId,
          title: product.title,
          handle: product.handle,
          description: product.description,
          status: product.status,
          totalInventory: product.totalInventory,
          featuredImage: product.featuredImage,
          seoStatus,
          createdAt: product.createdAt,
          publishedAt: product.publishedAt,
          updatedAt: product.updatedAt,
          syncedAt: new Date()
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`[SYNC] Error saving product ${product.id}:`, error);
    }
  }

  console.log(`[SYNC] Products sync complete: ${allProducts.length} products`);
  return allProducts.length;
}

/**
 * Sync collections from Shopify using GraphQL
 */
export async function syncCollections(adminGraphql, shop, progressCallback = null) {
  let allCollections = [];
  let hasNextPage = true;
  let cursor = null;
  let pageCount = 0;

  console.log(`[SYNC] Starting collections sync for ${shop}`);

  while (hasNextPage) {
    pageCount++;
    
    const query = `
      query GetCollections($cursor: String) {
        collections(first: 50, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              handle
              description
              descriptionHtml
              productsCount { count }
              updatedAt
              metafields(first: 50, namespace: "seo_ai") {
                edges {
                  node {
                    id
                    namespace
                    key
                    value
                    type
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await adminGraphql(query, { cursor });
    const { collections } = response || {};

    if (!collections || !collections.edges) {
      console.error('[SYNC] Invalid collections response from Shopify GraphQL');
      break;
    }

    allCollections = allCollections.concat(collections.edges);
    hasNextPage = collections.pageInfo.hasNextPage;
    cursor = collections.pageInfo.endCursor;

    if (progressCallback) {
      progressCallback({
        type: 'collections',
        current: allCollections.length,
        message: `Fetched ${allCollections.length} collections...`
      });
    }

    console.log(`[SYNC] Fetched page ${pageCount}, total collections: ${allCollections.length}`);
  }

  // Save collections to database
  console.log(`[SYNC] Saving ${allCollections.length} collections to database...`);
  
  for (const { node: collection } of allCollections) {
    try {
      const seoStatus = processMetafields(collection.metafields);
      
      await Collection.findOneAndUpdate(
        { 
          shop, 
          collectionId: collection.id 
        },
        {
          shop,
          collectionId: collection.id,
          shopifyCollectionId: collection.id,
          gid: collection.id,
          title: collection.title,
          handle: collection.handle,
          description: collection.description,
          descriptionHtml: collection.descriptionHtml,
          productsCount: collection.productsCount?.count || 0,
          seoStatus,
          updatedAt: collection.updatedAt,
          syncedAt: new Date()
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`[SYNC] Error saving collection ${collection.id}:`, error);
    }
  }

  console.log(`[SYNC] Collections sync complete: ${allCollections.length} collections`);
  return allCollections.length;
}

/**
 * Get store languages from Shopify
 */
export async function syncLanguages(adminGraphql, shop, progressCallback = null) {
  console.log(`[SYNC] Fetching store languages for ${shop}`);

  const query = `
    query {
      shopLocales {
        locale
        name
        primary
        published
      }
    }
  `;

  try {
    const response = await adminGraphql(query);
    const languages = response?.shopLocales || [];

    if (progressCallback) {
      progressCallback({
        type: 'languages',
        current: languages.length,
        message: `Found ${languages.length} languages`
      });
    }

    // Save languages to Shop model
    await Shop.findOneAndUpdate(
      { shop },
      { 
        $set: { 
          'storeLanguages': languages.map(l => ({
            locale: l.locale,
            name: l.name,
            primary: l.primary,
            published: l.published
          }))
        } 
      }
    );

    console.log(`[SYNC] Languages sync complete:`, languages);
    return languages;
  } catch (error) {
    console.error('[SYNC] Error fetching languages:', error);
    return [];
  }
}

/**
 * Get store markets from Shopify
 */
export async function syncMarkets(adminGraphql, shop, progressCallback = null) {
  console.log(`[SYNC] Fetching store markets for ${shop}`);

  const query = `
    query {
      markets(first: 10) {
        edges {
          node {
            id
            name
            enabled
          }
        }
      }
    }
  `;

  try {
    const response = await adminGraphql(query);
    const markets = response?.markets?.edges?.map(e => e.node) || [];

    if (progressCallback) {
      progressCallback({
        type: 'markets',
        current: markets.length,
        message: `Found ${markets.length} markets`
      });
    }

    // Save markets to Shop model
    await Shop.findOneAndUpdate(
      { shop },
      { 
        $set: { 
          'storeMarkets': markets.map(m => ({ id: m.id, name: m.name, enabled: m.enabled }))
        } 
      }
    );

    console.log(`[SYNC] Markets sync complete:`, markets.length);
    return markets;
  } catch (error) {
    console.error('[SYNC] Error fetching markets:', error);
    return [];
  }
}

/**
 * Process metafields to extract SEO optimization status
 */
function processMetafields(metafields) {
  if (!metafields?.edges || metafields.edges.length === 0) {
    return {
      optimized: false,
      languages: [],
      lastCheckedAt: new Date()
    };
  }

  const languages = [];
  
  metafields.edges.forEach(({ node }) => {
    if (node.key && node.key.startsWith('seo__')) {
      try {
        const seoData = JSON.parse(node.value);
        if (seoData && seoData.language) {
          const existingLang = languages.find(l => l.code === seoData.language);
          if (!existingLang) {
            languages.push({
              code: seoData.language,
              optimized: true,
              lastOptimizedAt: seoData.updatedAt ? new Date(seoData.updatedAt) : new Date()
            });
          }
        }
      } catch (error) {
        console.warn(`[SYNC] Failed to parse metafield ${node.key}`);
      }
    }
  });

  return {
    optimized: languages.length > 0,
    languages,
    lastCheckedAt: new Date()
  };
}

/**
 * Full store sync - all data
 */
export async function syncStore(adminGraphql, shop, progressCallback = null) {
  console.log(`[SYNC] ===== FULL STORE SYNC STARTED for ${shop} =====`);
  
  const startTime = Date.now();
  const results = {
    products: 0,
    collections: 0,
    languages: 0,
    markets: 0,
    success: false,
    error: null
  };

  try {
    // Update sync status
    await Shop.findOneAndUpdate(
      { shop },
      { 
        'syncStatus.inProgress': true,
        'syncStatus.lastError': null
      }
    );

    // Sync in sequence (can be parallel if needed)
    results.products = await syncProducts(adminGraphql, shop, progressCallback);
    results.collections = await syncCollections(adminGraphql, shop, progressCallback);
    
    const languages = await syncLanguages(adminGraphql, shop, progressCallback);
    results.languages = languages.length;
    
    const markets = await syncMarkets(adminGraphql, shop, progressCallback);
    results.markets = markets.length;

    // Update shop sync status
    await Shop.findOneAndUpdate(
      { shop },
      { 
        lastSyncDate: new Date(),
        'syncStatus.inProgress': false,
        'syncStatus.lastError': null
      }
    );

    results.success = true;
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[SYNC] ===== FULL STORE SYNC COMPLETE in ${duration}s =====`);
    console.log(`[SYNC] Results:`, results);

    if (progressCallback) {
      progressCallback({
        type: 'complete',
        results,
        message: 'Sync complete!'
      });
    }

    return results;
  } catch (error) {
    console.error('[SYNC] Error during store sync:', error);
    
    // Update error status
    await Shop.findOneAndUpdate(
      { shop },
      { 
        'syncStatus.inProgress': false,
        'syncStatus.lastError': error.message
      }
    );

    results.error = error.message;
    
    if (progressCallback) {
      progressCallback({
        type: 'error',
        error: error.message
      });
    }

    throw error;
  }
}

