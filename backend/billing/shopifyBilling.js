// backend/billing/shopifyBilling.js
// Shopify Billing integration using ONLY GraphQL Admin API
// NO REST API - fully modern approach

import { PLANS, TRIAL_DAYS } from '../plans.js';
import { TOKEN_CONFIG, getIncludedTokens } from './tokenConfig.js';

/**
 * Create a subscription using GraphQL (App Bridge v4 compatible)
 * @param {string} shop - Shop domain
 * @param {string} plan - Plan key (starter, professional, etc.)
 * @param {string} accessToken - Shop access token
 * @param {object} options - Additional options
 * @returns {Promise<{confirmationUrl: string, subscription: object}>}
 */
export async function createSubscription(shop, plan, accessToken, options = {}) {
  const planConfig = PLANS[plan];
  if (!planConfig) {
    throw new Error(`Invalid plan: ${plan}`);
  }
  
  const trialDays = options.trialDays !== undefined ? options.trialDays : TRIAL_DAYS;
  const returnTo = options.returnTo || '/billing'; // Default to billing page
  
  // ALWAYS use test mode until we go live with real payments
  // This allows instant activation without waiting for webhooks
  const isTest = true;
  
  const mutation = `
    mutation CreateSubscription(
      $name: String!
      $returnUrl: URL!
      $trialDays: Int
      $lineItems: [AppSubscriptionLineItemInput!]!
      $test: Boolean
    ) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        trialDays: $trialDays
        lineItems: $lineItems
        test: $test
      ) {
        userErrors {
          field
          message
        }
        confirmationUrl
        appSubscription {
          id
          name
          status
          trialDays
          currentPeriodEnd
          test
          lineItems {
            id
            plan {
              pricingDetails {
                __typename
                ... on AppRecurringPricing {
                  price {
                    amount
                    currencyCode
                  }
                  interval
                }
              }
            }
          }
        }
      }
    }
  `;
  
  const variables = {
    name: `${planConfig.name} Plan`,
    returnUrl: `${process.env.APP_URL}/billing/callback?shop=${encodeURIComponent(shop)}&plan=${plan}&returnTo=${encodeURIComponent(returnTo)}`,
    trialDays,
    test: isTest,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: {
              amount: planConfig.priceUsd,
              currencyCode: 'USD'
            },
            interval: 'EVERY_30_DAYS'
          }
        }
      }
    ]
  };
  
  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: mutation,
      variables
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Shopify Billing] HTTP error:', response.status, errorText);
    throw new Error(`Shopify API error: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (result.errors) {
    console.error('[Shopify Billing] GraphQL errors:', result.errors);
    throw new Error(`GraphQL error: ${result.errors[0].message}`);
  }
  
  const createResult = result.data.appSubscriptionCreate;
  
  if (createResult.userErrors && createResult.userErrors.length > 0) {
    console.error('[Shopify Billing] User errors:', createResult.userErrors);
    throw new Error(createResult.userErrors[0].message);
  }
  
  return {
    confirmationUrl: createResult.confirmationUrl,
    subscription: createResult.appSubscription
  };
}

/**
 * Purchase tokens using one-time charge (GraphQL)
 * @param {string} shop - Shop domain
 * @param {number} usdAmount - Amount in USD
 * @param {string} accessToken - Shop access token
 * @param {object} options - Optional params (returnTo)
 * @returns {Promise<{confirmationUrl: string, charge: object}>}
 */
export async function purchaseTokens(shop, usdAmount, accessToken, options = {}) {
  if (!TOKEN_CONFIG.isValidAmount(usdAmount)) {
    throw new Error(`Invalid amount: must be between $${TOKEN_CONFIG.minimumPurchase} and $${TOKEN_CONFIG.maximumPurchase}, in increments of $${TOKEN_CONFIG.increment}`);
  }
  
  // Use dynamic pricing from OpenRouter (checks cache first, then fetches if needed)
  const { calculateTokensWithDynamicPricing } = await import('./tokenConfig.js');
  const tokens = await calculateTokensWithDynamicPricing(usdAmount);
  
  // ALWAYS use test mode until we go live with real payments
  const isTest = true;
  
  const mutation = `
    mutation PurchaseTokens(
      $name: String!
      $price: MoneyInput!
      $returnUrl: URL!
      $test: Boolean
    ) {
      appPurchaseOneTimeCreate(
        name: $name
        price: $price
        returnUrl: $returnUrl
        test: $test
      ) {
        userErrors {
          field
          message
        }
        confirmationUrl
        appPurchaseOneTime {
          id
          name
          price {
            amount
            currencyCode
          }
          status
          test
        }
      }
    }
  `;
  
  // Build returnUrl with returnTo parameter
  const returnTo = options.returnTo || '/billing';
  const returnUrl = `${process.env.APP_URL}/billing/tokens/callback?shop=${encodeURIComponent(shop)}&amount=${usdAmount}&returnTo=${encodeURIComponent(returnTo)}`;
  
  const variables = {
    name: `AI Tokens Purchase (${tokens.toLocaleString()} tokens)`,
    price: {
      amount: usdAmount,
      currencyCode: 'USD'
    },
    returnUrl: returnUrl,
    test: isTest
  };
  
  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: mutation,
      variables
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Shopify Billing] HTTP error:', response.status, errorText);
    throw new Error(`Shopify API error: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (result.errors) {
    console.error('[Shopify Billing] GraphQL errors:', result.errors);
    throw new Error(`GraphQL error: ${result.errors[0].message}`);
  }
  
  const purchaseResult = result.data.appPurchaseOneTimeCreate;
  
  if (purchaseResult.userErrors && purchaseResult.userErrors.length > 0) {
    console.error('[Shopify Billing] User errors:', purchaseResult.userErrors);
    throw new Error(purchaseResult.userErrors[0].message);
  }
  
  return {
    confirmationUrl: purchaseResult.confirmationUrl,
    charge: purchaseResult.appPurchaseOneTime,
    tokens
  };
}

