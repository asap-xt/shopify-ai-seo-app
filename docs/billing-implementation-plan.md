# 💳 Billing System Implementation Plan

## 🎯 ЦЕЛИ

1. Интеграция със Shopify Billing API за subscription management
2. Token-based система за AI функции (Professional+)
3. Trial period ограничения
4. Лесно тестване в development store

---

## 📊 АРХИТЕКТУРА: HYBRID SYSTEM

### SHOPIFY BILLING (Managed)
- ✅ Recurring subscriptions (месечни планове)
- ✅ Payment processing
- ✅ Usage charges (токени)
- ✅ Billing cycle management
- ✅ Webhooks за subscription updates

### CUSTOM LOGIC (MongoDB + Backend)
- ✅ Trial period enforcement
- ✅ Feature flags per plan
- ✅ Usage tracking (queries, products)
- ✅ Token balance management
- ✅ AI provider access control

---

## 🏗️ ИМПЛЕМЕНТАЦИЯ

### PHASE 1: Shopify Subscription Setup

#### 1.1 GraphQL Mutations

**Create Subscription:**
```graphql
mutation {
  appSubscriptionCreate(
    name: "Professional Plan"
    returnUrl: "https://yourapp.com/billing/callback"
    test: true
    trialDays: 5
    lineItems: [{
      plan: {
        appRecurringPricingDetails: {
          price: { amount: 39, currencyCode: USD }
          interval: EVERY_30_DAYS
        }
      }
    }]
  ) {
    userErrors { field message }
    confirmationUrl
    appSubscription { id status }
  }
}
```

**Create Usage Charge Line Item:**
```graphql
mutation {
  appSubscriptionCreate(
    name: "Professional Plan + Tokens"
    returnUrl: "https://yourapp.com/billing/callback"
    test: true
    trialDays: 5
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: 39, currencyCode: USD }
            interval: EVERY_30_DAYS
          }
        }
      },
      {
        plan: {
          appUsagePricingDetails: {
            cappedAmount: { amount: 100, currencyCode: USD }
            terms: "Per AI generation token: $0.10"
          }
        }
      }
    ]
  ) {
    userErrors { field message }
    confirmationUrl
    appSubscription { id lineItems { id } }
  }
}
```

**Record Usage:**
```graphql
mutation {
  appUsageRecordCreate(
    subscriptionLineItemId: "gid://shopify/AppSubscriptionLineItem/123"
    price: { amount: 0.10, currencyCode: USD }
    description: "1 AI Generation Token"
  ) {
    userErrors { field message }
    appUsageRecord { id price }
  }
}
```

#### 1.2 Backend Implementation

**File: `backend/billing/shopifyBilling.js`**
```javascript
import shopify from '../utils/shopifyApi.js';

export async function createSubscription(shop, plan, accessToken) {
  const planConfig = PLANS[plan];
  
  const mutation = `
    mutation CreateSubscription($name: String!, $returnUrl: URL!, $trialDays: Int, $lineItems: [AppSubscriptionLineItemInput!]!, $test: Boolean) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        trialDays: $trialDays
        lineItems: $lineItems
        test: $test
      ) {
        userErrors { field message }
        confirmationUrl
        appSubscription {
          id
          name
          status
          trialDays
          currentPeriodEnd
          lineItems {
            id
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  price { amount }
                  interval
                }
                ... on AppUsagePricing {
                  cappedAmount { amount }
                  terms
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
    returnUrl: `${process.env.APP_URL}/billing/callback?shop=${shop}`,
    trialDays: TRIAL_DAYS,
    test: process.env.NODE_ENV !== 'production',
    lineItems: [
      // Base subscription
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: planConfig.priceUsd, currencyCode: 'USD' },
            interval: 'EVERY_30_DAYS'
          }
        }
      }
    ]
  };
  
  // Add usage charges for Professional+ plans
  if (['professional', 'growth', 'growth extra', 'enterprise'].includes(plan)) {
    variables.lineItems.push({
      plan: {
        appUsagePricingDetails: {
          cappedAmount: { amount: 100, currencyCode: 'USD' },
          terms: 'AI Generation Tokens: $0.10 per token'
        }
      }
    });
  }
  
  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: mutation, variables })
  });
  
  const result = await response.json();
  
  if (result.data.appSubscriptionCreate.userErrors.length > 0) {
    throw new Error(result.data.appSubscriptionCreate.userErrors[0].message);
  }
  
  return {
    confirmationUrl: result.data.appSubscriptionCreate.confirmationUrl,
    subscription: result.data.appSubscriptionCreate.appSubscription
  };
}

