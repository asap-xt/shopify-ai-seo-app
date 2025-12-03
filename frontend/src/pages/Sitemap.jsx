// frontend/src/pages/Sitemap.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card,
  Box,
  Text,
  Button,
  InlineStack,
  BlockStack,
  Toast,
  Banner,
  Icon,
  Spinner,
  Modal,
  Badge,
  ProgressBar,
  Divider,
} from '@shopify/polaris';
import { CheckIcon, AlertCircleIcon, ClockIcon, ExternalIcon, LockIcon } from '@shopify/polaris-icons';
import { makeSessionFetch } from '../lib/sessionFetch.js';
import TrialActivationModal from '../components/TrialActivationModal.jsx';
import InsufficientTokensModal from '../components/InsufficientTokensModal.jsx';
import TokenPurchaseModal from '../components/TokenPurchaseModal.jsx';
import UpgradeModal from '../components/UpgradeModal.jsx';

const qs = (k, d = '') => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };

export default function SitemapPage({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  // plan banner state (restored)
  const [plan, setPlan] = useState(null);
  // PHASE 4: Queue status
  const [queueStatus, setQueueStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const api = useMemo(() => makeSessionFetch(), []);
  
  // Modal states (copied from Settings.jsx)
  const [sitemapModalOpen, setSitemapModalOpen] = useState(false);
  const [sitemapModalContent, setSitemapModalContent] = useState(null);
  const [loadingSitemap, setLoadingSitemap] = useState(false);
  
  // ===== AI-OPTIMIZED SITEMAP STATES =====
  // AI Sitemap generation status (background queue)
  const [aiSitemapStatus, setAiSitemapStatus] = useState({
    inProgress: false,
    status: 'idle', // idle, queued, processing, completed, failed
    message: null,
    position: null,
    estimatedTime: null,
    generatedAt: null,
    productCount: 0
  });
  const aiSitemapPollingRef = useRef(null);
  const [aiSitemapBusy, setAiSitemapBusy] = useState(false);
  
  // AI Sitemap info (from database)
  const [aiSitemapInfo, setAiSitemapInfo] = useState(null);
  
  // Token/Plan modals
  const [showTrialActivationModal, setShowTrialActivationModal] = useState(false);
  const [showInsufficientTokensModal, setShowInsufficientTokensModal] = useState(false);
  const [showTokenPurchaseModal, setShowTokenPurchaseModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  
  // AI Sitemap View modal
  const [aiSitemapModalOpen, setAiSitemapModalOpen] = useState(false);
  const [aiSitemapModalContent, setAiSitemapModalContent] = useState(null);
  const [loadingAiSitemap, setLoadingAiSitemap] = useState(false);

  const loadInfo = useCallback(async () => {
    if (!shop) return;
    try {
      // ✅ backend routes live under /api
      const j = await api(`/api/sitemap/info?shop=${shop}`);
      setInfo(j);
    } catch (e) {
      setToast(e.message || 'Failed to load sitemap info');
    }
  }, [shop, api]);

  // restore plan fetch for banner (from working version)
  const loadPlan = useCallback(async () => {
    if (!shop) return;
    try {
      const Q = `
        query PlansMe($shop:String!) {
          plansMe(shop:$shop) {
            shop
            plan
            planKey
            priceUsd
            product_limit
            collection_limit
            language_limit
            providersAllowed
            modelsSuggested
            autosyncCron
            trial {
              active
              ends_at
              days_left
            }
          }
        }
      `;
      const res = await api('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: Q, variables: { shop } }),
      });
      if (res?.errors?.length) throw new Error(res.errors[0]?.message || 'GraphQL error');
      const j = res?.data?.plansMe;
      setPlan(j || null);
    } catch (e) {
      // non-blocking; just log toast optionally
      // setToast(e.message || 'Failed to load plan');
    }
  }, [shop, api]);

  const generate = useCallback(async () => {
    if (!shop) return;
    setBusy(true);
    setQueueStatus(null);
    
    try {
      // PHASE 4: POST generates async, returns queue status
      const response = await fetch(`/api/sitemap/generate?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('[SITEMAP] Generation response:', data);
        
        if (data.success) {
          setToast(data.message || 'Sitemap generation started!');
          setQueueStatus(data.job);
          
          // Start polling for status if queued
          if (data.job?.queued) {
            setPolling(true);
          }
        } else {
          setToast(data.message || 'Sitemap generation failed');
        }
      } else {
        const errorText = await response.text();
        setToast(`Sitemap generation failed: ${errorText}`);
      }
    } catch (e) {
      console.error('[SITEMAP] Generation error:', e);
      setToast(e.message || 'Sitemap generation failed');
    } finally {
      setBusy(false);
    }
  }, [shop]);

  // PHASE 4: Poll for queue status
  const checkStatus = useCallback(async () => {
    if (!shop || !polling) return;
    
    try {
      const status = await api(`/api/sitemap/status?shop=${shop}`);
      console.log('[SITEMAP] Status:', status);
      
      setQueueStatus(status.queue);
      
      // Stop polling if generation is completed or failed
      if (status.queue.status === 'completed' || status.queue.status === 'failed' || status.queue.status === 'idle') {
        setPolling(false);
        setToast(status.queue.message || 'Sitemap generation completed!');
        await loadInfo(); // Reload sitemap info
      }
    } catch (e) {
      console.error('[SITEMAP] Status check error:', e);
    }
  }, [shop, polling, api, loadInfo]);

  // PHASE 4: Polling effect
  useEffect(() => {
    if (polling) {
      const interval = setInterval(checkStatus, 3000); // Check every 3 seconds
      return () => clearInterval(interval);
    }
  }, [polling, checkStatus]);

  // View Sitemap in Modal (copied from Settings.jsx viewJson function)
  const viewSitemap = useCallback(async () => {
    if (!shop) return;
    
    setSitemapModalOpen(true);
    setLoadingSitemap(true);
    setSitemapModalContent(null);
    
    try {
      console.log('[SITEMAP] Loading existing sitemap from database...');
      // Read existing sitemap from database (does NOT regenerate)
      // Uses force=true to trigger the "view existing" code path in backend
      const response = await fetch(`/api/sitemap/generate?shop=${encodeURIComponent(shop)}&force=true&t=${Date.now()}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`
        }
      });
      
      if (response.ok) {
        console.log('[SITEMAP] Sitemap XML loaded successfully');
        const xmlContent = await response.text();
        setSitemapModalContent(xmlContent);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[SITEMAP] Error loading sitemap:', error);
      setSitemapModalContent(`Error loading sitemap: ${error.message}`);
    } finally {
      setLoadingSitemap(false);
    }
  }, [shop]);

  // ===== AI-OPTIMIZED SITEMAP FUNCTIONS =====
  
  // Helper function to format time ago
  const timeAgo = (date) => {
    if (!date) return '';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };
  
  // Load AI Sitemap info from database
  // CRITICAL: Only show AI-Optimized Sitemap as generated if isAiEnhanced is true
  const loadAiSitemapInfo = useCallback(async () => {
    if (!shop) return;
    try {
      const status = await api(`/api/sitemap/status?shop=${shop}`);
      // Check BOTH generatedAt AND isAiEnhanced flag
      // If sitemap exists but is NOT AI-enhanced, don't show as AI-generated
      if (status.sitemap?.generatedAt && status.sitemap?.isAiEnhanced === true) {
        setAiSitemapInfo({
          generated: true,
          generatedAt: status.sitemap.generatedAt,
          productCount: status.sitemap.productCount || 0
        });
      } else {
        // Reset AI sitemap info if not AI-enhanced
        setAiSitemapInfo(null);
      }
    } catch (e) {
      console.error('[SITEMAP] Failed to load AI sitemap info:', e);
    }
  }, [shop, api]);
  
  // Fetch AI Sitemap status from backend
  const fetchAiSitemapStatus = useCallback(async () => {
    try {
      const status = await api(`/api/sitemap/status?shop=${shop}`);
      
      setAiSitemapStatus(prevStatus => {
        const justCompleted = prevStatus.inProgress && !status.inProgress && 
          (status.status === 'completed' || status.status === 'failed');
        
        if (justCompleted) {
          // Stop polling
          if (aiSitemapPollingRef.current) {
            clearInterval(aiSitemapPollingRef.current);
            aiSitemapPollingRef.current = null;
          }
          
          if (status.status === 'completed') {
            setToast(`AI-Optimized Sitemap generated! (${status.sitemap?.productCount || 0} products)`);
            // Reload AI sitemap info
            loadAiSitemapInfo();
          } else if (status.status === 'failed') {
            setToast('AI-Optimized Sitemap generation failed');
          }
        }
        
        return {
          inProgress: status.inProgress || false,
          status: status.status || 'idle',
          message: status.message || null,
          position: status.queue?.position || null,
          estimatedTime: status.queue?.estimatedTime || null,
          generatedAt: status.sitemap?.generatedAt || null,
          productCount: status.sitemap?.productCount || 0
        };
      });
      
      return status;
    } catch (error) {
      console.error('[SITEMAP] Failed to fetch AI sitemap status:', error);
    }
  }, [shop, api, loadAiSitemapInfo]);
  
  // Start polling for AI Sitemap status
  const startAiSitemapPolling = useCallback(() => {
    if (aiSitemapPollingRef.current) {
      clearInterval(aiSitemapPollingRef.current);
    }
    fetchAiSitemapStatus();
    aiSitemapPollingRef.current = setInterval(() => {
      fetchAiSitemapStatus();
    }, 5000);
  }, [fetchAiSitemapStatus]);
  
  // Helper function to normalize plan names
  const normalizePlan = (planName) => {
    return (planName || 'starter').toLowerCase().replace(' ', '_');
  };
  
  // Generate AI-Optimized Sitemap (calls GraphQL mutation)
  const generateAiSitemap = useCallback(async () => {
    if (!shop) return;
    setAiSitemapBusy(true);
    
    try {
      // ===== FRONTEND PLAN/TOKEN CHECKS (same as Settings.jsx) =====
      const normalizedPlan = normalizePlan(plan?.plan);
      const plansWithUnlimitedAISitemap = ['growth_extra', 'growth extra', 'enterprise'];
      const plusPlans = ['professional_plus', 'professional plus', 'growth_plus', 'growth plus'];
      
      const isPlusPlan = plusPlans.includes(normalizedPlan);
      const hasUnlimitedAccess = plansWithUnlimitedAISitemap.includes(normalizedPlan);
      
      // Check plan access - show UpgradeModal if plan doesn't support AI Sitemap
      if (!hasUnlimitedAccess && !isPlusPlan) {
        setShowUpgradeModal(true);
        setAiSitemapBusy(false);
        return;
      }
      
      // Check token balance for Plus plans
      if (isPlusPlan) {
        try {
          const tokenData = await api(`/api/billing/tokens/balance?shop=${shop}`);
          const currentTokenBalance = tokenData.balance || 0;
          const hasTokens = currentTokenBalance > 0;
          
          if (!hasTokens) {
            setTokenError({
              feature: 'ai-sitemap-optimized',
              tokensRequired: 3000,
              tokensAvailable: currentTokenBalance,
              tokensNeeded: 3000
            });
            setShowInsufficientTokensModal(true);
            setAiSitemapBusy(false);
            return;
          }
        } catch (error) {
          console.error('[SITEMAP] Failed to fetch token balance:', error);
          setToast('Failed to check token balance');
          setAiSitemapBusy(false);
          return;
        }
      }
      
      // ===== CALL GRAPHQL MUTATION =====
      const response = await api('/graphql', {
        method: 'POST',
        body: JSON.stringify({
          query: `mutation RegenerateSitemap($shop: String!) {
            regenerateSitemap(shop: $shop) {
              success
              message
              queued
              position
              estimatedTime
            }
          }`,
          variables: { shop }
        })
      });
      
      // Check for GraphQL errors
      if (response?.errors?.length) {
        const errorMessage = response.errors[0]?.message || 'GraphQL error';
        
        // Handle trial restriction error
        if (errorMessage.includes('TRIAL_RESTRICTION')) {
          setTokenError({
            trialRestriction: true,
            requiresActivation: true,
            message: 'AI-Optimized Sitemap is locked during trial period. Activate your plan to unlock.'
          });
          setShowTrialActivationModal(true);
          return;
        }
        
        throw new Error(errorMessage);
      }
      
      const result = response?.data?.regenerateSitemap;
      
      if (result?.success) {
        setToast(result.message || 'AI-Optimized Sitemap generation started!');
        
        // Start polling if queued
        if (result.queued) {
          setAiSitemapStatus({
            inProgress: true,
            status: 'queued',
            message: 'Queued for processing...',
            position: result.position,
            estimatedTime: result.estimatedTime,
            generatedAt: null,
            productCount: 0
          });
          startAiSitemapPolling();
        }
      } else {
        // Check if error message indicates trial restriction (same as Settings.jsx)
        const errorMessage = result?.message || '';
        if (errorMessage.startsWith('TRIAL_RESTRICTION:')) {
          setAiSitemapBusy(false);
          
          // Show Trial Activation Modal instead of redirect
          setTokenError({
            trialRestriction: true,
            requiresActivation: true,
            feature: 'ai-sitemap-optimized',
            currentPlan: plan?.plan || 'enterprise'
          });
          setShowTrialActivationModal(true);
          return;
        }
        
        setToast(result?.message || 'Failed to start AI-Optimized Sitemap generation');
      }
      
    } catch (error) {
      console.error('[SITEMAP] AI generation error:', error);
      
      // Check if error is trial restriction (402 with trialRestriction flag) - same as Settings.jsx
      if (error.status === 402 && error.trialRestriction && error.requiresActivation) {
        // Show Trial Activation Modal instead of redirect
        setTokenError({
          trialRestriction: true,
          requiresActivation: true,
          feature: 'ai-sitemap-optimized',
          currentPlan: plan?.plan || 'enterprise'
        });
        setShowTrialActivationModal(true);
      } else if (error.status === 402 || error.requiresPurchase) {
        setTokenError(error);
        setShowInsufficientTokensModal(true);
      } else {
        setToast(error.message || 'Failed to generate AI-Optimized Sitemap');
      }
    } finally {
      setAiSitemapBusy(false);
    }
  }, [shop, api, plan, startAiSitemapPolling]);
  
  // View AI-Optimized Sitemap in Modal
  const viewAiSitemap = useCallback(async () => {
    if (!shop) return;
    
    setAiSitemapModalOpen(true);
    setLoadingAiSitemap(true);
    setAiSitemapModalContent(null);
    
    try {
      const response = await fetch(`/api/sitemap/generate?shop=${encodeURIComponent(shop)}&force=true&ai=true&t=${Date.now()}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`
        }
      });
      
      if (response.ok) {
        const xmlContent = await response.text();
        setAiSitemapModalContent(xmlContent);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[SITEMAP] Error loading AI sitemap:', error);
      setAiSitemapModalContent(`Error loading AI sitemap: ${error.message}`);
    } finally {
      setLoadingAiSitemap(false);
    }
  }, [shop]);
  
  // Handle plan activation
  const handleActivatePlan = useCallback(async () => {
    try {
      const response = await api('/api/billing/activate', {
        method: 'POST',
        body: { shop }
      });
      
      if (response?.confirmationUrl) {
        // Redirect to Shopify for plan approval
        window.top.location.href = response.confirmationUrl;
      } else {
        setToast('Failed to activate plan');
      }
    } catch (error) {
      console.error('[SITEMAP] Activation error:', error);
      setToast(error.message || 'Failed to activate plan');
    }
  }, [shop, api]);
  
  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (aiSitemapPollingRef.current) {
        clearInterval(aiSitemapPollingRef.current);
      }
    };
  }, []);

  useEffect(() => {
    loadInfo();
    loadPlan();
    loadAiSitemapInfo();
    
    // Check for in-progress AI sitemap generation
    fetchAiSitemapStatus().then(status => {
      if (status?.inProgress) {
        startAiSitemapPolling();
      }
    });
  }, [loadInfo, loadPlan, loadAiSitemapInfo, fetchAiSitemapStatus, startAiSitemapPolling]);

  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="400">
          {/* Plan Info Banner (restored) */}
          <Banner tone="info">
            <p>
              Your {plan?.plan || 'Starter'} plan includes up to{' '}
              <strong>
                {plan?.product_limit?.toLocaleString() || '70'} products in up to {plan?.language_limit || 1} language{(plan?.language_limit || 1) > 1 ? 's' : ''}
              </strong>
              .
              {info?.productCount && plan?.product_limit &&
                (info.productCount > plan.product_limit) && (
                  <> You have {info.productCount} products, so only the first{' '}
                    {plan.product_limit.toLocaleString()}{' '}
                    will be included in the sitemap.</>
                )}
            </p>
          </Banner>

          {/* PHASE 4: Queue Status Banner */}
          {(polling || queueStatus) && (
            <Banner tone={queueStatus?.status === 'processing' ? 'info' : queueStatus?.status === 'failed' ? 'critical' : 'success'}>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  {polling && <Spinner size="small" />}
                  <Text variant="bodyMd" fontWeight="medium">
                    {queueStatus?.message || 'Processing...'}
                  </Text>
                </InlineStack>
                
                {queueStatus?.position > 0 && (
                  <Text variant="bodySm" tone="subdued">
                    Position in queue: {queueStatus.position} | Estimated time: ~{queueStatus.estimatedTime}s
                  </Text>
                )}
                
                {queueStatus?.queueLength > 0 && (
                  <Text variant="bodySm" tone="subdued">
                    Queue length: {queueStatus.queueLength} job(s)
                  </Text>
                )}
              </BlockStack>
            </Banner>
          )}

          <InlineStack align="space-between" blockAlign="center">
            <Box>
              <Text variant="headingMd" as="h3">Sitemap Generator</Text>
              <Text variant="bodySm" tone="subdued">
                Generate structured sitemap for AI models to discover and index your products
              </Text>
            </Box>
            
            <Button
              primary
              onClick={generate}
              loading={busy}
              disabled={busy}
            >
              {busy ? 'Generating...' : 'Generate Sitemap'}
            </Button>
          </InlineStack>

          {info && (
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  {info.generated ? (
                    <>
                      <Icon source={CheckIcon} tone="success" />
                      <Text variant="bodyMd" fontWeight="semibold" tone="success">
                        Sitemap Active
                      </Text>
                    </>
                  ) : (
                    <>
                      <Icon source={ClockIcon} />
                      <Text variant="bodyMd" fontWeight="semibold">
                        No Sitemap Found
                      </Text>
                    </>
                  )}
                </InlineStack>

                {info.generated && (
                  <BlockStack gap="400">
                    <Box>
                      <BlockStack gap="200">
                        <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" color="subdued">Products included</Text>
                            <Text variant="bodyMd" fontWeight="semibold">{info.lastProductCount || 0} URLs</Text>
                          </InlineStack>
                        </Box>
                        <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" color="subdued">File size</Text>
                            <Text variant="bodyMd" fontWeight="semibold">{info.size ? `${(info.size / 1024).toFixed(2)} KB` : 'Unknown'}</Text>
                          </InlineStack>
                        </Box>
                        <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" color="subdued">Last updated</Text>
                            <Text variant="bodyMd" fontWeight="semibold">{info.generatedAt ? new Date(info.generatedAt).toLocaleString() : 'Unknown'}</Text>
                          </InlineStack>
                        </Box>
                      </BlockStack>
                    </Box>

                    <Box>
                      <Button
                        fullWidth
                        onClick={viewSitemap}
                      >
                        View Sitemap
                      </Button>
                    </Box>
                  </BlockStack>
                )}
              </BlockStack>
            </Box>
          )}

          <Box paddingBlockStart="400">
            <Text variant="headingMd" as="h4">What's included:</Text>
            <Box paddingBlockStart="200">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="start">
                  <Box minWidth="24px">
                    <Icon source={CheckIcon} tone="positive" />
                  </Box>
                  <Text>All active products with structured URLs for AI parsing</Text>
                </InlineStack>
                <InlineStack gap="200" blockAlign="start">
                  <Box minWidth="24px">
                    <Icon source={CheckIcon} tone="positive" />
                  </Box>
                  <Text>Priority rankings to help AI models understand product importance</Text>
                </InlineStack>
                <InlineStack gap="200" blockAlign="start">
                  <Box minWidth="24px">
                    <Icon source={CheckIcon} tone="positive" />
                  </Box>
                  <Text>Multi-language URLs for international AI search coverage</Text>
                </InlineStack>
                <InlineStack gap="200" blockAlign="start">
                  <Box minWidth="24px">
                    <Icon source={CheckIcon} tone="positive" />
                  </Box>
                  <Text>Standard XML format that AI crawlers understand</Text>
                </InlineStack>
              </BlockStack>
            </Box>
          </Box>

          <Box paddingBlockStart="200">
            <Text variant="headingMd" as="h4">How it helps AI models:</Text>
            <Box paddingBlockStart="200">
              <BlockStack gap="200">
                <Text>1. Click "Generate Sitemap" to create a structured map of your products</Text>
                <Text>2. The sitemap is automatically saved and available to AI crawlers</Text>
                <Text>3. AI models can discover and understand your product catalog structure</Text>
                <Text>4. Regenerate when you add new products to keep AI models updated</Text>
              </BlockStack>
            </Box>
          </Box>
          
          {/* ===== AI-OPTIMIZED SITEMAP SECTION ===== */}
          {/* Only show if basic sitemap is generated */}
          {info?.generated && (
            <>
              <Divider />
              
              <Box paddingBlockStart="200">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Box>
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="headingMd" as="h3">AI-Optimized Sitemap</Text>
                        <Badge tone="info">Premium</Badge>
                      </InlineStack>
                      <Text variant="bodySm" tone="subdued">
                        Enhance your sitemap with AI-generated descriptions for better AI discovery
                      </Text>
                    </Box>
                    
                    <Button
                      primary
                      onClick={generateAiSitemap}
                      loading={aiSitemapBusy}
                      disabled={aiSitemapBusy || aiSitemapStatus.inProgress}
                    >
                      {aiSitemapBusy || aiSitemapStatus.inProgress ? 'Generating...' : 'Generate AI-Optimized'}
                    </Button>
                  </InlineStack>
                  
                  {/* AI Sitemap Status Indicator */}
                  {aiSitemapStatus.inProgress && (
                    <Banner tone="info">
                      <InlineStack gap="300" blockAlign="center">
                        <Spinner size="small" />
                        <BlockStack gap="100">
                          <Text variant="bodyMd" fontWeight="semibold">
                            Generating AI-Optimized Sitemap...
                          </Text>
                          <Text variant="bodySm" tone="subdued">
                            {aiSitemapStatus.message || 'Processing in background...'}
                          </Text>
                          {aiSitemapStatus.position > 0 && (
                            <Text variant="bodySm" tone="subdued">
                              Queue position: {aiSitemapStatus.position} · Est. {Math.ceil((aiSitemapStatus.estimatedTime || 60) / 60)} min
                            </Text>
                          )}
                        </BlockStack>
                      </InlineStack>
                    </Banner>
                  )}
                  
                  {/* AI Sitemap Completed Status */}
                  {!aiSitemapStatus.inProgress && (aiSitemapInfo?.generated || aiSitemapStatus.status === 'completed') && (
                    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                      <BlockStack gap="300">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon source={CheckIcon} tone="success" />
                          <Text variant="bodyMd" fontWeight="semibold" tone="success">
                            AI-Optimized Sitemap Active
                          </Text>
                          <Badge tone="success">Generated</Badge>
                        </InlineStack>
                        
                        <BlockStack gap="200">
                          <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                            <InlineStack align="space-between">
                              <Text variant="bodyMd" color="subdued">Products included</Text>
                              <Text variant="bodyMd" fontWeight="semibold">
                                {aiSitemapInfo?.productCount || aiSitemapStatus.productCount || 0} products
                              </Text>
                            </InlineStack>
                          </Box>
                          <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                            <InlineStack align="space-between">
                              <Text variant="bodyMd" color="subdued">Last generated</Text>
                              <Text variant="bodyMd" fontWeight="semibold">
                                {timeAgo(aiSitemapInfo?.generatedAt || aiSitemapStatus.generatedAt)}
                              </Text>
                            </InlineStack>
                          </Box>
                        </BlockStack>
                        
                        <Button fullWidth onClick={viewAiSitemap}>
                          View AI-Optimized Sitemap
                        </Button>
                      </BlockStack>
                    </Box>
                  )}
                  
                  {/* What's included in AI-Optimized Sitemap */}
                  <Box paddingBlockStart="200">
                    <Text variant="headingSm" as="h4">What AI-Optimization adds:</Text>
                    <Box paddingBlockStart="200">
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="start">
                          <Box minWidth="24px">
                            <Icon source={CheckIcon} tone="positive" />
                          </Box>
                          <Text>AI-generated product descriptions optimized for AI crawlers</Text>
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="start">
                          <Box minWidth="24px">
                            <Icon source={CheckIcon} tone="positive" />
                          </Box>
                          <Text>Enhanced metadata for better AI understanding</Text>
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="start">
                          <Box minWidth="24px">
                            <Icon source={CheckIcon} tone="positive" />
                          </Box>
                          <Text>Structured data annotations for AI parsing</Text>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  </Box>
                </BlockStack>
              </Box>
            </>
          )}
        </BlockStack>
      </Box>
      
      {/* Sitemap View Modal (copied from Settings.jsx) */}
      {sitemapModalOpen && (
        <Modal
          open={sitemapModalOpen}
          onClose={() => {
            setSitemapModalOpen(false);
            setSitemapModalContent(null);
          }}
          title="AI-Optimized Sitemap"
          primaryAction={{
            content: 'Copy',
            onAction: () => {
              navigator.clipboard.writeText(sitemapModalContent);
              setToast('Copied to clipboard!');
            },
            disabled: loadingSitemap
          }}
          secondaryActions={[{
            content: 'Close',
            onAction: () => {
              setSitemapModalOpen(false);
              setSitemapModalContent(null);
            }
          }]}
        >
          <Modal.Section>
            <Box padding="200" background="bg-surface-secondary" borderRadius="100">
              {loadingSitemap ? (
                <InlineStack align="center" gap="200">
                  <Spinner size="small" />
                  <Text variant="bodyMd">Loading sitemap XML... This may take a moment for large stores.</Text>
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
                  {sitemapModalContent}
                </pre>
              )}
            </Box>
          </Modal.Section>
        </Modal>
      )}

      {/* AI-Optimized Sitemap View Modal */}
      {aiSitemapModalOpen && (
        <Modal
          open={aiSitemapModalOpen}
          onClose={() => {
            setAiSitemapModalOpen(false);
            setAiSitemapModalContent(null);
          }}
          title="AI-Optimized Sitemap"
          primaryAction={{
            content: 'Copy',
            onAction: () => {
              navigator.clipboard.writeText(aiSitemapModalContent);
              setToast('Copied to clipboard!');
            },
            disabled: loadingAiSitemap
          }}
          secondaryActions={[{
            content: 'Close',
            onAction: () => {
              setAiSitemapModalOpen(false);
              setAiSitemapModalContent(null);
            }
          }]}
        >
          <Modal.Section>
            <Box padding="200" background="bg-surface-secondary" borderRadius="100">
              {loadingAiSitemap ? (
                <InlineStack align="center" gap="200">
                  <Spinner size="small" />
                  <Text variant="bodyMd">Loading AI-optimized sitemap...</Text>
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
                  {aiSitemapModalContent}
                </pre>
              )}
            </Box>
          </Modal.Section>
        </Modal>
      )}
      
      {/* Trial Activation Modal */}
      <TrialActivationModal
        open={showTrialActivationModal}
        onClose={() => {
          setShowTrialActivationModal(false);
          setTokenError(null);
        }}
        featureName="AI-Optimized Sitemap"
        currentPlan={plan?.plan || 'Starter'}
        trialEndsAt={plan?.trial?.ends_at}
        onActivatePlan={handleActivatePlan}
        onPurchaseTokens={() => {
          setShowTrialActivationModal(false);
          setShowTokenPurchaseModal(true);
        }}
      />
      
      {/* Insufficient Tokens Modal */}
      <InsufficientTokensModal
        open={showInsufficientTokensModal}
        onClose={() => {
          setShowInsufficientTokensModal(false);
          setTokenError(null);
        }}
        featureName="AI-Optimized Sitemap"
        tokensRequired={tokenError?.tokensRequired}
        tokensAvailable={tokenError?.tokensAvailable}
        currentPlan={plan?.plan || 'Starter'}
        needsUpgrade={tokenError?.needsUpgrade}
        onBuyTokens={() => {
          setShowInsufficientTokensModal(false);
          setShowTokenPurchaseModal(true);
        }}
      />
      
      {/* Token Purchase Modal */}
      <TokenPurchaseModal
        open={showTokenPurchaseModal}
        onClose={() => setShowTokenPurchaseModal(false)}
        shop={shop}
        returnTo={window.location.pathname}
      />
      
      {/* Upgrade Modal */}
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        featureName="AI-Optimized Sitemap"
        currentPlan={plan?.plan || 'Starter'}
        minimumPlanRequired="Professional Plus"
        features={[
          'AI-enhanced product descriptions in sitemap',
          'Better AI crawler understanding',
          'Professional Plus, Growth Plus, Growth Extra, or Enterprise plan',
          'Or purchase tokens on any Plus plan'
        ]}
        returnTo={window.location.pathname}
      />

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </Card>
  );
}