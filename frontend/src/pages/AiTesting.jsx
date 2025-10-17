// frontend/src/pages/AiTesting.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Box,
  Text,
  Button,
  InlineStack,
  Banner,
  Toast,
  BlockStack,
  TextField,
  Badge,
  Divider,
  Modal
} from '@shopify/polaris';
import { makeSessionFetch } from '../lib/sessionFetch.js';

const qs = (k, d = '') => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };

export default function AiTesting({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  
  const [toastContent, setToastContent] = useState('');
  const api = useMemo(() => makeSessionFetch(), []);
  const [currentPlan, setCurrentPlan] = useState(null);
  const [aiSimulationResponse, setAiSimulationResponse] = useState('');
  const [showAiBotModal, setShowAiBotModal] = useState(false);
  const [selectedBot, setSelectedBot] = useState(null);
  const [customQuestion, setCustomQuestion] = useState('');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [showEndpointUpgrade, setShowEndpointUpgrade] = useState(false);
  const [endpointUpgradeInfo, setEndpointUpgradeInfo] = useState(null);

  useEffect(() => {
    if (shop) {
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
      
      console.log('[AI-TESTING] Plan data:', data);
      setCurrentPlan(data?.data?.plansMe?.plan);
    } catch (err) {
      console.error('[AI-TESTING] Error loading plan:', err);
    }
  };

  // Plan-based feature availability (synced with Settings.jsx)
  const isFeatureAvailable = (feature) => {
    if (!currentPlan) return false;
    
    const planHierarchy = ['Starter', 'Professional', 'Growth', 'Growth Extra', 'Enterprise'];
    const currentPlanIndex = planHierarchy.indexOf(currentPlan);
    
    switch (feature) {
      // AI Discovery Features (synced with Settings.jsx)
      case 'productsJson':
        return currentPlanIndex >= 0; // All plans
      case 'storeMetadata':
        return currentPlanIndex >= 1; // Professional+
      case 'welcomePage':
      case 'collectionsJson':
        return currentPlanIndex >= 2; // Growth+
      case 'aiSitemap':
        return currentPlanIndex >= 3; // Growth Extra+
      case 'schemaData':
        return currentPlanIndex >= 4; // Enterprise
      
      // AI Bot Testing (synced with Settings.jsx)
      case 'meta':
        return currentPlanIndex >= 0; // Starter+ (Meta AI)
      case 'claude':
        return currentPlanIndex >= 0; // Starter+ (Anthropic Claude)
      case 'gemini':
        return currentPlanIndex >= 1; // Professional+ (Google Gemini)
      case 'chatgpt':
        return currentPlanIndex >= 2; // Growth+ (OpenAI ChatGPT)
      case 'perplexity':
        return currentPlanIndex >= 3; // Growth Extra+ (Perplexity)
      case 'deepseek':
        return currentPlanIndex >= 4; // Enterprise (DeepSeek)
      default:
        return false;
    }
  };

  const getRequiredPlan = (feature) => {
    switch (feature) {
      // AI Discovery Features
      case 'storeMetadata':
        return 'Professional';
      case 'welcomePage':
      case 'collectionsJson':
        return 'Growth';
      case 'aiSitemap':
        return 'Growth Extra';
      case 'schemaData':
        return 'Enterprise';
      
      // AI Bot Testing
      case 'gemini':
        return 'Professional';
      case 'chatgpt':
        return 'Growth';
      case 'perplexity':
        return 'Growth Extra';
      case 'deepseek':
        return 'Enterprise';
      default:
        return 'Professional';
    }
  };

  // Check if endpoint requires plan upgrade
  const getEndpointRequirement = (endpointName) => {
    // All endpoints are available for all plans now
    // (This is a placeholder for future restrictions)
    return { available: true, requiredPlan: null };
  };

  // Open endpoint with plan check
  const openEndpoint = (url, endpointName, requiredPlan = null) => {
    if (requiredPlan) {
      const planHierarchy = ['Starter', 'Professional', 'Growth', 'Growth Extra', 'Enterprise'];
      const currentIndex = planHierarchy.indexOf(currentPlan);
      const requiredIndex = planHierarchy.indexOf(requiredPlan);
      
      if (currentIndex < requiredIndex) {
        setEndpointUpgradeInfo({
          endpoint: endpointName,
          currentPlan: currentPlan,
          requiredPlan: requiredPlan
        });
        setShowEndpointUpgrade(true);
        return;
      }
    }
    
    // Open in new window
    window.open(url, '_blank');
  };

  const openAiBotModal = (botName, botUrl) => {
    setSelectedBot({ name: botName, url: botUrl });
    setShowAiBotModal(true);
  };

  const simulateAIResponse = async (queryType, question = null) => {
    try {
      setAiSimulationResponse('Generating AI response...');
      
      let url = `/api/ai-discovery/simulate?shop=${shop}&type=${queryType}`;
      if (question) {
        url += `&question=${encodeURIComponent(question)}`;
      }
      
      const response = await api(url, {
        method: 'GET'
      });
      
      setAiSimulationResponse(response.response || 'No response generated');
    } catch (error) {
      console.error('[AI-TESTING] Simulation error:', error);
      console.log('[AI-TESTING] Error status:', error.status);
      console.log('[AI-TESTING] Error requiresUpgrade:', error.requiresUpgrade);
      console.log('[AI-TESTING] Error requiresPurchase:', error.requiresPurchase);
      
      // Check for 402 status (payment required)
      if (error.status === 402) {
        // Plan upgrade required (Starter plan)
        if (error.requiresUpgrade) {
          setTokenError(error);
          setShowUpgradeModal(true);
          setAiSimulationResponse('');
          return;
        }
        
        // Token purchase required (Professional/Growth without tokens)
        if (error.requiresPurchase) {
          setTokenError(error);
          setShowTokenModal(true);
          setAiSimulationResponse('');
          return;
        }
      }
      
      setAiSimulationResponse('Error generating response. Please try again.');
      setToastContent('Failed to simulate AI response');
    }
  };

  return (
    <>
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">AI Testing</Text>
            
            <Banner tone="info">
              <Text>Test how AI models discover and understand your store content. Check if your structured data and AI Discovery features are working correctly.</Text>
            </Banner>

            {/* AI Discovery Endpoints */}
            <Card>
              <Box padding="300">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">AI Discovery Endpoints</Text>
                  
                  <Text variant="bodyMd" tone="subdued">
                    These are the endpoints that AI bots use to discover and understand your store content.
                  </Text>

                  <BlockStack gap="300">
                    {/* Products JSON Feed - Always available */}
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">Products JSON Feed</Text>
                        <Text variant="bodySm" tone="subdued">Bulk product data for AI consumption</Text>
                      </BlockStack>
                      <Button 
                        onClick={() => openEndpoint(`https://${shop}/apps/new-ai-seo/ai/products.json?shop=${shop}`, 'Products JSON Feed')}
                        size="slim"
                      >
                        View
                      </Button>
                    </InlineStack>

                    <Divider />

                    {/* Store Metadata - Professional+ */}
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">Store Metadata for AI Search</Text>
                        <Text variant="bodySm" tone="subdued">Organization schema & AI metadata</Text>
                      </BlockStack>
                      <Button 
                        onClick={() => openEndpoint(`https://${shop}/apps/new-ai-seo/ai/store-metadata.json?shop=${shop}`, 'Store Metadata for AI Search', 'Professional')}
                        size="slim"
                      >
                        View
                      </Button>
                    </InlineStack>

                    <Divider />

                    {/* AI Welcome Page - Growth+ */}
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">AI Welcome Page</Text>
                        <Text variant="bodySm" tone="subdued">Landing page for AI bots</Text>
                      </BlockStack>
                      <Button 
                        onClick={() => openEndpoint(`https://${shop}/apps/new-ai-seo/ai/welcome?shop=${shop}`, 'AI Welcome Page', 'Growth')}
                        size="slim"
                      >
                        View
                      </Button>
                    </InlineStack>

                    <Divider />

                    {/* Collections JSON Feed - Growth+ */}
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">Collections JSON Feed</Text>
                        <Text variant="bodySm" tone="subdued">Category data for better AI understanding</Text>
                      </BlockStack>
                      <Button 
                        onClick={() => openEndpoint(`https://${shop}/apps/new-ai-seo/ai/collections-feed.json?shop=${shop}`, 'Collections JSON Feed', 'Growth')}
                        size="slim"
                      >
                        View
                      </Button>
                    </InlineStack>

                    <Divider />

                    {/* AI-Optimized Sitemap - Growth Extra+ */}
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">AI-Optimized Sitemap</Text>
                        <Text variant="bodySm" tone="subdued">Optimized sitemap for AI bots</Text>
                      </BlockStack>
                      <Button 
                        onClick={() => openEndpoint(`https://${shop}/apps/new-ai-seo/ai/sitemap-feed.xml?shop=${shop}`, 'AI-Optimized Sitemap', 'Growth Extra')}
                        size="slim"
                      >
                        View
                      </Button>
                    </InlineStack>

                    <Divider />

                    {/* robots.txt - Always available */}
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">robots.txt (Dynamic)</Text>
                        <Text variant="bodySm" tone="subdued">Test how AI bots understand your store</Text>
                      </BlockStack>
                      <Button 
                        onClick={() => openEndpoint(`https://${shop}/apps/new-ai-seo/ai/robots-dynamic?shop=${shop}`, 'robots.txt')}
                        size="slim"
                      >
                        View
                      </Button>
                    </InlineStack>

                    <Divider />

                    {/* Advanced Schema Data - Enterprise */}
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">Advanced Schema Data</Text>
                        <Text variant="bodySm" tone="subdued">BreadcrumbList, FAQPage & more</Text>
                      </BlockStack>
                      <Button 
                        onClick={() => openEndpoint(`https://${shop}/apps/new-ai-seo/ai/schema-data.json?shop=${shop}`, 'Advanced Schema Data', 'Enterprise')}
                        size="slim"
                      >
                        View
                      </Button>
                    </InlineStack>
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="200">
                    {/* Meta AI - Starter+ (Always available) */}
                    <InlineStack align="space-between">
                      <Text>Meta AI Search</Text>
                      {isFeatureAvailable('meta') ? (
                        <Button
                          onClick={() => openAiBotModal('Meta AI', 'https://www.meta.ai/')}
                          size="slim"
                        >
                          Test
                        </Button>
                      ) : (
                        <Button disabled size="slim">
                          {getRequiredPlan('meta')}+ Required
                        </Button>
                      )}
                    </InlineStack>

                    {/* Anthropic Claude - Starter+ (Always available) */}
                    <InlineStack align="space-between">
                      <Text>Claude AI Search</Text>
                      {isFeatureAvailable('claude') ? (
                        <Button
                          onClick={() => openAiBotModal('Claude AI', 'https://claude.ai/')}
                          size="slim"
                        >
                          Test
                        </Button>
                      ) : (
                        <Button disabled size="slim">
                          {getRequiredPlan('claude')}+ Required
                        </Button>
                      )}
                    </InlineStack>

                    {/* Google Gemini - Professional+ */}
                    <InlineStack align="space-between">
                      <Text>Gemini AI Search</Text>
                      {isFeatureAvailable('gemini') ? (
                        <Button
                          onClick={() => openAiBotModal('Gemini AI', 'https://gemini.google.com/')}
                          size="slim"
                        >
                          Test
                        </Button>
                      ) : (
                        <Button disabled size="slim">
                          {getRequiredPlan('gemini')}+ Required
                        </Button>
                      )}
                    </InlineStack>

                    {/* ChatGPT - Growth+ */}
                    <InlineStack align="space-between">
                      <Text>ChatGPT Web Search</Text>
                      {isFeatureAvailable('chatgpt') ? (
                        <Button
                          url={`https://chat.openai.com/?q=What+products+does+${shop}+sell%3F+Tell+me+about+this+business+and+what+they+offer`}
                          external
                          size="slim"
                        >
                          Test
                        </Button>
                      ) : (
                        <Button disabled size="slim">
                          {getRequiredPlan('chatgpt')}+ Required
                        </Button>
                      )}
                    </InlineStack>

                    {/* Perplexity - Growth Extra+ */}
                    <InlineStack align="space-between">
                      <Text>Perplexity AI Search</Text>
                      {isFeatureAvailable('perplexity') ? (
                        <Button
                          url={`https://www.perplexity.ai/search?q=What+products+does+${shop}+sell%3F+Tell+me+about+this+business+and+what+they+offer`}
                          external
                          size="slim"
                        >
                          Test
                        </Button>
                      ) : (
                        <Button disabled size="slim">
                          {getRequiredPlan('perplexity')}+ Required
                        </Button>
                      )}
                    </InlineStack>

                    {/* DeepSeek - Enterprise only */}
                    <InlineStack align="space-between">
                      <Text>DeepSeek AI Search</Text>
                      {isFeatureAvailable('deepseek') ? (
                        <Button
                          onClick={() => openAiBotModal('DeepSeek AI', 'https://chat.deepseek.com/')}
                          size="slim"
                        >
                          Test
                        </Button>
                      ) : (
                        <Button disabled size="slim">
                          {getRequiredPlan('deepseek')}+ Required
                        </Button>
                      )}
                    </InlineStack>
                  </BlockStack>
                  
                  <Banner tone="info">
                    <Text>
                      <strong>How to test with AI bots:</strong><br/>
                      • <strong>Perplexity & ChatGPT:</strong> Click "Test" - they support URL parameters<br/>
                      • <strong>Meta AI, Claude, Gemini, DeepSeek:</strong> Click "Test" to open a modal with the prompt to copy
                    </Text>
                  </Banner>
                </BlockStack>
              </Box>
            </Card>

            {/* AI Search Simulation */}
            <Card>
              <Box padding="300">
                <BlockStack gap="300">
                  <Text as="h4" variant="headingSm">AI Search Simulation</Text>
                  
                  <Text variant="bodyMd" tone="subdued">
                    Test how AI bots would respond to questions about your store based on your structured data.
                  </Text>

                  <Banner tone="info">
                    <BlockStack gap="100">
                      <Text variant="bodySm" fontWeight="semibold">Simulation Details:</Text>
                      <Text variant="bodySm">• <strong>Data Source:</strong> Your store's products, collections, and metadata</Text>
                      <Text variant="bodySm">• <strong>Response Style:</strong> Concise (2-3 sentences), natural language</Text>
                      <Text variant="bodySm">• <strong>Best For:</strong> General store info, products, categories, contact details</Text>
                      <Text variant="bodySm">• <strong>Limitations:</strong> May not have real-time data (current stock, active promotions, exact shipping times)</Text>
                    </BlockStack>
                  </Banner>

                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text>What products does this store sell?</Text>
                      <Button
                        onClick={() => simulateAIResponse('products')}
                        size="slim"
                      >
                        Simulate Response
                      </Button>
                    </InlineStack>

                    <InlineStack align="space-between">
                      <Text>Tell me about this business</Text>
                      <Button
                        onClick={() => simulateAIResponse('business')}
                        size="slim"
                      >
                        Simulate Response
                      </Button>
                    </InlineStack>

                    <InlineStack align="space-between">
                      <Text>What categories does this store have?</Text>
                      <Button
                        onClick={() => simulateAIResponse('categories')}
                        size="slim"
                      >
                        Simulate Response
                      </Button>
                    </InlineStack>

                    <InlineStack align="space-between">
                      <Text>What is this store's contact information?</Text>
                      <Button
                        onClick={() => simulateAIResponse('contact')}
                        size="slim"
                      >
                        Simulate Response
                      </Button>
                    </InlineStack>
                  </BlockStack>

                  <Divider />

                  {/* Custom Question */}
                  <BlockStack gap="200">
                    <Text variant="headingSm">Ask Your Own Question</Text>
                    <TextField
                      label=""
                      value={customQuestion}
                      onChange={setCustomQuestion}
                      placeholder="e.g., What are your return policies? Do you ship internationally?"
                      autoComplete="off"
                      connectedRight={
                        <Button
                          onClick={() => {
                            if (customQuestion.trim()) {
                              simulateAIResponse('custom', customQuestion);
                            } else {
                              setToastContent('Please enter a question');
                            }
                          }}
                          disabled={!customQuestion.trim()}
                        >
                          Ask AI
                        </Button>
                      }
                    />
                  </BlockStack>

                  {aiSimulationResponse && (
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <Text variant="bodyMd" fontWeight="semibold">AI Bot Response:</Text>
                      <Box paddingBlockStart="200">
                        <Text variant="bodyMd">{aiSimulationResponse}</Text>
                      </Box>
                    </Box>
                  )}
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Box>
      </Card>

      {toastContent && (
        <Toast content={toastContent} onDismiss={() => setToastContent('')} />
      )}
      
      {/* AI Bot Modal */}
      <Modal
        open={showAiBotModal}
        onClose={() => setShowAiBotModal(false)}
        title={`Test with ${selectedBot?.name}`}
        primaryAction={{
          content: 'Copy Prompt',
          onAction: () => {
            navigator.clipboard.writeText(`What products does ${shop} sell? Tell me about this business and what they offer.`);
            setToastContent('Prompt copied to clipboard!');
          }
        }}
        secondaryActions={[
          {
            content: 'Open AI Bot',
            url: selectedBot?.url,
            external: true
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodyMd">
              1. Click "Copy Prompt" below
            </Text>
            <Text variant="bodyMd">
              2. Click "Open AI Bot" to visit {selectedBot?.name}
            </Text>
            <Text variant="bodyMd">
              3. Paste the prompt and send
            </Text>
            
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <Text variant="bodyMd" fontWeight="semibold">Prompt to test:</Text>
              <Box paddingBlockStart="200">
                <Text variant="bodyMd" as="p">
                  What products does {shop} sell? Tell me about this business and what they offer.
                </Text>
              </Box>
            </Box>
            
            <Banner tone="info">
              <Text>The AI bot will search the web and use your store's structured data to answer.</Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Endpoint Upgrade Modal */}
      <Modal
        open={showEndpointUpgrade}
        onClose={() => setShowEndpointUpgrade(false)}
        title="Upgrade Required"
        primaryAction={{
          content: 'View Plans',
          onAction: () => {
            const currentParams = new URLSearchParams(window.location.search);
            const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
            window.location.href = `/billing${paramString}`;
          }
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowEndpointUpgrade(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodyMd">
              <strong>{endpointUpgradeInfo?.endpoint}</strong> requires <strong>{endpointUpgradeInfo?.requiredPlan}</strong> plan or higher.
            </Text>
            <Text variant="bodyMd" tone="subdued">
              Your current plan: <strong>{endpointUpgradeInfo?.currentPlan}</strong>
            </Text>
            <Banner tone="info">
              <Text>Upgrade to access this advanced AI Discovery feature.</Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Upgrade Modal (Starter plan) */}
      <Modal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        title="Upgrade Required"
        primaryAction={{
          content: 'View Plans',
          onAction: () => {
            const currentParams = new URLSearchParams(window.location.search);
            const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
            window.location.href = `/billing${paramString}`;
          }
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowUpgradeModal(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodyMd">
              AI Testing requires <strong>{tokenError?.minimumPlan || 'Professional'}</strong> plan or higher.
            </Text>
            <Text variant="bodyMd" tone="subdued">
              Your current plan: <strong>{tokenError?.currentPlan || 'Starter'}</strong>
            </Text>
            <Banner tone="info">
              <Text>Upgrade to test AI responses with real store data.</Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Buy Tokens Modal (Professional/Growth) */}
      <Modal
        open={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        title="Insufficient Tokens"
        primaryAction={{
          content: 'Buy Tokens',
          onAction: () => {
            const currentParams = new URLSearchParams(window.location.search);
            const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
            window.location.href = `/billing${paramString}`;
          }
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowTokenModal(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodyMd">
              You need more tokens to use AI Testing.
            </Text>
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="bodySm">Required:</Text>
                  <Text variant="bodySm" fontWeight="semibold">{tokenError?.tokensRequired?.toLocaleString() || 0} tokens</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodySm">Available:</Text>
                  <Text variant="bodySm">{tokenError?.tokensAvailable?.toLocaleString() || 0} tokens</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodySm">Needed:</Text>
                  <Text variant="bodySm" fontWeight="semibold" tone="critical">{tokenError?.tokensNeeded?.toLocaleString() || 0} tokens</Text>
                </InlineStack>
              </BlockStack>
            </Box>
            <Banner tone="info">
              <Text>Purchase tokens to continue using AI features. Tokens never expire.</Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