export async function recordUsage(shop, subscriptionLineItemId, tokens, accessToken) {
  const mutation = `
    mutation RecordUsage($subscriptionLineItemId: ID!, $price: MoneyInput!, $description: String!) {
      appUsageRecordCreate(
        subscriptionLineItemId: $subscriptionLineItemId
        price: $price
        description: $description
      ) {
        userErrors { field message }
        appUsageRecord {
          id
          price { amount }
          subscriptionLineItem { id }
        }
      }
    }
  `;
  
  const variables = {
    subscriptionLineItemId,
    price: { amount: tokens * 0.10, currencyCode: 'USD' },
    description: `${tokens} AI Generation Token${tokens > 1 ? 's' : ''}`
  };
  
  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: mutation, variables })
  });
  
  const result = await response.json();
  
  if (result.data.appUsageRecordCreate.userErrors.length > 0) {
    throw new Error(result.data.appUsageRecordCreate.userErrors[0].message);
  }
  
  return result.data.appUsageRecordCreate.appUsageRecord;
}
```

---

### PHASE 2: Trial Period Enforcement

#### 2.1 Trial Restrictions

**File: `backend/middleware/trialRestrictions.js`**
```javascript
export function enforceTrialRestrictions(req, res, next) {
  const subscription = req.subscription; // from attachShop middleware
  
  if (!subscription) {
    return res.status(403).json({ 
      error: 'No active subscription',
      trialRestriction: true 
    });
  }
  
  const now = new Date();
  const inTrial = subscription.trialEndsAt && now < new Date(subscription.trialEndsAt);
  
  // Block token-based features during trial
  if (inTrial && req.body.useTokens) {
    return res.status(403).json({
      error: 'Token-based features are not available during trial period',
      trialRestriction: true,
      trialEndsAt: subscription.trialEndsAt
    });
  }
  
  req.inTrial = inTrial;
  next();
}
```

#### 2.2 Usage Tracking

**File: `backend/db/TokenUsage.js`**
```javascript
import mongoose from 'mongoose';

const tokenUsageSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true },
  month: { type: String, required: true }, // "2025-01"
  tokensUsed: { type: Number, default: 0 },
  tokensPurchased: { type: Number, default: 0 },
  tokensRemaining: { type: Number, default: 0 },
  transactions: [{
    type: { type: String, enum: ['purchase', 'usage', 'refund'] },
    amount: Number,
    description: String,
    timestamp: Date,
    shopifyUsageRecordId: String
  }]
}, { timestamps: true });

export default mongoose.model('TokenUsage', tokenUsageSchema);
```

---

### PHASE 3: Frontend Billing Page

#### 3.1 Billing UI Components

**Current Plan Card:**
- Plan name & price
- Trial status (if applicable)
- Next billing date
- Features included
- Token balance (if applicable)

**Upgrade/Downgrade:**
- Plan comparison table
- Switch plan button
- Prorated billing info

**Token Management (Professional+):**
- Current token balance
- Usage this month
- Purchase tokens button
- Usage history

**Payment History:**
- Invoice list
- Download invoices
- Payment method

#### 3.2 Implementation Files

**File: `frontend/src/pages/Billing.jsx`**
```javascript
import React, { useState, useEffect } from 'react';
import { Card, Box, Text, Button, Badge, ProgressBar } from '@shopify/polaris';

