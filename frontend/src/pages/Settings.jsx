// frontend/src/pages/Settings.jsx
import React, { useState, useEffect } from 'react';
import {
  Card,
  Box,
  Text,
  Button,
  BlockStack,
  InlineStack,
  Checkbox,
  Banner,
  Modal,
  TextField,
  Divider,
  Icon,
  Link,
  Badge,
  Toast,
  Spinner
} from '@shopify/polaris';
import { ClipboardIcon, ExternalIcon, ViewIcon } from '@shopify/polaris-icons';

const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; } 
  catch { return d; }
};

// Helper function to normalise plans names
const normalizePlan = (plan) => {
  return (plan || 'starter').toLowerCase().replace(' ', '_');
};

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const [robotsTxt, setRobotsTxt] = useState('');
  const [showRobotsModal, setShowRobotsModal] = useState(false);
  const [toast, setToast] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showNoBotsModal, setShowNoBotsModal] = useState(false);
  const [showManualInstructions, setShowManualInstructions] = useState(false);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [jsonModalTitle, setJsonModalTitle] = useState('');
  const [jsonModalContent, setJsonModalContent] = useState(null);
  const [loadingJson, setLoadingJson] = useState(false);
  const [originalSettings, setOriginalSettings] = useState(null);
  
  // Advanced Schema Data state
  const [advancedSchemaEnabled, setAdvancedSchemaEnabled] = useState(false);
  const [processingSchema, setProcessingSchema] = useState(false);
  const [schemaGenerating, setSchemaGenerating] = useState(false);
  const [schemaError, setSchemaError] = useState('');
  const [advancedSchemaStatus, setAdvancedSchemaStatus] = useState({
    enabled: false,
    generating: false,
    generated: false,
    progress: ''
  });
  
  const shop = qs('shop', '');

  useEffect(() => {
    if (!shop) {
      setLoading(false);
      return;
    }
    loadSettings();
  }, [shop]);


  // Check schema status when enabled
  useEffect(() => {
    if (advancedSchemaEnabled) {
      checkSchemaStatus();
    }
  }, [advancedSchemaEnabled]);

  const checkSchemaStatus = async () => {
    try {
      const res = await fetch(`/api/schema/status?shop=${shop}`);
      const data = await res.json();
      setAdvancedSchemaStatus({
        enabled: data.enabled,
        generating: data.generating,
        generated: data.hasSiteFAQ || data.productsWithSchema > 0,
        progress: data.progress || ''
      });
    } catch (error) {
      console.error('Failed to check schema status:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await fetch(`/api/ai-discovery/settings?shop=${encodeURIComponent(shop)}`);
      if (!res.ok) throw new Error('Failed to load settings');
      
      const data = await res.json();
      console.log('Loaded settings:', data); // Debug log
      console.log('Settings plan:', data?.plan);
      console.log('Normalized plan:', normalizePlan(data?.plan));
      setSettings(data);
      setOriginalSettings(data); // Save original settings
      
      // Set Advanced Schema enabled state
      setAdvancedSchemaEnabled(data.advancedSchemaEnabled || false);
      
      // Generate robots.txt preview
      generateRobotsTxt(data);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setToast('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const generateRobotsTxt = async (currentSettings = settings) => {
    try {
      const res = await fetch(`/api/ai-discovery/robots-txt?shop=${encodeURIComponent(shop)}`);
      const txt = await res.text();
      setRobotsTxt(txt);
    } catch (error) {
      console.error('Failed to generate robots.txt:', error);
    }
  };

  const toggleBot = (botKey) => {
    if (!settings?.availableBots?.includes(botKey)) {
      setToast(`Upgrade to ${requiredPlan} plan to enable ${settings.bots[botKey].name}`);
      return;
    }
    
    setSettings(prev => ({
      ...prev,
      bots: {
        ...prev.bots,
        [botKey]: {
          ...prev.bots[botKey],
          enabled: !prev.bots[botKey].enabled
        }
      }
    }));
    
    setHasUnsavedChanges(true); // Mark that there are changes
  };

  const toggleFeature = (featureKey) => {
    if (!isFeatureAvailable(featureKey)) {
      const feature = {
        productsJson: 'Products JSON Feed',
        aiSitemap: 'AI-Optimized Sitemap',
        welcomePage: 'AI Welcome Page',
        collectionsJson: 'Collections JSON Feed',
        storeMetadata: 'Store Metadata',
        schemaData: 'Schema Data'
      };
      setToast(`Upgrade your plan to enable ${feature[featureKey] || featureKey}`);
      return;
    }
    
    setSettings(prev => ({
      ...prev,
      features: {
        ...prev.features,
        [featureKey]: !prev.features[featureKey]
      }
    }));
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ai-discovery/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop,
          bots: settings.bots,
          features: settings.features
        })
      });
      
      if (!res.ok) throw new Error('Failed to save');
      
      setToast('Settings saved successfully');
      setHasUnsavedChanges(false); // Clear unsaved changes flag
      setOriginalSettings(settings); // Update original settings
      generateRobotsTxt(); // Regenerate robots.txt
    } catch (error) {
      console.error('Failed to save settings:', error);
      setToast('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(robotsTxt);
    setToast('Copied to clipboard!');
  };

  const applyRobotsTxt = async () => {
    try {
      const res = await fetch('/api/ai-discovery/apply-robots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply');
      
      setToast('robots.txt applied successfully!');
    } catch (error) {
      console.error('Failed to apply robots.txt:', error);
      setToast(error.message);
    }
  };

  const isFeatureAvailable = (featureKey) => {
    const plan = normalizePlan(settings?.plan);
    
    const availability = {
      productsJson: ['starter', 'professional', 'growth', 'growth_extra', 'enterprise'],
      aiSitemap: ['starter', 'professional', 'growth', 'growth_extra', 'enterprise'],
      welcomePage: ['professional', 'growth', 'growth_extra', 'enterprise'],
      collectionsJson: ['growth', 'growth_extra', 'enterprise'],
      storeMetadata: ['growth_extra', 'enterprise'],
      schemaData: ['enterprise']
    };
    
    return availability[featureKey]?.includes(plan) || false;
  };

  const setTestPlan = async (plan) => {
    try {
      const res = await fetch('/test/set-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop, plan })
      });
      if (res.ok) {
        setToast(`Test plan set to ${plan}`);
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (error) {
      setToast('Failed to set test plan');
    }
  };

  const viewJson = async (feature, title) => {
    setJsonModalTitle(title);
    setJsonModalOpen(true);
    setLoadingJson(true);
    setJsonModalContent(null);

    try {
      const endpoints = {
        productsJson: `/ai/products.json?shop=${shop}`,
        collectionsJson: `/ai/collections-feed.json?shop=${shop}`,
        storeMetadata: `/ai/store-metadata.json?shop=${shop}`,
        schemaData: `/ai/schema-data.json?shop=${shop}`,
        aiSitemap: `/ai/sitemap-feed.xml?shop=${shop}`,
        welcomePage: `/ai/welcome?shop=${shop}`
      };

      const res = await fetch(endpoints[feature]);
      const contentType = res.headers.get('content-type');
      
      if (contentType?.includes('json')) {
        const data = await res.json();
        setJsonModalContent(JSON.stringify(data, null, 2));
      } else {
        const text = await res.text();
        setJsonModalContent(text);
      }
    } catch (error) {
      setJsonModalContent(`Error loading data: ${error.message}`);
    } finally {
      setLoadingJson(false);
    }
  };

  if (!shop) {
    return (
      <Card>
        <Box padding="400">
          <Text tone="critical">Missing shop parameter</Text>
        </Box>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <Box padding="400">
          <InlineStack align="center">
            <Spinner size="small" />
            <Text>Loading settings...</Text>
          </InlineStack>
        </Box>
      </Card>
    );
  }

  return (
    <BlockStack gap="600">
      {/* AI Bot Access Control */}
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">AI Bot Access Control</Text>
              {settings?.plan && (
                <Badge tone="info">
                  {settings.plan.charAt(0).toUpperCase() + settings.plan.slice(1)} Plan
                </Badge>
              )}
            </InlineStack>
            
            <Text variant="bodyMd" tone="subdued">
              Choose which AI bots can access your store's structured data
            </Text>
            
            <Banner status="info">
              Don't forget to click "Save Settings" after making changes.
            </Banner>
            
            <Divider />
            
            <BlockStack gap="300">
              {/* Row 1: OpenAI, Perplexity */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '1rem' 
              }}>
                {['openai', 'perplexity'].map(key => {
                  const bot = settings?.bots?.[key];
                  if (!bot) return null;
                  
                  // Use normalized plan for availableBots check
                  const availableBotsByPlan = {
                    starter: ['openai', 'perplexity'],
                    professional: ['openai', 'anthropic', 'perplexity'],
                    growth: ['openai', 'anthropic', 'google', 'perplexity', 'meta', 'others'],
                    growth_extra: ['openai', 'anthropic', 'google', 'perplexity', 'meta', 'others'],
                    enterprise: ['openai', 'anthropic', 'google', 'perplexity', 'meta', 'others']
                  };
                  
                  const normalizedPlan = normalizePlan(settings?.plan);
                  const availableBots = availableBotsByPlan[normalizedPlan] || availableBotsByPlan.starter;
                  const isAvailable = availableBots.includes(key);
                  
                  const requiredPlan = 
                    key === 'anthropic' ? 'Professional' :
                    key === 'google' ? 'Growth' :
                    ['meta', 'others'].includes(key) ? 'Growth Extra' : // Changed from 'Growth' to 'Growth Extra'
                    null;
                  
                  return (
                    <Box key={key} 
                      padding="200" 
                      background={isAvailable ? "bg-surface" : "bg-surface-secondary"}
                      borderRadius="200"
                      borderWidth="025"
                      borderColor="border"
                    >
                      <BlockStack gap="100">
                        <Checkbox
                          label={
                            <InlineStack gap="200" align="center">
                              <Text variant={isAvailable ? "bodyMd" : "bodySm"} tone={isAvailable ? "base" : "subdued"}>
                                {bot.name || key}
                              </Text>
                              {!isAvailable && requiredPlan && (
                                <Badge tone="info" size="small">
                                  {requiredPlan}+
                                </Badge>
                              )}
                            </InlineStack>
                          }
                          checked={!!settings?.bots?.[key]?.enabled}
                          onChange={() => toggleBot(key)}
                          disabled={!isAvailable}
                          helpText={
                            !isAvailable ? 
                              `Upgrade to ${requiredPlan} plan to enable this AI bot` :
                              key === 'openai' ? 'Most popular AI assistant' :
                              key === 'anthropic' ? 'Claude AI assistant' :
                              key === 'google' ? 'Google Gemini' :
                              key === 'perplexity' ? 'AI-powered search' :
                              key === 'meta' ? 'Meta AI platforms' :
                              key === 'others' ? 'Bytespider, DeepSeek, etc.' :
                              ''
                          }
                        />
                      </BlockStack>
                    </Box>
                  );
                })}
              </div>

              {/* Row 2: Anthropic, Google */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '1rem' 
              }}>
                {['anthropic', 'google'].map(key => {
                  const bot = settings?.bots?.[key];
                  if (!bot) return null;
                  
                  const isAvailable = settings?.availableBots?.includes(key);
                  const requiredPlan = 
                    key === 'anthropic' ? 'Professional' :
                    key === 'google' ? 'Growth' :
                    ['meta', 'others'].includes(key) ? 'Growth Extra' : // Changed from 'Growth' to 'Growth Extra'
                    null;
                  
                  return (
                    <Box key={key} 
                      padding="200" 
                      background={isAvailable ? "bg-surface" : "bg-surface-secondary"}
                      borderRadius="200"
                      borderWidth="025"
                      borderColor="border"
                    >
                      <BlockStack gap="100">
                        <Checkbox
                          label={
                            <InlineStack gap="200" align="center">
                              <Text variant={isAvailable ? "bodyMd" : "bodySm"} tone={isAvailable ? "base" : "subdued"}>
                                {bot.name || key}
                              </Text>
                              {!isAvailable && requiredPlan && (
                                <Badge tone="info" size="small">
                                  {requiredPlan}+
                                </Badge>
                              )}
                            </InlineStack>
                          }
                          checked={!!settings?.bots?.[key]?.enabled}
                          onChange={() => toggleBot(key)}
                          disabled={!isAvailable}
                          helpText={
                            !isAvailable ? 
                              `Upgrade to ${requiredPlan} plan to enable this AI bot` :
                              key === 'openai' ? 'Most popular AI assistant' :
                              key === 'anthropic' ? 'Claude AI assistant' :
                              key === 'google' ? 'Google Gemini' :
                              key === 'perplexity' ? 'AI-powered search' :
                              key === 'meta' ? 'Meta AI platforms' :
                              key === 'others' ? 'Bytespider, DeepSeek, etc.' :
                              ''
                          }
                        />
                      </BlockStack>
                    </Box>
                  );
                })}
              </div>

              {/* Row 3: Meta, Others */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '1rem' 
              }}>
                {['meta', 'others'].map(key => {
                  const bot = settings?.bots?.[key];
                  if (!bot) return null;
                  
                  const isAvailable = settings?.availableBots?.includes(key);
                  const requiredPlan = 
                    key === 'anthropic' ? 'Professional' :
                    key === 'google' ? 'Growth' :
                    ['meta', 'others'].includes(key) ? 'Growth Extra' : // Changed from 'Growth' to 'Growth Extra'
                    null;
                  
                  return (
                    <Box key={key} 
                      padding="200" 
                      background={isAvailable ? "bg-surface" : "bg-surface-secondary"}
                      borderRadius="200"
                      borderWidth="025"
                      borderColor="border"
                    >
                      <BlockStack gap="100">
                <Checkbox
                          label={
                            <InlineStack gap="200" align="center">
                              <Text variant={isAvailable ? "bodyMd" : "bodySm"} tone={isAvailable ? "base" : "subdued"}>
                                {bot.name || key}
                              </Text>
                              {!isAvailable && requiredPlan && (
                                <Badge tone="info" size="small">
                                  {requiredPlan}+
                                </Badge>
                              )}
                            </InlineStack>
                          }
                          checked={!!settings?.bots?.[key]?.enabled}
                  onChange={() => toggleBot(key)}
                          disabled={!isAvailable}
                          helpText={
                            !isAvailable ? 
                              `Upgrade to ${requiredPlan} plan to enable this AI bot` :
                              key === 'openai' ? 'Most popular AI assistant' :
                              key === 'anthropic' ? 'Claude AI assistant' :
                              key === 'google' ? 'Google Gemini' :
                              key === 'perplexity' ? 'AI-powered search' :
                              key === 'meta' ? 'Meta AI platforms' :
                              key === 'others' ? 'Bytespider, DeepSeek, etc.' :
                              ''
                          }
                        />
                      </BlockStack>
                    </Box>
                  );
                })}
              </div>
            </BlockStack>
          </BlockStack>
        </Box>
      </Card>

      {/* robots.txt Configuration */}
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">robots.txt Configuration</Text>
            
            {hasUnsavedChanges && (
              <Banner status="warning" title="Unsaved changes">
                <p>You have unsaved bot selections. Please click "Save Settings" before configuring robots.txt.</p>
              </Banner>
            )}
            
            <Banner>
              <p>
                {['growth', 'growth_extra', 'enterprise'].includes(normalizePlan(settings?.plan)) ? 
                  "With your plan, you can apply robots.txt changes directly to your theme!" :
                  "Copy the generated rules and add them to your theme's robots.txt.liquid file."
                }
              </p>
            </Banner>
            
            <InlineStack gap="200">
              <Button 
                onClick={() => {
                  console.log('[ADD MANUAL] Starting...');
                  console.log('[ADD MANUAL] Settings:', settings);
                  
                  try {
                    const hasSelectedBots = Object.values(settings?.bots || {}).some(bot => bot.enabled);
                    console.log('[ADD MANUAL] Has selected bots:', hasSelectedBots);
                    
                    if (!hasSelectedBots) {
                      console.log('[ADD MANUAL] No bots, showing modal');
                      setShowNoBotsModal(true);
                    } else {
                      console.log('[ADD MANUAL] Showing instructions');
                      setShowManualInstructions(true);
                    }
                  } catch (error) {
                    console.error('[ADD MANUAL] Error:', error);
                  }
                }}
              >
                Add manually
              </Button>
              
              {['growth', 'growth_extra', 'enterprise'].includes(normalizePlan(settings?.plan)) && (
                <Button 
                  primary 
                  onClick={async () => {
                    console.log('[APPLY AUTO] Starting...');
                    console.log('[APPLY AUTO] Settings:', settings);
                    console.log('[APPLY AUTO] Bots:', settings?.bots);
                    
                    try {
                      // Check if any bots are selected
                      const hasSelectedBots = Object.values(settings?.bots || {}).some(bot => bot.enabled);
                      console.log('[APPLY AUTO] Has selected bots:', hasSelectedBots);
                      
                      if (!hasSelectedBots) {
                        console.log('[APPLY AUTO] No bots selected, showing modal');
                        setShowNoBotsModal(true);
                        return;
                      }
                      
                      console.log('[APPLY AUTO] Applying robots.txt...');
                      const res = await fetch('/api/ai-discovery/apply-robots', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ shop })
                      });
                      
                      console.log('[APPLY AUTO] Response:', res.status);
                      const data = await res.json();
                      console.log('[APPLY AUTO] Data:', data);
                      
                      if (!res.ok) throw new Error(data.error);
                      
                      setToast(data.message || 'robots.txt applied successfully!');
                    } catch (error) {
                      console.error('[APPLY AUTO] Error:', error);
                      setToast(error.message);
                    }
                  }}
                >
                  Apply Automatically
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>

      {/* Advanced Schema Data - Enterprise only */}
      {normalizePlan(settings?.plan) === 'enterprise' && (
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Advanced Schema Data</Text>
              <Text variant="bodyMd" tone="subdued">
                Generate BreadcrumbList, FAQPage, WebPage and more structured data for better AI discovery
              </Text>
              
              <Button
                primary
                onClick={async () => {
                  console.log('Generate Schema clicked!');
                  try {
                    const res = await fetch('/api/schema/generate-all', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ shop })
                    });
                    
                    console.log('Response status:', res.status);
                    const data = await res.json();
                    console.log('Response data:', data);
                    
                    if (res.ok) {
                      setToast('Schema generation started! This may take a few minutes.');
                    } else {
                      setToast(`Error: ${data.error || 'Failed to start generation'}`);
                    }
                  } catch (err) {
                    console.error('Error:', err);
                    setToast('Failed to generate schema');
                  }
                }}
              >
                Generate Advanced Schema Data
              </Button>
              
              <Button
                plain
                onClick={() => window.open(`/schema-data.json?shop=${shop}`, '_blank')}
              >
                View Generated Schema
              </Button>
            </BlockStack>
          </Box>
        </Card>
      )}

      {/* AI Discovery Features */}
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">AI Discovery Features</Text>
            <Text variant="bodyMd" tone="subdued">
              Select the features you want to enable for AI bots to consume your store data.
            </Text>
            
            <Banner status="info">
              Don't forget to click "Save Settings" after making changes.
            </Banner>
            
            <Divider />
            
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
              gap: '1rem' 
            }}>
              {[
                {
                  key: 'productsJson',
                  name: 'Products JSON Feed',
                  description: 'Bulk product data for AI consumption',
                  requiredPlan: null
                },
                {
                  key: 'aiSitemap',
                  name: 'AI-Optimized Sitemap',
                  description: 'Enhanced sitemap with AI hints',
                  requiredPlan: null
                },
                {
                  key: 'welcomePage',
                  name: 'AI Welcome Page',
                  description: 'Landing page for AI bots',
                  requiredPlan: 'Professional'
                },
                {
                  key: 'collectionsJson',
                  name: 'Collections JSON Feed',
                  description: 'Category data for better AI understanding',
                  requiredPlan: 'Growth'
                },
                {
                  key: 'storeMetadata',
                  name: 'Store Metadata for AI Search',
                  description: 'Organization & LocalBusiness schema',
                  requiredPlan: 'Growth Extra'
                },
                {
                  key: 'schemaData',
                  name: 'Advanced Schema Data',
                  description: 'BreadcrumbList, FAQPage & more',
                  requiredPlan: 'Enterprise'
                }
              ].map((feature) => {
                const isAvailable = isFeatureAvailable(feature.key);
                const isEnabled = !!settings?.features?.[feature.key];
                
                return (
                  <Box key={feature.key}
                    padding="200" 
                    background={isAvailable ? "bg-surface" : "bg-surface-secondary"}
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border"
                  >
                    {isAvailable ? (
                      <InlineStack align="space-between" blockAlign="center">
                        <Box flexGrow={1}>
                          <Checkbox
                            label={feature.name}
                            checked={isEnabled}
                            onChange={() => toggleFeature(feature.key)}
                            helpText={feature.description}
                          />
                        </Box>
                        {/* View button is outside checkbox and shows only for saved features */}
                        {originalSettings?.features?.[feature.key] && (
                          <Button
                            size="slim"
                            onClick={() => viewJson(feature.key, feature.name)}
                          >
                            View
                          </Button>
                        )}
                      </InlineStack>
                    ) : (
                      <Checkbox
                        label={
                          <InlineStack gap="200" align="center">
                            <Text variant="bodySm" tone="subdued">
                              {feature.name}
                            </Text>
                            {feature.requiredPlan && (
                              <Badge tone="info" size="small">
                                {feature.requiredPlan}
                                {feature.requiredPlan !== 'Enterprise' && '+'} 
                              </Badge>
                            )}
                          </InlineStack>
                        }
                        checked={false}
                        onChange={() => toggleFeature(feature.key)}
                        disabled={true}
                        helpText={`Upgrade to ${feature.requiredPlan} plan to enable`}
                      />
                    )}
                  </Box>
                );
              })}
            </div>
          </BlockStack>
        </Box>
      </Card>

      {/* Available Endpoints - commented out, now using View buttons */}
      {/* {(settings?.features?.productsJson || settings?.features?.collectionsJson || settings?.features?.storeMetadata || settings?.features?.schemaData || settings?.features?.aiSitemap || settings?.features?.welcomePage) && (
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Available AI Endpoints</Text>
              
              <BlockStack gap="200">
                {settings?.features?.productsJson && (
                  <InlineStack align="space-between">
                    <Text>Products Feed:</Text>
                    <Link url={`/ai/products.json?shop=${shop}`} external>
                      /ai/products.json
                    </Link>
                  </InlineStack>
                )}
                
                {settings?.features?.collectionsJson && (
                  <InlineStack align="space-between">
                    <Text>Collections Feed:</Text>
                    <Link url={`/ai/collections-feed.json?shop=${shop}`} external>
                      /ai/collections-feed.json
                    </Link>
                  </InlineStack>
                )}
                
                {settings?.features?.storeMetadata && (
                  <InlineStack align="space-between">
                    <Text>Store Metadata:</Text>
                    <Link url={`/ai/store-metadata.json?shop=${shop}`} external>
                      /ai/store-metadata.json
                    </Link>
                  </InlineStack>
                )}
                
                {settings?.features?.schemaData && (
                  <InlineStack align="space-between">
                    <Text>Advanced Schema Data:</Text>
                    <Link url={`/ai/schema-data.json?shop=${shop}`} external>
                      /ai/schema-data.json
                    </Link>
                  </InlineStack>
                )}
                
                {settings?.features?.aiSitemap && (
                  <InlineStack align="space-between">
                    <Text>AI Sitemap:</Text>
                    <Link url={`/ai/sitemap-feed.xml?shop=${shop}`} external>
                      /ai/sitemap-feed.xml
                    </Link>
                  </InlineStack>
                )}
                
                {settings?.features?.welcomePage && (
                  <InlineStack align="space-between">
                    <Text>Welcome Page:</Text>
                    <Link url={`/ai/welcome?shop=${shop}`} external>
                      /ai/welcome
                    </Link>
                  </InlineStack>
                )}
              </BlockStack>
            </BlockStack>
          </Box>
        </Card>
      )} */}

      {/* Save and Reset Buttons */}
      <InlineStack gap="200" align="end">
        <Button
          tone="critical"
          onClick={async () => {
            if (window.confirm('Are you sure you want to reset all AI Discovery settings to defaults?')) {
              try {
                const res = await fetch(`/api/ai-discovery/settings?shop=${shop}`, {
                  method: 'DELETE'
                });
                
                if (res.ok) {
                  setToast('Settings reset successfully');
                  setOriginalSettings(null); // Clear original settings too
                  setTimeout(() => {
                    window.location.reload();
                  }, 1000);
                } else {
                  throw new Error('Failed to reset');
                }
              } catch (error) {
                console.error('Failed to reset:', error);
                setToast('Failed to reset settings');
              }
            }
          }}
        >
          Reset to Defaults
        </Button>
        
        <Button
          primary
          size="large"
          loading={saving}
          onClick={saveSettings}
          disabled={!settings}
        >
          Save Settings
        </Button>
      </InlineStack>

      {/* Robots.txt Modal */}
      {showRobotsModal && (
        <Modal
          open={showRobotsModal}
          onClose={() => setShowRobotsModal(false)}
          title="robots.txt Configuration"
          primaryAction={{
            content: 'Copy to clipboard',
            onAction: () => {
              navigator.clipboard.writeText(robotsTxt);
              setToast('Copied to clipboard!');
            }
          }}
          secondaryActions={[
            {
              content: 'Close',
              onAction: () => setShowRobotsModal(false)
            }
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {!['growth', 'growth_extra', 'enterprise'].includes(normalizePlan(settings?.plan)) && (
                <Banner status="info" title="Manual Configuration Steps">
                  <ol style={{ marginLeft: '20px', marginTop: '10px' }}>
                    <li>Copy the robots.txt content below</li>
                    <li>Go to <strong>Online Store → Themes</strong></li>
                    <li>Click <strong>Actions → Edit code</strong> on your active theme</li>
                    <li>In the file browser, look for <strong>robots.txt.liquid</strong></li>
                    <li>If it doesn't exist, click <strong>Add a new template</strong> → Select "robots" → Create</li>
                    <li>Replace the content with what you copied</li>
                    <li>Click <strong>Save</strong></li>
                  </ol>
                </Banner>
              )}
              
              <Box padding="200" background="bg-surface-secondary" borderRadius="100">
                <pre style={{ 
                  whiteSpace: 'pre-wrap', 
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  margin: 0,
                  overflow: 'auto',
                  maxHeight: '400px'
                }}>
                  {robotsTxt}
                </pre>
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* No Bots Selected Modal */}
      {showNoBotsModal && (
        <Modal
          open={showNoBotsModal}
          onClose={() => setShowNoBotsModal(false)}
          title="No AI Bots Selected"
          primaryAction={{
            content: 'Got it',
            onAction: () => setShowNoBotsModal(false)
          }}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner status="warning">
                <p>You haven't selected any AI bots yet.</p>
              </Banner>
              
              <Text>To configure robots.txt:</Text>
              <ol style={{ marginLeft: '20px', marginTop: '10px' }}>
                <li>Select AI bots from the "AI Bot Access Control" section above</li>
                <li>Click "Save Settings" to save your selections</li>
                <li>Then click "Apply Automatically" to configure robots.txt</li>
              </ol>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Manual Instructions Modal */}
      {showManualInstructions && (
        <Modal
          open={showManualInstructions}
          onClose={() => setShowManualInstructions(false)}
          title="Manual robots.txt Configuration"
          primaryAction={{
            content: 'Continue',
            onAction: () => {
              setShowManualInstructions(false);
              setShowRobotsModal(true);
            }
          }}
          secondaryActions={[{
            content: 'Cancel',
            onAction: () => setShowManualInstructions(false)
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text variant="headingMd">How to add robots.txt manually:</Text>
              
              <ol style={{ marginLeft: '20px', marginTop: '10px' }}>
                <li>Click "Continue" to see your custom robots.txt content</li>
                <li>Copy the generated content</li>
                  <li>Go to <strong>Online Store → Themes</strong></li>
                  <li>Click <strong>Actions → Edit code</strong> on your active theme</li>
                <li>Find or create <strong>robots.txt.liquid</strong> file</li>
                <li>Paste the content and save</li>
              </ol>
              
              <Banner status="info">
                <p>This allows AI bots to discover and properly index your products.</p>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Test Plan Switcher - само за development */}
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Test Plan Switcher (Dev Only)</Text>
            <InlineStack gap="200">
              <Button onClick={() => setTestPlan('starter')}>Starter</Button>
              <Button onClick={() => setTestPlan('professional')}>Professional</Button>
              <Button onClick={() => setTestPlan('growth')}>Growth</Button>
              <Button onClick={() => setTestPlan('growth extra')}>Growth Extra</Button>
              <Button onClick={() => setTestPlan('enterprise')}>Enterprise</Button>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>

      {/* JSON View Modal */}
      {jsonModalOpen && (
        <Modal
          open={jsonModalOpen}
          onClose={() => {
            setJsonModalOpen(false);
            setJsonModalContent(null);
          }}
          title={jsonModalTitle}
          primaryAction={{
            content: 'Copy',
            onAction: () => {
              navigator.clipboard.writeText(jsonModalContent);
              setToast('Copied to clipboard!');
            },
            disabled: loadingJson
          }}
          secondaryActions={[{
            content: 'Close',
            onAction: () => {
              setJsonModalOpen(false);
              setJsonModalContent(null);
            }
          }]}
        >
          <Modal.Section>
            <Box padding="200" background="bg-surface-secondary" borderRadius="100">
              {loadingJson ? (
                <InlineStack align="center">
                  <Spinner size="small" />
                  <Text>Loading...</Text>
                </InlineStack>
              ) : (
                <pre style={{ 
                  whiteSpace: 'pre-wrap', 
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  margin: 0,
                  overflow: 'auto',
                  maxHeight: '400px'
                }}>
                  {jsonModalContent}
                </pre>
              )}
            </Box>
          </Modal.Section>
        </Modal>
      )}

      {/* Toast notifications */}
      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </BlockStack>
  );
}

/* 
ЗАКОМЕНТИРАН СТАР КОД ЗА ADVANCED SCHEMA CHECKBOX - ЗА ТЕСТВАНЕ

onChange={async (checked) => {
  console.log('Advanced Schema checkbox clicked:', checked);
  setAdvancedSchemaEnabled(checked);
  setSchemaError('');
  
  // Save the setting in AI Discovery settings
  try {
    console.log('Saving settings to AI Discovery...');
    const saveRes = await fetch('/api/ai-discovery/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop,
        ...settings,
        advancedSchemaEnabled: checked
      })
    });
    
    console.log('Save response status:', saveRes.status);
    
    if (!saveRes.ok) {
      const error = await saveRes.json();
      console.error('Save error:', error);
      throw new Error('Failed to save settings');
    }
    
    console.log('Advanced Schema setting saved successfully');
  } catch (err) {
    console.error('Failed to save Advanced Schema setting:', err);
    setSchemaError('Failed to save settings');
    setAdvancedSchemaEnabled(false);
    return;
  }
  
  // Trigger schema generation if enabled
  if (checked) {
    console.log('Triggering schema generation...');
    console.log('Shop:', shop);
    setSchemaGenerating(true);
    
    try {
      const url = '/api/schema/generate-all';
      console.log('Calling:', url);
      
      const schemaRes = await fetch(url, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop })
      });
      
      console.log('Schema response status:', schemaRes.status);
      const result = await schemaRes.json();
      console.log('Schema generation result:', result);
      
      if (!schemaRes.ok) {
        throw new Error(result.error || 'Failed to start generation');
      }
      
      // Show progress for 30 seconds
      setTimeout(() => {
        setSchemaGenerating(false);
      }, 30000);
      
    } catch (err) {
      console.error('Schema generation error:', err);
      setSchemaError(err.message);
      setSchemaGenerating(false);
      setAdvancedSchemaEnabled(false);
    }
  }
}}
*/