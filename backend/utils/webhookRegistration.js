// backend/utils/webhookRegistration.js
// Register webhooks with Shopify

import { makeShopifyGraphQLRequest } from './shopifyGraphQL.js';
import { resolveAdminToken } from './tokenResolver.js';
import { createAllMetafieldDefinitions } from './metafieldDefinitions.js';

/**
 * Register products/update webhook with Shopify
 * @param {Object} req - Express request
 * @param {string} shop - Shop domain
 * @param {string} callbackUrl - Full webhook URL (e.g., https://your-app.com/webhooks/products)
 * @returns {Promise<Object>} - Registration result
 */
export async function registerProductsUpdateWebhook(req, shop, callbackUrl) {
  try {
    const accessToken = await resolveAdminToken(req, shop);
    if (!accessToken) {
      throw new Error(`No access token found for shop: ${shop}`);
    }
    
    // Check if webhook already exists
    const checkQuery = `
      query {
        webhookSubscriptions(first: 50, topics: PRODUCTS_UPDATE) {
          edges {
            node {
              id
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
          }
        }
      }
    `;
    
    const checkResult = await makeShopifyGraphQLRequest(shop, accessToken, checkQuery);
    const existingWebhooks = checkResult?.webhookSubscriptions?.edges || [];
    
    // Check if our webhook is already registered
    const ourWebhook = existingWebhooks.find(edge => {
      const endpoint = edge.node.endpoint;
      return endpoint.__typename === 'WebhookHttpEndpoint' && 
             endpoint.callbackUrl === callbackUrl;
    });
    
    if (ourWebhook) {
      return { 
        success: true, 
        alreadyExists: true, 
        webhookId: ourWebhook.node.id 
      };
    }
    
    // Register new webhook
    const createMutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const variables = {
      topic: 'PRODUCTS_UPDATE',
      webhookSubscription: {
        callbackUrl: callbackUrl,
        format: 'JSON'
      }
    };
    
    const createResult = await makeShopifyGraphQLRequest(shop, accessToken, createMutation, variables);
    
    const errors = createResult?.webhookSubscriptionCreate?.userErrors || [];
    if (errors.length > 0) {
      console.error(`[WEBHOOK-REG] Errors:`, errors);
      return {
        success: false,
        errors: errors.map(e => e.message)
      };
    }
    
    const webhook = createResult?.webhookSubscriptionCreate?.webhookSubscription;
    
    return {
      success: true,
      alreadyExists: false,
      webhookId: webhook.id
    };
    
  } catch (error) {
    console.error(`[WEBHOOK-REG] Error:`, error);
    return {
      success: false,
      errors: [error.message]
    };
  }
}

/**
 * Register collections/update webhook with Shopify
 * @param {Object} req - Express request
 * @param {string} shop - Shop domain
 * @param {string} callbackUrl - Full webhook URL (e.g., https://your-app.com/webhooks/collections)
 * @returns {Promise<Object>} - Registration result
 */
export async function registerCollectionsUpdateWebhook(req, shop, callbackUrl) {
  
  try {
    const accessToken = await resolveAdminToken(req, shop);
    if (!accessToken) {
      throw new Error(`No access token found for shop: ${shop}`);
    }
    
    // Check if webhook already exists
    const checkQuery = `
      query {
        webhookSubscriptions(first: 50, topics: COLLECTIONS_UPDATE) {
          edges {
            node {
              id
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
          }
        }
      }
    `;
    
    const checkResult = await makeShopifyGraphQLRequest(shop, accessToken, checkQuery);
    const existingWebhooks = checkResult?.webhookSubscriptions?.edges || [];
    
    // Check if our webhook is already registered
    const ourWebhook = existingWebhooks.find(edge => {
      const endpoint = edge.node.endpoint;
      return endpoint.__typename === 'WebhookHttpEndpoint' && 
             endpoint.callbackUrl === callbackUrl;
    });
    
    if (ourWebhook) {
      return { 
        success: true, 
        alreadyExists: true, 
        webhookId: ourWebhook.node.id 
      };
    }
    
    // Register new webhook
    const createMutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const variables = {
      topic: 'COLLECTIONS_UPDATE',
      webhookSubscription: {
        callbackUrl: callbackUrl,
        format: 'JSON'
      }
    };
    
    const createResult = await makeShopifyGraphQLRequest(shop, accessToken, createMutation, variables);
    
    const errors = createResult?.webhookSubscriptionCreate?.userErrors || [];
    if (errors.length > 0) {
      console.error(`[WEBHOOK-REG] Errors:`, errors);
      return {
        success: false,
        errors: errors.map(e => e.message)
      };
    }
    
    const webhook = createResult?.webhookSubscriptionCreate?.webhookSubscription;
    
    return {
      success: true,
      alreadyExists: false,
      webhookId: webhook.id
    };
    
  } catch (error) {
    console.error(`[WEBHOOK-REG] Error:`, error);
    return {
      success: false,
      errors: [error.message]
    };
  }
}

/**
 * Register app/uninstalled webhook with Shopify
 * @param {Object} req - Express request
 * @param {string} shop - Shop domain
 * @param {string} callbackUrl - Full webhook URL (e.g., https://your-app.com/webhooks/app/uninstalled)
 * @returns {Promise<Object>} - Registration result
 */
