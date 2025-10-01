# AI Search Simulation - Hybrid Approach

## Цел
Симулиране на реален AI bot crawling, като се използват internal APIs (bypass password protection) + external accessibility validation.

## Архитектура

### 1. Feature Mapping

```javascript
const QUESTION_FEATURE_MAP = {
  products: {
    feature: 'productsJson',
    endpoint: '/apps/new-ai-seo/ai/products.json',
    requiredPlan: 'Starter',
    fallbackMessage: 'Enable Products JSON Feed to allow AI bots to discover your products'
  },
  business: {
    feature: 'welcomePage',
    endpoint: '/apps/new-ai-seo/ai/welcome',
    requiredPlan: 'Growth',
    fallbackMessage: 'Enable AI Welcome Page to provide comprehensive business information to AI bots'
  },
  categories: {
    feature: 'collectionsJson',
    endpoint: '/apps/new-ai-seo/ai/collections.json',
    requiredPlan: 'Growth',
    fallbackMessage: 'Enable Collections JSON Feed to help AI bots understand your product categories'
  },
  contact: {
    feature: 'storeMetadata',
    endpoint: '/apps/new-ai-seo/ai/welcome',
    requiredPlan: 'Professional',
    fallbackMessage: 'Configure Store Metadata to provide contact information to AI bots'
  }
}
```

### 2. Main Flow

