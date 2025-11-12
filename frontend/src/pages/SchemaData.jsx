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
  Divider,
  Modal
} from '@shopify/polaris';
import { makeSessionFetch } from '../lib/sessionFetch.js';
import { PLAN_HIERARCHY, getPlanIndex } from '../hooks/usePlanHierarchy.js';

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
      const query = `
        query PlansMe($shop:String!) {
          plansMe(shop:$shop) {
            shop
            plan
            planKey
          }
        }
      `;
      
      const data = await api('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { shop } })
      });
      
      console.log('[SCHEMA-DATA] Plan data:', data);
      setCurrentPlan(data?.data?.plansMe?.plan);
    } catch (err) {
      console.error('[SCHEMA-DATA] Error loading plan:', err);
    }
  };

  // Plan-based feature availability
  const isFeatureAvailable = (feature) => {
    console.log('[SCHEMA-DATA] isFeatureAvailable - currentPlan:', currentPlan);
    console.log('[SCHEMA-DATA] isFeatureAvailable - feature:', feature);
    
    if (!currentPlan) {
      console.log('[SCHEMA-DATA] No current plan, returning false');
      return false;
    }
    
    const currentPlanIndex = getPlanIndex(currentPlan);
    
    console.log('[SCHEMA-DATA] Plan hierarchy:', PLAN_HIERARCHY);
    console.log('[SCHEMA-DATA] Current plan index:', currentPlanIndex);
    
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



  const runBasicSimulation = async (questionType) => {
    let response = '';
    
    switch (questionType) {
      case 'products':
        // Fetch real products data
        const productsData = await api(`/api/products/list?shop=${shop}&limit=5&optimized=true`, { headers: { 'X-Shop': shop } });
        if (productsData?.products && productsData.products.length > 0) {
          const productTitles = productsData.products.slice(0, 3).map(p => p.title).join(', ');
          response = `Based on the structured data, ${shop} sells ${productsData.products.length} optimized products including: ${productTitles}${productsData.products.length > 3 ? ' and more.' : '.'}`;
        } else {
          response = `I can see that ${shop} is a store, but I don't have detailed product information available in the structured data. The store may need to generate AI optimization data for their products.`;
        }
        break;
        
      case 'business':
        // Try to fetch Store Metadata first
        try {
          const storeMetadataData = await api(`/api/store/metadata?shop=${shop}`, { headers: { 'X-Shop': shop } });
          if (storeMetadataData?.seoMetadata) {
            const seoData = JSON.parse(storeMetadataData.seoMetadata);
            const storeName = seoData.storeName || storeMetadataData.shopName || shop;
            const description = seoData.fullDescription || storeMetadataData.description || 'an online store';
            
            response = `${storeName} is ${description.toLowerCase()}.`;
            
            if (seoData.keywords && seoData.keywords.length > 0) {
              response += ` They specialize in: ${seoData.keywords.slice(0, 3).join(', ')}.`;
            }
            
            if (storeMetadataData.aiMetadata) {
              const aiData = JSON.parse(storeMetadataData.aiMetadata);
              if (aiData.businessType) {
                response += ` This is a ${aiData.businessType}.`;
              }
              if (aiData.shippingInfo) {
                response += ` Shipping: ${aiData.shippingInfo}.`;
              }
            }
          } else if (schemas.organization) {
            response = `${schemas.organization.name || shop} is a business that ${schemas.organization.description ? `offers ${schemas.organization.description.toLowerCase()}` : 'operates an online store'}.`;
            if (schemas.organization.url) {
              response += ` You can visit them at ${schemas.organization.url}.`;
            }
          } else {
            response = `${shop} appears to be an online store, but I don't have detailed business information available in the structured data. The store may need to configure their store metadata or organization schema.`;
          }
        } catch (error) {
          console.error('[SCHEMA-DATA] Error fetching store metadata:', error);
          if (schemas.organization) {
            response = `${schemas.organization.name || shop} is a business that ${schemas.organization.description ? `offers ${schemas.organization.description.toLowerCase()}` : 'operates an online store'}.`;
            if (schemas.organization.url) {
              response += ` You can visit them at ${schemas.organization.url}.`;
            }
          } else {
            response = `${shop} appears to be an online store, but I don't have detailed business information available in the structured data. The store may need to configure their organization schema.`;
          }
        }
        break;
        
      case 'categories':
        // Fetch real collections data
        const collectionsData = await api(`/collections/list-graphql?shop=${shop}&limit=5`, { headers: { 'X-Shop': shop } });
        if (collectionsData?.collections && collectionsData.collections.length > 0) {
          const collectionNames = collectionsData.collections.slice(0, 3).map(c => c.title).join(', ');
          response = `${shop} has ${collectionsData.collections.length} product categories including: ${collectionNames}${collectionsData.collections.length > 3 ? ' and more.' : '.'}`;
        } else {
          response = `I can see that ${shop} is a store, but I don't have detailed category information available in the structured data. The store may need to generate collections data.`;
        }
        break;
        
      case 'contact':
        if (schemas.organization && schemas.organization.contactPoint) {
          const contact = schemas.organization.contactPoint;
          response = `For ${schemas.organization.name || shop}, you can contact them`;
          if (contact.telephone) {
            response += ` by phone at ${contact.telephone}`;
          }
          if (contact.email) {
            response += ` or by email at ${contact.email}`;
          }
          response += '.';
        } else {
          response = `I can see that ${shop} is a store, but I don't have contact information available in the structured data. The store may need to configure their organization schema with contact details.`;
        }
        break;
        
      default:
        response = 'I don\'t have enough information to provide a detailed response about this store.';
    }
    
    setAiSimulationResponse(response);
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
    { id: 'installation', content: 'Installation', accessibilityLabel: 'Installation' }
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
                    <Banner tone="info">
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
                      </BlockStack>
                    </Banner>

                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <Text as="h4" variant="headingSm">Code to Install</Text>

                          <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                            <pre style={{ fontSize: '12px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
{`{% comment %} Organization & WebSite Schema - indexAIze: Unlock AI Search {% endcomment %}
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

                          <InlineStack align="end">
                            <Button 
                              onClick={() => {
                                const code = `{% comment %} Organization & WebSite Schema - indexAIze: Unlock AI Search {% endcomment %}
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
{% endif %}`;
                                navigator.clipboard.writeText(code);
                                setToastContent('Code copied to clipboard!');
                              }}
                            >
                              Copy Code
                            </Button>
                          </InlineStack>

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