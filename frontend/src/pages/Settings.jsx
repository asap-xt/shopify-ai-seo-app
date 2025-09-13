// frontend/src/pages/Settings.jsx
import React, { useState, useEffect, useMemo } from 'react';
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
  Spinner,
  ProgressBar
} from '@shopify/polaris';
import { ClipboardIcon, ExternalIcon, ViewIcon } from '@shopify/polaris-icons';
import { makeSessionFetch } from '../lib/sessionFetch.js';

const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; } 
  catch { return d; }
};

// Helper function to normalize plan names
const normalizePlan = (plan) => {
  return (plan || 'starter').toLowerCase().replace(' ', '_');
};

export default function Settings() {
  // Debug helper
  const debugLog = (message, data = null) => {
    console.log(`[SETTINGS DEBUG] ${message}`, data || '');
  };

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
  const api = useMemo(() => makeSessionFetch(), []);
  
  // Advanced Schema Data state
  const [advancedSchemaEnabled, setAdvancedSchemaEnabled] = useState(false);
  const [processingSchema, setProcessingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState('');
  const [advancedSchemaStatus, setAdvancedSchemaStatus] = useState({
    enabled: false,
    generating: false,
    generated: false,
    progress: ''
  });
  
  // Advanced Schema generation progress state
  const [schemaGenerating, setSchemaGenerating] = useState(false);
  const [schemaProgress, setSchemaProgress] = useState({
    current: 0,
    total: 0,
    percent: 0,
    currentProduct: '',
    stats: {
      siteFAQ: false,
      products: 0,
      totalSchemas: 0
    }
  });
  const [schemaComplete, setSchemaComplete] = useState(false);
  
  const shop = qs('shop', '');

  useEffect(() => {
    if (!shop) {
      setLoading(false);
      return;
    }
    loadSettings();
  }, [shop, api]);


  // Check schema status when enabled
  useEffect(() => {
    if (advancedSchemaEnabled) {
      checkSchemaStatus();
    }
  }, [advancedSchemaEnabled]);

  // Auto-enable AI Discovery when features are selected
  useEffect(() => {
    if (settings && Object.values(settings.features || {}).some(f => f)) {
      // Автоматично включваме AI Discovery ако има избрани features
      setSettings(prev => ({
        ...prev,
        enabled: true,
        discoveryEnabled: true
      }));
    }
  }, [settings?.features]);

  const checkSchemaStatus = async () => {
    try {
      const data = await api(`/api/schema/status`, { shop });
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

  // Check generation progress
  const checkGenerationProgress = async () => {
    try {
      // Check directly in MongoDB for data
      const data = await api(`/ai/schema-data.json`, { shop });
      
      if (data.schemas && data.schemas.length > 0) {
        // Generation complete
        setSchemaComplete(true);
        setSchemaGenerating(false);
        
        // Calculate statistics
        const products = [...new Set(data.schemas.map(s => s.url?.split('/products/')[1]?.split('#')[0]))].filter(Boolean);
        
        setSchemaProgress(prev => ({
          ...prev,
          percent: 100,
          stats: {
            siteFAQ: data.site_faq ? true : false,
            products: products.length,
            totalSchemas: data.schemas.length
          }
        }));
      } else {
        // Still generating, check again
        setSchemaProgress(prev => ({
          ...prev,
          percent: Math.min(prev.percent + 10, 90), // Simulate progress
          currentProduct: 'Processing products...'
        }));
        
        // Check again in 3 seconds
        setTimeout(checkGenerationProgress, 3000);
      }
    } catch (err) {
      console.error('Progress check error:', err);
      // Try again in 3 seconds
      setTimeout(checkGenerationProgress, 3000);
    }
  };

  const loadSettings = async () => {
    try {
      const data = await api(`/api/ai-discovery/settings`, { shop });
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
    console.log('[GENERATE ROBOTS] Called with shop:', shop);
    
    try {
      const txt = await api(`/api/ai-discovery/robots-txt`, { 
        shop,
        responseType: 'text'  // <-- Важно!
      });
      
      console.log('[GENERATE ROBOTS] Received:', txt);
      
      // Ако е празен отговор (304), генерирай базов robots.txt
      if (!txt) {
        const defaultTxt = 'User-agent: *\nDisallow: /';
        setRobotsTxt(defaultTxt);
      } else {
        setRobotsTxt(txt);
      }
    } catch (error) {
      console.error('[GENERATE ROBOTS] Error:', error);
      setRobotsTxt('# Error generating robots.txt\n# ' + error.message);
    }
  };

  // Test log to check if generateRobotsTxt function exists (after definition)
  console.log('[SETTINGS DEBUG] generateRobotsTxt function exists:', typeof generateRobotsTxt);

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
      await api('/api/ai-discovery/settings', {
        method: 'POST',
        shop,
        body: {
          shop,
          bots: settings.bots,
          features: settings.features
        }
      });
      
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
      const data = await api('/api/ai-discovery/apply-robots', {
        method: 'POST',
        shop,
        body: { shop }
      });
      
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
      await api('/test/set-plan', {
        method: 'POST',
        shop,
        body: { shop, plan }
      });
      setToast(`Test plan set to ${plan}`);
      setTimeout(() => window.location.reload(), 1000);
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

      const data = await api(endpoints[feature]);
      const contentType = 'application/json'; // sessionFetch always returns JSON
      
      setJsonModalContent(JSON.stringify(data, null, 2));
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
                onClick={async () => { // <-- Добавете async
                  console.log('[ADD MANUAL] Starting...');
                  console.log('[ADD MANUAL] Settings:', settings);
                  
                  try {
                    const hasSelectedBots = Object.values(settings?.bots || {}).some(bot => bot.enabled);
                    console.log('[ADD MANUAL] Has selected bots:', hasSelectedBots);
                    
                    if (!hasSelectedBots) {
                      console.log('[ADD MANUAL] No bots, showing modal');
                      setShowNoBotsModal(true);
                    } else {
                      console.log('[ADD MANUAL] Calling generateRobotsTxt...');
                      await generateRobotsTxt(); // <-- Добавете await
                      console.log('[ADD MANUAL] Robots.txt generated, showing instructions');
                      setShowManualInstructions(true);
                    }
                  } catch (error) {
                    console.error('[ADD MANUAL] Error:', error);
                    setToast('Error generating robots.txt: ' + error.message);
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
                      const data = await api('/api/ai-discovery/apply-robots', {
                        method: 'POST',
                        shop,
                        body: { shop }
                      });
                      
                      console.log('[APPLY AUTO] Data:', data);
                      
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
                        {originalSettings?.features?.[feature.key] && feature.key !== 'schemaData' && (
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

      {/* Advanced Schema Data Management - shows only for Enterprise plan AND if enabled */}
      {normalizePlan(settings?.plan) === 'enterprise' && 
       settings?.features?.schemaData && 
       originalSettings?.features?.schemaData && (
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Advanced Schema Data Management</Text>
              <Text variant="bodyMd" tone="subdued">
                Generate and manage structured data for your products
              </Text>
              
              <InlineStack gap="300">
                <Button
                  primary
                  onClick={async () => {
                    // First check if there's existing data
                    const existingData = await api(`/ai/schema-data.json`, { shop });
                    
                    if (existingData.schemas && existingData.schemas.length > 0) {
                      // Has data - ask if to regenerate
                      if (!confirm('This will replace existing schema data. Continue?')) {
                        return;
                      }
                    }
                    
                    // Continue with generation
                    setSchemaGenerating(true);
                    setSchemaComplete(false);
                    setSchemaProgress({
                      current: 0,
                      total: 0,
                      percent: 0,
                      currentProduct: 'Initializing...',
                      stats: {
                        siteFAQ: false,
                        products: 0,
                        totalSchemas: 0
                      }
                    });
                    
                    try {
                      const data = await api('/api/schema/generate-all', {
                        method: 'POST',
                        shop,
                        body: { shop }
                      });
                      
                      // Start checking progress after 2 seconds
                      setTimeout(checkGenerationProgress, 2000);
                    } catch (err) {
                      console.error('Error:', err);
                      setToast('Failed to generate schema');
                      setSchemaGenerating(false);
                    }
                  }}
                >
                  Generate/Update Schema Data
                </Button>
                
                <Button
                  onClick={() => {
                    window.open(`/ai/schema-data.json?shop=${shop}`, '_blank');
                  }}
                >
                  View Generated Schema
                </Button>
                
                <Button
                  destructive
                  onClick={async () => {
                    if (confirm('This will delete all advanced schema data. Are you sure?')) {
                      try {
                        await api('/api/schema/delete', {
                          method: 'DELETE',
                          shop,
                          body: { shop }
                        });
                        
                        setToast('Schema data deleted successfully');
                      } catch (err) {
                        setToast('Failed to delete schema data');
                      }
                    }
                  }}
                >
                  Delete Schema Data
                </Button>
              </InlineStack>
              
              <Banner status="info" tone="subdued">
                <p>Generation creates BreadcrumbList, FAQPage, WebPage and more schemas for each product. 
                AI can access them at <code>/ai/product/[handle]/schemas.json</code></p>
              </Banner>
            </BlockStack>
          </Box>
        </Card>
      )}

      {/* Save and Reset Buttons */}
      <InlineStack gap="200" align="end">
        <Button
          tone="critical"
          onClick={async () => {
            if (window.confirm('Are you sure you want to reset all AI Discovery settings to defaults?')) {
              try {
                await api(`/api/ai-discovery/settings`, {
                  method: 'DELETE',
                  shop
                });
                
                setToast('Settings reset successfully');
                setOriginalSettings(null); // Clear original settings too
                setTimeout(() => {
                  window.location.reload();
                }, 1000);
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

      {/* Test Plan Switcher - for development only */}
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

      {/* Debug log for modal state */}
      {debugLog('Modal states', { 
        schemaGenerating, 
        schemaComplete,
        modalShouldShow: schemaGenerating && !schemaComplete 
      })}

      {/* Simple test modal */}
      {schemaGenerating && !schemaComplete && (
        <Modal
          open={schemaGenerating}
          title="Generating Advanced Schema Data"
          onClose={() => {
            debugLog('Modal close clicked');
            setSchemaGenerating(false);
          }}
        >
          <Modal.Section>
            <Text>Modal is showing! Progress: {schemaProgress.percent}%</Text>
          </Modal.Section>
        </Modal>
      )}

      {/* Schema Generation Complete Modal */}
      {schemaComplete && (
        <Modal
          open={true}
          title="Schema Generation Complete"
          onClose={() => {
            setSchemaGenerating(false);
            setSchemaComplete(false);
          }}
          primaryAction={{
            content: 'View Generated Schemas',
            onAction: () => {
              window.open(`/ai/schema-data.json?shop=${shop}`, '_blank');
              setSchemaGenerating(false);
              setSchemaComplete(false);
            }
          }}
          secondaryActions={[{
            content: 'Close',
            onAction: () => {
              setSchemaGenerating(false);
              setSchemaComplete(false);
            }
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner status="success" title="Generation successful!">
                <p>Advanced schema data has been generated for your products.</p>
              </Banner>
              
              <Text variant="headingMd">Generation Statistics</Text>
              
              <InlineStack gap="600" wrap>
                <Box>
                  <Text variant="bodyMd" tone="subdued">Site FAQ</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.siteFAQ ? '✓' : '—'}
                  </Text>
                </Box>
                
                <Box>
                  <Text variant="bodyMd" tone="subdued">Products Processed</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.products}
                  </Text>
                </Box>
                
                <Box>
                  <Text variant="bodyMd" tone="subdued">Total Schemas</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.totalSchemas}
                  </Text>
                </Box>
              </InlineStack>
              
              <Box paddingBlockStart="200">
                <Text variant="bodySm" tone="subdued">
                  Schemas are now available at /ai/product/[handle]/schemas.json
                </Text>
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Schema Generation Progress Modal */}
      {schemaGenerating && !schemaComplete && (
        <Modal
          open={true}
          title="Generating Advanced Schema Data"
          onClose={() => {}}
          noScroll
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text variant="bodyMd">
                Generating schemas for your products...
              </Text>
              <ProgressBar progress={schemaProgress.percent} size="small" />
              <Text variant="bodySm" tone="subdued">
                This process may take 1-2 minutes depending on the number of products.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Schema Generation Complete Modal */}
      {schemaComplete && (
        <Modal
          open={true}
          title="Schema Generation Complete"
          onClose={() => {
            setSchemaGenerating(false);
            setSchemaComplete(false);
          }}
          primaryAction={{
            content: 'View Generated Schemas',
            onAction: () => {
              window.open(`/ai/schema-data.json?shop=${shop}`, '_blank');
              setSchemaGenerating(false);
              setSchemaComplete(false);
            }
          }}
          secondaryActions={[{
            content: 'Close',
            onAction: () => {
              setSchemaGenerating(false);
              setSchemaComplete(false);
            }
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner status="success" title="Generation successful!">
                <p>Advanced schema data has been generated for your products.</p>
              </Banner>
              
              <Text variant="headingMd">Generation Statistics</Text>
              
              <InlineStack gap="600" wrap>
                <Box>
                  <Text variant="bodyMd" tone="subdued">Site FAQ</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.siteFAQ ? '✓' : '—'}
                  </Text>
                </Box>
                
                <Box>
                  <Text variant="bodyMd" tone="subdued">Products Processed</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.products}
                  </Text>
                </Box>
                
                <Box>
                  <Text variant="bodyMd" tone="subdued">Total Schemas</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.totalSchemas}
                  </Text>
                </Box>
              </InlineStack>
              
              <Box paddingBlockStart="200">
                <Text variant="bodySm" tone="subdued">
                  Schemas are now available at /ai/product/[handle]/schemas.json
                </Text>
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Toast notifications */}
      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </BlockStack>
  );
}

/* 
COMMENTED OLD CODE FOR ADVANCED SCHEMA CHECKBOX - FOR TESTING

onChange={async (checked) => {
  console.log('Advanced Schema checkbox clicked:', checked);
  setAdvancedSchemaEnabled(checked);
  setSchemaError('');
  
  // Save the setting in AI Discovery settings
  try {
    console.log('Saving settings to AI Discovery...');
    await api('/api/ai-discovery/settings', {
      method: 'POST',
      shop,
      body: {
        shop,
        ...settings,
        advancedSchemaEnabled: checked
      }
    });
    
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
      
      const result = await api(url, {
        method: 'POST', 
        shop,
        body: { shop }
      });
      
      console.log('Schema generation result:', result);
      
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