```javascript
async function simulateAICrawling(shop, questionType, req) {
  const featureConfig = QUESTION_FEATURE_MAP[questionType];
  
  // Step 1: Check plan eligibility
  const plan = await fetchPlan(shop, req.app);
  const planCheck = checkPlanEligibility(plan.plan, featureConfig.requiredPlan);
  
  if (!planCheck.eligible) {
    return {
      status: 'upgrade_required',
      message: `Upgrade to ${featureConfig.requiredPlan}+ to enable this feature`,
      currentPlan: plan.plan,
      requiredPlan: featureConfig.requiredPlan,
      action: {
        type: 'upgrade_plan',
        url: `/ai-seo/billing?shop=${shop}`
      }
    };
  }
  
  // Step 2: Check if feature is enabled
  const settings = await AIDiscoverySettings.findOne({ shop });
  const isEnabled = settings?.features?.[featureConfig.feature];
  
  if (!isEnabled) {
    return {
      status: 'feature_disabled',
      message: featureConfig.fallbackMessage,
      feature: featureConfig.feature,
      action: {
        type: 'enable_feature',
        url: `/ai-seo/settings?shop=${shop}#ai-discovery`
      }
    };
  }
  
  // Step 3: Fetch data internally (bypasses password)
  let internalData;
  try {
    internalData = await fetchDataInternal(shop, questionType, req.shopAccessToken);
  } catch (error) {
    return {
      status: 'error',
      message: 'Failed to fetch data from internal API',
      error: error.message
    };
  }
  
  // Step 4: Check if data exists
  if (!internalData || (Array.isArray(internalData) && internalData.length === 0)) {
    return {
      status: 'no_data',
      message: getNoDataMessage(questionType),
      action: {
        type: 'generate_data',
        description: getNoDataAction(questionType),
        url: getNoDataUrl(questionType, shop)
      }
    };
  }
  
  // Step 5: Validate external accessibility (non-blocking)
  const accessibilityCheck = await validateExternalAccess(shop, featureConfig.endpoint);
  
  // Step 6: Generate AI response
  const prompt = generatePrompt(questionType, {
    shop,
    data: internalData
  });
  
  const aiResponse = await callOpenRouter(prompt, internalData);
  
  return {
    status: 'success',
    aiResponse: aiResponse.content,
    metadata: {
      source: 'internal_api',
      itemCount: Array.isArray(internalData) ? internalData.length : 1,
      crawledAt: new Date().toISOString()
    },
    accessibility: accessibilityCheck
  };
}
```

### 3. Internal Data Fetching (Bypasses Password)

```javascript
async function fetchDataInternal(shop, questionType, accessToken) {
  const adminGraphql = new GraphQLClient(`https://${shop}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });
  
  switch (questionType) {
    case 'products':
      const productsQuery = `
        query {
          products(first: 20) {
            edges {
              node {
                id
                title
                description
                productType
                vendor
                tags
              }
            }
          }
        }
      `;
      const productsResult = await adminGraphql.request(productsQuery);
      return productsResult.products.edges;
      
    case 'categories':
      const collectionsQuery = `
        query {
          collections(first: 20) {
            edges {
              node {
                id
                title
                description
              }
            }
          }
        }
      `;
      const collectionsResult = await adminGraphql.request(collectionsQuery);
      return collectionsResult.collections.edges;
      
    case 'business':
    case 'contact':
      // Fetch store metadata from metafields
      const metadataQuery = `
        query {
          shop {
            name
            description
            metafield(namespace: "ai_seo_store", key: "seo_metadata") {
              value
            }
            organizationMetafield: metafield(namespace: "ai_seo_store", key: "organization_schema") {
              value
            }
            aiMetafield: metafield(namespace: "ai_seo_store", key: "ai_metadata") {
              value
            }
          }
        }
      `;
      const metadataResult = await adminGraphql.request(metadataQuery);
      return {
        shopName: metadataResult.shop.name,
        description: metadataResult.shop.description,
        seoMetadata: metadataResult.shop.metafield?.value ? JSON.parse(metadataResult.shop.metafield.value) : null,
        organizationSchema: metadataResult.shop.organizationMetafield?.value ? JSON.parse(metadataResult.shop.organizationMetafield.value) : null,
        aiMetadata: metadataResult.shop.aiMetafield?.value ? JSON.parse(metadataResult.shop.aiMetafield.value) : null
      };
  }
}
```

### 4. External Accessibility Check

```javascript
async function validateExternalAccess(shop, endpoint) {
  try {
    const url = `https://${shop}${endpoint}?shop=${shop}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(url, { 
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      return {
        accessible: true,
        message: '✅ AI bots can access this endpoint'
      };
    } else if (response.status === 401 || response.status === 403) {
      return {
        accessible: false,
        reason: 'password_protected',
        message: '⚠️ Store is password-protected. AI bots will be able to access after store launch.'
      };
    } else {
      return {
        accessible: false,
        reason: 'http_error',
        message: `⚠️ Endpoint returned ${response.status}. Check your settings.`
      };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        accessible: 'unknown',
        message: 'Accessibility check timed out'
      };
    }
    return {
      accessible: 'unknown',
      message: 'Could not verify external accessibility (network error)'
    };
  }
}
```

### 5. Helper Functions

```javascript
function getNoDataMessage(questionType) {
  switch (questionType) {
    case 'products':
      return 'No products found. AI bots won\'t be able to discover your products.';
    case 'categories':
      return 'No collections found. AI bots won\'t see your product categories.';
    case 'business':
      return 'No business information configured in Store Metadata.';
    case 'contact':
      return 'No contact information found in Store Metadata.';
  }
}

function getNoDataAction(questionType) {
  switch (questionType) {
    case 'products':
      return 'Go to Bulk Edit → Generate SEO for your products';
    case 'categories':
      return 'Go to Collections → Generate SEO for your collections';
    case 'business':
    case 'contact':
      return 'Go to Store Metadata and configure your business information';
  }
}

