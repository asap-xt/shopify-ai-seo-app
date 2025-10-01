# AI Search Simulation - Standard Approach (Real Crawling)

## Цел
Пълна симулация на реален AI bot crawling чрез fetch-ване на данни от external AI endpoints (както би направил истински AI bot).

## Архитектура

### 1. Feature Mapping (същото като hybrid)

```javascript
const QUESTION_FEATURE_MAP = {
  products: {
    feature: 'productsJson',
    endpoint: '/apps/new-ai-seo/ai/products.json',
    requiredPlan: 'Starter'
  },
  business: {
    feature: 'welcomePage',
    endpoint: '/apps/new-ai-seo/ai/welcome',
    requiredPlan: 'Growth'
  },
  categories: {
    feature: 'collectionsJson',
    endpoint: '/apps/new-ai-seo/ai/collections.json',
    requiredPlan: 'Growth'
  },
  contact: {
    feature: 'storeMetadata',
    endpoint: '/apps/new-ai-seo/ai/welcome',
    requiredPlan: 'Professional'
  }
}
```

### 2. Main Flow (Pure External Crawling)

```javascript
async function simulateAICrawling(shop, questionType) {
  const featureConfig = QUESTION_FEATURE_MAP[questionType];
  
  // Step 1: Check plan eligibility (same as hybrid)
  const plan = await fetchPlan(shop);
  const planCheck = checkPlanEligibility(plan.plan, featureConfig.requiredPlan);
  
  if (!planCheck.eligible) {
    return {
      status: 'upgrade_required',
      // ... same as hybrid
    };
  }
  
  // Step 2: Check if feature is enabled (same as hybrid)
  const settings = await AIDiscoverySettings.findOne({ shop });
  const isEnabled = settings?.features?.[featureConfig.feature];
  
  if (!isEnabled) {
    return {
      status: 'feature_disabled',
      // ... same as hybrid
    };
  }
  
  // Step 3: Try to fetch data from EXTERNAL AI endpoint (real crawling)
  try {
    const url = `https://${shop}${featureConfig.endpoint}?shop=${shop}`;
    console.log(`[AI-SIMULATION] Crawling external endpoint: ${url}`);
    
    const response = await fetch(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'AI-Search-Bot-Simulator/1.0'
      }
    });
    
    if (!response.ok) {
      return {
        status: 'endpoint_error',
        message: 'AI endpoint returned an error. This may indicate a configuration issue.',
        statusCode: response.status,
        endpoint: featureConfig.endpoint,
        action: {
          type: 'check_settings',
          description: 'Check your AI Discovery settings or contact support',
          url: `/ai-seo/settings?shop=${shop}`
        }
      };
    }
    
    // Step 4: Parse data based on content type
    const data = await parseEndpointData(response, questionType);
    
    if (!data || (Array.isArray(data) && data.length === 0)) {
      return {
        status: 'no_data',
        message: getNoDataMessage(questionType),
        action: getNoDataAction(questionType)
      };
    }
    
    // Step 5: Generate AI response
    const prompt = generatePrompt(questionType, { shop, data });
    const aiResponse = await callOpenRouter(prompt, data);
    
    return {
      status: 'success',
      aiResponse: aiResponse.content,
      metadata: {
        source: featureConfig.endpoint,
        crawledFrom: url,
        itemCount: Array.isArray(data) ? data.length : 1,
        crawledAt: new Date().toISOString()
      }
    };
    
  } catch (error) {
    if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
      return {
        status: 'timeout',
        message: 'AI endpoint request timed out',
        action: {
          type: 'check_settings',
          description: 'Check if your store is accessible and endpoints are configured correctly'
        }
      };
    }
    
    return {
      status: 'fetch_error',
      message: 'Failed to fetch data from AI endpoint',
      error: error.message,
      action: {
        type: 'check_settings',
        description: 'Verify your AI Discovery settings'
      }
    };
  }
}
```

### 3. Data Parsing

```javascript
async function parseEndpointData(response, questionType) {
  const contentType = response.headers.get('content-type');
  
  if (contentType?.includes('application/json')) {
    const json = await response.json();
    
    // Products/Collections JSON feed
    if (questionType === 'products' || questionType === 'categories') {
      return json; // Direct JSON array
    }
    
    return json;
    
  } else if (contentType?.includes('text/html')) {
    const html = await response.text();
    
    // Extract structured data from HTML (Welcome Page)
    return extractStructuredDataFromHTML(html);
    
  } else if (contentType?.includes('application/xml')) {
    const xml = await response.text();
    
    // Parse XML to JSON (Sitemap)
    return parseXMLToJSON(xml);
  }
  
  return null;
}

