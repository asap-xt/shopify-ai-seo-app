# Billing System Overview

## Architecture

The billing system is built entirely on **Shopify GraphQL Admin API** - no REST API is used. This ensures future compatibility and compliance with Shopify's latest standards.

## Components

### 1. Database (MongoDB)

#### TokenBalance Model (`backend/db/TokenBalance.js`)
```javascript
{
  shop: String,
  balance: Number,           // Current tokens
  totalPurchased: Number,    // Lifetime purchased USD
  totalUsed: Number,         // Lifetime used tokens
  lastPurchase: {
    amount: Number,
    tokens: Number,
    date: Date,
    shopifyChargeId: String
  },
  purchases: [/* purchase history */],
  usage: [/* usage history */]
}
```

**Methods:**
- `getOrCreate(shop)` - Get or create token balance for shop
- `hasBalance(amount)` - Check if sufficient tokens
- `addTokens(usdAmount, tokens, chargeId)` - Add purchased tokens
- `deductTokens(amount, feature, metadata)` - Deduct tokens for feature use

### 2. Configuration

#### Token Config (`backend/billing/tokenConfig.js`)
```javascript
TOKEN_CONFIG = {
  presetAmounts: [10, 20, 50, 100],  // Quick select amounts
  minimumPurchase: 5,                 // Min $5
  maximumPurchase: 1000,              // Max $1000
  increment: 5,                        // Must be multiple of $5
  appRevenuePercent: 0.40,            // 40% to app
  tokenBudgetPercent: 0.60,           // 60% for tokens
  provider: 'gemini-2.5-flash-lite',  // Internal only
  tokensExpire: false,                // Tokens never expire
  rollover: true                      // Unused tokens roll over
}
```

#### Feature Costs
```javascript
'ai-seo-product-basic': {
  base: 1000,           // Base tokens
  perLanguage: 800      // Per additional language
},
'ai-seo-product-enhanced': {
  base: 2000,
  perLanguage: 1500
},
'ai-seo-collection': {
  base: 1500,
  perLanguage: 1200
},
'ai-testing-simulation': {
  base: 500
},
'ai-schema-advanced': {
  base: 3000,
  perProduct: 2500
},
'ai-sitemap-optimized': {
  base: 5000,
  perProduct: 100
}
```

#### Plan-Based Token Inclusions
```javascript
'growth extra': {
  usdAmount: 35.70,  // 30% of $119 plan price
  tokens: ~214,200   // Calculated dynamically
},
'enterprise': {
  usdAmount: 89.70,  // 30% of $299 plan price
  tokens: ~538,200   // Calculated dynamically
}
```

### 3. Backend Routes (`backend/billing/billingRoutes.js`)

#### Billing Info
```
GET /api/billing/info
Returns: subscription, tokens, available plans
```

#### Subscribe to Plan
```
POST /api/billing/subscribe
Body: { plan: 'professional', endTrial: false }
Returns: { confirmationUrl, subscriptionId }
Flow: Create Shopify subscription → Save to MongoDB → Redirect to confirmation
```

#### Purchase Tokens
```
POST /api/billing/tokens/purchase
Body: { amount: 20 }
Returns: { confirmationUrl, chargeId, tokens }
Flow: Create one-time purchase → Save pending → Redirect to confirmation
```

#### Check Feature Access
```
POST /api/billing/check-feature-access
Body: { feature: 'ai-seo-product-basic', options: {} }
Returns: { allowed: true/false, tokensRequired, tokensAvailable }
Checks: Trial restrictions + Token balance
```

#### Callbacks
```
GET /billing/callback?shop={shop}&plan={plan}&charge_id={id}
- Activates subscription
- Adds included tokens for Growth Extra+
- Redirects to app

GET /billing/tokens/callback?shop={shop}&amount={amount}&charge_id={id}
- Adds purchased tokens to balance
- Updates purchase history
- Redirects to app
```

### 4. Middleware (`backend/middleware/tokenMiddleware.js`)

#### checkTrialStatus
Attaches `req.inTrial` and `req.trialEndsAt` to request.

#### blockTokenFeaturesInTrial
Returns 402 error if trial user attempts token-based feature.

#### validateTokenBalance
Checks token balance before allowing feature use.

#### deductTokens
Deducts tokens after successful operation.

#### requireTokens(feature)
Combined middleware: trial check + balance validation.

### 5. Shopify GraphQL Integration (`backend/billing/shopifyBilling.js`)

#### createSubscription
```graphql
mutation AppSubscriptionCreate {
  appSubscriptionCreate(
    name: "Professional Plan"
    returnUrl: "https://app.com/billing/callback"
    trialDays: 5
    lineItems: [{
      plan: {
        appRecurringPricingDetails: {
          price: { amount: "39.00", currencyCode: "USD" }
          interval: EVERY_30_DAYS
        }
      }
    }]
  ) {
    confirmationUrl
    appSubscription { id, status }
  }
}
```