function getNoDataUrl(questionType, shop) {
  switch (questionType) {
    case 'products':
      return `/ai-seo/bulk-edit?shop=${shop}`;
    case 'categories':
      return `/ai-seo/collections?shop=${shop}`;
    case 'business':
    case 'contact':
      return `/ai-seo/store-metadata?shop=${shop}`;
  }
}
```

## Response Structure

### Success Response
```json
{
  "success": true,
  "status": "success",
  "aiResponse": "This store sells various products including...",
  "metadata": {
    "source": "internal_api",
    "itemCount": 15,
    "crawledAt": "2025-10-01T12:00:00Z"
  },
  "accessibility": {
    "accessible": false,
    "reason": "password_protected",
    "message": "⚠️ Store is password-protected. AI bots will access after store launch."
  }
}
```

### Feature Disabled Response
```json
{
  "success": false,
  "status": "feature_disabled",
  "message": "Enable Products JSON Feed to allow AI bots to discover your products",
  "feature": "productsJson",
  "action": {
    "type": "enable_feature",
    "url": "/ai-seo/settings?shop=...#ai-discovery"
  }
}
```

### Upgrade Required Response
```json
{
  "success": false,
  "status": "upgrade_required",
  "message": "Upgrade to Growth+ to enable this feature",
  "currentPlan": "Starter",
  "requiredPlan": "Growth",
  "action": {
    "type": "upgrade_plan",
    "url": "/ai-seo/billing?shop=..."
  }
}
```

### No Data Response
```json
{
  "success": false,
  "status": "no_data",
  "message": "No products found. AI bots won't be able to discover your products.",
  "action": {
    "type": "generate_data",
    "description": "Go to Bulk Edit → Generate SEO for your products",
    "url": "/ai-seo/bulk-edit?shop=..."
  }
}
```

## Frontend Implementation

### SchemaData.jsx Updates

```jsx
// Handle different response statuses
if (response.status === 'success') {
  setAiSimulationResponse(response.aiResponse);
  
  // Show accessibility warning if needed
  if (response.accessibility && !response.accessibility.accessible) {
    setAccessibilityWarning(response.accessibility.message);
  }
  
} else if (response.status === 'feature_disabled') {
  setShowFeatureDisabledBanner(response);
  
} else if (response.status === 'upgrade_required') {
  setShowUpgradeModal(response);
  
} else if (response.status === 'no_data') {
  setShowNoDataWarning(response);
  
} else {
  setError(response.message);
}
```

### UI Components

```jsx
// Feature Disabled Banner
{showFeatureDisabledBanner && (
  <Banner tone="warning" 
    title="Feature Disabled"
    action={{
      content: 'Enable in Settings',
      url: showFeatureDisabledBanner.action.url
    }}
  >
    {showFeatureDisabledBanner.message}
  </Banner>
)}

// Upgrade Required Modal
{showUpgradeModal && (
  <Modal
    open
    title="Upgrade Required"
    onClose={() => setShowUpgradeModal(null)}
    primaryAction={{
      content: `Upgrade to ${showUpgradeModal.requiredPlan}`,
      url: showUpgradeModal.action.url
    }}
  >
    <Modal.Section>
      <Text>{showUpgradeModal.message}</Text>
      <Text variant="bodySm" tone="subdued">
        Current plan: {showUpgradeModal.currentPlan}
      </Text>
    </Modal.Section>
  </Modal>
)}

// No Data Warning
{showNoDataWarning && (
  <Banner tone="info"
    title="No Data Available"
    action={{
      content: 'Generate Data',
      url: showNoDataWarning.action.url
    }}
  >
    {showNoDataWarning.message}
    <Text variant="bodySm" tone="subdued">
      {showNoDataWarning.action.description}
    </Text>
  </Banner>
)}

// Accessibility Warning
{accessibilityWarning && (
  <Banner tone="info">
    <Text>{accessibilityWarning}</Text>
  </Banner>
)}
```

## Предимства

1. ✅ **Работи на password-protected stores** - използва internal API
2. ✅ **Показва реални данни** - от същите sources като AI endpoints
3. ✅ **Plan-aware** - upselling за disabled features
4. ✅ **Actionable warnings** - казва какво да направят
5. ✅ **Validates accessibility** - показва warning за password-protected
6. ✅ **Тества структурата** - дали данните са налични
7. ✅ **User-friendly** - ясни съобщения и действия

## Имплементация стъпки

1. Refactor `aiSimulationController.js`:
   - Добави `QUESTION_FEATURE_MAP`
   - Имплементирай `simulateAICrawling`
   - Добави `fetchDataInternal`
   - Добави `validateExternalAccess`
   - Добави helper functions

2. Update `SchemaData.jsx`:
   - Добави state за различните статуси
   - Имплементирай UI components за всеки статус
   - Handle response statuses

3. Testing:
   - Test с disabled features
   - Test с различни планове
   - Test с no data scenarios
   - Test на password-protected store
   - Test external accessibility на live store

