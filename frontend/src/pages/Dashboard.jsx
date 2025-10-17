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
  const pollRef = useRef(null);
  
  // Onboarding state
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    loadDashboardData();
    loadSyncStatus();
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [shop]);
  
  // Auto-sync on load if enabled
  useEffect(() => {
    if (syncStatus && syncStatus.autoSyncEnabled && !syncStatus.synced) {
      handleSync();
    }
  }, [syncStatus]);

  const loadDashboardData = async () => {
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
    } catch (error) {
      console.error('[Dashboard] Error loading data:', error);
    } finally {
      setLoading(false);
    }
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
                loadDashboardData(); // Reload stats
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
  
  const handleAutoSyncToggle = async (enabled) => {
    try {
      const res = await api(`/api/dashboard/auto-sync?shop=${shop}`, { method: 'POST', body: { enabled } });
      if (res?.success) {
        setAutoSync(!!res.autoSyncEnabled);
        setSyncStatus({ ...(syncStatus || {}), autoSyncEnabled: !!res.autoSyncEnabled });
      } else {
        setAutoSync(enabled);
        setSyncStatus({ ...(syncStatus || {}), autoSyncEnabled: enabled });
      }
    } catch (error) {
      console.error('[Dashboard] Error toggling auto-sync:', error);
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
  const hasCollections = ['growth', 'growth_extra', 'enterprise'].includes(subscription?.plan);
  const hasStoreMetadata = ['professional', 'growth', 'growth_extra', 'enterprise'].includes(subscription?.plan);
  const hasAdvancedSchema = subscription?.plan === 'enterprise';
  const hasAiSitemap = ['growth_extra', 'enterprise'].includes(subscription?.plan);

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
      <Layout.Section>
        <Text variant="headingLg" as="h1">Store Overview</Text>
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
                <Button 
                  onClick={handleSync} 
                  loading={syncing}
                >
                  Sync Now
                </Button>
              </InlineStack>
              
              <Divider />
              
              <Checkbox
                label="Auto-sync on load"
                checked={autoSync}
                onChange={handleAutoSyncToggle}
                helpText="Automatically sync store data when you open the dashboard"
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      )}

      {/* Main Stats Grid */}
      <Layout.Section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
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
                <Text variant="bodySm" tone="subdued">
                  Last synced: {syncStatus?.lastSyncDate ? new Date(syncStatus.lastSyncDate).toLocaleString() : 'Never'}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Last optimized: {stats?.lastOptimization ? new Date(stats.lastOptimization).toLocaleString() : 'Never'}
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Removed separate Collections card to avoid duplication */}

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
                      <Text variant="bodySm" tone="subdued">
                        +{stats.languages.length - 3} more...
                      </Text>
                    )}
                  </>
                ) : (
                  <Text variant="bodyMd" tone="subdued">
                    No language data
                  </Text>
                )}
              </BlockStack>

              {/* Markets summary (compact) */}
              {stats?.storeMarkets && stats.storeMarkets.length > 0 && (
                <Box paddingBlockStart="200">
                  <Divider />
                  <Box paddingBlockStart="200">
                    <Text variant="bodySm" tone="subdued">
                      Markets: {stats.storeMarkets.slice(0, 2).map(m => m.name).join(', ')}{stats.storeMarkets.length > 2 ? ` +${stats.storeMarkets.length - 2}` : ''}
                    </Text>
                  </Box>
                </Box>
              )}
            </BlockStack>
          </Card>
        </div>
      </Layout.Section>

      {/* Second Row: Last Optimization & Token Balance */}
      <Layout.Section>
        <InlineStack gap="400" wrap>
          {/* Last Optimization */}
          <div style={{ flex: '1', minWidth: '300px' }}>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Last Optimization</Text>
                
                <Text variant="bodyLg" fontWeight="semibold">
                  {stats?.lastOptimization ? 
                    new Date(stats.lastOptimization).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    }) 
                    : 'Never'}
                </Text>
                
                <Button
                  onClick={() => navigate('/ai-seo/products')}
                >
                  Optimize Now
                </Button>
              </BlockStack>
            </Card>
          </div>

          {/* Token Balance */}
          <div style={{ flex: '1', minWidth: '300px' }}>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Token Balance</Text>
                
                <Text variant="bodyLg" fontWeight="semibold">
                  {tokens?.balance?.toLocaleString() || 0} tokens
                </Text>
                
                {(subscription?.plan === 'growth_extra' || subscription?.plan === 'enterprise') && (
                  <Text variant="bodySm" tone="subdued">
                    {subscription?.plan === 'growth_extra' ? '100M' : '300M'} included monthly
                  </Text>
                )}
                
                <Button
                  variant="primary"
                  onClick={() => navigate('/billing')}
                >
                  Manage Tokens
                </Button>
              </BlockStack>
            </Card>
          </div>
        </InlineStack>
      </Layout.Section>

      {/* Quick Actions */}
      <Layout.Section>
        <Card>
      <BlockStack gap="400">
            <Text variant="headingMd">Quick Actions</Text>
            
            <InlineStack gap="300" wrap>
              <Button
                onClick={() => navigate('/ai-seo/products')}
              >
                Optimize Products
              </Button>
              
              {hasCollections && (
                <Button
                  onClick={() => navigate('/ai-seo/collections')}
                >
                  Optimize Collections
                </Button>
              )}
              
              {/* Show these buttons only after sync */}
              {!isFirstLoad && (
                <>
                  <Button
                    onClick={() => navigate('/ai-seo/sitemap')}
                  >
                    {hasAiSitemap ? 'Regenerate Sitemap' : 'View Sitemap'}
                  </Button>
                  
                  {hasAdvancedSchema && (
                    <Button
                      onClick={() => navigate('/ai-seo/schema-data')}
                    >
                      Regenerate Schemas
                    </Button>
                  )}
                </>
              )}
              
              {hasStoreMetadata && (
                <Button
                  onClick={() => navigate('/ai-seo/store-metadata')}
                >
                  Store Info
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        </Card>
      </Layout.Section>

      {/* Current Plan */}
      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <div>
                <Text variant="headingMd">Current Plan</Text>
                <Box paddingBlockStart="100">
                  <Text variant="bodySm" tone="subdued">
                    ${subscription?.price || 0}/month
                  </Text>
                </Box>
              </div>
              <Badge tone="info" size="large">
                {subscription?.plan?.replace('_', ' ').toUpperCase() || 'N/A'}
              </Badge>
            </InlineStack>
            
            <Button
              onClick={() => navigate('/billing')}
            >
              View Plans & Billing
            </Button>
          </BlockStack>
        </Card>
      </Layout.Section>
      
      {/* Onboarding Accordion */}
      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd">Getting Started</Text>
              <Button
                onClick={() => setOnboardingOpen(!onboardingOpen)}
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
                    <Text variant="headingMd" as="h3">Quick Start Guide</Text>
                    
                    <BlockStack gap="200">
                      <Text variant="bodyMd" fontWeight="semibold">1. Sync Your Store</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Click "Sync Now" to fetch your products, collections, and languages from Shopify. 
                        This is required before you can start optimizing.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">2. Choose a Plan</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Visit Plans & Billing to select the plan that fits your store size. 
                        Each plan includes different limits for products, languages, and features.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">3. Optimize Your Products</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Go to "Search Optimization for AI" → Products tab. Select products and click "AI Enhance" 
                        to generate SEO-optimized titles, descriptions, and metadata.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">4. Generate AI Sitemap</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Navigate to Sitemap tab and generate your AI-optimized sitemap. This helps AI search engines 
                        discover and index your products.
                      </Text>
                      
                      <Text variant="bodyMd" fontWeight="semibold">5. Monitor & Improve</Text>
                      <Text variant="bodyMd" tone="subdued">
                        Return to Dashboard regularly to track optimization progress and token usage. 
                        Enable auto-sync to keep your data fresh.
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
    </Layout>
  );
}
