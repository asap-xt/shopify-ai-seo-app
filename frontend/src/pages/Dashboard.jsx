// frontend/src/pages/Dashboard.jsx
import React, { useEffect, useState, useMemo } from 'react';
import {
  Layout,
  Card,
  Text,
  Button,
  InlineStack,
  BlockStack,
  Badge,
  Banner,
  ProgressBar,
  Divider,
  Box,
  Icon
} from '@shopify/polaris';
import { useNavigate } from 'react-router-dom';
import { makeSessionFetch } from '../lib/sessionFetch.js';

const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; }
  catch { return d; }
};

export default function Dashboard({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  const navigate = useNavigate();
  const api = useMemo(() => makeSessionFetch(), []);
  
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [tokens, setTokens] = useState(null);

  useEffect(() => {
    if (shop) {
      loadDashboardData();
    }
  }, [shop]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Load billing info (subscription & tokens)
      const billingResponse = await api(`/api/billing/info?shop=${shop}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      setSubscription(billingResponse.subscription);
      setTokens(billingResponse.tokens);
      
      // Load optimization stats
      const statsResponse = await api(`/api/dashboard/stats?shop=${shop}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      setStats(statsResponse);
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

  // Plan-based feature checks
  const hasCollections = ['growth', 'growth extra', 'enterprise'].includes(subscription?.plan);
  const hasStoreMetadata = ['professional', 'growth', 'growth extra', 'enterprise'].includes(subscription?.plan);
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
      {/* Optimization Stats Row */}
      <Layout.Section>
        <InlineStack gap="400" wrap={false}>
          {/* Products Optimization */}
          <div style={{ flex: 1 }}>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd">Products</Text>
                  <Badge tone={productOptimizationPercent === 100 ? 'success' : 'attention'}>
                    {stats?.products?.optimized || 0} / {stats?.products?.total || 0}
                  </Badge>
                </InlineStack>
                
                <ProgressBar 
                  progress={productOptimizationPercent} 
                  tone={productOptimizationPercent === 100 ? 'success' : 'primary'}
                />
                
                <Text variant="bodySm" tone="subdued">
                  {productOptimizationPercent}% optimized for AI Search
                </Text>
                
                {stats?.products?.lastOptimized && (
                  <Text variant="bodySm" tone="subdued">
                    Last: {new Date(stats.products.lastOptimized).toLocaleDateString()}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </div>
          
          {/* Collections Optimization (if available) */}
          {hasCollections && (
            <div style={{ flex: 1 }}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd">Collections</Text>
                    <Badge tone={collectionOptimizationPercent === 100 ? 'success' : 'attention'}>
                      {stats?.collections?.optimized || 0} / {stats?.collections?.total || 0}
                    </Badge>
                  </InlineStack>
                  
                  <ProgressBar 
                    progress={collectionOptimizationPercent} 
                    tone={collectionOptimizationPercent === 100 ? 'success' : 'primary'}
                  />
                  
                  <Text variant="bodySm" tone="subdued">
                    {collectionOptimizationPercent}% optimized for AI Search
                  </Text>
                  
                  {stats?.collections?.lastOptimized && (
                    <Text variant="bodySm" tone="subdued">
                      Last: {new Date(stats.collections.lastOptimized).toLocaleDateString()}
                    </Text>
                  )}
                </BlockStack>
              </Card>
            </div>
          )}
          
          {/* Token Balance */}
          <div style={{ flex: 1 }}>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Token Balance</Text>
                
                <Box>
                  <Text variant="heading2xl" alignment="center">
                    {tokens?.balance?.toLocaleString() || 0}
                  </Text>
                  <Text variant="bodySm" tone="subdued" alignment="center">
                    tokens available
                  </Text>
                  {(subscription?.plan === 'growth extra' || subscription?.plan === 'enterprise') && (
                    <Text variant="bodySm" tone="subdued" alignment="center">
                      ({subscription?.plan === 'growth extra' ? '100M' : '300M'} included)
                    </Text>
                  )}
                </Box>
                
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => navigate(`/billing?shop=${shop}&host=${qs('host')}&embedded=1`)}
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
                onClick={() => navigate(`/products?shop=${shop}&host=${qs('host')}&embedded=1`)}
              >
                Optimize Products
              </Button>
              
              {hasCollections && (
                <Button
                  onClick={() => navigate(`/collections?shop=${shop}&host=${qs('host')}&embedded=1`)}
                >
                  Optimize Collections
                </Button>
              )}
              
              {hasStoreMetadata && (
                <Button
                  onClick={() => navigate(`/store-metadata?shop=${shop}&host=${qs('host')}&embedded=1`)}
                >
                  Edit Store Metadata
                </Button>
              )}
              
              <Button
                onClick={() => navigate(`/sitemap?shop=${shop}&host=${qs('host')}&embedded=1`)}
              >
                View Sitemap
              </Button>
              
              {hasAdvancedSchema && (
                <Button
                  onClick={() => navigate(`/schema?shop=${shop}&host=${qs('host')}&embedded=1`)}
                >
                  Advanced Schema
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        </Card>
      </Layout.Section>

      {/* AI Features Status */}
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd">AI Features Status</Text>
            
            <Divider />
            
            <BlockStack gap="300">
              {/* Store Metadata */}
              {hasStoreMetadata && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd">Store Metadata</Text>
                  {stats?.storeMetadata?.complete ? (
                    <Badge tone="success">✓ Complete</Badge>
                  ) : (
                    <Badge tone="warning">Incomplete</Badge>
                  )}
                </InlineStack>
              )}
              
              {/* Sitemap */}
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="bodyMd">Sitemap</Text>
                {stats?.sitemap?.generated ? (
                  <Badge tone="success">✓ Generated</Badge>
                ) : (
                  <Badge tone="attention">Not yet</Badge>
                )}
              </InlineStack>
              
              {/* Advanced Schema */}
              {hasAdvancedSchema && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd">Advanced Schema</Text>
                  {stats?.advancedSchema?.active ? (
                    <Badge tone="success">✓ Active</Badge>
                  ) : (
                    <Badge tone="attention">Not set up</Badge>
                  )}
                </InlineStack>
              )}
            </BlockStack>
          </BlockStack>
        </Card>
      </Layout.Section>

      {/* Alerts & Recommendations */}
      {(stats?.alerts && stats.alerts.length > 0) && (
        <Layout.Section>
          <BlockStack gap="300">
            {stats.alerts.map((alert, idx) => (
              <Banner
                key={idx}
                tone={alert.type === 'warning' ? 'warning' : 'info'}
                title={alert.title}
                action={alert.action ? {
                  content: alert.action.label,
                  onAction: () => navigate(alert.action.url)
                } : undefined}
              >
                {alert.message && <p>{alert.message}</p>}
              </Banner>
            ))}
          </BlockStack>
        </Layout.Section>
      )}

      {/* Current Plan Info */}
      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd">Current Plan</Text>
              <Badge tone="info">{subscription?.plan?.toUpperCase() || 'N/A'}</Badge>
            </InlineStack>
            
            <Text variant="bodySm" tone="subdued">
              ${subscription?.price || 0}/month
            </Text>
            
            <Button
              onClick={() => navigate(`/billing?shop=${shop}&host=${qs('host')}&embedded=1`)}
            >
              View Plans & Billing
            </Button>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}