/**
 * Get current active subscription (GraphQL)
 * @param {string} shop - Shop domain
 * @param {string} accessToken - Shop access token
 * @returns {Promise<object|null>}
 */
export async function getCurrentSubscription(shop, accessToken) {
  const query = `
    query GetCurrentSubscription {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          test
          trialDays
          currentPeriodEnd
          lineItems {
            id
            plan {
              pricingDetails {
                __typename
                ... on AppRecurringPricing {
                  price {
                    amount
                    currencyCode
                  }
                  interval
                }
              }
            }
          }
        }
      }
    }
  `;
  
  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  
  if (!response.ok) {
    console.error('[Shopify Billing] Failed to get subscription:', response.status);
    return null;
  }
  
  const result = await response.json();
  
  if (result.errors || !result.data) {
    console.error('[Shopify Billing] Query errors:', result.errors);
    return null;
  }
  
  const subscriptions = result.data.currentAppInstallation?.activeSubscriptions || [];
  
  // Return the first active subscription
  return subscriptions.length > 0 ? subscriptions[0] : null;
}

/**
 * Cancel subscription (GraphQL)
 * @param {string} shop - Shop domain  
 * @param {string} subscriptionId - Shopify subscription GID
 * @param {string} accessToken - Shop access token
 * @returns {Promise<boolean>}
 */
export async function cancelSubscription(shop, subscriptionId, accessToken) {
  const mutation = `
    mutation CancelSubscription($id: ID!) {
      appSubscriptionCancel(id: $id) {
        userErrors {
          field
          message
        }
        appSubscription {
          id
          status
        }
      }
    }
  `;
  
  const variables = { id: subscriptionId };
  
  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: mutation,
      variables
    })
  });
  
  if (!response.ok) {
    console.error('[Shopify Billing] Failed to cancel:', response.status);
    return false;
  }
  
  const result = await response.json();
  
  if (result.errors) {
    console.error('[Shopify Billing] Cancel errors:', result.errors);
    return false;
  }
  
  const cancelResult = result.data.appSubscriptionCancel;
  
  if (cancelResult.userErrors && cancelResult.userErrors.length > 0) {
    console.error('[Shopify Billing] Cancel user errors:', cancelResult.userErrors);
    return false;
  }
  
  return true;
}

