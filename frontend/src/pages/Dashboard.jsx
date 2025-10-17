// frontend/src/pages/Dashboard.jsx
import { useState, useEffect, useMemo } from 'react';
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
  Box
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

  useEffect(() => {
    loadDashboardData();
  }, [shop]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      const [statsRes, tokensRes] = await Promise.all([
        api.get(`/api/dashboard/stats?shop=${shop}`),
        api.get(`/api/billing/tokens/balance?shop=${shop}`)
      ]);
      
      if (statsRes.ok && tokensRes.ok) {
        const statsData = await statsRes.json();
        const tokensData = await tokensRes.json();
        
        setStats(statsData);
        setSubscription(statsData.subscription);
        setTokens(tokensData);
      }
    } catch (error) {
      console.error('[Dashboard] Error loading data:', error);
    } finally {
      setLoading(false);
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

  return (
    <Layout>
      <Layout.Section>
        <Text variant="headingLg" as="h1">Store Overview</Text>
      </Layout.Section>

      {/* Main Stats Grid */}
      <Layout.Section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {/* Products Card */}
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd">Products</Text>
              
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="bodyMd" tone="subdued">Total</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {stats?.products?.total || 0}
                  </Text>
                </InlineStack>
                
                <InlineStack align="space-between">
                  <Text variant="bodyMd" tone="subdued">Optimized</Text>
                  <Text variant="bodyMd" fontWeight="semibold" tone="success">
                    {stats?.products?.optimized || 0}
                  </Text>
                </InlineStack>
                
                <Divider />
                
                <Box paddingBlockStart="200">
                  <div style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: '#e0e0e0',
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${productOptimizationPercent}%`,
                      height: '100%',
                      backgroundColor: productOptimizationPercent === 100 ? '#4caf50' : '#2196f3',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                  <Box paddingBlockStart="100">
                    <Text variant="bodySm" tone="subdued">
                      {productOptimizationPercent}% optimized
                    </Text>
                  </Box>
                </Box>
              </BlockStack>
            </BlockStack>
          </Card>

          {/* Collections Card (if available) */}
          {hasCollections && (
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Collections</Text>
                
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodyMd" tone="subdued">Total</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {stats?.collections?.total || 0}
                    </Text>
                  </InlineStack>
                  
                  <InlineStack align="space-between">
                    <Text variant="bodyMd" tone="subdued">Optimized</Text>
                    <Text variant="bodyMd" fontWeight="semibold" tone="success">
                      {stats?.collections?.optimized || 0}
                    </Text>
                  </InlineStack>
                  
                  <Divider />
                  
                  <Box paddingBlockStart="200">
                    <div style={{
                      width: '100%',
                      height: '8px',
                      backgroundColor: '#e0e0e0',
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        width: `${collectionOptimizationPercent}%`,
                        height: '100%',
                        backgroundColor: collectionOptimizationPercent === 100 ? '#4caf50' : '#2196f3',
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                    <Box paddingBlockStart="100">
                      <Text variant="bodySm" tone="subdued">
                        {collectionOptimizationPercent}% optimized
                      </Text>
                    </Box>
                  </Box>
                </BlockStack>
              </BlockStack>
            </Card>
          )}

          {/* Languages Card */}
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd">Languages</Text>
              
              <BlockStack gap="200">
                {stats?.languages && stats.languages.length > 0 ? (
                  <>
                    {stats.languages.slice(0, 3).map((lang, idx) => (
                      <InlineStack key={idx} align="space-between">
                        <Text variant="bodyMd" tone="subdued">
                          {lang.name || lang.code} {lang.primary && '★'}
                        </Text>
                        <Badge tone={lang.optimizedCount > 0 ? 'success' : 'subdued'}>
                          {lang.optimizedCount || 0}
                        </Badge>
                      </InlineStack>
                    ))}
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
              
              <Button
                onClick={() => navigate('/ai-seo/sitemap')}
              >
                View Sitemap
              </Button>
              
              {hasStoreMetadata && (
                <Button
                  onClick={() => navigate('/ai-seo/store-metadata')}
                >
                  Store Info
                </Button>
              )}
              
              {hasAdvancedSchema && (
                <Button
                  onClick={() => navigate('/ai-seo/schema-data')}
                >
                  Schema Data
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
    </Layout>
  );
}
