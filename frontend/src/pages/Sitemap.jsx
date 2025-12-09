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
import { estimateTokens } from '../utils/tokenEstimates.js';

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
    productCount: 0,
    progress: null // { current, total, percent, remainingSeconds }
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

  // View Sitemap in Modal (only fetches cached version, no regeneration)
  const viewSitemap = useCallback(async () => {
    if (!shop) return;
    
    setSitemapModalOpen(true);
    setLoadingSitemap(true);
    setSitemapModalContent(null);
    
    try {
      // Use view endpoint to get cached version without regenerating
      const response = await fetch(`/api/sitemap/view?shop=${encodeURIComponent(shop)}&t=${Date.now()}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`
        }
      });
      
      if (response.ok) {
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
          isAiEnhanced: true,  // CRITICAL: Include this for View button logic
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
          productCount: status.sitemap?.productCount || 0,
          progress: status.progress || null
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
  
  // Reset stuck sitemap generation
  const resetSitemapGeneration = useCallback(async () => {
    if (!shop) return;
    
    try {
      const response = await fetch(`/api/sitemap/reset?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        // Stop polling
        if (aiSitemapPollingRef.current) {
          clearInterval(aiSitemapPollingRef.current);
          aiSitemapPollingRef.current = null;
        }
        
        // Reset status
        setAiSitemapStatus({
          inProgress: false,
          status: 'idle',
          message: null,
          position: null,
          estimatedTime: null,
          generatedAt: null,
          productCount: 0
        });
        setAiSitemapBusy(false);
        setPolling(false);
        setBusy(false);
        
        setToast('Generation cancelled. You can now start a new generation.');
      } else {
        setToast(data.error || 'Failed to reset');
      }
    } catch (error) {
      console.error('[SITEMAP] Reset error:', error);
      setToast('Failed to reset sitemap generation');
    }
  }, [shop]);
  
  // Helper function to normalize plan names
  const normalizePlan = (planName) => {
    return (planName || 'starter').toLowerCase().replace(' ', '_');
  };
  
  // Generate AI-Optimized Sitemap (calls GraphQL mutation)
  const generateAiSitemap = useCallback(async () => {
    if (!shop) return;
    setAiSitemapBusy(true);
    
    try {
      // Ensure info is loaded before proceeding (for accurate token estimation)
      let currentInfo = info;
      if (!currentInfo?.productCount && !currentInfo?.lastProductCount) {
        try {
          currentInfo = await api(`/api/sitemap/info?shop=${shop}`);
          setInfo(currentInfo);
        } catch (e) {
          console.error('[SITEMAP] Failed to load info:', e);
        }
      }
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
          
          // Use centralized token estimation
          // Use currentInfo (freshly loaded) for accurate product count
          const productCount = currentInfo?.productCount || currentInfo?.lastProductCount || 0;
          const tokenEstimate = estimateTokens('ai-sitemap-optimized', { productCount });
          
          const hasEnoughTokens = currentTokenBalance >= tokenEstimate.withMargin;
          
          if (!hasEnoughTokens) {
            setTokenError({
              feature: 'ai-sitemap-optimized',
              tokensRequired: tokenEstimate.withMargin,
              tokensAvailable: currentTokenBalance,
              tokensNeeded: Math.max(0, tokenEstimate.withMargin - currentTokenBalance)
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
        // Check if error message indicates specific error types
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
        
        if (errorMessage.startsWith('INSUFFICIENT_TOKENS:')) {
          setAiSitemapBusy(false);
          
          // Use centralized token estimation with currentInfo
          const productCount = currentInfo?.productCount || currentInfo?.lastProductCount || 0;
          const tokenEstimate = estimateTokens('ai-sitemap-optimized', { productCount });
          
          setTokenError({
            feature: 'ai-sitemap-optimized',
            tokensRequired: tokenEstimate.withMargin,
            tokensAvailable: 0,
            tokensNeeded: tokenEstimate.withMargin
          });
          setShowInsufficientTokensModal(true);
          return;
        }
        
        if (errorMessage.startsWith('PLAN_NOT_ELIGIBLE:')) {
          setAiSitemapBusy(false);
          
          // Show upgrade modal for plans without AI Sitemap access
          setUpgradeModalData({
            featureName: 'AI-Optimized Sitemap',
            currentPlan: plan?.plan || 'starter',
            minimumPlanRequired: 'Growth Extra',
            errorMessage: 'Your plan does not include AI-Optimized Sitemap. Upgrade to Growth Extra or Enterprise, or purchase tokens on a Plus plan.'
          });
          setShowUpgradeModal(true);
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
        // Calculate tokens properly using currentInfo
        const productCount = currentInfo?.productCount || currentInfo?.lastProductCount || 0;
        const tokenEstimate = estimateTokens('ai-sitemap-optimized', { productCount });
        
        setTokenError({
          ...error,
          feature: 'ai-sitemap-optimized',
          tokensRequired: tokenEstimate.withMargin,
          tokensAvailable: error.tokensAvailable || 0,
          tokensNeeded: tokenEstimate.withMargin
        });
        setShowInsufficientTokensModal(true);
      } else {
        setToast(error.message || 'Failed to generate AI-Optimized Sitemap');
      }
    } finally {
      setAiSitemapBusy(false);
    }
  }, [shop, api, plan, startAiSitemapPolling]);
  
  // View AI-Optimized Sitemap in Modal (only fetches cached version, no regeneration)
  const viewAiSitemap = useCallback(async () => {
    if (!shop) return;
    
    setAiSitemapModalOpen(true);
    setLoadingAiSitemap(true);
    setAiSitemapModalContent(null);
    
    try {
      // Use view endpoint without force=true to get cached version without regenerating
      const response = await fetch(`/api/sitemap/view?shop=${encodeURIComponent(shop)}&t=${Date.now()}`, {
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
        body: { 
          shop,
          endTrial: true,  // CRITICAL: Must be true to actually activate the plan
          returnTo: window.location.pathname  // Return here after approval
        }
      });
      
      if (response?.confirmationUrl) {
        // Redirect to Shopify for plan approval
        window.top.location.href = response.confirmationUrl;
      } else if (response?.success) {
        // Already activated (shouldn't happen but handle it)
        setToast('Plan activated successfully!');
        setShowTrialActivationModal(false);
        // Reload plan info
        loadPlan();
      } else {
        setToast('Failed to activate plan');
      }
    } catch (error) {
      console.error('[SITEMAP] Activation error:', error);
      setToast(error.message || 'Failed to activate plan');
    }
  }, [shop, api, loadPlan]);
  
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
          {/* Plan Info Banner - compact */}
          <Banner tone="info">
            Your <strong>{plan?.plan || 'Starter'}</strong> plan: up to <strong>{plan?.product_limit?.toLocaleString() || '70'} products</strong> in {plan?.language_limit || 1} language{(plan?.language_limit || 1) > 1 ? 's' : ''}.
            {info?.productCount && plan?.product_limit && (info.productCount > plan.product_limit) && (
              <> (You have {info.productCount}, only first {plan.product_limit.toLocaleString()} included)</>
            )}
          </Banner>

          {/* Queue Status Banner - only when ACTIVELY processing */}
          {(busy || polling || aiSitemapBusy || aiSitemapStatus.inProgress) && (
            <Box 
              background="bg-surface-secondary" 
              padding="300" 
              borderRadius="200"
              borderWidth="025"
              borderColor="border-info"
            >
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center" gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" />
                    <Text variant="bodyMd">
                      {aiSitemapStatus.inProgress || aiSitemapBusy
                        ? (aiSitemapStatus.progress?.total > 0
                            ? `Processing ${aiSitemapStatus.progress.current}/${aiSitemapStatus.progress.total} products${aiSitemapStatus.progress.remainingSeconds > 0 ? ` • ~${Math.ceil(aiSitemapStatus.progress.remainingSeconds / 60)} min remaining` : ''}`
                            : (() => {
                                // Estimate based on product count (~5 sec per product for AI)
                                const productCount = info?.productCount || info?.lastProductCount || 0;
                                const estimatedMinutes = productCount > 0 ? Math.ceil((productCount * 5) / 60) : 0;
                                return productCount > 0 
                                  ? `Starting AI optimization for ${productCount} products • ~${estimatedMinutes} min estimated`
                                  : 'Starting... (loading products)';
                              })()
                          )
                        : (queueStatus?.status === 'queued'
                            ? 'Starting...'
                            : queueStatus?.status === 'processing'
                              ? 'Generating XML...'
                              : queueStatus?.message || 'Generating...'
                          )}
                    </Text>
                  </InlineStack>
                  <Button 
                    size="slim" 
                    tone="critical" 
                    onClick={resetSitemapGeneration}
                  >
                    Cancel
                  </Button>
                </InlineStack>
                {/* Progress bar for AI sitemap */}
                {aiSitemapStatus.progress && aiSitemapStatus.progress.total > 0 && (
                  <Box>
                    <div style={{ 
                      width: '100%', 
                      height: '8px', 
                      backgroundColor: '#e4e5e7', 
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}>
                      <div style={{ 
                        width: `${aiSitemapStatus.progress.percent || 0}%`, 
                        height: '100%', 
                        backgroundColor: '#2c6ecb',
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </Box>
                )}
              </BlockStack>
            </Box>
          )}

          {/* ===== BASIC SITEMAP ROW ===== */}
          <Box 
            background="bg-surface-secondary" 
            padding="300" 
            borderRadius="200"
            borderWidth="025"
            borderColor={info?.generated ? "border-success" : "border"}
          >
            <InlineStack align="space-between" blockAlign="center" gap="400">
              <InlineStack gap="300" blockAlign="center">
                {info?.generated ? (
                  <Icon source={CheckIcon} tone="success" />
                ) : (
                  <Icon source={ClockIcon} tone="subdued" />
                )}
                <BlockStack gap="050">
                  <Text variant="bodyMd" fontWeight="semibold">
                    Basic Sitemap
                  </Text>
                  {info?.generated ? (
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="bodySm" tone="subdued">
                        {info.lastProductCount || 0} products · {timeAgo(info.generatedAt)}
                      </Text>
                      {/* Hide View button if AI-Enhanced sitemap exists (there's only one sitemap file) */}
                      {!(aiSitemapInfo?.generated && aiSitemapInfo?.isAiEnhanced) && (
                        <Button variant="plain" size="slim" onClick={viewSitemap}>View</Button>
                      )}
                    </InlineStack>
                  ) : (
                    <Text variant="bodySm" tone="subdued">Not generated yet</Text>
                  )}
                </BlockStack>
              </InlineStack>
              
              <Button
                onClick={generate}
                loading={busy || polling}
                disabled={busy || polling}
                size="slim"
              >
                {info?.generated ? 'Regenerate' : 'Generate'}
              </Button>
            </InlineStack>
          </Box>

          {/* ===== AI-OPTIMIZED SITEMAP ROW ===== */}
          <Box 
            background="bg-surface-secondary" 
            padding="300" 
            borderRadius="200"
            borderWidth="025"
            borderColor={aiSitemapInfo?.generated ? "border-success" : "border"}
          >
            <InlineStack align="space-between" blockAlign="center" gap="400">
              <InlineStack gap="300" blockAlign="center">
                {aiSitemapInfo?.generated ? (
                  <Icon source={CheckIcon} tone="success" />
                ) : info?.generated ? (
                  <Icon source={ClockIcon} tone="subdued" />
                ) : (
                  <Icon source={LockIcon} tone="subdued" />
                )}
                <BlockStack gap="050">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="bodyMd" fontWeight="semibold">
                      AI-Optimized Sitemap
                    </Text>
                    <Badge tone="info" size="small">Premium</Badge>
                  </InlineStack>
                  {aiSitemapInfo?.generated ? (
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="bodySm" tone="subdued">
                        {aiSitemapInfo.productCount || 0} products · {timeAgo(aiSitemapInfo.generatedAt)}
                      </Text>
                      <Button variant="plain" size="slim" onClick={viewAiSitemap}>View</Button>
                    </InlineStack>
                  ) : info?.generated ? (
                    <Text variant="bodySm" tone="subdued">
                      Adds AI descriptions & enhanced metadata
                    </Text>
                  ) : (
                    <Text variant="bodySm" tone="subdued">Generate basic sitemap first</Text>
                  )}
                </BlockStack>
              </InlineStack>
              
              <Button
                primary
                onClick={generateAiSitemap}
                loading={aiSitemapBusy || aiSitemapStatus.inProgress}
                disabled={!info?.generated || aiSitemapBusy || aiSitemapStatus.inProgress}
                size="slim"
              >
                {aiSitemapInfo?.generated ? 'Regenerate' : 'Generate'}
              </Button>
            </InlineStack>
          </Box>

          {/* ===== WHAT'S INCLUDED SECTION ===== */}
          <Divider />
          
          <Box>
            <BlockStack gap="300">
              {/* Basic Sitemap Features */}
              <Box>
                <Text variant="headingSm" as="h4">Basic Sitemap includes:</Text>
                <Box paddingBlockStart="100">
                  <Text variant="bodySm" tone="subdued">
                    ✓ All active products with structured URLs · Priority rankings · Multi-language URLs · Standard XML format
                  </Text>
                </Box>
              </Box>
              
              {/* AI-Optimized Features - show as value proposition */}
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingSm" as="h4">Why AI-Optimized?</Text>
                    <Badge tone="info" size="small">Premium</Badge>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued">
                    Make your products stand out when customers search with AI assistants like ChatGPT, Perplexity, or Google AI.
                  </Text>
                  <BlockStack gap="100">
                    <Text variant="bodySm">
                      ✓ <strong>AI-generated descriptions</strong> — helps AI models better understand and recommend your products
                    </Text>
                    <Text variant="bodySm">
                      ✓ <strong>Enhanced metadata</strong> — category, price range, and key features formatted for AI consumption
                    </Text>
                    <Text variant="bodySm">
                      ✓ <strong>Structured annotations</strong> — special AI-readable tags that increase visibility in AI search results
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Box>
              
              {/* Tip for regeneration */}
              <Box>
                <Text variant="bodySm" tone="subdued">
                  💡 <strong>Tip:</strong> Regenerate your sitemaps after adding new products or updating existing ones to keep AI models up to date with your catalog.
                </Text>
              </Box>
            </BlockStack>
          </Box>
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
        feature="ai-sitemap-optimized"
        currentPlan={plan?.plan || 'Starter'}
        trialEndsAt={plan?.trial?.ends_at}
        tokensRequired={estimateTokens('ai-sitemap-optimized', { productCount: info?.productCount || info?.lastProductCount || 0 }).withMargin}
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
        feature={tokenError?.feature || 'ai-sitemap-optimized'}
        tokensRequired={tokenError?.tokensRequired || 0}
        tokensAvailable={tokenError?.tokensAvailable || 0}
        tokensNeeded={tokenError?.tokensNeeded || tokenError?.tokensRequired || 0}
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