#### purchaseTokens
```graphql
mutation AppPurchaseOneTimeCreate {
  appPurchaseOneTimeCreate(
    name: "AI Tokens Purchase ($20.00)"
    price: { amount: "20.00", currencyCode: "USD" }
    returnUrl: "https://app.com/billing/tokens/callback"
  ) {
    confirmationUrl
    appPurchaseOneTime { id, status }
  }
}
```

#### getCurrentSubscription
```graphql
query GetActiveSubscription {
  currentAppInstallation {
    activeSubscriptions {
      id, status, trialDays, currentPeriodEnd
      lineItems { ... }
    }
  }
}
```

#### cancelSubscription
```graphql
mutation AppSubscriptionCancel {
  appSubscriptionCancel(id: $subscriptionId) {
    appSubscription { id, status }
  }
}
```

### 6. Frontend Components

#### Billing Page (`frontend/src/pages/Billing.jsx`)
- Current plan display with trial badge
- Token balance card with progress bar
- Available plans grid
- Plan selection modal
- Token purchase modal with preset/custom amounts
- Real-time token calculation

#### TrialActivationModal (`frontend/src/components/TrialActivationModal.jsx`)
Shown when trial user attempts AI feature:
- Option 1: End trial & activate plan
- Option 2: Purchase tokens only (trial continues)
- Shows feature cost, trial end date, plan benefits

#### InsufficientTokensModal (`frontend/src/components/InsufficientTokensModal.jsx`)
Shown when user has insufficient tokens:
- Current balance vs required
- Preset amounts + custom input
- Real-time token calculation
- Visual indicator if amount is sufficient

#### useTokens Hook (`frontend/src/hooks/useTokens.js`)
```javascript
const {
  balance,              // Current token balance
  loading,              // Loading state
  fetchBalance,         // Refresh balance
  checkFeatureAccess,   // Check if feature allowed
  executeWithTokens,    // Execute with automatic checks
  purchaseTokens,       // Redirect to purchase
  activatePlan          // Redirect to activation
} = useTokens(shop);
```

## Trial Period Logic

### Trial Configuration
```javascript
TRIAL_CONFIG = {
  duration: 5,  // days
  blockedFeatures: [
    'ai-seo-product-basic',
    'ai-seo-product-enhanced',
    'ai-seo-collection',
    'ai-testing-simulation',
    'ai-schema-advanced',
    'ai-sitemap-optimized'
  ]
}
```

### Trial Restrictions
1. **During Trial:**
   - All AI-enhanced features blocked
   - User must either:
     - End trial & activate plan (immediate billing)
     - Purchase tokens (trial continues)

2. **After Trial:**
   - Plan automatically activates
   - Monthly billing begins
   - Features unlock based on plan + token balance

3. **Early Activation:**
   - User can end trial anytime
   - Immediate monthly charge
   - Full feature access

## Token Flow

### Purchase Flow
```
User clicks "Purchase Tokens"
  ↓
Selects amount ($10, $20, $50, $100, or custom)
  ↓
Backend creates Shopify one-time purchase
  ↓
User redirected to Shopify confirmation
  ↓
User approves purchase
  ↓
Shopify calls /billing/tokens/callback
  ↓
Tokens added to balance (60% of USD amount)
  ↓
User redirected back to app
```

### Usage Flow
```
User attempts AI feature (e.g., SEO generation)
  ↓
Backend checks:
  1. Is user in trial? → Show TrialActivationModal
  2. Sufficient tokens? → Show InsufficientTokensModal
  3. All OK? → Deduct tokens & execute
  ↓
Feature executes
  ↓
Tokens deducted from balance
  ↓
Usage recorded in history
```

## Testing in Dev Store

### Test Mode
All billing operations in development use `test: true`:
- No real charges
- Test subscriptions/purchases
- Can be cancelled/refunded freely

### Testing Checklist
1. ✅ Create subscription (trial period)
2. ✅ Attempt AI feature during trial → Modal appears
3. ✅ Purchase tokens during trial
4. ✅ Use AI feature with tokens
5. ✅ End trial early & activate plan
6. ✅ Change plans
7. ✅ Cancel subscription
8. ✅ Test insufficient tokens → Modal appears
9. ✅ Test token deduction & balance update
10. ✅ Check billing history

## Security Considerations

1. **Token Validation:**
   - All token operations require shop authentication
   - Balance checked before AND during execution
   - No client-side token manipulation

2. **GraphQL Only:**
   - No REST API = No deprecated endpoints
   - Future-proof implementation
   - Full Shopify API compliance

3. **Trial Protection:**
   - Server-side trial date validation
   - Cannot bypass trial restrictions client-side
   - Automatic plan activation after trial

4. **Audit Trail:**
   - All purchases recorded with Shopify charge ID
   - Usage history with feature + metadata
   - Timestamps for all operations

## Future Enhancements

1. **Token Packages:**
   - Discounted bulk purchases
   - Subscription-based token packages

2. **Usage Analytics:**
   - Token consumption graphs
   - Feature usage breakdown
   - Cost optimization suggestions

3. **Prorated Billing:**
   - Mid-cycle plan changes
   - Automatic credit adjustments

4. **Webhook Integration:**
   - Real-time subscription updates
   - Automatic token allocation
   - Payment failure handling

