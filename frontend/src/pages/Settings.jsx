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
import { ClipboardIcon, ExternalIcon } from '@shopify/polaris-icons';

const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; } 
  catch { return d; }
};

// Helper function to normalize plan names
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
  
  const shop = qs('shop', '');

  useEffect(() => {
    if (!shop) {
      setLoading(false);
      return;
    }
    loadSettings();
  }, [shop]);

  const loadSettings = async () => {
    try {
      const res = await fetch(`/api/ai-discovery/settings?shop=${encodeURIComponent(shop)}`);
      if (!res.ok) throw new Error('Failed to load settings');
      
      const data = await res.json();
      console.log('Loaded settings:', data); // Debug log
      setSettings(data);
      
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
    // Check if bot is available for current plan
    if (!settings?.availableBots?.includes(botKey)) {
      setToast(`Upgrade your plan to enable ${settings.bots[botKey].name}`);
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
    if (!['growth', 'growth_extra', 'enterprise'].includes(settings?.plan)) {
      setToast('Automatic robots.txt requires Growth plan or higher');
      return;
    }

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
      autoRobotsTxt: ['growth', 'growth_extra', 'enterprise'],
      storeMetadata: ['growth_extra', 'enterprise'],
      schemaData: ['enterprise']
    };
    
    return availability[featureKey]?.includes(plan) || false;
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
            
            <Banner>
              <p>
                {['growth', 'growth_extra', 'enterprise'].includes(normalizePlan(settings?.plan)) ? 
                  "With your plan, you can apply robots.txt changes directly to your theme!" :
                  "Copy the generated rules and add them to your theme's robots.txt.liquid file."
                }
              </p>
            </Banner>
            
            <InlineStack gap="200">
              <Button onClick={() => setShowRobotsModal(true)}>
                View robots.txt
              </Button>
              
              {['growth', 'growth_extra', 'enterprise'].includes(normalizePlan(settings?.plan)) && (
                <Button 
                  primary 
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/ai-discovery/apply-robots', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ shop })
                      });
                      
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      
                      setToast(data.message || 'robots.txt applied successfully!');
                    } catch (error) {
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
              Available data endpoints for AI consumption
            </Text>
            
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
                
                return (
                  <Box key={feature.key}
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
                              {feature.name}
                            </Text>
                            {!isAvailable && feature.requiredPlan && (
                              <Badge tone="info" size="small">
                                {feature.requiredPlan}
                                {feature.requiredPlan !== 'Enterprise' && '+'} 
                              </Badge>
                            )}
                          </InlineStack>
                        }
                        checked={!!settings?.features?.[feature.key]}
                        onChange={() => toggleFeature(feature.key)}
                        disabled={!isAvailable}
                        helpText={
                          !isAvailable && feature.requiredPlan ? 
                            `Upgrade to ${feature.requiredPlan} plan to enable` :
                          isAvailable ? feature.description : ''
                        }
                      />
                    </BlockStack>
                  </Box>
                );
              })}
            </div>
          </BlockStack>
        </Box>
      </Card>

      {/* Available Endpoints */}
      {(settings?.features?.productsJson || settings?.features?.welcomePage) && (
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
                
                {settings?.features?.aiSitemap && (
                  <InlineStack align="space-between">
                    <Text>AI Sitemap:</Text>
                    <Link url={`/api/sitemap/generate?shop=${shop}`} external>
                      /api/sitemap/generate
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
      )}

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
      <Modal
        open={showRobotsModal}
        onClose={() => setShowRobotsModal(false)}
        title="Generated robots.txt"
        primaryAction={{
          content: 'Copy to clipboard',
          onAction: copyToClipboard,
          icon: ClipboardIcon
        }}
        secondaryActions={[{
          content: 'Close',
          onAction: () => setShowRobotsModal(false)
        }]}
      >
        <Modal.Section>
          <Box padding="200" background="bg-surface-secondary" borderRadius="200">
            <TextField
              label=""
              value={robotsTxt}
              multiline={15}
              readOnly
              autoComplete="off"
            />
          </Box>
        </Modal.Section>
      </Modal>

      {/* Toast notifications */}
      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </BlockStack>
  );
}