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
  const [validationResults, setValidationResults] = useState(null);
  const [toastContent, setToastContent] = useState('');
  const api = useMemo(() => makeSessionFetch(), []);
  const [schemaScript, setSchemaScript] = useState('');

  useEffect(() => {
    if (shop) {
      loadSchemas();
    }
  }, [shop, api]);

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

  const handleValidate = async () => {
    setLoading(true);
    try {
      console.log('[SCHEMA-DATA] handleValidate - shop:', shop);
      const url = `/api/schema/validate?shop=${encodeURIComponent(shop)}`;
      console.log('[SCHEMA-DATA] handleValidate - url:', url);
      const data = await api(url, { headers: { 'X-Shop': shop } });
      console.log('[SCHEMA-DATA] handleValidate - response:', data);
      setValidationResults(data);
      setToastContent(data.ok ? 'Validation complete!' : 'Validation found issues');
    } catch (err) {
      console.error('[SCHEMA-DATA] handleValidate - error:', err);
      setToastContent(`Validation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
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
    { id: 'validation', content: 'Validation', accessibilityLabel: 'Validation' }
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
                          <Text as="h4" variant="headingSm">Validation Tools</Text>
                          
                          <TextField
                            label="Test URL"
                            value={`https://${shop}`}
                            readOnly
                            helpText="Use this URL to test your schemas in the tools below"
                          />

                          <Divider />

                          <BlockStack gap="200">
                            <InlineStack align="space-between">
                              <Text>Google Rich Results Test</Text>
                              <Button
                                url={`https://search.google.com/test/rich-results?url=${encodeURIComponent(`https://${shop}`)}`}
                                external
                                variant="plain"
                              >
                                Open Tool
                              </Button>
                            </InlineStack>

                            <InlineStack align="space-between">
                              <Text>Schema Markup Validator</Text>
                              <Button
                                url={`https://validator.schema.org/#url=${encodeURIComponent(`https://${shop}`)}`}
                                external
                                variant="plain"
                              >
                                Open Tool
                              </Button>
                            </InlineStack>

                            <InlineStack align="space-between">
                              <Text>Google Search Console</Text>
                              <Button
                                url="https://search.google.com/search-console"
                                external
                                variant="plain"
                              >
                                Open Console
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </BlockStack>
                      </Box>
                    </Card>

                    {validationResults && (
                      <Card>
                        <Box padding="300">
                          <BlockStack gap="300">
                            <Text as="h4" variant="headingSm">Internal Validation Results</Text>
                            
                            <Badge tone={validationResults.ok ? 'success' : 'warning'}>
                              {validationResults.ok ? 'All checks passed' : 'Issues found'}
                            </Badge>

                            {validationResults.checks && (
                              <BlockStack gap="200">
                                <List>
                                  <List.Item>
                                    <InlineStack gap="200" align="space-between">
                                      <InlineStack gap="200">
                                        <Text>hasStoreMetadata:</Text>
                                        <Badge tone={validationResults.checks.hasStoreMetadata ? 'success' : 'critical'}>
                                          {validationResults.checks.hasStoreMetadata ? '✓' : '✗'}
                                        </Badge>
                                      </InlineStack>
                                      {!validationResults.checks.hasStoreMetadata && (
                                        <Button 
                                          size="slim" 
                                          variant="plain"
                                          onClick={() => {
                                            setSelectedTab(0);
                                            setTimeout(() => {
                                              const storeTab = document.querySelector('[id="store-metadata"]');
                                              if (storeTab) storeTab.click();
                                            }, 100);
                                          }}
                                        >
                                          Add store metadata →
                                        </Button>
                                      )}
                                    </InlineStack>
                                  </List.Item>
                                  
                                  <List.Item>
                                    <InlineStack gap="200" align="space-between">
                                      <InlineStack gap="200">
                                        <Text>hasProductsWithSEO:</Text>
                                        <Badge tone={validationResults.checks.hasProductsWithSEO ? 'success' : 'critical'}>
                                          {validationResults.checks.hasProductsWithSEO ? '✓' : '✗'}
                                        </Badge>
                                      </InlineStack>
                                      {!validationResults.checks.hasProductsWithSEO && (
                                        <Button 
                                          size="slim" 
                                          variant="plain"
                                          onClick={() => {
                                            setSelectedTab(0);
                                            setTimeout(() => {
                                              const productsTab = document.querySelector('[id="products"]');
                                              if (productsTab) productsTab.click();
                                            }, 100);
                                          }}
                                        >
                                          Generate product SEO →
                                        </Button>
                                      )}
                                    </InlineStack>
                                  </List.Item>
                                  
                                  <List.Item>
                                    <InlineStack gap="200">
                                      <Text>hasThemeInstallation:</Text>
                                      <Badge tone={validationResults.checks.hasThemeInstallation === 'manual_check_required' ? 'info' : 'success'}>
                                        {validationResults.checks.hasThemeInstallation === 'manual_check_required' ? '?' : '✓'}
                                      </Badge>
                                      <Text tone="subdued" variant="bodySm">Manual check required</Text>
                                    </InlineStack>
                                  </List.Item>
                                  
                                  <List.Item>
                                    <InlineStack gap="200">
                                      <Text>hasValidSchemas:</Text>
                                      <Badge tone={validationResults.checks.hasValidSchemas ? 'success' : 'critical'}>
                                        {validationResults.checks.hasValidSchemas ? '✓' : '✗'}
                                      </Badge>
                                    </InlineStack>
                                  </List.Item>
                                </List>
                                
                                {!validationResults.checks.hasStoreMetadata && (
                                  <Banner tone="warning">
                                    <Text>Missing store metadata. This is needed for Organization schema.</Text>
                                  </Banner>
                                )}
                                
                                {!validationResults.checks.hasProductsWithSEO && (
                                  <Banner tone="warning">
                                    <Text>No products have Optimisation data. Generate AI Optimisation for products first.</Text>
                                  </Banner>
                                )}
                              </BlockStack>
                            )}
                          </BlockStack>
                        </Box>
                      </Card>
                    )}

                    <Button onClick={handleValidate} loading={loading} variant="primary">
                      Run Validation Check
                    </Button>
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