export async function registerAppUninstalledWebhook(req, shop, callbackUrl) {
  
  try {
    const accessToken = await resolveAdminToken(req, shop);
    if (!accessToken) {
      throw new Error(`No access token found for shop: ${shop}`);
    }
    
    // Check if webhook already exists
    const checkQuery = `
      query {
        webhookSubscriptions(first: 50, topics: APP_UNINSTALLED) {
          edges {
            node {
              id
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
          }
        }
      }
    `;
    
    const checkResult = await makeShopifyGraphQLRequest(shop, accessToken, checkQuery);
    const existingWebhooks = checkResult?.webhookSubscriptions?.edges || [];
    
    // Check if our webhook is already registered
    const ourWebhook = existingWebhooks.find(edge => {
      const endpoint = edge.node.endpoint;
      return endpoint.__typename === 'WebhookHttpEndpoint' && 
             endpoint.callbackUrl === callbackUrl;
    });
    
    if (ourWebhook) {
      return { 
        success: true, 
        alreadyExists: true, 
        webhookId: ourWebhook.node.id 
      };
    }
    
    // Register new webhook
    const createMutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const variables = {
      topic: 'APP_UNINSTALLED',
      webhookSubscription: {
        callbackUrl: callbackUrl,
        format: 'JSON'
      }
    };
    
    const createResult = await makeShopifyGraphQLRequest(shop, accessToken, createMutation, variables);
    
    const errors = createResult?.webhookSubscriptionCreate?.userErrors || [];
    if (errors.length > 0) {
      console.error(`[WEBHOOK-REG] Errors:`, errors);
      return {
        success: false,
        errors: errors.map(e => e.message)
      };
    }
    
    const webhook = createResult?.webhookSubscriptionCreate?.webhookSubscription;
    
    return {
      success: true,
      alreadyExists: false,
      webhookId: webhook.id
    };
    
  } catch (error) {
    console.error(`[WEBHOOK-REG] Error:`, error);
    return {
      success: false,
      errors: [error.message]
    };
  }
}

/**
 * Register APP_SUBSCRIPTIONS_UPDATE webhook with Shopify
 * This webhook fires when subscription status changes (PENDING → ACTIVE, ACTIVE → CANCELLED, etc.)
 * @param {Object} req - Express request
 * @param {string} shop - Shop domain
 * @param {string} callbackUrl - Full webhook URL (e.g., https://your-app.com/webhooks/subscription/update)
 * @returns {Promise<Object>} - Registration result
 */
export async function registerSubscriptionUpdateWebhook(req, shop, callbackUrl) {
  
  try {
    const accessToken = await resolveAdminToken(req, shop);
    if (!accessToken) {
      throw new Error(`No access token found for shop: ${shop}`);
    }
    
    // Check if webhook already exists
    const checkQuery = `
      query {
        webhookSubscriptions(first: 50, topics: APP_SUBSCRIPTIONS_UPDATE) {
          edges {
            node {
              id
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
          }
        }
      }
    `;
    
    const checkResult = await makeShopifyGraphQLRequest(shop, accessToken, checkQuery);
    const existingWebhooks = checkResult?.webhookSubscriptions?.edges || [];
    
    // Check if our webhook is already registered
    const ourWebhook = existingWebhooks.find(edge => {
      const endpoint = edge.node.endpoint;
      return endpoint.__typename === 'WebhookHttpEndpoint' && 
             endpoint.callbackUrl === callbackUrl;
    });
    
    if (ourWebhook) {
      return { 
        success: true, 
        alreadyExists: true, 
        webhookId: ourWebhook.node.id 
      };
    }
    
    // Register new webhook
    const createMutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const variables = {
      topic: 'APP_SUBSCRIPTIONS_UPDATE',
      webhookSubscription: {
        callbackUrl: callbackUrl,
        format: 'JSON'
      }
    };
    
    const createResult = await makeShopifyGraphQLRequest(shop, accessToken, createMutation, variables);
    
    const errors = createResult?.webhookSubscriptionCreate?.userErrors || [];
    if (errors.length > 0) {
      console.error(`[WEBHOOK-REG] Errors:`, errors);
      return {
        success: false,
        errors: errors.map(e => e.message)
      };
    }
    
    const webhook = createResult?.webhookSubscriptionCreate?.webhookSubscription;
    
    return {
      success: true,
      alreadyExists: false,
      webhookId: webhook.id
    };
    
  } catch (error) {
    console.error(`[WEBHOOK-REG] Error:`, error);
    return {
      success: false,
      errors: [error.message]
    };
  }
}

/**
 * Register all required webhooks for the app
 * Also creates metafield definitions to make metafields visible in Shopify Admin
 * @param {Object} req - Express request
 * @param {string} shop - Shop domain
 * @param {string} appUrl - Base app URL (e.g., https://your-app.com)
 * @returns {Promise<Object>} - Registration results
 */
export async function registerAllWebhooks(req, shop, appUrl) {
  
  const results = {};
  
  // Register products/update webhook
  const productsUrl = `${appUrl}/webhooks/products`;
  results.productsUpdate = await registerProductsUpdateWebhook(req, shop, productsUrl);
  
  // Register collections/update webhook
  const collectionsUrl = `${appUrl}/webhooks/collections`;
  results.collectionsUpdate = await registerCollectionsUpdateWebhook(req, shop, collectionsUrl);
  
  // Register app/uninstalled webhook
  const uninstallUrl = `${appUrl}/webhooks/app/uninstalled`;
  results.appUninstalled = await registerAppUninstalledWebhook(req, shop, uninstallUrl);
  
  // Register APP_SUBSCRIPTIONS_UPDATE webhook (for secure plan activation)
  const subscriptionUpdateUrl = `${appUrl}/webhooks/subscription/update`;
  results.subscriptionUpdate = await registerSubscriptionUpdateWebhook(req, shop, subscriptionUpdateUrl);
  
  // Create metafield definitions (makes metafields visible in Product → Metafields)
  results.metafieldDefinitions = await createAllMetafieldDefinitions(req, shop);
  
  return results;
}

