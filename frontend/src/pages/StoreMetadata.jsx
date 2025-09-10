// frontend/src/pages/StoreMetadata.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Card, Box, Text, Button, TextField, Checkbox, Toast, Form, FormLayout,
  InlineStack, Select, Divider, Banner, Link, Badge, Layout
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
  const [formData, setFormData] = useState({
    seo: {
      title: '',
      metaDescription: '',
      keywords: ''
    },
    aiMetadata: {
      businessType: '',
      targetAudience: '',
      uniqueSellingPoints: '',
      brandVoice: '',
      primaryCategories: '',
      shippingInfo: '',
      returnPolicy: ''
    },
    organizationSchema: {
      enabled: false,
      name: '',
      email: '',
      phone: '',
      logo: '',
      sameAs: ''
    },
    localBusinessSchema: {
      enabled: false,
      priceRange: '',
      openingHours: ''
    }
  });

  useEffect(() => {
    if (shop) loadStoreData();
  }, [shop, api]);

  async function loadStoreData() {
    setLoading(true);
    try {
      const url = `/api/store/generate?shop=${encodeURIComponent(shop)}`;
      console.log('[StoreMeta] GET', url);
      const data = await api(url, { headers: { 'X-Shop': shop } });
      console.log('[StoreMeta] GET ok', { url, keys: Object.keys(data || {}) });
      
      setStoreData(data);
      
      // Set existing metadata if any
      if (data.existingMetadata) {
        const existing = data.existingMetadata;
        setFormData(prev => ({
          ...prev,
          seo: {
            ...prev.seo,
            ...(existing.seo_metadata?.value || {}),
            keywords: Array.isArray(existing.seo_metadata?.value?.keywords) 
              ? existing.seo_metadata.value.keywords.join(', ')
              : existing.seo_metadata?.value?.keywords || prev.seo.keywords || ''
          },
          aiMetadata: existing.ai_metadata?.value || prev.aiMetadata,
          organizationSchema: {
          ...prev.organizationSchema,
          ...(existing.organization_schema?.value || {}),
          enabled: existing.organization_schema?.value?.enabled === true
          },
          localBusinessSchema: existing.local_business_schema?.value || prev.localBusinessSchema
        }));
      }
      
      // Set shop info defaults
      if (data.shopInfo) {
        setFormData(prev => ({
          ...prev,
          seo: {
            ...prev.seo,
            title: prev.seo.title || data.shopInfo.name
          },
          organizationSchema: {
            ...prev.organizationSchema,
            name: prev.organizationSchema.name || data.shopInfo.name,
            email: prev.organizationSchema.email || data.shopInfo.email
          }
        }));
      }
    } catch (error) {
      console.error('[StoreMeta] GET error', error?.debug || error, error);
      setToast(`Load failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    setLoading(true);
    try {
      const url = `/api/store/ai-generate?shop=${encodeURIComponent(shop)}`;
      console.log('[StoreMeta] POST', url);
      const data = await api(url, {
        method: 'POST',
        headers: { 'X-Shop': shop },
        body: {
          shopInfo: storeData?.shopInfo,
          businessType: formData.aiMetadata.businessType,
          targetAudience: formData.aiMetadata.targetAudience
        }
      });
      console.log('[StoreMeta] POST ok', { url, keys: Object.keys(data || {}) });
      
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
      const url = `/api/store/apply?shop=${encodeURIComponent(shop)}`;
      console.log('[StoreMeta] SAVE', url);
      const data = await api(url, {
        method: 'POST',
        headers: { 'X-Shop': shop },
        body: {
          metadata: formData,
          options: {
            updateSeo: true,
            updateAiMetadata: true,
            updateOrganization: formData.organizationSchema.enabled,
            updateLocalBusiness: formData.localBusinessSchema.enabled
          }
        }
      });
      console.log('[StoreMeta] SAVE ok', { url, ok: data?.ok });
      
      setToast('Metadata saved successfully!');
    } catch (error) {
      console.error('[StoreMeta] SAVE error', error?.debug || error, error);
      setToast(`Save failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
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
            <FormLayout>
              <TextField
                label="SEO Title"
                value={formData.seo.title}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  seo: { ...prev.seo, title: value }
                }))}
                helpText="Title for search engines (max 70 chars)"
                maxLength={70}
              />
              
              <TextField
                label="Meta Description"
                value={formData.seo.metaDescription}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  seo: { ...prev.seo, metaDescription: value }
                }))}
                helpText="Description for search results (150-160 chars)"
                maxLength={160}
                multiline={3}
              />
              
              <TextField
                label="Keywords"
                value={formData.seo.keywords}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  seo: { ...prev.seo, keywords: value }
                }))}
                helpText="Comma-separated keywords"
              />
            </FormLayout>
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
            </FormLayout>
          </Box>
        </Card>
      </Layout.Section>

      {storeData?.features?.organizationSchema && (
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
      )}

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
              >
                Save Metadata
              </Button>
            </InlineStack>
            
            <Box paddingBlockStart="400">
              <Text variant="bodyMd" color="subdued">
                Public metadata URL: <Link url={publicUrl} external>{publicUrl}</Link>
              </Text>
            </Box>
          </Box>
        </Card>
      </Layout.Section>

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </Layout>
  );
}