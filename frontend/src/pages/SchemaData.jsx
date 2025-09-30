// frontend/src/pages/SchemaData.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Box,
  Text,
  Button,
  InlineStack,
  Banner,
  Link,
  Toast,
  BlockStack,
  Tabs,
  TextField,
  Spinner,
  Badge,
  List,
  Divider
} from '@shopify/polaris';
import { makeSessionFetch } from '../lib/sessionFetch.js';

const qs = (k, d = '') => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };

export default function SchemaData({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  
  console.log('[SCHEMA-DATA] shopProp:', shopProp);
  console.log('[SCHEMA-DATA] qs("shop"):', qs('shop', ''));
  console.log('[SCHEMA-DATA] final shop:', shop);
  console.log('[SCHEMA-DATA] window.location.search:', window.location.search);
  
  const [selectedTab, setSelectedTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [schemas, setSchemas] = useState({
    organization: null,
    website: null,
    products: []
  });
  const [toastContent, setToastContent] = useState('');
  const api = useMemo(() => makeSessionFetch(), []);
  const [schemaScript, setSchemaScript] = useState('');
  const [currentPlan, setCurrentPlan] = useState(null);

  useEffect(() => {
    if (shop) {
      loadSchemas();
      loadPlan();
    }
  }, [shop, api]);

  const loadPlan = async () => {
    try {
      const url = `/api/plans/me?shop=${encodeURIComponent(shop)}`;
      const data = await api(url, { headers: { 'X-Shop': shop } });
      setCurrentPlan(data.plan);
    } catch (err) {
      console.error('[SCHEMA-DATA] Error loading plan:', err);
    }
  };

  // Plan-based feature availability
  const isFeatureAvailable = (feature) => {
    if (!currentPlan) return false;
    
    const planHierarchy = ['Starter', 'Professional', 'Growth', 'Growth Extra', 'Enterprise'];
    const currentPlanIndex = planHierarchy.indexOf(currentPlan);
    
    switch (feature) {
      case 'productsJson':
        return currentPlanIndex >= 0; // All plans
      case 'welcomePage':
        return currentPlanIndex >= 2; // Growth+
      case 'collectionsJson':
        return currentPlanIndex >= 2; // Growth+
      case 'aiSitemap':
        return currentPlanIndex >= 3; // Growth Extra+
      case 'schemaData':
        return currentPlanIndex >= 4; // Enterprise
      default:
        return false;
    }
  };

  const getRequiredPlan = (feature) => {
    switch (feature) {
      case 'productsJson': return 'Starter';
      case 'welcomePage': return 'Growth';
      case 'collectionsJson': return 'Growth';
      case 'aiSitemap': return 'Growth Extra';
      case 'schemaData': return 'Enterprise';
      default: return 'Starter';
    }
  };

  const loadSchemas = async () => {
    setLoading(true);
    try {
      console.log('[SCHEMA-DATA] loadSchemas - shop:', shop);
      const url = `/api/schema/preview?shop=${encodeURIComponent(shop)}`;
      console.log('[SCHEMA-DATA] loadSchemas - url:', url);
      const data = await api(url, { headers: { 'X-Shop': shop } });
      console.log('[SCHEMA-DATA] loadSchemas - response:', data);
      if (data.ok) {
        setSchemas(data.schemas);
        generateSchemaScript(data.schemas);
      } else {
        setToastContent(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error('[SCHEMA-DATA] loadSchemas - error:', err);
      setToastContent(`Failed to load schemas: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const generateSchemaScript = (schemaData) => {
    const allSchemas = [];
    
    if (schemaData.organization) {
      allSchemas.push(schemaData.organization);
    }
    
    if (schemaData.website) {
      allSchemas.push(schemaData.website);
    }
    
    // For products, we'll show instructions to use dynamic generation
    const script = `<script type="application/ld+json">
${JSON.stringify(allSchemas, null, 2)}
</script>`;
    
    setSchemaScript(script);
  };

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      console.log('[SCHEMA-DATA] handleRegenerate - shop:', shop);
      const url = `/api/schema/generate?shop=${encodeURIComponent(shop)}`;
      console.log('[SCHEMA-DATA] handleRegenerate - url:', url);
      const data = await api(url, {
        method: 'POST',
        headers: { 'X-Shop': shop },
        body: { shop }
      });
      console.log('[SCHEMA-DATA] handleRegenerate - response:', data);
      if (data.ok) {
        setToastContent('Schemas regenerated successfully!');
        loadSchemas();
      } else {
        setToastContent(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error('[SCHEMA-DATA] handleRegenerate - error:', err);
      setToastContent(`Failed to regenerate: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'overview', content: 'Overview', accessibilityLabel: 'Overview' },
    { id: 'installation', content: 'Installation', accessibilityLabel: 'Installation' },
    { id: 'ai-testing', content: 'AI Testing', accessibilityLabel: 'AI Testing' }
  ];

  if (loading) {
    return (
      <Card>
        <Box padding="400">
          <BlockStack gap="400" align="center">
            <Spinner />
            <Text>Loading schema data...</Text>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">Schema.org Structured Data</Text>
            
            <Banner tone="info">
              <Text>Schema.org structured data helps AI models understand your store content better, improving your visibility and search results.</Text>
            </Banner>

            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              {selectedTab === 0 && (
                <Box paddingBlockStart="400">
                  <BlockStack gap="400">
                    {/* Organization Schema */}
                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text as="h4" variant="headingSm">Organization Schema</Text>
                            <Badge tone={schemas.organization ? 'success' : 'warning'}>
                              {schemas.organization ? 'Active' : 'Not configured'}
                            </Badge>
                          </InlineStack>
                          
                          {!schemas.organization && (
                            <Text as="p" tone="subdued">
                              Configure organization details in Store Metadata to enable this schema.
                            </Text>
                          )}
                        </BlockStack>
                      </Box>
                    </Card>

                    {/* Website Schema */}
                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text as="h4" variant="headingSm">WebSite Schema</Text>
                            <Badge tone={schemas.website ? 'success' : 'warning'}>
                              {schemas.website ? 'Active' : 'Not configured'}
                            </Badge>
                          </InlineStack>
                          
                          {!schemas.website && (
                            <Text as="p" tone="subdued">
                              Website schema is automatically generated from your store information.
                            </Text>
                          )}
                        </BlockStack>
                      </Box>
                    </Card>

                    {/* Product Schema Info */}
                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text as="h4" variant="headingSm">Product Schemas</Text>
                            <Badge tone="success">Auto-generated</Badge>
                          </InlineStack>
                          
                          <Text tone="subdued">
                            Product schemas are automatically generated from your AI Optimisation data when pages load.
                            {schemas.products.length > 0 && ` ${schemas.products.length} products have SEO data.`}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Card>

                    <InlineStack gap="300">
                      <Button onClick={handleRegenerate} loading={loading}>
                        Regenerate Schemas
                      </Button>
                      <Button variant="plain" url="https://developers.google.com/search/docs/appearance/structured-data">
                        Learn about Schema.org
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              )}

              {selectedTab === 1 && (
                <Box paddingBlockStart="400">
                  <BlockStack gap="400">
                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <Text as="h4" variant="headingSm">Theme Installation</Text>
                          
                          <List type="number">
                            <List.Item>
                              Go to your Shopify Admin → Online Store → Themes
                            </List.Item>
                            <List.Item>
                              Click "Actions" → "Edit code" on your current theme
                            </List.Item>
                            <List.Item>
                              Open the file: <code>layout/theme.liquid</code>
                            </List.Item>
                            <List.Item>
                              Add this code before the closing <code>&lt;/head&gt;</code> tag:
                            </List.Item>
                          </List>

                          <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                            <pre style={{ fontSize: '12px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
{`{% comment %} Organization & WebSite Schema - AI SEO App {% endcomment %}
${schemaScript}

{% comment %} Product Schema - Dynamic {% endcomment %}
{% if template contains 'product' %}
  {% assign seo_bullets = product.metafields.seo_ai.bullets %}
  {% assign seo_faq = product.metafields.seo_ai.faq %}
  {% assign seo_data = product.metafields.seo_ai['seo__' | append: request.locale.iso_code] | default: product.metafields.seo_ai.seo__en %}
  
  {% if seo_data %}
    <script type="application/ld+json">
    {{ seo_data.jsonLd | json }}
    </script>
  {% endif %}
{% endif %}`}
                            </pre>
                          </Box>

                          <Banner tone="warning">
                            <Text>Always backup your theme before making changes!</Text>
                          </Banner>
                        </BlockStack>
                      </Box>
                    </Card>

                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <Text as="h4" variant="headingSm">Testing Your Installation</Text>
                          
                          <List>
                            <List.Item>
                              After installation, visit your store's homepage and product pages
                            </List.Item>
                            <List.Item>
                              View the page source (right-click → View Source)
                            </List.Item>
                            <List.Item>
                              Search for <code>application/ld+json</code> to find your schemas
                            </List.Item>
                            <List.Item>
                              Use the Validation tab to test with Google's tools
                            </List.Item>
                          </List>
                        </BlockStack>
                      </Box>
                    </Card>
                  </BlockStack>
                </Box>
              )}

              {selectedTab === 2 && (
                <Box paddingBlockStart="400">
                  <BlockStack gap="400">
                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <Text as="h4" variant="headingSm">AI Search Testing Tools</Text>
                          
                          <TextField
                            label="Test URL"
                            value={`https://${shop}`}
                            readOnly
                            helpText="Use this URL to test how AI bots understand your store"
                          />

                          <Divider />

                          <BlockStack gap="200">
                            <InlineStack align="space-between">
                              <Text>Perplexity AI Search</Text>
                              <Button
                                url={`https://www.perplexity.ai/search?q=What+products+does+${shop}+sell%3F+Tell+me+about+this+business+and+what+they+offer`}
                                external
                                variant="plain"
                              >
                                Test with Prompt
                              </Button>
                            </InlineStack>

                            <InlineStack align="space-between">
                              <Text>ChatGPT Web Search</Text>
                              <Button
                                url={`https://chat.openai.com/`}
                                external
                                variant="plain"
                              >
                                Test with Prompt
                              </Button>
                            </InlineStack>

                            <InlineStack align="space-between">
                              <Text>Claude AI Search</Text>
                              <Button
                                url={`https://claude.ai/`}
                                external
                                variant="plain"
                              >
                                Test with Prompt
                              </Button>
                            </InlineStack>

                            <InlineStack align="space-between">
                              <Text>Gemini AI Search</Text>
                              <Button
                                url={`https://gemini.google.com/`}
                                external
                                variant="plain"
                              >
                                Test with Prompt
                              </Button>
                            </InlineStack>
                          </BlockStack>
                          
                          <Banner tone="info">
                            <Text>
                              <strong>Pre-filled prompts:</strong> Click "Test with Prompt" to open AI tools with pre-filled questions about your store. 
                              For ChatGPT, Claude, and Gemini, copy this prompt: "What products does {shop} sell? Tell me about this business and what they offer."
                            </Text>
                          </Banner>
                        </BlockStack>
                      </Box>
                    </Card>

                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <Text as="h4" variant="headingSm">AI Bot Access Check</Text>
                          
                          <InlineStack align="space-between">
                            <Text>Test Products JSON Feed</Text>
                            {isFeatureAvailable('productsJson') ? (
                              <Button
                                url={`https://${shop}/apps/new-ai-seo/ai/products.json`}
                                external
                                variant="plain"
                              >
                                View
                              </Button>
                            ) : (
                              <Button disabled variant="plain">
                                {getRequiredPlan('productsJson')}+ Required
                              </Button>
                            )}
                          </InlineStack>
                          
                          <InlineStack align="space-between">
                            <Text>Test AI Welcome Page</Text>
                            {isFeatureAvailable('welcomePage') ? (
                              <Button
                                url={`https://${shop}/apps/new-ai-seo/ai/welcome`}
                                external
                                variant="plain"
                              >
                                View
                              </Button>
                            ) : (
                              <Button disabled variant="plain">
                                {getRequiredPlan('welcomePage')}+ Required
                              </Button>
                            )}
                          </InlineStack>
                          
                          <InlineStack align="space-between">
                            <Text>Test Collections JSON Feed</Text>
                            {isFeatureAvailable('collectionsJson') ? (
                              <Button
                                url={`https://${shop}/apps/new-ai-seo/ai/collections.json`}
                                external
                                variant="plain"
                              >
                                View
                              </Button>
                            ) : (
                              <Button disabled variant="plain">
                                {getRequiredPlan('collectionsJson')}+ Required
                              </Button>
                            )}
                          </InlineStack>
                          
                          <Banner tone="success">
                            <Text>
                              <strong>AI bots can access these endpoints</strong> to understand your store structure, 
                              products, and business information. This helps them provide better answers about your business.
                            </Text>
                          </Banner>
                        </BlockStack>
                      </Box>
                    </Card>
                  </BlockStack>
                </Box>
              )}
            </Tabs>
          </BlockStack>
        </Box>
      </Card>

      {toastContent && (
        <Toast content={toastContent} onDismiss={() => setToastContent('')} />
      )}
    </>
  );
}