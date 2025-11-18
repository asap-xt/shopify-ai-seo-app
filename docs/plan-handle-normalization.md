# Plan Handle Normalization

## Problem

Shopify uses different plan handle formats than our internal system:
- **Shopify format**: Uses hyphens (`-`) - e.g., `professional-plus`, `growth-plus`
- **Our internal format**: Uses spaces (` `) - e.g., `professional plus`, `growth plus`

Shopify only supports 4 plans:
- `professional`
- `professional-plus`
- `growth-plus`
- `enterprise`

## Solution

We've created normalization functions in `backend/plans.js`:

### Functions

1. **`toShopifyPlanHandle(planKey)`** - Convert our format → Shopify format
   ```javascript
   toShopifyPlanHandle('professional plus') // Returns: 'professional-plus'
   toShopifyPlanHandle('growth plus') // Returns: 'growth-plus'
   toShopifyPlanHandle('professional') // Returns: 'professional'
   toShopifyPlanHandle('enterprise') // Returns: 'enterprise'
   ```

2. **`fromShopifyPlanHandle(shopifyHandle)`** - Convert Shopify format → our format
   ```javascript
   fromShopifyPlanHandle('professional-plus') // Returns: 'professional plus'
   fromShopifyPlanHandle('growth-plus') // Returns: 'growth plus'
   fromShopifyPlanHandle('professional') // Returns: 'professional'
   fromShopifyPlanHandle('enterprise') // Returns: 'enterprise'
   ```

3. **`resolvePlanKey(input)`** - Enhanced to handle Shopify format
   ```javascript
   resolvePlanKey('professional-plus') // Returns: 'professional plus'
   resolvePlanKey('growth-plus') // Returns: 'growth plus'
   resolvePlanKey('professional_plus') // Returns: 'professional plus'
   resolvePlanKey('professional plus') // Returns: 'professional plus'
   ```

## Where to Use

### When Sending Data to Shopify

If you need to send plan handle to Shopify (e.g., in API calls, Partner Dashboard):
```javascript
import { toShopifyPlanHandle } from '../plans.js';

const shopifyHandle = toShopifyPlanHandle(ourPlanKey);
// Use shopifyHandle when communicating with Shopify
```

### When Receiving Data from Shopify

If you receive plan handle from Shopify (e.g., webhooks, API responses):
```javascript
import { fromShopifyPlanHandle } from '../plans.js';

const ourPlanKey = fromShopifyPlanHandle(shopifyHandle);
// Use ourPlanKey in our internal system
```

### General Normalization

For any plan input (from user, database, API, etc.):
```javascript
import { resolvePlanKey } from '../plans.js';

const normalized = resolvePlanKey(anyPlanInput);
// normalized will always be in our internal format (with spaces)
```

## Current Usage

The normalization is already integrated in:
- `resolvePlanKey()` - Now handles Shopify format (`professional-plus`)
- All plan lookups use `resolvePlanKey()` which handles all formats

## Future Integration Points

If you need to integrate with Shopify APIs that use plan handles:
1. **Partner Dashboard API** - Use `toShopifyPlanHandle()` when sending
2. **Webhook payloads** - Use `fromShopifyPlanHandle()` when receiving
3. **GraphQL queries** - Use `toShopifyPlanHandle()` if plan handle is required

## Example

```javascript
import { toShopifyPlanHandle, fromShopifyPlanHandle, resolvePlanKey } from './plans.js';

// User selects plan in our UI
const userSelectedPlan = 'professional plus';

// Convert to Shopify format for API call
const shopifyHandle = toShopifyPlanHandle(userSelectedPlan);
// shopifyHandle = 'professional-plus'

// Receive plan from Shopify webhook
const shopifyPlan = 'professional-plus';
const ourPlan = fromShopifyPlanHandle(shopifyPlan);
// ourPlan = 'professional plus'

// Normalize any input
const normalized = resolvePlanKey('professional-plus');
// normalized = 'professional plus'
```

