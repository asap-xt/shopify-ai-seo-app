// frontend/src/pages/Dashboard.jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Badge,
  BlockStack,
  InlineStack,
  Divider,
  Box,
  Banner,
  ProgressBar,
  Collapsible,
  Link,
  Checkbox
} from '@shopify/polaris';
import { makeSessionFetch } from '../lib/sessionFetch.js';
import { PLAN_HIERARCHY_LOWERCASE, getPlanIndex } from '../hooks/usePlanHierarchy.js';
import { devLog } from '../utils/devLog.js';
import AIEOScoreCard from '../components/AIEOScoreCard.jsx';
import TokenPurchaseModal from '../components/TokenPurchaseModal.jsx';

// Query string helper
const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; }
  catch { return d; }
};

export default function Dashboard({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  const api = useMemo(() => makeSessionFetch(), []);
  
  // Navigation helper - preserves all URL parameters
  const navigate = (path) => {
    const currentParams = new URLSearchParams(window.location.search);
    const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
    window.location.href = `${path}${paramString}`;
  };
  
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [plansData, setPlansData] = useState([]);
  
  // Test results for AIEO Score (loaded from localStorage, same as AI Testing page)
  const [testResults, setTestResults] = useState({});
  const [aiTestResults, setAiTestResults] = useState({});
  
  // Sync state
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const [isExpanded, setIsExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem(`syncCardExpanded_${shop}`);
      // If never set before, default to true (expanded)
      return saved === null ? true : saved === 'true';
    } catch {
      return true; // Default expanded if localStorage fails
    }
  });
  const pollRef = useRef(null);
  const autoSyncTriggered = useRef(false); // Track if auto-sync was already triggered
  const markAsSeenTimerRef = useRef(null); // Timer to mark card as seen after user has time to see it
  
  // Onboarding state logic - SIMPLIFIED:
  // 1. If never seen before AND has subscription: open card
  // 2. Mark as seen only when user closes it manually OR after 10 seconds (Dashboard is definitely visible)
  // 3. Subsequent loads: closed by default
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      const hasBeenSeenOnce = localStorage.getItem(`gettingStartedSeenOnce_${shop}`) === 'true';
      return !hasBeenSeenOnce; // Open only if never seen before
    } catch {
      return false; // Default closed if localStorage fails
    }
  });
  
  // Dismissed banners state (persist in localStorage)
  const [dismissedUpgradeBanner, setDismissedUpgradeBanner] = useState(() => {
    try {
      return localStorage.getItem(`dismissedUpgradeBanner_${shop}`) === 'true';
    } catch {
      return false;
    }
  });
  
  const [dismissedTokenBanner, setDismissedTokenBanner] = useState(() => {
    try {
      return localStorage.getItem(`dismissedTokenBanner_${shop}`) === 'true';
    } catch {
      return false;
    }
  });
  
  // Review banner state (show after 6+ days of activation)
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
  
  // AIEO Score for review banner trigger
  const [aieoScore, setAieoScore] = useState(0);
  
  // Token purchase modal state
  const [showTokenPurchaseModal, setShowTokenPurchaseModal] = useState(false);
  
  // Debounce timer for dashboard data loading
  const loadDataTimeoutRef = useRef(null);

  // Load saved test results and stats from localStorage (same as AI Testing page)
  const loadSavedTestResults = () => {
    try {
      const savedData = localStorage.getItem(`ai-test-results-${shop}`);
      if (savedData) {
        const parsed = JSON.parse(savedData);
        if (parsed.results) {
          setTestResults(parsed.results);
        }
      }
      
      // Check for AI test results (if saved separately)
      const savedAiData = localStorage.getItem(`ai-validation-results-${shop}`);
      if (savedAiData) {
        const parsed = JSON.parse(savedAiData);
        if (parsed.results) {
          setAiTestResults(parsed.results);
        }
      }
      
      // Load stats from localStorage (synced from Dashboard Sync)
      const savedStats = localStorage.getItem(`dashboard-stats-${shop}`);
      if (savedStats) {
        const parsed = JSON.parse(savedStats);
        // Use saved stats if they exist (will be overridden by API call, but ensures consistency)
        // This is mainly for AI Testing page to use
      }
    } catch (err) {
      console.error('[Dashboard] Error loading saved test results:', err);
    }
  };

  useEffect(() => {
    loadDashboardData(true); // Force immediate load on mount
    loadSyncStatus();
    loadSavedTestResults(); // Load test results from localStorage
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (loadDataTimeoutRef.current) {
        clearTimeout(loadDataTimeoutRef.current);
      }
      if (markAsSeenTimerRef.current) {
        clearTimeout(markAsSeenTimerRef.current);
        markAsSeenTimerRef.current = null;
      }
    };
  }, [shop]);
  
  // SIMPLIFIED: Mark Getting Started card as "seen" logic
  // Only mark as seen when:
  // 1. Dashboard is loaded (not loading)
  // 2. Has subscription (subscription.plan exists)
  // 3. Card is open (onboardingOpen === true)
  // 4. After 10 seconds (Dashboard is definitely visible, not redirecting)
  useEffect(() => {
    // Only proceed if Dashboard is fully loaded and has subscription
    if (!loading && subscription?.plan && onboardingOpen) {
      try {
        const hasBeenSeenOnce = localStorage.getItem(`gettingStartedSeenOnce_${shop}`) === 'true';
        
        // If not marked as seen yet, set timer to mark it after 10 seconds
        // This gives user time to see the card and ensures Dashboard is visible (not redirecting)
        if (!hasBeenSeenOnce && !markAsSeenTimerRef.current) {
          markAsSeenTimerRef.current = setTimeout(() => {
            try {
              localStorage.setItem(`gettingStartedSeenOnce_${shop}`, 'true');
              // Card stays open for this session, but will be closed on next load
            } catch (error) {
              console.error('[Dashboard] Error marking Getting Started as seen:', error);
            }
          }, 10000); // 10 seconds - enough time to ensure Dashboard is visible
        }
      } catch (error) {
        console.error('[Dashboard] Error checking Getting Started status:', error);
      }
    }
    
    // Cleanup function
    return () => {
      if (markAsSeenTimerRef.current) {
        clearTimeout(markAsSeenTimerRef.current);
        markAsSeenTimerRef.current = null;
      }
    };
  }, [loading, subscription?.plan, onboardingOpen, shop]);
  
  // Auto-sync on load if enabled (only once per page load)
  useEffect(() => {
    if (syncStatus && syncStatus.autoSyncEnabled && !syncing && !autoSyncTriggered.current) {
      devLog('[Dashboard] Auto-sync is enabled, triggering sync...');
      autoSyncTriggered.current = true;
      handleSync();
    }
  }, [syncStatus?.autoSyncEnabled]); // Only trigger when autoSyncEnabled changes

  const loadDashboardData = async (force = false) => {
    // Debounce multiple calls within 500ms
    if (!force && loadDataTimeoutRef.current) {
      clearTimeout(loadDataTimeoutRef.current);
    }
    
    return new Promise((resolve) => {
      loadDataTimeoutRef.current = setTimeout(async () => {
        try {
          setLoading(true);
          // makeSessionFetch връща директно JSON, не Response
          const [statsData, tokensData, billingData] = await Promise.all([
            api(`/api/dashboard/stats?shop=${shop}`),
            api(`/api/billing/tokens/balance?shop=${shop}`),
            api(`/api/billing/info?shop=${shop}`)
          ]);

          if (statsData) {
            setStats(statsData);
            setSubscription(statsData.subscription);
            
            // Save stats to localStorage for AI Testing page to use
            try {
              const statsToSave = {
                totalProducts: statsData?.products?.total || 0,
                optimizedProducts: statsData?.products?.optimized || 0,
                totalCollections: statsData?.collections?.total || 0,
                optimizedCollections: statsData?.collections?.optimized || 0,
                timestamp: new Date().toISOString()
              };
              localStorage.setItem(`dashboard-stats-${shop}`, JSON.stringify(statsToSave));
            } catch (err) {
              console.error('[Dashboard] Error saving stats to localStorage:', err);
            }
          }
          if (billingData?.plans) {
            setPlansData(billingData.plans);
          }
          if (tokensData) {
            setTokens(tokensData);
          }
          
          resolve();
        } catch (error) {
          console.error('[Dashboard] Error loading data:', error);
          resolve();
        } finally {
          setLoading(false);
        }
      }, force ? 0 : 500); // Immediate if forced, otherwise debounce
    });
  };
  
  const loadSyncStatus = async () => {
    try {
      const data = await api(`/api/dashboard/sync-status?shop=${shop}`);
      if (data) {
        setSyncStatus(data);
        setAutoSync(data.autoSyncEnabled || false);
        // Keep UI state aligned with backend status
        setSyncing(!!data.inProgress);
      }
    } catch (error) {
      console.error('[Dashboard] Error loading sync status:', error);
    }
  };
  
  const handleSync = async () => {
    try {
      setSyncing(true);
      const res = await api(`/api/dashboard/sync?shop=${shop}`, { method: 'POST' });
      devLog('[Dashboard] Sync start response:', res);
      
      if (res?.success || res?.inProgress) {
        // Clear any existing poller
        if (pollRef.current) clearInterval(pollRef.current);
        // Poll for completion
        pollRef.current = setInterval(async () => {
          try {
            const status = await api(`/api/dashboard/sync-status?shop=${shop}`);
            if (status) {
              setSyncStatus(status);
              if (!status.inProgress) {
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                }
                setSyncing(false);
                loadDashboardData(); // Reload stats (debounced)
              }
            }
          } catch (e) {
            console.error('[Dashboard] Poll error:', e);
          }
        }, 2000); // Poll every 2 seconds
      } else {
        // If backend didn't acknowledge start, stop spinner
        setSyncing(false);
      }
    } catch (error) {
      console.error('[Dashboard] Error syncing:', error);
      setSyncing(false);
    }
  };
  
  const handleAutoSyncToggle = async (newValue) => {
    try {
      devLog('[Dashboard] Toggling auto-sync to:', newValue);
      
      // Optimistic UI update
      setAutoSync(newValue);
      
      const res = await api(`/api/dashboard/auto-sync?shop=${shop}`, { 
        method: 'POST', 
        body: { enabled: newValue } 
      });
      
      devLog('[Dashboard] Auto-sync toggle response:', res);
      
      if (res?.success) {
        setAutoSync(!!res.autoSyncEnabled);
        setSyncStatus({ ...(syncStatus || {}), autoSyncEnabled: !!res.autoSyncEnabled });
      }
    } catch (error) {
      console.error('[Dashboard] Error toggling auto-sync:', error);
      // Revert on error
      setAutoSync(!newValue);
    }
  };

  // Calculate percentages
  const productOptimizationPercent = stats?.products?.total > 0 
    ? Math.round((stats.products.optimized / stats.products.total) * 100) 
    : 0;
    
  const collectionOptimizationPercent = stats?.collections?.total > 0 
    ? Math.round((stats.collections.optimized / stats.collections.total) * 100) 
    : 0;

  // Check feature availability
  const planIndex = getPlanIndex(subscription?.plan);
  const hasCollections = planIndex >= 3; // Growth+ (index 3)
  const hasStoreMetadata = planIndex >= 1; // Professional+ (index 1)
  const hasAdvancedSchema = planIndex >= 6; // Enterprise (index 6)
  const hasAiSitemap = planIndex >= 5; // Growth Extra+ (index 5)

  // Get plan price from dynamic data or use backend values
  const getPlanPrice = (planKey) => {
    const normalizedKey = planKey?.toLowerCase().replace(/_/g, ' ');
    const plan = plansData.find(p => p.key === normalizedKey || p.key === planKey);
    return plan?.price || 0;
  };
  
  const planPriceValue = subscription?.price && subscription.price > 0
    ? subscription.price
    : (subscription?.plan ? getPlanPrice(subscription.plan) : undefined);

  // Plan recommendation logic - uses dynamic data from backend
  const getPlanLimits = (planKey) => {
    const normalizedKey = planKey?.toLowerCase().replace(/_/g, ' ');
    const plan = plansData.find(p => p.key === normalizedKey || p.key === planKey);
    if (plan) {
      return { 
        products: plan.productLimit || 0, 
        languages: plan.languageLimit || 1 
      };
    }
    // Fallback if plans not loaded yet
    return { products: 0, languages: 0 };
  };

  const getPlanOrder = (planKey) => {
    const order = { 
      starter: 1, 
      professional: 2, 
      'professional_plus': 2.5,
      'professional plus': 2.5, 
      growth: 3, 
      'growth_plus': 3.5,
      'growth plus': 3.5,
      growth_extra: 4,
      'growth extra': 4, 
      enterprise: 5 
    };
    return order[planKey] || 0;
  };

  const recommendPlan = () => {
    if (!stats || plansData.length === 0) return null;
    
    const totalProducts = stats.products?.total || 0;
    const totalLanguages = stats.languages?.length || 1;
    const currentPlan = subscription?.plan || 'starter';
    const currentPlanOrder = getPlanOrder(currentPlan);

    // Find the most suitable plan based on store data using dynamic plan data
    // Skip hidden plans (growth is hidden, use growth plus instead)
    const hiddenPlans = ['growth'];
    let recommendedPlan = null;
    let recommendedPlanData = null;

    for (const planData of plansData) {
      // Skip hidden plans
      if (hiddenPlans.includes(planData.key)) continue;
      
      if (totalProducts <= planData.productLimit && totalLanguages <= planData.languageLimit) {
        recommendedPlan = planData.key;
        recommendedPlanData = planData;
        break;
      }
    }

    // If no plan fits, recommend enterprise
    if (!recommendedPlan) {
      recommendedPlanData = plansData.find(p => p.key === 'enterprise');
      recommendedPlan = 'enterprise';
    }

    // Only show recommendation if it's higher than current plan
    const recommendedPlanOrder = getPlanOrder(recommendedPlan);
    if (recommendedPlanOrder <= currentPlanOrder) return null;

    const currentLimits = getPlanLimits(currentPlan);
    
    let reason = '';
    if (totalProducts > currentLimits.products) {
      reason = `Your store has ${totalProducts} products, exceeding the ${currentLimits.products}-product limit of your current plan.`;
    } else if (totalLanguages > currentLimits.languages) {
      reason = `Your store has ${totalLanguages} language(s), exceeding the ${currentLimits.languages}-language limit of your current plan.`;
    }

    return {
      plan: recommendedPlan,
      planName: recommendedPlanData?.name || recommendedPlan.replace('_', ' ').toUpperCase(),
      price: recommendedPlanData?.price || getPlanPrice(recommendedPlan),
      productLimit: recommendedPlanData?.productLimit || 0,
      languageLimit: recommendedPlanData?.languageLimit || 1,
      reason
    };
  };

  const recommendation = useMemo(() => recommendPlan(), [stats, subscription, plansData]);

  // Token recommendation for Professional/Growth/Plus plans (pay-per-use)
  const shouldRecommendTokens = useMemo(() => {
    if (!subscription?.plan) return false;
    const plan = subscription.plan;
    // Show token recommendation for plans without included tokens (Professional, Growth, and their Plus variants)
    const payPerUsePlans = ['professional', 'professional_plus', 'professional plus', 'growth', 'growth_plus', 'growth plus'];
    if (!payPerUsePlans.includes(plan)) return false;
    // Show if balance is low (less than 1000 tokens) or zero
    const balance = tokens?.balance || 0;
    if (balance >= 1000) return false;
    return true;
  }, [subscription, tokens]);
  
  // Review banner - show when AIEO Score > 50 (user sees real value)
  // Score > 50 requires AI enhancement = user bought tokens = serious user
  const shouldShowReviewBanner = useMemo(() => {
    // Must not have dismissed or clicked rate
    if (dismissedReviewBanner || clickedReviewRate) return false;
    
    // Show when AIEO Score is above 50 (means user has done AI enhancement)
    return aieoScore > 50;
  }, [dismissedReviewBanner, clickedReviewRate, aieoScore]);

  // Handle dismissing the upgrade banner
  const handleDismissUpgradeBanner = () => {
    try {
      localStorage.setItem(`dismissedUpgradeBanner_${shop}`, 'true');
      setDismissedUpgradeBanner(true);
    } catch (error) {
      console.error('[Dashboard] Error saving dismissed banner state:', error);
    }
  };

  // Handle dismissing the token banner
  const handleDismissTokenBanner = () => {
    try {
      localStorage.setItem(`dismissedTokenBanner_${shop}`, 'true');
      setDismissedTokenBanner(true);
    } catch (error) {
      console.error('[Dashboard] Error saving dismissed token banner state:', error);
    }
  };
  
  // Handle dismissing the review banner
  const handleDismissReviewBanner = () => {
    try {
      localStorage.setItem(`dismissedReviewBanner_${shop}`, 'true');
      setDismissedReviewBanner(true);
    } catch (error) {
      console.error('[Dashboard] Error saving dismissed review banner state:', error);
    }
  };
  
  // Handle clicking "Rate Us" in review banner
  const handleClickReviewRate = () => {
    try {
      localStorage.setItem(`clickedReviewRate_${shop}`, 'true');
      setClickedReviewRate(true);
      // Open App Store in new tab
      window.open('https://apps.shopify.com/indexaize#modal-show=ReviewListingModal', '_blank');
    } catch (error) {
      console.error('[Dashboard] Error saving clicked review rate state:', error);
    }
  };

  // Handle onboarding toggle
  // If user manually closes the card, mark it as seen immediately
  const handleOnboardingToggle = () => {
    const newState = !onboardingOpen;
    setOnboardingOpen(newState);
    
    // If user is closing the card (was open, now closing), mark as seen immediately
    if (onboardingOpen && !newState) {
      try {
        localStorage.setItem(`gettingStartedSeenOnce_${shop}`, 'true');
        // Clear timer if it exists (user closed it manually, no need to wait)
        if (markAsSeenTimerRef.current) {
          clearTimeout(markAsSeenTimerRef.current);
          markAsSeenTimerRef.current = null;
        }
      } catch (error) {
        console.error('[Dashboard] Error marking Getting Started as seen:', error);
      }
    }
  };

  if (loading) {
    return (
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text>Loading dashboard...</Text>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    );
  }
  
  // Check if this is first load (no sync yet)
  const isFirstLoad = !syncStatus?.synced;

  return (
    <Layout>
      {/* Onboarding Accordion - Top priority */}
      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd">Getting Started</Text>
              <Button
                onClick={handleOnboardingToggle}
                disclosure={onboardingOpen ? 'up' : 'down'}
              >
                {onboardingOpen ? 'Hide' : 'Show'} Guide
              </Button>
            </InlineStack>
            
            <Collapsible
              open={onboardingOpen}
              id="onboarding-collapsible"
              transition={{duration: '200ms', timingFunction: 'ease-in-out'}}
            >
              <Box paddingBlockStart="300">
                <BlockStack gap="400">
                  <Divider />
                  
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">What This App Does</Text>
                    <Text variant="bodyMd" tone="subdued">
                      This app helps optimize your Shopify store for <strong>AI search engines</strong> (like ChatGPT, Claude, Perplexity) 
                      by structuring your existing product data in a format that AI bots can easily understand and reference.
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      <strong>Important:</strong> This app primarily <strong>structures</strong> your existing data rather than creating new content. 
                      AI-enhanced features are supplementary and require additional tokens (unless you're on Growth Extra or Enterprise plans).
                    </Text>
                  </BlockStack>
                  
                  <Divider />
                  
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">Video Tutorial</Text>
                    <Box 
                      padding="400" 
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <div style={{
                        position: 'relative',
                        paddingBottom: '56.25%', // 16:9 aspect ratio
                        height: 0,
                        overflow: 'hidden',
                        maxWidth: '100%',
                        borderRadius: '8px'
                      }}>
                        <iframe
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            border: 'none'
                          }}
                          src="https://www.youtube-nocookie.com/embed/v253h9ucKNk?origin=https://admin.shopify.com"
                          title="Video Tutorial"
                          referrerPolicy="no-referrer-when-downgrade"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    </Box>
                  </BlockStack>
                  
                  <Divider />
                  
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Quick Start Guide</Text>
                    
                    <BlockStack gap="200">
                      <Text variant="bodyMd" fontWeight="semibold">1. Sync Your Store Data</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Click "Sync Now" to fetch your products, collections, languages, and markets from Shopify. 
                        This is required before you can start optimizing. Enable "Auto-sync on load" to keep your data fresh.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">2. Token Management</Text>
                      <Text variant="bodyMd" tone="subdued">
                        AI-enhanced features (AI SEO, Advanced Schema, AI Sitemap) require tokens. Purchase tokens from "Plans & Billing" or upgrade to Growth Extra/Enterprise for included monthly allowances.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">3. Structure Your Product Data</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Go to "Store Optimization for AI" → Products tab. First, create <strong>basic optimization</strong> by structuring 
                        existing titles, descriptions, and metadata for better AI consumption. Data is saved to Shopify metafields (seo_ai namespace). This is essential - without basic optimization, AI-enhanced features cannot be applied.
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        Also optimize your <strong>Collections</strong> to help AI bots understand your product categories 
                        and relationships.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">4. Generate Sitemaps</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Navigate to "Store Optimization for AI" → Sitemap tab to generate your <strong>standard sitemap</strong> for search engines. 
                        AI-Optimized Sitemap with structured data for AI search engines is available in the same tab (Growth Extra+ plans or with tokens).
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">5. Configure Store Metadata</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Go to "Store Optimization for AI" → Store Metadata tab to configure store description, keywords, business information, 
                        and contact details (Professional+ plans). Some data is automatically synced from Shopify but can be manually edited. This helps AI bots understand your brand and business context.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">6. Schema Data & Advanced Features</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Go to "Store Optimization for AI" → Schema Data tab:
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • Copy basic schema Liquid code to your theme (reads from metafields)
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • <strong>Advanced Schema Data:</strong> Generate rich AI-enhanced structured data markup (Plus plans: Professional Plus, Growth Plus, Growth Extra, Enterprise)
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">7. Configure AI Discovery Settings</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Visit "AI Discovery Features" to configure:
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • <strong>AI Bot Access Control:</strong> Select which AI bots (OpenAI, Claude, Google, etc.) can access your store's structured data
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • <strong>AI Discovery Features:</strong> Enable Products JSON Feed, Collections JSON Feed, Store Metadata, AI Welcome Page
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • Click <strong>"Save Settings"</strong> to save your configuration
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">8. Install robots.txt (REQUIRED)</Text>
                      <Text variant="bodyMd" tone="subdued">
                        <strong>Critical:</strong> After saving Settings, you must manually install robots.txt in your theme for AI bots to access your endpoints:
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • In AI Discovery Features, scroll to "robots.txt Configuration" section and click <strong>"View & Copy robots.txt Code"</strong>
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • Copy the generated robots.txt content
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • Go to <strong>Online Store → Themes</strong> → <strong>Actions → Edit code</strong> on your active theme
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • Click <strong>"Add a new file"</strong> and type: <code>templates/robots.txt.liquid</code>
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • Paste the copied content and click <strong>Save</strong>
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        <strong>Without this step, AI bots cannot discover your store's endpoints!</strong>
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">9. AI Testing</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Go to "AI Testing" to validate your optimization:
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • Run Basic Tests to check endpoint availability
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • Run AI-Powered Validation for detailed analysis (requires tokens)
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • Check your AIEO Score breakdown
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">10. Monitor & Improve</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Return to Dashboard regularly to track optimization progress and AIEO Score. Re-optimize when adding new products or editing existing ones to keep AI-structured data current.
                      </Text>
                    </BlockStack>
                  </BlockStack>
                  
                  <Box paddingBlockStart="200">
                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        onClick={() => navigate('/ai-seo/products')}
                      >
                        Start Optimizing
                      </Button>
                      <Button
                        onClick={() => navigate('/billing')}
                      >
                        View Plans
                      </Button>
                    </InlineStack>
                  </Box>
                </BlockStack>
              </Box>
            </Collapsible>
          </BlockStack>
        </Card>
      </Layout.Section>

      {/* Sync Banner - Inline, not blocking */}
      {isFirstLoad && (
        <Layout.Section>
          <Banner
            title="Sync your store"
            tone="info"
            action={{
              content: syncing ? 'Syncing...' : 'Sync Now',
              onAction: handleSync,
              loading: syncing
            }}
          >
            <BlockStack gap="200">
              <Text>Sync products, collections, languages, and markets to get started with AI optimization.</Text>
              {syncing && (
                <Box paddingBlockStart="200">
                  <ProgressBar progress={50} size="small" tone="highlight" />
                  <Box paddingBlockStart="100">
                    <Text variant="bodySm" tone="subdued">Fetching store data...</Text>
                  </Box>
                </Box>
              )}
            </BlockStack>
          </Banner>
        </Layout.Section>
      )}
      
      {/* Sync Status for subsequent loads */}
      {!isFirstLoad && syncStatus && (
        <Layout.Section>
          <Card>
            {!isExpanded ? (
              // Collapsed view - shows compact info
              <InlineStack align="space-between" blockAlign="center" gap="400">
                <InlineStack gap="200" blockAlign="center">
                  {autoSync && <Badge tone="success">Auto-sync enabled</Badge>}
                  <Text variant="bodySm" tone="subdued">
                    Last synced: {syncStatus.lastSyncDate ? 
                      new Date(syncStatus.lastSyncDate).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      }) 
                      : 'Never'}
                  </Text>
                </InlineStack>
                <InlineStack gap="200">
                  <Button 
                    onClick={handleSync} 
                    loading={syncing}
                    size="slim"
                  >
                    Sync Now
                  </Button>
                  <Button 
                    onClick={() => {
                      setIsExpanded(true);
                      try {
                        localStorage.setItem(`syncCardExpanded_${shop}`, 'true');
                      } catch (error) {
                        console.error('[Dashboard] Error saving sync card state:', error);
                      }
                    }} 
                    size="slim"
                    variant="plain"
                  >
                    Expand
                  </Button>
                </InlineStack>
              </InlineStack>
            ) : (
              // Full view when auto-sync is disabled
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <div>
                    <Text variant="bodyMd" fontWeight="semibold">Store Sync</Text>
                    <Box paddingBlockStart="050">
                      <Text variant="bodySm" tone="subdued">
                        Last synced: {syncStatus.lastSyncDate ? 
                          new Date(syncStatus.lastSyncDate).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          }) 
                          : 'Never'}
                      </Text>
                    </Box>
                  </div>
                  <InlineStack gap="200">
                    <Button 
                      onClick={handleSync} 
                      loading={syncing}
                    >
                      Sync Now
                    </Button>
                    <Button 
                      onClick={() => {
                        setIsExpanded(false);
                        try {
                          localStorage.setItem(`syncCardExpanded_${shop}`, 'false');
                        } catch (error) {
                          console.error('[Dashboard] Error saving sync card state:', error);
                        }
                      }} 
                      variant="plain"
                    >
                      Close
                    </Button>
                  </InlineStack>
                </InlineStack>
                
                <Divider />
                
                <Checkbox
                  label="Auto-sync on load"
                  checked={autoSync}
                  onChange={handleAutoSyncToggle}
                  helpText="Automatically sync store data when you open the dashboard"
                />
              </BlockStack>
            )}
          </Card>
        </Layout.Section>
      )}

      {/* Plan Upgrade Recommendation */}
      {recommendation && !dismissedUpgradeBanner && (
        <Layout.Section>
          <Banner
            title={`Upgrade to ${recommendation.planName} Plan`}
            tone="warning"
            action={{
              content: 'View Plans',
              onAction: () => navigate('/billing')
            }}
            onDismiss={handleDismissUpgradeBanner}
          >
            <BlockStack gap="200">
              <Text>{recommendation.reason}</Text>
              <Text variant="bodySm" tone="subdued">
                The {recommendation.planName} plan supports up to {recommendation.productLimit} products in {recommendation.languageLimit} language{recommendation.languageLimit > 1 ? 's' : ''} for ${recommendation.price}/month.
              </Text>
            </BlockStack>
          </Banner>
        </Layout.Section>
      )}

      {/* Token Purchase Recommendation */}
      {shouldRecommendTokens && !dismissedTokenBanner && (
        <Layout.Section>
          <Banner
            title="Buy Tokens to Unlock AI Features"
            tone="info"
            action={{
              content: 'Buy Tokens',
              onAction: () => setShowTokenPurchaseModal(true)
            }}
            onDismiss={handleDismissTokenBanner}
          >
            <Text>
              Purchase tokens to access AI-enhanced optimization features like AEO generation, AI Discovery and more.
            </Text>
          </Banner>
        </Layout.Section>
      )}
      
      {/* App Store Review Request - shows 6+ days after plan activation */}
      {shouldShowReviewBanner && (
        <Layout.Section>
          <Banner
            title="Enjoying indexAIze? ⭐"
            tone="success"
            action={{
              content: 'Rate Us',
              onAction: handleClickReviewRate
            }}
            onDismiss={handleDismissReviewBanner}
          >
            <Text>
              Your feedback helps other merchants discover indexAIze. If you're finding value in our app, we'd love a quick review!
            </Text>
          </Banner>
        </Layout.Section>
      )}

      {/* Two columns: Left = Products & Collections; Right = Languages & Markets + Last Optimization */}
      <Layout.Section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {/* LEFT COLUMN */}
          <div style={{ display: 'grid', gap: 16 }}>
            {/* Products & Collections Card */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Products & Collections</Text>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {/* Products Section */}
                  <BlockStack gap="150">
                    <Text variant="bodyMd" fontWeight="semibold">Products</Text>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued">Total</Text>
                      <Text variant="bodySm" fontWeight="semibold">{stats?.products?.total || 0}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued">Optimized</Text>
                      <Text variant="bodySm" fontWeight="semibold" tone="success">{stats?.products?.optimized || 0}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued">Unoptimized</Text>
                      <Text variant="bodySm" fontWeight="semibold">{Math.max((stats?.products?.total || 0) - (stats?.products?.optimized || 0), 0)}</Text>
                    </InlineStack>
                    <Box paddingBlockStart="100">
                      <ProgressBar progress={productOptimizationPercent} size="small" tone={productOptimizationPercent === 100 ? 'success' : 'primary'} />
                      <Box paddingBlockStart="050">
                        <Text variant="bodySm" tone="subdued">{productOptimizationPercent}% optimized</Text>
                      </Box>
                    </Box>
                  </BlockStack>
                  {/* Collections Section */}
                  <BlockStack gap="150">
                    <Text variant="bodyMd" fontWeight="semibold">Collections</Text>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued">Total</Text>
                      <Text variant="bodySm" fontWeight="semibold">{stats?.collections?.total || 0}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued">Optimized</Text>
                      <Text variant="bodySm" fontWeight="semibold" tone="success">{stats?.collections?.optimized || 0}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued">Unoptimized</Text>
                      <Text variant="bodySm" fontWeight="semibold">{Math.max((stats?.collections?.total || 0) - (stats?.collections?.optimized || 0), 0)}</Text>
                    </InlineStack>
                    <Box paddingBlockStart="100">
                      <ProgressBar progress={collectionOptimizationPercent} size="small" tone={collectionOptimizationPercent === 100 ? 'success' : 'primary'} />
                      <Box paddingBlockStart="050">
                        <Text variant="bodySm" tone="subdued">{collectionOptimizationPercent}% optimized</Text>
                      </Box>
                    </Box>
                  </BlockStack>
                </div>
                <Divider />
                <InlineStack align="space-between">
                  <Text variant="bodySm" tone="subdued">Last synced: {syncStatus?.lastSyncDate ? new Date(syncStatus.lastSyncDate).toLocaleString() : 'Never'}</Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'grid', gap: 16 }}>
            {/* Languages & Markets Card */}
            <Card>
      <BlockStack gap="400">
                <Text variant="headingMd">Languages & Markets</Text>
                <BlockStack gap="200">
                  {stats?.languages && stats.languages.length > 0 ? (
                    <>
                      {stats.languages
                        .slice()
                        .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || (b.totalCount || 0) - (a.totalCount || 0))
                        .slice(0, 3)
                        .map((lang, idx) => {
                          const pct = lang.totalCount > 0 ? Math.round((lang.optimizedCount / lang.totalCount) * 100) : 0;
                          return (
                            <BlockStack key={idx} gap="050">
                              <InlineStack align="space-between">
                                <Text variant="bodyMd" tone="subdued">{lang.name || lang.code} {lang.primary ? '★' : ''}</Text>
                                <Text variant="bodySm" fontWeight="semibold">{lang.optimizedCount || 0}/{lang.totalCount || 0}</Text>
                              </InlineStack>
                              <ProgressBar progress={pct} size="small" tone={pct === 100 ? 'success' : 'primary'} />
                            </BlockStack>
                          );
                        })}
                      {stats.languages.length > 3 && (
                        <Text variant="bodySm" tone="subdued">+{stats.languages.length - 3} more...</Text>
                      )}
                    </>
                  ) : (
                    <Text variant="bodyMd" tone="subdued">No language data</Text>
                  )}
                </BlockStack>
                {stats?.storeMarkets && stats.storeMarkets.length > 0 && (
                  <Box paddingBlockStart="200">
                    <Divider />
                    <Box paddingBlockStart="200">
                      <Text variant="bodySm" tone="subdued">Markets: {stats.storeMarkets.slice(0, 2).map(m => m.name).join(', ')}{stats.storeMarkets.length > 2 ? ` +${stats.storeMarkets.length - 2}` : ''}</Text>
                    </Box>
                  </Box>
                )}
              </BlockStack>
            </Card>

            {/* Last Optimization */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Last Optimization</Text>
                <Text variant="bodyLg" fontWeight="semibold">
                  {stats?.lastOptimization ? new Date(stats.lastOptimization).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'}
                </Text>
                <Button onClick={() => navigate('/ai-seo/products')}>Optimize Now</Button>
              </BlockStack>
            </Card>
          </div>
        </div>
      </Layout.Section>

      {/* AIEO Score Card - Full width section (2 columns) */}
      <Layout.Section>
        <AIEOScoreCard 
          testResults={testResults}
          aiTestResults={aiTestResults}
          stats={(() => {
            // Use stats from state (synced via localStorage)
            // If stats are not loaded yet, try to get from localStorage
            if (stats) {
              return {
                totalProducts: stats?.products?.total || 0,
                optimizedProducts: stats?.products?.optimized || 0,
                totalCollections: stats?.collections?.total || 0,
                optimizedCollections: stats?.collections?.optimized || 0
              };
            }
            
            // Fallback to localStorage if stats not loaded yet
            try {
              const savedStats = localStorage.getItem(`dashboard-stats-${shop}`);
              if (savedStats) {
                const parsed = JSON.parse(savedStats);
                return {
                  totalProducts: parsed.totalProducts || 0,
                  optimizedProducts: parsed.optimizedProducts || 0,
                  totalCollections: parsed.totalCollections || 0,
                  optimizedCollections: parsed.optimizedCollections || 0
                };
              }
            } catch (err) {
              console.error('[Dashboard] Error loading stats from localStorage:', err);
            }
            
            return {
              totalProducts: 0,
              optimizedProducts: 0,
              totalCollections: 0,
              optimizedCollections: 0
            };
          })()}
          shop={shop}
          api={api}
          onTestsComplete={(results) => {
            setTestResults(results);
            // Reload dashboard data to get fresh stats
            loadDashboardData(true);
          }}
          onScoreCalculated={(score) => setAieoScore(score)}
        />
      </Layout.Section>

      {/* Current Plan & Token Balance - Two columns side by side */}
      <Layout.Section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {/* Current Plan */}
          <Card style={{ height: 220, minHeight: 220 }}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <div>
                  <Text variant="headingMd">Current Plan</Text>
                  <Box paddingBlockStart="100">
                    <Text variant="bodySm" tone="subdued">{planPriceValue ? `$${planPriceValue.toFixed(2)}` : '—'}/month</Text>
                  </Box>
                </div>
                <Badge tone="info" size="large">{subscription?.plan?.replace('_', ' ').toUpperCase() || 'N/A'}</Badge>
              </InlineStack>
              <Button onClick={() => navigate('/billing')}>View Plans & Billing</Button>
            </BlockStack>
          </Card>

          {/* Token Balance */}
          <Card style={{ height: 220, minHeight: 220 }}>
            <BlockStack gap="300">
              <Text variant="headingMd">Token Balance</Text>
              <Text variant="bodyLg" fontWeight="semibold">{tokens?.balance?.toLocaleString() || 0} tokens</Text>
              {(subscription?.plan === 'growth_extra' || subscription?.plan === 'enterprise') && (
                <Text variant="bodySm" tone="subdued">{subscription?.plan === 'growth_extra' ? '100M' : '300M'} included monthly</Text>
              )}
              <Button onClick={() => navigate('/billing')}>Manage Tokens</Button>
            </BlockStack>
          </Card>
        </div>
      </Layout.Section>

      {/* Token Purchase Modal */}
      <TokenPurchaseModal
        open={showTokenPurchaseModal}
        onClose={() => setShowTokenPurchaseModal(false)}
        shop={shop}
        returnTo="/dashboard"
        onPurchaseComplete={() => {
          setShowTokenPurchaseModal(false);
          loadDashboardData(true); // Refresh token balance
        }}
      />
    </Layout>
  );
}

