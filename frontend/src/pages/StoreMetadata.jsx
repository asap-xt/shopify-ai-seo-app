// frontend/src/pages/StoreMetadata.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Card, Box, Text, Button, TextField, Checkbox, Toast, Form, FormLayout,
  InlineStack, Select, Divider, Banner, Link, Badge, Layout, Tooltip
} from '@shopify/polaris';
import { makeSessionFetch } from '../lib/sessionFetch.js';

const qs = (k, d = '') => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };

export default function StoreMetadata({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [storeData, setStoreData] = useState(null);
  const api = useMemo(() => makeSessionFetch({ debug: true }), []);
  const [previewing, setPreviewing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [shopifyData, setShopifyData] = useState({ storeName: '', homePageTitle: '', metaDescription: '' });
  const [hasShopifyChanges, setHasShopifyChanges] = useState(false);
  const [formData, setFormData] = useState({
    seo: {
      storeName: '',
      shortDescription: '',
      fullDescription: '',
      keywords: ''
    },
    aiMetadata: {
      businessType: '',
      targetAudience: '',
      uniqueSellingPoints: '',
      brandVoice: '',
      primaryCategories: '',
      shippingInfo: '',
      returnPolicy: '',
      languages: '', // Changed to string for easier editing
      supportedCurrencies: '', // Changed to string for easier editing
      shippingRegions: '', // Changed to string for easier editing
      culturalConsiderations: ''
    },
    organizationSchema: {
      enabled: false,
      name: '',
      email: '',
      phone: '',
      logo: '',
      sameAs: ''
    },
    // localBusinessSchema: {
    //   enabled: false,
    //   priceRange: '',
    //   openingHours: ''
    // } // DISABLED - not relevant for online stores
  });

  useEffect(() => {
    if (shop) loadStoreData();
  }, [shop, api]);

  async function loadStoreData() {
    setLoading(true);
    try {
      const url = `/api/store/generate?shop=${encodeURIComponent(shop)}`;
      const data = await api(url, { headers: { 'X-Shop': shop } });
      
      setStoreData(data);
      
      // Запази Shopify defaults
      setShopifyData({
        storeName: data.shopifyDefaults?.storeName || '',
        homePageTitle: data.shopifyDefaults?.homePageTitle || '',
        metaDescription: data.shopifyDefaults?.metaDescription || ''
      });
      
      const existing = data.existingMetadata || {};
      
      // Custom данни от MongoDB
      const customStoreName = existing.seo_metadata?.value?.storeName || '';
      const customShortDescription = existing.seo_metadata?.value?.shortDescription || '';
      const customFullDescription = existing.seo_metadata?.value?.fullDescription || '';
      
      // Use custom data if available, otherwise use Shopify defaults (DIRECT text, not placeholder)
      const displayStoreName = customStoreName || data.shopifyDefaults?.storeName || '';
      const displayShortDescription = customShortDescription || data.shopifyDefaults?.homePageTitle || '';
      const displayFullDescription = customFullDescription || data.shopifyDefaults?.metaDescription || '';
      
      // Провери за разлики
      const storeNameDifferent = customStoreName && customStoreName !== data.shopifyDefaults?.storeName;
      const shortDescDifferent = customShortDescription && customShortDescription !== data.shopifyDefaults?.homePageTitle;
      const fullDescDifferent = customFullDescription && customFullDescription !== data.shopifyDefaults?.metaDescription;
      setHasShopifyChanges(storeNameDifferent || shortDescDifferent || fullDescDifferent);
      
      const newFormData = {
        seo: {
          storeName: displayStoreName,
          shortDescription: displayShortDescription,
          fullDescription: displayFullDescription,
          keywords: Array.isArray(existing.seo_metadata?.value?.keywords) 
            ? existing.seo_metadata.value.keywords.join(', ')
            : existing.seo_metadata?.value?.keywords || ''
        },
        aiMetadata: {
          ...(existing.ai_metadata?.value || {}),
          // Convert arrays to comma-separated strings for easier editing
          languages: existing.ai_metadata?.value?.languages?.length > 0 
            ? existing.ai_metadata.value.languages.join(', ')
            : (data.shopInfo?.locales || []).filter(locale => locale.published).map(locale => locale.locale).join(', '),
          supportedCurrencies: existing.ai_metadata?.value?.supportedCurrencies?.length > 0 
            ? existing.ai_metadata.value.supportedCurrencies.join(', ')
            : (data.shopInfo?.currencies || ['EUR']).join(', '),
          shippingRegions: existing.ai_metadata?.value?.shippingRegions?.length > 0 
            ? existing.ai_metadata.value.shippingRegions.join(', ')
            : (data.shopInfo?.markets || []).map(market => market.name).join(', ')
        },
        organizationSchema: {
          ...(existing.organization_schema?.value || {}),
          enabled: existing.organization_schema?.value?.enabled === true,
          name: existing.organization_schema?.value?.name || data.shopInfo?.name || '',
          email: existing.organization_schema?.value?.email || data.shopInfo?.email || ''
        },
        // localBusinessSchema: existing.local_business_schema?.value || prev.localBusinessSchema // DISABLED
      };
      
      setFormData(newFormData);
      
    } catch (error) {
      console.error('[StoreMeta] Load error:', error);
      setToast(`Load failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  function syncFromShopify() {
    setFormData(prev => ({
      ...prev,
      seo: {
        ...prev.seo,
        storeName: '',
        shortDescription: '',
        fullDescription: ''
      }
    }));
    setHasShopifyChanges(false);
    setToast('Synced with Shopify store settings');
  }

  async function handleGenerate() {
    setLoading(true);
    try {
      const url = `/api/store/ai-generate?shop=${encodeURIComponent(shop)}`;
      const data = await api(url, {
        method: 'POST',
        headers: { 'X-Shop': shop },
        body: {
          shopInfo: storeData?.shopInfo,
          businessType: formData.aiMetadata.businessType,
          targetAudience: formData.aiMetadata.targetAudience
        }
      });
      
      // Update form with generated data
      if (data.metadata) {
        setFormData(prev => ({
          ...prev,
          seo: data.metadata.seo || prev.seo,
          aiMetadata: data.metadata.aiMetadata || prev.aiMetadata,
          organizationSchema: data.metadata.organizationSchema || prev.organizationSchema
        }));
        setToast('Metadata generated successfully!');
      }
    } catch (error) {
      console.error('[StoreMeta] POST error', error?.debug || error, error);
      setToast(`AI generation failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Normalize comma-separated fields before saving (convert string to array)
      const normalizedFormData = {
        ...formData,
        aiMetadata: {
          ...formData.aiMetadata,
          languages: typeof formData.aiMetadata.languages === 'string'
            ? formData.aiMetadata.languages.split(',').map(s => s.trim()).filter(s => s)
            : formData.aiMetadata.languages,
          supportedCurrencies: typeof formData.aiMetadata.supportedCurrencies === 'string'
            ? formData.aiMetadata.supportedCurrencies.split(',').map(s => s.trim()).filter(s => s)
            : formData.aiMetadata.supportedCurrencies,
          shippingRegions: typeof formData.aiMetadata.shippingRegions === 'string'
            ? formData.aiMetadata.shippingRegions.split(',').map(s => s.trim()).filter(s => s)
            : formData.aiMetadata.shippingRegions
        }
      };
      
      const url = `/api/store/apply?shop=${encodeURIComponent(shop)}`;
      const data = await api(url, {
        method: 'POST',
        headers: { 'X-Shop': shop },
        body: {
          metadata: normalizedFormData,
          options: {
            updateSeo: true,
            updateAiMetadata: true,
            updateOrganization: formData.organizationSchema.enabled,
            // updateLocalBusiness: formData.localBusinessSchema.enabled // DISABLED
          }
        }
      });
      
      setToast('Metadata saved successfully!');
      await loadStoreData(); // Reload за да обновим hasShopifyChanges
    } catch (error) {
      console.error('[StoreMeta] SAVE error', error?.debug || error, error);
      setToast(`Save failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  // Preview metadata function
  async function handlePreview() {
    setPreviewing(true);
    try {
      // First save the current data
      await handleSave();
      
      // Then fetch preview data using GraphQL
      const query = `
        query GetStoreMetadata($shop: String!) {
          storeMetadata(shop: $shop) {
            shopName
            description
            shortDescription
            seoMetadata
            aiMetadata
            organizationSchema
          }
        }
      `;
      
      const result = await api('/graphql', {
        method: 'POST',
        headers: { 'X-Shop': shop },
        body: { query, variables: { shop } }
      });
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      // Show preview in modal or new tab
      const previewData = result.data?.storeMetadata;
      if (previewData) {
        const previewWindow = window.open('', '_blank');
        
        // Format the data for better readability
        const formattedData = {
          shopName: previewData.shopName,
          shortDescription: previewData.shortDescription,
          description: previewData.description,
          seoMetadata: previewData.seoMetadata ? (() => {
            try { return JSON.parse(previewData.seoMetadata); } 
            catch (e) { console.error('Error parsing seoMetadata:', e); return previewData.seoMetadata; }
          })() : null,
          aiMetadata: previewData.aiMetadata ? (() => {
            try { return JSON.parse(previewData.aiMetadata); } 
            catch (e) { console.error('Error parsing aiMetadata:', e); return previewData.aiMetadata; }
          })() : null,
          organizationSchema: previewData.organizationSchema ? (() => {
            try { return JSON.parse(previewData.organizationSchema); } 
            catch (e) { console.error('Error parsing organizationSchema:', e); return previewData.organizationSchema; }
          })() : null,
          // localBusinessSchema: previewData.localBusinessSchema ? (() => {
          //   try { return JSON.parse(previewData.localBusinessSchema); } 
          //   catch (e) { console.error('Error parsing localBusinessSchema:', e); return previewData.localBusinessSchema; }
          // })() : null // DISABLED
        };
        
        previewWindow.document.write(`
          <html>
            <head>
              <title>Store Metadata Preview</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
                h1 { color: #333; }
                .section { margin: 20px 0; }
                .section h2 { color: #666; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
              </style>
            </head>
            <body>
              <h1>Store Metadata Preview</h1>
              <div class="section">
                <h2>Basic Info</h2>
                <p><strong>Shop Name:</strong> ${formattedData.shopName || 'Not set'}</p>
                <p><strong>Short Description:</strong> ${previewData.shortDescription || 'Not set'}</p>
                <p><strong>Full Description:</strong> ${formattedData.description || 'Not set'}</p>
              </div>
              
              <div class="section">
                <h2>SEO Metadata</h2>
                <pre>${JSON.stringify(formattedData.seoMetadata, null, 2)}</pre>
              </div>
              
              <div class="section">
                <h2>AI Metadata</h2>
                <pre>${JSON.stringify(formattedData.aiMetadata, null, 2)}</pre>
              </div>
              
              <div class="section">
                <h2>Organization Schema</h2>
                <pre>${JSON.stringify(formattedData.organizationSchema, null, 2)}</pre>
              </div>
              
              <!-- Local Business Schema - DISABLED -->
              <!-- <div class="section">
                <h2>Local Business Schema</h2>
                <pre>${JSON.stringify(formattedData.localBusinessSchema, null, 2)}</pre>
              </div> -->
              
              <div class="section">
                <h2>Raw Data</h2>
                <pre>${JSON.stringify(formattedData, null, 2)}</pre>
              </div>
            </body>
          </html>
        `);
        previewWindow.document.close();
      } else {
        throw new Error('No preview data available');
      }
      
    } catch (error) {
      setToast(`Preview failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setPreviewing(false);
    }
  }

  // Clear all metadata function
  async function handleClear() {
    setClearing(true);
    try {
      const emptyData = {
        seo: {
          storeName: '',
          shortDescription: '',
          fullDescription: '',
          keywords: ''
        },
        aiMetadata: {
          businessType: '',
          targetAudience: '',
          uniqueSellingPoints: '',
          brandVoice: '',
          primaryCategories: '',
          shippingInfo: '',
          returnPolicy: '',
          languages: '', // Empty string instead of array
          supportedCurrencies: '', // Empty string instead of array
          shippingRegions: '', // Empty string instead of array
          culturalConsiderations: ''
        },
        organizationSchema: {
          enabled: false,
          name: '',
          email: '',
          phone: '',
          logo: '',
          sameAs: ''
        },
        // localBusinessSchema: {
        //   enabled: false,
        //   priceRange: '',
        //   openingHours: ''
        // } // DISABLED
      };
      
      // Reset form to empty state
      setFormData(emptyData);
      
      // Save empty data to clear from backend/preview
      await handleSave();
      
      await loadStoreData();
      
      setToast('Metadata cleared successfully!');
      
    } catch (error) {
      console.error('[StoreMeta] CLEAR - Error', error);
      setToast(`Clear failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setClearing(false);
    }
  }

  if (loading && !storeData) {
    return (
      <Card>
        <Box padding="400">
          <Text>Loading store data...</Text>
        </Box>
      </Card>
    );
  }

  if (storeData?.plan === 'Starter') {
    return (
      <Banner status="warning">
        <Text>Store metadata features are available starting from the Professional plan.</Text>
      </Banner>
    );
  }

  const publicUrl = `/api/store/public/${shop}`;

  return (
    <Layout>
      <Layout.Section>
        <Card title="Basic Store Information">
          <Box padding="400">
            <Banner tone="info">
              <Box>
                <Text variant="bodyMd" fontWeight="semibold">From Shopify Settings:</Text>
                <Box paddingBlockStart="200">
                  <Text variant="bodySm" tone="subdued">
                    Store name: <Text as="span" fontWeight="medium">{shopifyData.storeName || 'Not set'}</Text>
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Home page title: <Text as="span" fontWeight="medium">{shopifyData.homePageTitle || 'Not set'}</Text>
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Meta description: <Text as="span" fontWeight="medium">
                      {shopifyData.metaDescription ? 
                        (shopifyData.metaDescription.substring(0, 100) + (shopifyData.metaDescription.length > 100 ? '...' : ''))
                        : 'Not set'}
                    </Text>
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Languages: <Text as="span" fontWeight="medium">
                      {storeData?.shopInfo?.locales?.filter(l => l.published).map(l => l.locale).join(', ') || 'Not set'}
                    </Text>
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Currencies: <Text as="span" fontWeight="medium">
                      {storeData?.shopInfo?.currencies?.join(', ') || 'EUR'}
                    </Text>
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Markets: <Text as="span" fontWeight="medium">
                      {storeData?.shopInfo?.markets?.map(m => m.name).join(', ') || 'Not set'}
                    </Text>
                  </Text>
                  {storeData?.shopInfo?.name && (
                    <Text variant="bodySm" tone="subdued">
                      Organization: <Text as="span" fontWeight="medium">{storeData.shopInfo.name}</Text>
                      {storeData.shopInfo.email && <> ({storeData.shopInfo.email})</>}
                    </Text>
                  )}
                </Box>
                {hasShopifyChanges && (
                  <Box paddingBlockStart="300">
                    <Button size="slim" onClick={syncFromShopify}>
                      Sync from Shopify
                    </Button>
                  </Box>
                )}
              </Box>
            </Banner>
            
            <Box paddingBlockStart="400">
              <FormLayout>
                <TextField
                  label="Store Name"
                  value={formData.seo.storeName}
                  onChange={(value) => setFormData(prev => ({
                    ...prev,
                    seo: { ...prev.seo, storeName: value }
                  }))}
                  helpText="Loaded from Shopify. Edit if needed."
                  maxLength={100}
                />
                
                <TextField
                  label="Short Store Description"
                  value={formData.seo.shortDescription}
                  onChange={(value) => setFormData(prev => ({
                    ...prev,
                    seo: { ...prev.seo, shortDescription: value }
                  }))}
                  helpText="Loaded from Shopify. Edit if needed - max 100 characters"
                  maxLength={100}
                />
                
                <TextField
                  label="Full Store Description"
                  value={formData.seo.fullDescription}
                  onChange={(value) => setFormData(prev => ({
                    ...prev,
                    seo: { ...prev.seo, fullDescription: value }
                  }))}
                  helpText="Loaded from Shopify. Edit if needed - max 300 characters"
                  maxLength={300}
                  multiline={3}
                />
                
                <TextField
                  label="Keywords"
                  value={formData.seo.keywords}
                  onChange={(value) => setFormData(prev => ({
                    ...prev,
                    seo: { ...prev.seo, keywords: value }
                  }))}
                  helpText="Comma-separated keywords (optional)"
                />
              </FormLayout>
            </Box>
          </Box>
        </Card>
      </Layout.Section>

      <Layout.Section>
        <Card title="AI Metadata">
          <Box padding="400">
            <FormLayout>
              <FormLayout.Group>
                <TextField
                  label="Business Type"
                  value={formData.aiMetadata.businessType}
                  onChange={(value) => setFormData(prev => ({
                    ...prev,
                    aiMetadata: { ...prev.aiMetadata, businessType: value }
                  }))}
                  placeholder="e.g., Fashion Retailer, Electronics Store"
                  helpText="Max 3 words"
                />
                
                <TextField
                  label="Target Audience"
                  value={formData.aiMetadata.targetAudience}
                  onChange={(value) => setFormData(prev => ({
                    ...prev,
                    aiMetadata: { ...prev.aiMetadata, targetAudience: value }
                  }))}
                  placeholder="e.g., Young professionals, Parents"
                />
              </FormLayout.Group>
              
              <TextField
                label="Unique Selling Points"
                value={formData.aiMetadata.uniqueSellingPoints}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  aiMetadata: { ...prev.aiMetadata, uniqueSellingPoints: value }
                }))}
                helpText="Comma-separated list"
                multiline={2}
              />
              
              <TextField
                label="Brand Voice"
                value={formData.aiMetadata.brandVoice}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  aiMetadata: { ...prev.aiMetadata, brandVoice: value }
                }))}
                placeholder="e.g., Professional, Friendly, Casual"
              />
              
              <TextField
                label="Primary Categories"
                value={formData.aiMetadata.primaryCategories}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  aiMetadata: { ...prev.aiMetadata, primaryCategories: value }
                }))}
                helpText="Main product categories, comma-separated"
              />
              
              <TextField
                label="Shipping Information"
                value={formData.aiMetadata.shippingInfo}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  aiMetadata: { ...prev.aiMetadata, shippingInfo: value }
                }))}
                helpText="Shipping costs, delivery times, free shipping thresholds (e.g., Free shipping over $50, 2-3 business days)"
                multiline={2}
              />
              
              <TextField
                label="Return Policy"
                value={formData.aiMetadata.returnPolicy}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  aiMetadata: { ...prev.aiMetadata, returnPolicy: value }
                }))}
                multiline={2}
              />
              
              <Divider />
              
              <Text variant="headingMd" as="h3">Languages & Markets</Text>
              <Text variant="bodyMd" color="subdued">
                Automatically populated from Shopify settings
              </Text>
              
              <TextField
                label="Supported Languages"
                value={formData.aiMetadata.languages || ''}
                onChange={(value) => {
                  // Store as string - no normalization during typing (allows trailing commas)
                  setFormData(prev => ({
                    ...prev,
                    aiMetadata: { ...prev.aiMetadata, languages: value }
                  }));
                }}
                helpText="Comma-separated language codes (e.g., en, de, es, fr)"
                multiline={2}
              />
              
              <TextField
                label="Supported Currencies"
                value={formData.aiMetadata.supportedCurrencies || ''}
                onChange={(value) => {
                  // Store as string - no normalization during typing (allows trailing commas)
                  setFormData(prev => ({
                    ...prev,
                    aiMetadata: { ...prev.aiMetadata, supportedCurrencies: value }
                  }));
                }}
                helpText="Comma-separated currency codes (e.g., EUR, USD, GBP)"
              />
              
              <TextField
                label="Shipping Regions"
                value={formData.aiMetadata.shippingRegions || ''}
                onChange={(value) => {
                  // Store as string - no normalization during typing (allows trailing commas)
                  setFormData(prev => ({
                    ...prev,
                    aiMetadata: { ...prev.aiMetadata, shippingRegions: value }
                  }));
                }}
                helpText="Comma-separated regions (e.g., EU, USA, UK, Canada)"
                multiline={2}
              />
              
              <TextField
                label="Cultural Considerations"
                value={formData.aiMetadata.culturalConsiderations || ''}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  aiMetadata: { ...prev.aiMetadata, culturalConsiderations: value }
                }))}
                helpText="Cultural context for AI models (e.g., European market focus, Local customs)"
                multiline={2}
              />
            </FormLayout>
          </Box>
        </Card>
      </Layout.Section>

      {storeData?.features?.organizationSchema ? (
        <Layout.Section>
          <Card title="Organization Schema">
            <Box padding="400">
              <Checkbox
                label="Enable Organization Schema"
                checked={formData.organizationSchema.enabled}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  organizationSchema: { ...prev.organizationSchema, enabled: value }
                }))}
              />
              
              {formData.organizationSchema.enabled && (
                <Box paddingBlockStart="400">
                  <FormLayout>
                    <FormLayout.Group>
                      <TextField
                        label="Organization Name"
                        value={formData.organizationSchema.name}
                        onChange={(value) => setFormData(prev => ({
                          ...prev,
                          organizationSchema: { ...prev.organizationSchema, name: value }
                        }))}
                      />
                      
                      <TextField
                        label="Contact Email"
                        value={formData.organizationSchema.email}
                        onChange={(value) => setFormData(prev => ({
                          ...prev,
                          organizationSchema: { ...prev.organizationSchema, email: value }
                        }))}
                        type="email"
                      />
                    </FormLayout.Group>
                    
                    <TextField
                      label="Phone"
                      value={formData.organizationSchema.phone}
                      onChange={(value) => setFormData(prev => ({
                        ...prev,
                        organizationSchema: { ...prev.organizationSchema, phone: value }
                      }))}
                      type="tel"
                    />
                    
                    <TextField
                      label="Logo URL"
                      value={formData.organizationSchema.logo}
                      onChange={(value) => setFormData(prev => ({
                        ...prev,
                        organizationSchema: { ...prev.organizationSchema, logo: value }
                      }))}
                      type="url"
                    />
                    
                    <TextField
                      label="Social Media Links"
                      value={formData.organizationSchema.sameAs}
                      onChange={(value) => setFormData(prev => ({
                        ...prev,
                        organizationSchema: { ...prev.organizationSchema, sameAs: value }
                      }))}
                      helpText="Comma-separated URLs"
                      multiline={2}
                    />
                  </FormLayout>
                </Box>
              )}
            </Box>
          </Card>
        </Layout.Section>
      ) : (
        <Layout.Section>
          <Card title="Organization Schema">
            <Box padding="400">
              <Banner tone="info">
                <Box>
                  <Text variant="bodyMd" fontWeight="semibold">
                    Upgrade to Professional+ to enable Organization Schema
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Organization Schema helps AI bots understand your business structure, contact information, and social media presence.
                  </Text>
                  <Box paddingBlockStart="300">
                    <Button 
                      primary 
                      onClick={() => {
                        // Navigate to billing within the same iframe - copy ALL URL parameters
                        const currentParams = new URLSearchParams(window.location.search);
                        const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
                        window.location.href = `/billing${paramString}`;
                      }}
                    >
                      Upgrade Plan
                    </Button>
                  </Box>
                </Box>
              </Banner>
            </Box>
          </Card>
        </Layout.Section>
      )}

      {/* Local Business Schema - DISABLED - not relevant for online stores */}
      {/*
      {storeData?.features?.localBusinessSchema && (
        <Layout.Section>
          <Card title="Local Business Schema">
            <Box padding="400">
              <InlineStack align="start" gap="200">
                <Checkbox
                  label="Enable Local Business Schema"
                  checked={formData.localBusinessSchema.enabled}
                  onChange={(value) => setFormData(prev => ({
                    ...prev,
                    localBusinessSchema: { ...prev.localBusinessSchema, enabled: value }
                  }))}
                />
                <Tooltip content="Optional - only enable if you have physical stores/locations">
                  <Text variant="bodyMd" color="subdued">ℹ️</Text>
                </Tooltip>
              </InlineStack>
              
              {formData.localBusinessSchema.enabled && (
                <Box paddingBlockStart="400">
                  <FormLayout>
                    <TextField
                      label="Price Range"
                      value={formData.localBusinessSchema.priceRange}
                      onChange={(value) => setFormData(prev => ({
                        ...prev,
                        localBusinessSchema: { ...prev.localBusinessSchema, priceRange: value }
                      }))}
                      helpText="e.g., $, $$, $$$, $$$$"
                    />
                    
                    <TextField
                      label="Opening Hours"
                      value={formData.localBusinessSchema.openingHours}
                      onChange={(value) => setFormData(prev => ({
                        ...prev,
                        localBusinessSchema: { ...prev.localBusinessSchema, openingHours: value }
                      }))}
                      helpText="e.g., Mo-Fr 09:00-18:00, Sa 10:00-16:00"
                      multiline={2}
                    />
                  </FormLayout>
                </Box>
              )}
            </Box>
          </Card>
        </Layout.Section>
      )}
      */}

      <Layout.Section>
        <Card>
          <Box padding="400">
            <InlineStack gap="300">
              {/* Временно скрито - ще се добави AI генерация по-късно
              <Button
                primary
                onClick={handleGenerate}
                loading={loading}
                disabled={!formData.aiMetadata.businessType}
              >
                Generate with AI
              </Button>
              */}
              
              <Button
                onClick={handleSave}
                loading={saving}
                primary
              >
                Save Metadata
              </Button>
              
              <Button
                onClick={handlePreview}
                loading={previewing}
              >
                Preview Metadata
              </Button>
              
              {false && (
                <Button
                  onClick={handleClear}
                  loading={clearing}
                  destructive
                >
                  Clear Metadata
                </Button>
              )}
            </InlineStack>
          </Box>
        </Card>
      </Layout.Section>

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </Layout>
  );
}