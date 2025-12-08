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
  Modal,
  ProgressBar,
  Spinner,
  Layout
} from '@shopify/polaris';
import { makeSessionFetch } from '../lib/sessionFetch.js';
import InsufficientTokensModal from '../components/InsufficientTokensModal.jsx';
import TrialActivationModal from '../components/TrialActivationModal.jsx';
import TokenPurchaseModal from '../components/TokenPurchaseModal.jsx';
import AIEOScoreCard from '../components/AIEOScoreCard.jsx';
import { PLAN_HIERARCHY, PLAN_HIERARCHY_LOWERCASE, getPlanIndex, isPlanAtLeast } from '../hooks/usePlanHierarchy.js';

const qs = (k, d = '') => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };

export default function AiTesting({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  
  // Navigation helper (like Dashboard.jsx)
  const navigate = (path) => {
    const currentParams = new URLSearchParams(window.location.search);
    const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
    window.location.href = `${path}${paramString}`;
  };
  
  const [toastContent, setToastContent] = useState('');
  const api = useMemo(() => makeSessionFetch(), []);
  const [currentPlan, setCurrentPlan] = useState(null);
  const [aiSimulationResponse, setAiSimulationResponse] = useState('');
  const [showAiBotModal, setShowAiBotModal] = useState(false);
  const [selectedBot, setSelectedBot] = useState(null);
  const [customQuestion, setCustomQuestion] = useState('');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showTrialActivationModal, setShowTrialActivationModal] = useState(false);
  const [showTokenPurchaseModal, setShowTokenPurchaseModal] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [showEndpointUpgrade, setShowEndpointUpgrade] = useState(false);
  const [endpointUpgradeInfo, setEndpointUpgradeInfo] = useState(null);
  
  // New state for automated testing
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState(0);
  
  // New state for AI validation
  const [aiTestResults, setAiTestResults] = useState({});
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestProgress, setAiTestProgress] = useState(0);
  const [tokenBalance, setTokenBalance] = useState(null);
  const [trialEndsAt, setTrialEndsAt] = useState(null);
  const [aiEOScore, setAiEOScore] = useState(null);
  const [stats, setStats] = useState({
    totalProducts: 0,
    optimizedProducts: 0,
    totalCollections: 0,
    optimizedCollections: 0
  });
  const [storeUrl, setStoreUrl] = useState(''); // Public domain for AI prompts
  const [storeName, setStoreName] = useState('');
  const [lastTestTimestamp, setLastTestTimestamp] = useState(null);
  const [lastAiTestTimestamp, setLastAiTestTimestamp] = useState(null);

  // Review banner state (same as Dashboard)
  const [dismissedReviewBanner, setDismissedReviewBanner] = useState(() => {
    try {
      return localStorage.getItem(`dismissedReviewBanner_${shop}`) === 'true';
    } catch {
      return false;
    }
  });
  
  const [clickedReviewRate, setClickedReviewRate] = useState(() => {
    try {
      return localStorage.getItem(`clickedReviewRate_${shop}`) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (shop) {
      loadPlan();
      loadTokenBalance();
      loadStats();
      loadSavedTestResults();
    }
  }, [shop, api]);

  // Load saved test results from localStorage
  const loadSavedTestResults = () => {
    try {
      const savedData = localStorage.getItem(`ai-test-results-${shop}`);
      if (savedData) {
        const parsed = JSON.parse(savedData);
        if (parsed.results && parsed.timestamp) {
          setTestResults(parsed.results);
          setLastTestTimestamp(new Date(parsed.timestamp));
        }
      }
      
      // Load AI validation results if available
      const savedAiData = localStorage.getItem(`ai-validation-results-${shop}`);
      if (savedAiData) {
        const parsed = JSON.parse(savedAiData);
        if (parsed.results) {
          setAiTestResults(parsed.results);
        }
        if (parsed.timestamp) {
          setLastAiTestTimestamp(new Date(parsed.timestamp));
        }
      }
    } catch (err) {
      console.error('[AI-TESTING] Error loading saved test results:', err);
    }
  };

  // Save test results to localStorage
  const saveTestResults = (results) => {
    try {
      const dataToSave = {
        results,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem(`ai-test-results-${shop}`, JSON.stringify(dataToSave));
      setLastTestTimestamp(new Date());
    } catch (err) {
      console.error('[AI-TESTING] Error saving test results:', err);
    }
  };
  
  // Refresh token balance when component becomes visible (after returning from billing page)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && shop) {
        loadTokenBalance();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [shop, api]);

  const loadPlan = async () => {
    try {
      // Use REST API instead of GraphQL to avoid Redis cache issues
      const data = await api(`/api/billing/info?shop=${shop}`);
      const planFromApi = data?.subscription?.plan || 'Starter';
      
      // Set plan, token balance, and trial info from single API call
      setCurrentPlan(planFromApi);
      setTokenBalance(data?.tokens?.balance || 0);
      setTrialEndsAt(data?.subscription?.trialEndsAt || null);
    } catch (err) {
      console.error('[AI-TESTING] Error loading billing info:', err);
      setCurrentPlan('Starter'); // Fallback
      setTokenBalance(0);
    }
  };

  const loadTokenBalance = async () => {
    try {
      const data = await api(`/api/billing/info?shop=${shop}`);
      // Only update token balance (plan doesn't change frequently)
      setTokenBalance(data?.tokens?.balance || 0);
      setTrialEndsAt(data?.subscription?.trialEndsAt || null);
    } catch (err) {
      console.error('[AI-TESTING] Error loading token balance:', err);
    }
  };

  const loadStats = async () => {
    try {
      // First, try to load from localStorage (synced from Dashboard Sync)
      let statsData = null;
      let needsFreshData = false;
      
      try {
        const savedStats = localStorage.getItem(`dashboard-stats-${shop}`);
        if (savedStats) {
          const parsed = JSON.parse(savedStats);
          // Check if stats are recent (less than 5 minutes old)
          const statsAge = parsed.timestamp ? (Date.now() - new Date(parsed.timestamp).getTime()) : Infinity;
          if (statsAge < 5 * 60 * 1000) { // 5 minutes
            statsData = parsed;
            // If cache doesn't have storeUrl, we need to fetch fresh data
            if (!parsed.storeUrl) {
              needsFreshData = true;
            }
          }
        }
      } catch (err) {
        console.error('[AI-TESTING] Error loading stats from localStorage:', err);
      }
      
      // If no recent stats in localStorage OR cache is missing storeUrl, fetch from API
      if (!statsData || needsFreshData) {
        const data = await api(`/api/dashboard/stats?shop=${shop}`);
        statsData = {
          totalProducts: data?.products?.total || 0,
          optimizedProducts: data?.products?.optimized || 0,
          totalCollections: data?.collections?.total || 0,
          optimizedCollections: data?.collections?.optimized || 0,
          storeName: data?.store?.name || '',
          storeUrl: data?.store?.primaryDomain || '',
          timestamp: new Date().toISOString()
        };
        
        // Save to localStorage for consistency
        try {
          localStorage.setItem(`dashboard-stats-${shop}`, JSON.stringify(statsData));
        } catch (err) {
          console.error('[AI-TESTING] Error saving stats to localStorage:', err);
        }
      }
      
      setStats({
        totalProducts: statsData.totalProducts || 0,
        optimizedProducts: statsData.optimizedProducts || 0,
        totalCollections: statsData.totalCollections || 0,
        optimizedCollections: statsData.optimizedCollections || 0
      });
      
      // Set store info for AI prompts (use public domain, not myshopify.com)
      if (statsData.storeUrl) {
        setStoreUrl(statsData.storeUrl);
      }
      if (statsData.storeName) {
        setStoreName(statsData.storeName);
      }
    } catch (err) {
      console.error('[AI-TESTING] Error loading stats:', err);
    }
  };

  // Plan-based feature availability (synced with Settings.jsx)
  const isFeatureAvailable = (feature) => {
    if (!currentPlan) return false;
    
    const currentPlanIndex = getPlanIndex(currentPlan);
    
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
      const currentIndex = getPlanIndex(currentPlan);
      const requiredIndex = getPlanIndex(requiredPlan);
      
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

  // Run automated tests for all endpoints
  const runAllTests = async () => {
    setTesting(true);
    setTestProgress(0);
    setTestResults({});
    
    try {
      // Call backend endpoint to run tests
      const response = await api('/api/ai-testing/run-tests', {
        method: 'POST',
        body: { shop }
      });
      
      if (response.results) {
        setTestResults(response.results);
        setTestProgress(100);
        saveTestResults(response.results); // Save to localStorage
        setToastContent('Basic tests completed!');
      } else {
        setToastContent('Testing failed. Please try again.');
      }
    } catch (error) {
      console.error('[AI-TESTING] Error running tests:', error);
      setToastContent('Failed to run tests. Please try again.');
    } finally {
      setTesting(false);
    }
  };

  // Run AI-powered validation
  const runAiValidation = async () => {
    // Check if Professional+ plan (case-insensitive)
    const currentIndex = getPlanIndex(currentPlan);
    
    if (currentIndex < 1) { // Less than Professional
      setTokenError({
        message: 'AI-powered validation requires Professional plan or higher',
        requiredPlan: 'Professional',
        currentPlan: currentPlan || 'Starter'
      });
      setShowUpgradeModal(true);
      return;
    }
    
    // Token balance check removed - let backend calculate exact cost
    // Backend will return accurate token estimation based on enabled endpoints
    
    setAiTesting(true);
    setAiTestProgress(0);
    setAiTestResults({});
    
    try {
      // Call backend endpoint to run AI validation
      const response = await api('/api/ai-testing/ai-validate', {
        method: 'POST',
        body: { 
          shop,
          endpointResults: testResults // Pass basic test results
        }
      });
      
      if (response && response.results) {
        setAiTestResults(response.results);
        setAiTestProgress(100);
        
        // Save AI test results to localStorage (for Dashboard to use)
        try {
          const dataToSave = {
            results: response.results,
            timestamp: new Date().toISOString()
          };
          localStorage.setItem(`ai-validation-results-${shop}`, JSON.stringify(dataToSave));
          setLastAiTestTimestamp(new Date());
        } catch (err) {
          console.error('[AI-TESTING] Error saving AI test results:', err);
        }
        
        // Store AIEO score if available
        if (response.aiEOScore) {
          const scoreData = response.aiEOScore;
          // Always set if present, regardless of structure
          setAiEOScore(scoreData);
          setToastContent(`AI validation completed! Score: ${scoreData.score || 'N/A'}/100 (${response.tokensUsed || 0} tokens used)`);
        } else {
          // Reset score if not present
          setAiEOScore(null);
          setToastContent(`AI validation completed! (${response.tokensUsed || 0} tokens used)`);
        }
        
        // Reload token balance
        loadTokenBalance();
      } else {
        setAiEOScore(null);
        setToastContent('AI validation failed. Please try again.');
      }
    } catch (error) {
      // Check for 402 status (payment required)
      if (error.status === 402) {
        if (error.trialRestriction && error.requiresActivation) {
          // Growth Extra/Enterprise in trial → Show "Activate Plan" modal
          setTokenError(error);
          setShowTrialActivationModal(true);
          return;
        }
        
        if (error.requiresUpgrade) {
          setTokenError(error);
          setShowUpgradeModal(true);
          return;
        }
        
        if (error.requiresPurchase) {
          setTokenError(error);
          setShowTokenModal(true);
          return;
        }
      }
      
      setToastContent('Failed to run AI validation. Please try again.');
    } finally {
      setAiTesting(false);
    }
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
      
      // Check for 402 status (payment required)
      if (error.status === 402) {
        if (error.trialRestriction && error.requiresActivation) {
          // Growth Extra/Enterprise in trial → Show "Activate Plan" modal
          setTokenError(error);
          setShowTrialActivationModal(true);
          setAiSimulationResponse('');
          return;
        }
        
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
  
  // Review banner handlers (same as Dashboard)
  const handleDismissReviewBanner = () => {
    try {
      localStorage.setItem(`dismissedReviewBanner_${shop}`, 'true');
      setDismissedReviewBanner(true);
    } catch (error) {
      console.error('[AiTesting] Error saving dismissed review banner state:', error);
    }
  };
  
  const handleClickReviewRate = () => {
    try {
      localStorage.setItem(`clickedReviewRate_${shop}`, 'true');
      setClickedReviewRate(true);
      window.open('https://apps.shopify.com/indexaize-unlock-ai-search#modal-show=WriteReviewModal', '_blank');
    } catch (error) {
      console.error('[AiTesting] Error saving clicked review rate state:', error);
    }
  };
  
  // Show review banner when AIEO Score > 50
  const shouldShowReviewBanner = useMemo(() => {
    if (dismissedReviewBanner || clickedReviewRate) return false;
    return (aiEOScore || 0) > 50;
  }, [dismissedReviewBanner, clickedReviewRate, aiEOScore]);

  return (
    <>
      <BlockStack gap="400">
        <Banner tone="info">
          <Text>Test how AI models discover and understand your store content. Check if your structured data and AI Discovery features are working correctly.</Text>
        </Banner>

        {/* AIEO Score Card - Always shown at the top */}
        <AIEOScoreCard 
          testResults={testResults}
          aiTestResults={aiTestResults}
          stats={stats}
          onScoreCalculated={(score) => setAiEOScore(score)}
        />
        
        {/* App Store Review Request - shows when AIEO Score > 50 */}
        {shouldShowReviewBanner && (
          <Banner
            title="Help shape the future of AI Search"
            tone="success"
            action={{
              content: 'Rate indexAIze',
              onAction: handleClickReviewRate
            }}
            onDismiss={handleDismissReviewBanner}
          >
            <Text>
              You've successfully optimized your store for AI engines. Your feedback helps us build better tools for the Shopify community.
            </Text>
          </Banner>
        )}

        {/* Two-column layout for Basic and AI tests */}
        <Layout>
          <Layout.Section variant="oneHalf">
            {/* Card 1: Basic AIEO Tests */}
            <Card>
              <Box padding="300">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingMd">Basic AIEO Tests</Text>
                      <Text variant="bodySm" tone="subdued">
                        Quick check if endpoints are accessible and returning data
                      </Text>
                    </BlockStack>
                    <Button 
                      onClick={runAllTests}
                      loading={testing}
                      disabled={testing}
                    >
                      {testing ? 'Testing...' : 'Run Basic Tests'}
                    </Button>
                  </InlineStack>

                  {/* Show banner if there are saved test results */}
                  {lastTestTimestamp && Object.keys(testResults).length > 0 && !testing && (
                    <Banner tone="info">
                      <Text variant="bodySm">
                        These results are from {lastTestTimestamp.toLocaleString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}. Run Basic Tests again to refresh.
                      </Text>
                    </Banner>
                  )}

                  {testing && (
                    <Box>
                      <BlockStack gap="200">
                        <Text variant="bodySm">Testing endpoints...</Text>
                        <ProgressBar progress={testProgress} size="small" />
                      </BlockStack>
                    </Box>
                  )}

                  {Object.keys(testResults).length > 0 && (
                    <BlockStack gap="300">
                      {/* Helper function to render test result */}
                      {Object.entries(testResults).map(([key, result], index) => {
                        const isLast = index === Object.entries(testResults).length - 1;
                        return (
                          <React.Fragment key={key}>
                            <InlineStack align="space-between" blockAlign="center">
                              <BlockStack gap="100">
                                <InlineStack gap="200" blockAlign="center">
                                  <Text variant="bodyMd" fontWeight="semibold">{result.name}</Text>
                                  {result.status === 'success' && <Badge tone="success">OK</Badge>}
                                  {result.status === 'fair' && <Badge tone="info">Fair</Badge>}
                                  {result.status === 'poor' && <Badge tone="warning">Poor</Badge>}
                                  {result.status === 'warning' && <Badge tone="critical">Warning</Badge>}
                                  {result.status === 'error' && <Badge tone="critical">Failed</Badge>}
                                  {result.status === 'locked' && <Badge>Locked</Badge>}
                                </InlineStack>
                                <Text variant="bodySm" tone="subdued">
                                  {result.message}
                                </Text>
                                {result.actionLink && (
                                  <Button 
                                    size="slim" 
                                    onClick={() => navigate(result.actionLink)}
                                  >
                                    {key === 'basicSitemap' ? 'Go to Sitemap' : 
                                     key === 'aiSitemap' ? 'Go to Settings' : 'Go'}
                                  </Button>
                                )}
                              </BlockStack>
                            </InlineStack>
                            {!isLast && <Divider />}
                          </React.Fragment>
                        );
                      })}
                    </BlockStack>
                  )}

                  {Object.keys(testResults).length === 0 && !testing && (
                    <Banner tone="info">
                      <Text>Click "Run Basic Tests" to check if your AI Discovery endpoints are configured correctly.</Text>
                    </Banner>
                  )}
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            {/* Card 2: AI-Powered Validation */}
            <Card>
              <Box padding="300">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingMd">AI-Powered Validation</Text>
                        {/* Token balance hidden - kept for potential future use
                        {tokenBalance !== null && (
                          <Badge tone={tokenBalance > 50 ? 'success' : 'warning'}>
                            {tokenBalance} tokens
                          </Badge>
                        )}
                        <Button 
                          size="micro" 
                          onClick={() => loadTokenBalance()}
                          accessibilityLabel="Refresh token balance"
                        >
                          🔄
                        </Button>
                        */}
                      </InlineStack>
                      <Text variant="bodySm" tone="subdued">
                        Deep analysis with AI bot
                      </Text>
                      {currentPlan && (
                        <Text variant="bodySm" tone="subdued">
                          Requires: Professional+ plan & pay-per-use tokens
                        </Text>
                      )}
                    </BlockStack>
                    <Button 
                      onClick={runAiValidation}
                      loading={aiTesting}
                      disabled={aiTesting || Object.keys(testResults).length === 0}
                      variant="primary"
                    >
                      {aiTesting ? 'Validating...' : 'Test with AI Bot'}
                    </Button>
                  </InlineStack>

                  {/* Show banner if there are saved AI test results */}
                  {lastAiTestTimestamp && Object.keys(aiTestResults).length > 0 && !aiTesting && (
                    <Banner tone="info">
                      <Text variant="bodySm">
                        These results are from {lastAiTestTimestamp.toLocaleString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}. Test with AI Bot again to refresh.
                      </Text>
                    </Banner>
                  )}

                  {aiTesting && (
                    <Box>
                      <BlockStack gap="200">
                        <Text variant="bodySm">AI is analyzing your endpoints...</Text>
                        <ProgressBar progress={aiTestProgress} size="small" tone="primary" />
                      </BlockStack>
                    </Box>
                  )}

                  {Object.keys(aiTestResults).length > 0 && (
                    <BlockStack gap="300">
                      {/* AI Results for Products JSON Feed */}
                      {aiTestResults.productsJson && (
                        <>
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text variant="bodyMd" fontWeight="semibold">Products JSON Feed</Text>
                                {aiTestResults.productsJson.rating === 'excellent' && <Badge tone="success">Excellent</Badge>}
                                {aiTestResults.productsJson.rating === 'good' && <Badge tone="success">Good</Badge>}
                                {aiTestResults.productsJson.rating === 'fair' && <Badge tone="warning">Fair</Badge>}
                                {aiTestResults.productsJson.rating === 'poor' && <Badge tone="critical">Poor</Badge>}
                                {aiTestResults.productsJson.rating === 'locked' && <Badge>🔒 Locked</Badge>}
                                {aiTestResults.productsJson.rating === 'unavailable' && <Badge tone="critical">❌ Unavailable</Badge>}
                              </InlineStack>
                              <Text variant="bodySm">
                                {aiTestResults.productsJson.feedback}
                              </Text>
                              {aiTestResults.productsJson.suggestions && (
                                <Text variant="bodySm" tone="subdued">
                                  💡 {aiTestResults.productsJson.suggestions}
                                </Text>
                              )}
                            </BlockStack>
                          </InlineStack>
                          <Divider />
                        </>
                      )}

                      {/* AI Results for Store Metadata */}
                      {aiTestResults.storeMetadata && (
                        <>
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text variant="bodyMd" fontWeight="semibold">Store Metadata</Text>
                                {aiTestResults.storeMetadata.rating === 'excellent' && <Badge tone="success">Excellent</Badge>}
                                {aiTestResults.storeMetadata.rating === 'good' && <Badge tone="success">Good</Badge>}
                                {aiTestResults.storeMetadata.rating === 'fair' && <Badge tone="warning">Fair</Badge>}
                                {aiTestResults.storeMetadata.rating === 'poor' && <Badge tone="critical">Poor</Badge>}
                                {aiTestResults.storeMetadata.rating === 'locked' && <Badge>🔒 Locked</Badge>}
                                {aiTestResults.storeMetadata.rating === 'unavailable' && <Badge tone="critical">❌ Unavailable</Badge>}
                              </InlineStack>
                              <Text variant="bodySm">
                                {aiTestResults.storeMetadata.feedback}
                              </Text>
                              {aiTestResults.storeMetadata.suggestions && (
                                <Text variant="bodySm" tone="subdued">
                                  💡 {aiTestResults.storeMetadata.suggestions}
                                </Text>
                              )}
                            </BlockStack>
                          </InlineStack>
                          <Divider />
                        </>
                      )}

                      {/* AI Results for Welcome Page */}
                      {aiTestResults.welcomePage && (
                        <>
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text variant="bodyMd" fontWeight="semibold">AI Welcome Page</Text>
                                {aiTestResults.welcomePage.rating === 'excellent' && <Badge tone="success">Excellent</Badge>}
                                {aiTestResults.welcomePage.rating === 'good' && <Badge tone="success">Good</Badge>}
                                {aiTestResults.welcomePage.rating === 'fair' && <Badge tone="warning">Fair</Badge>}
                                {aiTestResults.welcomePage.rating === 'poor' && <Badge tone="critical">Poor</Badge>}
                                {aiTestResults.welcomePage.rating === 'locked' && <Badge>🔒 Locked</Badge>}
                                {aiTestResults.welcomePage.rating === 'unavailable' && <Badge tone="critical">❌ Unavailable</Badge>}
                              </InlineStack>
                              <Text variant="bodySm">
                                {aiTestResults.welcomePage.feedback}
                              </Text>
                              {aiTestResults.welcomePage.suggestions && (
                                <Text variant="bodySm" tone="subdued">
                                  💡 {aiTestResults.welcomePage.suggestions}
                                </Text>
                              )}
                            </BlockStack>
                          </InlineStack>
                          <Divider />
                        </>
                      )}

                      {/* AI Results for Collections JSON */}
                      {aiTestResults.collectionsJson && (
                        <>
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text variant="bodyMd" fontWeight="semibold">Collections JSON Feed</Text>
                                {aiTestResults.collectionsJson.rating === 'excellent' && <Badge tone="success">Excellent</Badge>}
                                {aiTestResults.collectionsJson.rating === 'good' && <Badge tone="success">Good</Badge>}
                                {aiTestResults.collectionsJson.rating === 'fair' && <Badge tone="warning">Fair</Badge>}
                                {aiTestResults.collectionsJson.rating === 'poor' && <Badge tone="critical">Poor</Badge>}
                                {aiTestResults.collectionsJson.rating === 'locked' && <Badge>🔒 Locked</Badge>}
                                {aiTestResults.collectionsJson.rating === 'unavailable' && <Badge tone="critical">❌ Unavailable</Badge>}
                              </InlineStack>
                              <Text variant="bodySm">
                                {aiTestResults.collectionsJson.feedback}
                              </Text>
                              {aiTestResults.collectionsJson.suggestions && (
                                <Text variant="bodySm" tone="subdued">
                                  💡 {aiTestResults.collectionsJson.suggestions}
                                </Text>
                              )}
                            </BlockStack>
                          </InlineStack>
                          <Divider />
                        </>
                      )}

                      {/* AI Results for AI Sitemap */}
                      {aiTestResults.aiSitemap && (
                        <>
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text variant="bodyMd" fontWeight="semibold">AI-Enhanced Sitemap</Text>
                                {aiTestResults.aiSitemap.rating === 'excellent' && <Badge tone="success">Excellent</Badge>}
                                {aiTestResults.aiSitemap.rating === 'good' && <Badge tone="success">Good</Badge>}
                                {aiTestResults.aiSitemap.rating === 'fair' && <Badge tone="warning">Fair</Badge>}
                                {aiTestResults.aiSitemap.rating === 'poor' && <Badge tone="critical">Poor</Badge>}
                                {aiTestResults.aiSitemap.rating === 'locked' && <Badge>🔒 Locked</Badge>}
                                {aiTestResults.aiSitemap.rating === 'unavailable' && <Badge tone="critical">❌ Unavailable</Badge>}
                              </InlineStack>
                              <Text variant="bodySm">
                                {aiTestResults.aiSitemap.feedback}
                              </Text>
                              {aiTestResults.aiSitemap.suggestions && (
                                <Text variant="bodySm" tone="subdued">
                                  💡 {aiTestResults.aiSitemap.suggestions}
                                </Text>
                              )}
                            </BlockStack>
                          </InlineStack>
                          <Divider />
                        </>
                      )}

                      {/* AI Results for Schema Data */}
                      {aiTestResults.schemaData && (
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text variant="bodyMd" fontWeight="semibold">Advanced Schema Data</Text>
                              {aiTestResults.schemaData.rating === 'excellent' && <Badge tone="success">Excellent</Badge>}
                              {aiTestResults.schemaData.rating === 'good' && <Badge tone="success">Good</Badge>}
                              {aiTestResults.schemaData.rating === 'fair' && <Badge tone="warning">Fair</Badge>}
                              {aiTestResults.schemaData.rating === 'poor' && <Badge tone="critical">Poor</Badge>}
                              {aiTestResults.schemaData.rating === 'locked' && <Badge>🔒 Locked</Badge>}
                              {aiTestResults.schemaData.rating === 'unavailable' && <Badge tone="critical">❌ Unavailable</Badge>}
                            </InlineStack>
                            <Text variant="bodySm">
                              {aiTestResults.schemaData.feedback}
                            </Text>
                            {aiTestResults.schemaData.suggestions && (
                              <Text variant="bodySm" tone="subdued">
                                💡 {aiTestResults.schemaData.suggestions}
                              </Text>
                            )}
                          </BlockStack>
                        </InlineStack>
                      )}
                    </BlockStack>
                  )}

                  {Object.keys(aiTestResults).length === 0 && !aiTesting && (
                    <Banner tone="info">
                      <Text>
                        {Object.keys(testResults).length === 0 
                          ? 'Run Basic Tests first, then use AI validation for deep analysis'
                          : 'Click "Test with AI Bot" to get AI-powered feedback on your endpoint data quality'
                        }
                      </Text>
                    </Banner>
                  )}

                  {!currentPlan && (
                    <Banner tone="warning">
                      <Text>Loading plan information...</Text>
                    </Banner>
                  )}
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Card 3: Test with Real AI Bots */}
        <Card>
          <Box padding="300">
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">Test with Real AI Bots</Text>
              
              <Text variant="bodyMd" tone="subdued">
                Manually test your store with real AI search engines
              </Text>

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
                          Plan upgrade required
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
                          Plan upgrade required
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
                          Plan upgrade required
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
                          Plan upgrade required
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
                          Plan upgrade required
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
                          Plan upgrade required
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
                      <Text>What products do they offer according to their website?</Text>
                      <Button
                        onClick={() => simulateAIResponse('products')}
                        size="slim"
                      >
                        Simulate Response
                      </Button>
                    </InlineStack>

                    <InlineStack align="space-between">
                      <Text>What kind of business is this based on their store?</Text>
                      <Button
                        onClick={() => simulateAIResponse('business')}
                        size="slim"
                      >
                        Simulate Response
                      </Button>
                    </InlineStack>

                    <InlineStack align="space-between">
                      <Text>What product categories can I browse?</Text>
                      <Button
                        onClick={() => simulateAIResponse('categories')}
                        size="slim"
                      >
                        Simulate Response
                      </Button>
                    </InlineStack>

                    <InlineStack align="space-between">
                      <Text>How can I contact them according to their website?</Text>
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

      {toastContent && (
        <Toast content={toastContent} onDismiss={() => setToastContent('')} />
      )}
      
      {/* AI Bot Modal */}
      <Modal
        open={showAiBotModal}
        onClose={() => setShowAiBotModal(false)}
        title={`Test with ${selectedBot?.name}`}
        primaryAction={{
          content: 'Open AI Bot',
          url: selectedBot?.url,
          external: true
        }}
        secondaryActions={[
          {
            content: 'Copy Prompt',
            onAction: () => {
              const domain = storeUrl || storeName || shop;
              navigator.clipboard.writeText(`I want to learn more about ${domain}. Based on their website, what do they sell and what kind of business are they?`);
              setToastContent('Prompt copied to clipboard!');
            }
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodyMd">
              1. Click "Copy Prompt" (left button)
            </Text>
            <Text variant="bodyMd">
              2. Click "Open AI Bot" (right button) to visit {selectedBot?.name}
            </Text>
            <Text variant="bodyMd">
              3. Paste the prompt and send
            </Text>
            
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <Text variant="bodyMd" fontWeight="semibold">Prompt to test:</Text>
              <Box paddingBlockStart="200">
                <Text variant="bodyMd" as="p">
                  I want to learn more about {storeUrl || storeName || shop}. Based on their website, what do they sell and what kind of business are they?
                </Text>
              </Box>
            </Box>
            
            <Banner tone="info">
              <Text>The AI bot will search your website and use your optimized store data to answer.</Text>
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
      <InsufficientTokensModal
        open={showTokenModal}
        onClose={() => {
          setShowTokenModal(false);
          setTokenError(null);
          // Refresh token balance when closing modal (in case user bought tokens in another tab)
          loadTokenBalance();
        }}
        tokensRequired={tokenError?.tokensRequired || 0}
        tokensAvailable={tokenError?.tokensAvailable || 0}
        tokensNeeded={tokenError?.tokensNeeded || 0}
        feature="ai-testing-simulation"
        shop={shop}
        needsUpgrade={false}
        returnTo="/ai-testing"
        onBuyTokens={() => {
          setShowTokenModal(false);
          setShowTokenPurchaseModal(true);
        }}
      />
      
      {/* Trial Activation Modal for Growth Extra/Enterprise */}
      {tokenError && (
        <TrialActivationModal
          open={showTrialActivationModal}
          onClose={() => {
            setShowTrialActivationModal(false);
            setTokenError(null);
          }}
          feature={tokenError.feature || 'ai-testing-simulation'}
          trialEndsAt={tokenError.trialEndsAt}
          currentPlan={tokenError.currentPlan || currentPlan}
          tokensRequired={tokenError.tokensRequired || 0}
          onActivatePlan={async () => {
            // Direct API call to activate plan (no billing page redirect)
            try {
              const response = await api('/api/billing/activate', {
                method: 'POST',
                body: JSON.stringify({
                  shop,
                  endTrial: true,
                  returnTo: '/ai-testing' // Return to AI Testing after approval
                })
              });
              
              // Check if Shopify approval is required
              if (response.requiresApproval && response.confirmationUrl) {
                // Direct redirect to Shopify approval page
                window.top.location.href = response.confirmationUrl;
                return;
              }
              
              // Plan activated successfully without approval (shouldn't happen for trial end)
              window.location.reload();
              
            } catch (error) {
              console.error('[AI-TESTING] ❌ Activation failed:', error);
              
              // Fallback: Navigate to billing page
              const params = new URLSearchParams(window.location.search);
              const host = params.get('host');
              const embedded = params.get('embedded');
              window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host)}`;
            }
          }}
          onPurchaseTokens={() => {
            setShowTrialActivationModal(false);
            setShowTokenPurchaseModal(true);
          }}
        />
      )}

      {/* Token Purchase Modal */}
      <TokenPurchaseModal
        open={showTokenPurchaseModal}
        onClose={() => {
          setShowTokenPurchaseModal(false);
          setTokenError(null);
          loadTokenBalance();
        }}
        shop={shop}
        returnTo="/ai-testing"
        inTrial={!!tokenError?.trialEndsAt}
      />
    </>
  );
}