export default function Billing({ shop }) {
  const [subscription, setSubscription] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    loadBillingData();
  }, [shop]);
  
  const loadBillingData = async () => {
    // Fetch subscription info
    // Fetch token balance
  };
  
  const handleUpgrade = async (newPlan) => {
    // Redirect to Shopify billing confirmation
  };
  
  const handlePurchaseTokens = async (amount) => {
    // Create usage charge
  };
  
  return (
    <Box>
      {/* Current Plan Card */}
      {/* Token Balance Card (if Professional+) */}
      {/* Upgrade Options */}
      {/* Payment History */}
    </Box>
  );
}
```

---

### PHASE 4: Webhooks

#### 4.1 Subscription Webhooks

**Topics to subscribe:**
- `APP_SUBSCRIPTIONS_UPDATE` - plan changes, cancellations
- `APP_SUBSCRIPTIONS_APPROACHING_CAPPED_AMOUNT` - usage limit warning

**File: `backend/webhooks/subscriptions.js`**
```javascript
export async function handleSubscriptionUpdate(webhookData) {
  const { app_subscription } = webhookData;
  
  // Update MongoDB subscription record
  await Subscription.findOneAndUpdate(
    { shop: webhookData.shop_domain },
    {
      shopifySubscriptionId: app_subscription.id,
      status: app_subscription.status,
      currentPeriodEnd: app_subscription.current_period_end,
      // ... other fields
    }
  );
}
```

---

## 🧪 TESTING IN DEV STORE

### Test Mode
- All charges created with `test: true`
- No real payments processed
- Full functionality testing
- Webhooks still fire

### Test Scenarios
1. ✅ Create subscription → redirect → approve
2. ✅ Trial period → attempt token usage → blocked
3. ✅ Upgrade plan → prorated billing
4. ✅ Purchase tokens → usage charge created
5. ✅ Cancel subscription → cleanup

### Test Cards (Shopify)
```
Success: (any valid card format)
Decline: Use card with insufficient funds
```

---

## 📝 MIGRATION STRATEGY

### From Current Custom Billing

1. **Keep existing MongoDB structure** for:
   - Feature flags
   - Usage tracking
   - Trial logic

2. **Add Shopify fields** to Subscription model:
   ```javascript
   {
     shopifySubscriptionId: String,
     shopifyLineItemIds: {
       recurring: String,
       usage: String
     },
     shopifyStatus: String,
     lastShopifySync: Date
   }
   ```

3. **Gradual rollout:**
   - Phase 1: New installs use Shopify billing
   - Phase 2: Migrate existing users
   - Phase 3: Deprecate old system

---

## 🔒 SECURITY CONSIDERATIONS

1. **Webhook validation** - verify HMAC
2. **Access token protection** - never expose to frontend
3. **Usage validation** - prevent token fraud
4. **Rate limiting** - prevent abuse
5. **Audit logging** - track all billing events

---

## 📊 MONITORING & ANALYTICS

1. **Track metrics:**
   - Subscription churn rate
   - Token purchase frequency
   - Average revenue per user (ARPU)
   - Trial conversion rate

2. **Alerts:**
   - Failed payments
   - Approaching usage caps
   - Subscription cancellations

---

## 🚀 IMPLEMENTATION TIMELINE

**Week 1:** Backend Shopify billing integration
**Week 2:** Frontend billing UI
**Week 3:** Webhooks & testing
**Week 4:** Migration & monitoring

---

## ✅ ПРЕПОРЪКА

**ДА, използвай Shopify Billing**, но с hybrid подход:
- Shopify за payment processing и subscription management
- Custom logic за trial restrictions и feature flags
- Token system чрез Usage Charges
- MongoDB за tracking и business logic

Това ти дава най-доброто от двата свята - надеждна payment инфраструктура и гъвкавост за custom features!

