// backend/utils/shopifyGraphQL.js
// Utility for making GraphQL requests to Shopify Admin API

/**
 * Make a GraphQL request to Shopify Admin API
 * @param {string} shop - Shop domain
 * @param {string} accessToken - Shop access token
 * @param {string} query - GraphQL query or mutation
 * @param {object} variables - GraphQL variables
 * @returns {Promise<object>} GraphQL response data
 */
export async function makeShopifyGraphQLRequest(shop, accessToken, query, variables = {}) {
  const url = `https://${shop}/admin/api/2024-10/graphql.json`;
  
  console.log('[Shopify GraphQL] Making request to:', url);
  console.log('[Shopify GraphQL] Query:', query.substring(0, 200) + '...');
  console.log('[Shopify GraphQL] Variables:', JSON.stringify(variables, null, 2));
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      body: JSON.stringify({
        query,
        variables
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Shopify GraphQL] HTTP Error:', response.status, errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    if (result.errors) {
      console.error('[Shopify GraphQL] GraphQL Errors:', JSON.stringify(result.errors, null, 2));
      throw new Error(`GraphQL Error: ${result.errors[0]?.message || 'Unknown error'}`);
    }
    
    console.log('[Shopify GraphQL] Success:', JSON.stringify(result.data, null, 2).substring(0, 500));
    
    return result.data;
  } catch (error) {
    console.error('[Shopify GraphQL] Request failed:', error);
    throw error;
  }
}

/**
 * Make a paginated GraphQL request to Shopify Admin API
 * Automatically fetches all pages using cursor-based pagination
 * @param {string} shop - Shop domain
 * @param {string} accessToken - Shop access token
 * @param {string} query - GraphQL query (must include pageInfo { hasNextPage, endCursor })
 * @param {object} variables - Initial GraphQL variables
 * @param {string} dataPath - Path to the paginated data (e.g., 'products.edges')
 * @param {number} maxPages - Maximum pages to fetch (safety limit)
 * @returns {Promise<Array>} All items from all pages
 */
export async function makePaginatedGraphQLRequest(
  shop,
  accessToken,
  query,
  variables,
  dataPath,
  maxPages = 10
) {
  const allItems = [];
  let hasNextPage = true;
  let cursor = null;
  let pageCount = 0;
  
  while (hasNextPage && pageCount < maxPages) {
    pageCount++;
    
    const currentVariables = {
      ...variables,
      cursor: cursor
    };
    
    const data = await makeShopifyGraphQLRequest(shop, accessToken, query, currentVariables);
    
    // Navigate to the data using the path
    const pathParts = dataPath.split('.');
    let current = data;
    for (const part of pathParts) {
      current = current?.[part];
      if (!current) break;
    }
    
    if (!current) {
      console.warn('[Shopify GraphQL] Data path not found:', dataPath);
      break;
    }
    
    // Extract items (assuming edges structure)
    const items = Array.isArray(current) ? current : current.edges || [];
    allItems.push(...items);
    
    // Check for next page
    const pageInfo = current.pageInfo;
    hasNextPage = pageInfo?.hasNextPage || false;
    cursor = pageInfo?.endCursor || null;
    
    console.log(`[Shopify GraphQL] Page ${pageCount}: fetched ${items.length} items, hasNextPage: ${hasNextPage}`);
  }
  
  console.log(`[Shopify GraphQL] Pagination complete: ${allItems.length} total items from ${pageCount} pages`);
  
  return allItems;
}