function extractStructuredDataFromHTML(html) {
  // Find all JSON-LD script tags
  const jsonLdRegex = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
  const matches = [...html.matchAll(jsonLdRegex)];
  
  const structuredData = {
    organization: null,
    website: null,
    breadcrumbs: null,
    faq: null
  };
  
  for (const match of matches) {
    try {
      const data = JSON.parse(match[1]);
      
      if (data['@type'] === 'Organization') {
        structuredData.organization = data;
      } else if (data['@type'] === 'WebSite') {
        structuredData.website = data;
      } else if (data['@type'] === 'BreadcrumbList') {
        structuredData.breadcrumbs = data;
      } else if (data['@type'] === 'FAQPage') {
        structuredData.faq = data;
      }
    } catch (error) {
      console.error('[PARSE-HTML] Error parsing JSON-LD:', error);
    }
  }
  
  return structuredData;
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
    "source": "/apps/new-ai-seo/ai/products.json",
    "crawledFrom": "https://shop.myshopify.com/apps/new-ai-seo/ai/products.json?shop=shop.myshopify.com",
    "itemCount": 15,
    "crawledAt": "2025-10-01T12:00:00Z"
  }
}
```

### Endpoint Error Response
```json
{
  "success": false,
  "status": "endpoint_error",
  "message": "AI endpoint returned 404. This may indicate a configuration issue.",
  "statusCode": 404,
  "endpoint": "/apps/new-ai-seo/ai/products.json",
  "action": {
    "type": "check_settings",
    "description": "Check your AI Discovery settings or contact support",
    "url": "/ai-seo/settings?shop=..."
  }
}
```

### Timeout Response
```json
{
  "success": false,
  "status": "timeout",
  "message": "AI endpoint request timed out",
  "action": {
    "type": "check_settings",
    "description": "Check if your store is accessible and endpoints are configured correctly"
  }
}
```

### Fetch Error Response
```json
{
  "success": false,
  "status": "fetch_error",
  "message": "Failed to fetch data from AI endpoint",
  "error": "Network error details...",
  "action": {
    "type": "check_settings",
    "description": "Verify your AI Discovery settings"
  }
}
```

## Frontend Implementation

### SchemaData.jsx Updates

```jsx
// Handle different response statuses
if (response.status === 'success') {
  setAiSimulationResponse(response.aiResponse);
  
  // Show metadata about the crawl
  setSimulationMetadata({
    source: response.metadata.source,
    itemCount: response.metadata.itemCount,
    crawledAt: response.metadata.crawledAt
  });
  
} else if (response.status === 'endpoint_error') {
  setShowEndpointErrorBanner(response);
  
} else if (response.status === 'timeout') {
  setShowTimeoutBanner(response);
  
} else if (response.status === 'fetch_error') {
  setShowFetchErrorBanner(response);
  
} else if (response.status === 'feature_disabled') {
  setShowFeatureDisabledBanner(response);
  
} else if (response.status === 'upgrade_required') {
  setShowUpgradeModal(response);
  
} else if (response.status === 'no_data') {
  setShowNoDataWarning(response);
}
```

### UI Components

```jsx
// Endpoint Error Banner
{showEndpointErrorBanner && (
  <Banner tone="critical"
    title="Endpoint Error"
    action={{
      content: 'Check Settings',
      url: showEndpointErrorBanner.action.url
    }}
  >
    {showEndpointErrorBanner.message}
    <Text variant="bodySm" tone="subdued">
      Status: {showEndpointErrorBanner.statusCode}
    </Text>
    <Text variant="bodySm" tone="subdued">
      Endpoint: {showEndpointErrorBanner.endpoint}
    </Text>
  </Banner>
)}

// Timeout Banner
{showTimeoutBanner && (
  <Banner tone="warning"
    title="Request Timeout"
  >
    {showTimeoutBanner.message}
    <Text variant="bodySm" tone="subdued">
      {showTimeoutBanner.action.description}
    </Text>
  </Banner>
)}

// Fetch Error Banner
{showFetchErrorBanner && (
  <Banner tone="critical"
    title="Fetch Error"
  >
    {showFetchErrorBanner.message}
    <Text variant="bodySm" tone="subdued">
      Error: {showFetchErrorBanner.error}
    </Text>
  </Banner>
)}

// Success - Show Simulation Metadata
{simulationMetadata && (
  <Box paddingBlockStart="400">
    <Text variant="bodySm" tone="subdued">
      Crawled from: {simulationMetadata.source}
    </Text>
    <Text variant="bodySm" tone="subdued">
      Items found: {simulationMetadata.itemCount}
    </Text>
    <Text variant="bodySm" tone="subdued">
      Crawled at: {new Date(simulationMetadata.crawledAt).toLocaleString()}
    </Text>
  </Box>
)}
```

## Предимства

1. ✅ **Истинска симулация** - точно това, което AI ботът вижда
2. ✅ **Тества реални endpoints** - открива проблеми в конфигурацията
3. ✅ **Validates full flow** - от request до response
4. ✅ **Real-world testing** - тества accessibility, performance, errors
5. ✅ **Educational** - показва как AI ботовете crawl-ват

## Недостатъци

1. ❌ **Не работи на password-protected stores** - 401/403 errors
2. ❌ **По-бавно** - HTTP overhead
3. ❌ **Depends on external factors** - network, store status, proxy config
4. ❌ **Може да fail на dev environment** - ако endpoints не са accessible

## Кога да използваме Standard Approach

- ✅ **Production stores** (без password protection)
- ✅ **Final testing** преди launch
- ✅ **Debugging endpoint issues** - виждаш какво AI ботовете виждат
- ✅ **Performance testing** - измерваш response time

## Кога да използваме Hybrid Approach

- ✅ **Development stores** (с password protection)
- ✅ **Fast development** - по-бързо без external requests
- ✅ **Testing на различни stores** - работи навсякъде
- ✅ **Data validation** - фокус на структурата, не на accessibility

## Имплементация стъпки

1. Refactor `aiSimulationController.js`:
   - Имплементирай `simulateAICrawling` с external fetch
   - Добави `parseEndpointData`
   - Добави `extractStructuredDataFromHTML`
   - Добави `parseXMLToJSON` (optional)
   - Handle timeout и network errors

2. Update `SchemaData.jsx`:
   - Добави state за различните error статуси
   - Имплементирай error UI components
   - Show crawl metadata

3. Testing:
   - Test на live store без password
   - Test с различни endpoint errors (404, 500, timeout)
   - Test с broken endpoints
   - Measure performance

