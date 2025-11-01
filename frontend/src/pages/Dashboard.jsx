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
  
  // Sync state
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false); // New state for expanded view
  const pollRef = useRef(null);
  const autoSyncTriggered = useRef(false); // Track if auto-sync was already triggered
  
  // Onboarding state - open by default, persist in localStorage
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(`onboardingOpen_${shop}`);
      // If never set before, default to true (open)
      return saved === null ? true : saved === 'true';
    } catch {
      return true; // Default open if localStorage fails
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
  
  // Debounce timer for dashboard data loading
  const loadDataTimeoutRef = useRef(null);

  useEffect(() => {
    loadDashboardData(true); // Force immediate load on mount
    loadSyncStatus();
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (loadDataTimeoutRef.current) {
        clearTimeout(loadDataTimeoutRef.current);
      }
    };
  }, [shop]);
  
  // Auto-sync on load if enabled (only once per page load)
  useEffect(() => {
    if (syncStatus && syncStatus.autoSyncEnabled && !syncing && !autoSyncTriggered.current) {
      console.log('[Dashboard] Auto-sync is enabled, triggering sync...');
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
          const [statsData, tokensData] = await Promise.all([
            api(`/api/dashboard/stats?shop=${shop}`),
            api(`/api/billing/tokens/balance?shop=${shop}`)
          ]);

          if (statsData) {
            setStats(statsData);
            setSubscription(statsData.subscription);
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
      console.log('[Dashboard] Sync start response:', res);
      
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
      console.log('[Dashboard] Toggling auto-sync to:', newValue);
      
      // Optimistic UI update
      setAutoSync(newValue);
      
      const res = await api(`/api/dashboard/auto-sync?shop=${shop}`, { 
        method: 'POST', 
        body: { enabled: newValue } 
      });
      
      console.log('[Dashboard] Auto-sync toggle response:', res);
      
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
  const hasCollections = ['growth', 'growth_plus', 'growth plus', 'growth_extra', 'growth extra', 'enterprise'].includes(subscription?.plan);
  const hasStoreMetadata = ['professional', 'professional_plus', 'professional plus', 'growth', 'growth_plus', 'growth plus', 'growth_extra', 'growth extra', 'enterprise'].includes(subscription?.plan);
  const hasAdvancedSchema = subscription?.plan === 'enterprise';
  const hasAiSitemap = ['growth_extra', 'growth extra', 'enterprise'].includes(subscription?.plan);

  // Plan price fallback mapping (if backend doesn't provide price)
  const planPriceFallback = useMemo(() => ({
    starter: 9.99,
    professional: 15.99,
    professional_plus: 19.99,
    'professional plus': 19.99,
    growth: 29.99,
    growth_plus: 35.99,
    'growth plus': 35.99,
    growth_extra: 79.99,
    'growth extra': 79.99,
    enterprise: 139.99
  }), []);
  const planPriceValue = subscription?.price && subscription.price > 0
    ? subscription.price
    : (subscription?.plan ? planPriceFallback[subscription.plan] : undefined);

  // Plan recommendation logic
  const getPlanLimits = (planKey) => {
    switch (planKey) {
      case 'starter': return { products: 100, languages: 1 };
      case 'professional': return { products: 250, languages: 2 };
      case 'professional_plus':
      case 'professional plus': return { products: 250, languages: 2 };
      case 'growth': return { products: 700, languages: 3 };
      case 'growth_plus':
      case 'growth plus': return { products: 700, languages: 3 };
      case 'growth_extra':
      case 'growth extra': return { products: 1000, languages: 6 };
      case 'enterprise': return { products: 2500, languages: 10 };
      default: return { products: 0, languages: 0 };
    }
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
    if (!stats) return null;
    
    const totalProducts = stats.products?.total || 0;
    const totalLanguages = stats.languages?.length || 1;
    const currentPlan = subscription?.plan || 'starter';
    const currentPlanOrder = getPlanOrder(currentPlan);

    // Find the most suitable plan based on store data
    const plans = ['starter', 'professional', 'growth', 'growth_extra', 'enterprise'];
    let recommendedPlan = null;

    for (const plan of plans) {
      const limits = getPlanLimits(plan);
      if (totalProducts <= limits.products && totalLanguages <= limits.languages) {
        recommendedPlan = plan;
        break;
      }
    }

    // If no plan fits, recommend enterprise
    if (!recommendedPlan) recommendedPlan = 'enterprise';

    // Only show recommendation if it's higher than current plan
    const recommendedPlanOrder = getPlanOrder(recommendedPlan);
    if (recommendedPlanOrder <= currentPlanOrder) return null;

    const currentLimits = getPlanLimits(currentPlan);
    const recommendedLimits = getPlanLimits(recommendedPlan);
    
    let reason = '';
    if (totalProducts > currentLimits.products) {
      reason = `Your store has ${totalProducts} products, exceeding the ${currentLimits.products}-product limit of your current plan.`;
    } else if (totalLanguages > currentLimits.languages) {
      reason = `Your store has ${totalLanguages} language(s), exceeding the ${currentLimits.languages}-language limit of your current plan.`;
    }

    return {
      plan: recommendedPlan,
      planName: recommendedPlan.replace('_', ' ').toUpperCase(),
      price: planPriceFallback[recommendedPlan],
      productLimit: recommendedLimits.products,
      languageLimit: recommendedLimits.languages,
      reason
    };
  };

  const recommendation = useMemo(() => recommendPlan(), [stats, subscription]);

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

  // Handle onboarding toggle with localStorage persistence
  const handleOnboardingToggle = () => {
    const newState = !onboardingOpen;
    setOnboardingOpen(newState);
    try {
      localStorage.setItem(`onboardingOpen_${shop}`, String(newState));
    } catch (error) {
      console.error('[Dashboard] Error saving onboarding state:', error);
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
            {autoSync && !isExpanded ? (
              // Collapsed view when auto-sync is enabled
              <InlineStack align="space-between" blockAlign="center" gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="success">Auto-sync enabled</Badge>
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
                    onClick={() => setIsExpanded(!isExpanded)} 
                    size="slim"
                    variant="plain"
                  >
                    Settings
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
                      onClick={() => setIsExpanded(false)} 
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
                The {recommendation.planName} plan supports up to {recommendation.productLimit} products 
                in {recommendation.languageLimit} language{recommendation.languageLimit > 1 ? 's' : ''} 
                for ${recommendation.price}/month.
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
              onAction: () => navigate('/billing')
            }}
            onDismiss={handleDismissTokenBanner}
          >
            <Text>
              Your current plan uses pay-per-use tokens. Purchase tokens to access AI-enhanced optimization features 
              like SEO generation, bulk editing, and AI Discovery.
            </Text>
          </Banner>
        </Layout.Section>
      )}

      {/* Onboarding Accordion - Moved to top */}
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
                  
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">Quick Start Guide</Text>
                    
                    <BlockStack gap="200">
                      <Text variant="bodyMd" fontWeight="semibold">1. Sync Your Store Data</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Click "Sync Now" to fetch your products, collections, languages, and markets from Shopify. 
                        This is required before you can start optimizing. Enable "Auto-sync on load" to keep your data fresh.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">2. Plan Selection & Token Management</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Plan selection happens during app installation. Visit "Plans & Billing" to upgrade your plan 
                        or purchase additional tokens for AI-enhanced features (Professional/Growth plans).
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">3. Structure Your Product Data</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Go to "Search Optimization for AI" → Products tab. First, create <strong>basic optimization</strong> by structuring 
                        existing titles, descriptions, and metadata for better AI consumption. This is essential - without basic optimization, 
                        AI-enhanced features cannot be applied.
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        Also optimize your <strong>Collections</strong> to help AI bots understand your product categories 
                        and relationships.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">4. Configure Store Metadata</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Go to "Store Metadata" to configure store description, keywords, business information, 
                        and contact details (Professional+ plans). This helps AI bots understand your brand and business context.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">5. Generate Sitemaps</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Navigate to Sitemap tab to generate your <strong>standard sitemap</strong> for search engines. 
                        For advanced optimization, go to Settings → Sitemap to configure <strong>AI-enhanced sitemap</strong> 
                         with structured data that helps AI search engines discover and index your products (Growth Extra+ plans).
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">6. AI-Enhanced Features (Optional)</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Use AI-enhanced add-ons to <strong>supplement and strengthen</strong> your data discovery by AI bots, 
                        increasing your store's chances of being well-represented. These include:
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • <strong>AI Testing:</strong> Test how AI bots respond to your products (Professional+)
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • <strong>AI Discovery Endpoints:</strong> Advanced AI simulation features (Growth Extra+)
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • <strong>Advanced Schema Data:</strong> Rich structured data markup (Enterprise only)
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        These features require additional tokens unless you're on Growth Extra or Enterprise plans.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">7. Configure Settings</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Visit "Settings" to configure app preferences, view JSON feeds, manage AI providers, 
                        and access advanced features like AI-enhanced sitemap generation. Settings are crucial for 
                        fine-tuning how your store data is presented to AI search engines.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">8. Manual Setup Required</Text>
                      <Text variant="bodyMd" tone="subdued">
                        <strong>Important:</strong> Some features require manual setup in your Shopify theme:
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • <strong>Schema Data:</strong> Copy the generated schema markup from Settings → Schema Data 
                        and paste it into your theme's product templates (Enterprise plan)
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        • <strong>robots.txt.liquid:</strong> Add the generated robots.txt content to your theme's 
                        templates/layout/robots.txt.liquid file to help AI crawlers discover your content
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        These manual steps are essential for full AI search engine optimization.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">9. Monitor & Improve</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Return to Dashboard regularly to track optimization progress, monitor token usage, 
                        and review plan recommendations.
                      </Text>
                    </BlockStack>
                  </BlockStack>
                  
                  <Divider />
                  
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">Video Tutorial</Text>
                    <Box 
                      padding="400" 
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="200" inlineAlign="center">
                        <Text variant="bodyMd" tone="subdued" alignment="center">
                          Video tutorial coming soon
                        </Text>
                        <Text variant="bodySm" tone="subdued" alignment="center">
                          [Embedded video will be added here]
                        </Text>
                      </BlockStack>
                    </Box>
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

      {/* Two columns: Left = Products & Collections + Current Plan; Right = Languages & Markets + Last Optimization + Token Balance */}
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
        </div>
      </Layout.Section>

    </Layout>
  );
}
