import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Layout, Card, Text, Button, Badge, BlockStack, InlineStack,
  Box, Banner, Divider, DataTable, Select, Spinner, Icon
} from '@shopify/polaris';
import { makeSessionFetch } from '../lib/sessionFetch.js';
import { isPlanAtLeast } from '../hooks/usePlanHierarchy.js';

const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; }
  catch { return d; }
};

const PERIODS = [
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
];

const SOURCE_COLORS = {
  ChatGPT: '#10a37f',
  Perplexity: '#20b8cd',
  Claude: '#d97706',
  Gemini: '#4285f4',
  Copilot: '#0078d4',
  'You.com': '#6366f1',
  Poe: '#7c3aed',
  Phind: '#059669',
  'Meta AI': '#1877f2',
  Kagi: '#fbbf24',
};

function formatCurrency(amount, currency = 'USD') {
  const num = parseFloat(amount || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
}

function pct(val) {
  const n = parseFloat(val || 0);
  if (n > 0) return `+${n}%`;
  if (n < 0) return `${n}%`;
  return '0%';
}

// Simple bar chart using div bars
function BarChart({ data, maxHeight = 160 }) {
  if (!data || !data.length) {
    return <Text color="subdued">No data for this period</Text>;
  }
  const maxVal = Math.max(...data.map(d => d.total || 0), 1);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: maxHeight, padding: '0 4px' }}>
      {data.map((d, i) => {
        const directH = ((d.direct_ai || 0) / maxVal) * maxHeight;
        const influencedH = ((d.ai_influenced || 0) / maxVal) * maxHeight;
        const organicH = ((d.organic || 0) / maxVal) * maxHeight;
        const barW = Math.max(Math.floor(600 / data.length) - 2, 4);
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', width: barW, height: '100%' }}
               title={`${d.date}\nDirect AI: ${formatCurrency(d.direct_ai)}\nAI Influenced: ${formatCurrency(d.ai_influenced)}\nOrganic: ${formatCurrency(d.organic)}`}>
            <div style={{ height: directH, background: '#10a37f', borderRadius: '2px 2px 0 0' }} />
            <div style={{ height: influencedH, background: '#60a5fa' }} />
            <div style={{ height: organicH, background: '#d1d5db', borderRadius: '0 0 2px 2px' }} />
          </div>
        );
      })}
    </div>
  );
}

// Funnel visualization
function FunnelChart({ steps }) {
  if (!steps || !steps.length) return null;
  const maxCount = Math.max(...steps.map(s => s.count), 1);

  return (
    <BlockStack gap="300">
      {steps.map((step, i) => {
        const widthPct = Math.max((step.count / maxCount) * 100, 8);
        const colors = ['#10a37f', '#60a5fa', '#fbbf24', '#f87171'];
        return (
          <div key={i}>
            <InlineStack align="space-between">
              <Text variant="bodySm" fontWeight="medium">{step.stage}</Text>
              <Text variant="bodySm" fontWeight="bold">{step.count.toLocaleString()}</Text>
            </InlineStack>
            <div style={{ marginTop: 4, height: 28, background: '#f3f4f6', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${widthPct}%`,
                background: colors[i % colors.length],
                borderRadius: 6,
                transition: 'width 0.5s ease',
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 8,
              }}>
                {widthPct > 15 && (
                  <Text variant="bodySm" fontWeight="bold" tone="text-inverse">
                    {step.count.toLocaleString()}
                  </Text>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </BlockStack>
  );
}

// Stat card component
function StatCard({ title, value, subtitle, tone }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text variant="bodySm" color="subdued">{title}</Text>
        <Text variant="headingLg" fontWeight="bold">{value}</Text>
        {subtitle && <Text variant="bodySm" color={tone || 'subdued'}>{subtitle}</Text>}
      </BlockStack>
    </Card>
  );
}

export default function Analytics({ shop: shopProp, globalPlan }) {
  const shop = shopProp || qs('shop', '');
  const api = useMemo(() => makeSessionFetch(), []);
  const planName = globalPlan?.plan || globalPlan?.planKey || '';
  const hasAccess = isPlanAtLeast(planName, 'Professional');

  const [period, setPeriod] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [revenue, setRevenue] = useState(null);
  const [addToCart, setAddToCart] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);

  const loadAnalytics = useCallback(async (p) => {
    if (!shop) return;
    setLoading(true);
    setError(null);
    try {
      const [rev, atc, fun, tl, comp, prod] = await Promise.all([
        api(`/api/analytics/revenue?shop=${shop}&period=${p}&compare=true`),
        api(`/api/analytics/add-to-cart?shop=${shop}&period=${p}`),
        api(`/api/analytics/funnel?shop=${shop}&period=${p}`),
        api(`/api/analytics/timeline?shop=${shop}&period=${p}`),
        api(`/api/analytics/comparison?shop=${shop}&period=${p}`),
        api(`/api/analytics/products?shop=${shop}&period=${p}`),
      ]);
      setRevenue(rev);
      setAddToCart(atc);
      setFunnel(fun);
      setTimeline(tl);
      setComparison(comp);
      setProducts(prod);
    } catch (err) {
      console.error('[Analytics] Load error:', err);
      setError(err.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [shop, api]);

  useEffect(() => {
    loadAnalytics(period);
  }, [period, loadAnalytics]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api(`/api/analytics/sync-orders?shop=${shop}`, { method: 'POST' });
      await loadAnalytics(period);
    } catch (err) {
      setError('Sync failed: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handlePeriodChange = (val) => {
    setPeriod(val);
  };

  const cur = revenue?.currency || 'USD';

  if (loading && !revenue) {
    return (
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="800" minHeight="200px">
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd" color="subdued">Loading analytics...</Text>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    );
  }

  if (error && !revenue) {
    return (
      <Layout>
        <Layout.Section>
          <Banner tone="critical" title="Analytics Error">
            <p>{error}</p>
          </Banner>
        </Layout.Section>
      </Layout>
    );
  }

  const hasAnyData = revenue && (revenue.totalOrders > 0 || (funnel?.funnel?.[0]?.count > 0));

  if (!hasAccess) {
    const navigate = (path) => {
      const currentParams = new URLSearchParams(window.location.search);
      const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
      window.location.href = `${path}${paramString}`;
    };

    return (
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingLg" fontWeight="bold">AI Revenue Analytics</Text>
              <Banner tone="warning" title="Upgrade to unlock Analytics">
                <p>
                  AI Revenue Analytics is available on Professional and higher plans.
                  Track which AI platforms drive revenue to your store, see conversion funnels,
                  and compare optimized vs non-optimized product performance.
                </p>
              </Banner>
              <div style={{ position: 'relative' }}>
                <div style={{ filter: 'blur(6px)', opacity: 0.5, pointerEvents: 'none' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    <StatCard title="Total Revenue" value="$12,450.00" subtitle="156 orders" />
                    <StatCard title="Direct AI Revenue" value="$2,890.00" subtitle="23 orders" />
                    <StatCard title="AI-Influenced Revenue" value="$4,120.00" subtitle="48 orders" />
                    <StatCard title="Avg Order Value" value="$79.81" subtitle="+12.3% vs previous" />
                  </div>
                </div>
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center', zIndex: 10
                }}>
                  <Button variant="primary" onClick={() => navigate('/billing')}>
                    Upgrade Plan
                  </Button>
                </div>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Header with period selector and sync */}
      <Layout.Section>
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text variant="headingLg" fontWeight="bold">AI Revenue Analytics</Text>
              <Text variant="bodySm" color="subdued">
                Track revenue attributed to AI platforms reading your product data
              </Text>
            </BlockStack>
            <InlineStack gap="300" blockAlign="center">
              <Select
                label=""
                labelHidden
                options={PERIODS}
                value={period}
                onChange={handlePeriodChange}
              />
              <Button onClick={handleSync} loading={syncing} size="slim">
                Sync Orders
              </Button>
            </InlineStack>
          </InlineStack>
        </Card>
      </Layout.Section>

      {!hasAnyData && (
        <Layout.Section>
          <Banner tone="info" title="No data yet">
            <p>
              Revenue analytics need time to collect data. Click "Sync Orders" to import your recent
              orders, or wait for the automated sync (every 6 hours). The AI web pixel will start tracking
              add-to-cart and checkout events from AI-referred visitors once deployed.
            </p>
          </Banner>
        </Layout.Section>
      )}

      {/* Section 1: Revenue Overview */}
      <Layout.Section>
        <Text variant="headingMd" fontWeight="bold">Revenue Overview</Text>
      </Layout.Section>

      <Layout.Section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <StatCard
            title="Total Revenue"
            value={formatCurrency(revenue?.totalRevenue, cur)}
            subtitle={`${revenue?.totalOrders || 0} orders`}
          />
          <StatCard
            title="Direct AI Revenue"
            value={formatCurrency(revenue?.directAI?.revenue, cur)}
            subtitle={`${revenue?.directAI?.orders || 0} orders from AI platforms`}
            tone="success"
          />
          <StatCard
            title="AI-Influenced Revenue"
            value={formatCurrency(revenue?.aiInfluenced?.revenue, cur)}
            subtitle={`${revenue?.aiInfluenced?.orders || 0} orders for AI-read products`}
          />
          <StatCard
            title="Avg Order Value"
            value={formatCurrency(revenue?.avgOrderValue, cur)}
            subtitle={revenue?.comparison?.orderGrowth != null
              ? `${pct(revenue.comparison.orderGrowth)} vs previous period`
              : ''}
            tone={parseFloat(revenue?.comparison?.orderGrowth || 0) >= 0 ? 'success' : 'critical'}
          />
        </div>
      </Layout.Section>

      {/* AI Sources breakdown */}
      {revenue?.directAI?.sources?.length > 0 && (
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" fontWeight="bold">Revenue by AI Source</Text>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {revenue.directAI.sources.map(s => (
                  <div key={s.source} style={{
                    padding: '8px 14px', borderRadius: 8,
                    background: '#f3f4f6', display: 'flex', alignItems: 'center', gap: 8
                  }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: SOURCE_COLORS[s.source] || '#6b7280'
                    }} />
                    <Text variant="bodySm" fontWeight="medium">{s.source}</Text>
                    <Badge>{s.count} order{s.count !== 1 ? 's' : ''}</Badge>
                  </div>
                ))}
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>
      )}

      {/* Revenue Timeline Chart */}
      {timeline?.timeline?.length > 0 && (
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" fontWeight="bold">Revenue Timeline</Text>
              <InlineStack gap="400">
                <InlineStack gap="100" blockAlign="center">
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: '#10a37f' }} />
                  <Text variant="bodySm">Direct AI</Text>
                </InlineStack>
                <InlineStack gap="100" blockAlign="center">
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: '#60a5fa' }} />
                  <Text variant="bodySm">AI Influenced</Text>
                </InlineStack>
                <InlineStack gap="100" blockAlign="center">
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: '#d1d5db' }} />
                  <Text variant="bodySm">Organic</Text>
                </InlineStack>
              </InlineStack>
              <BarChart data={timeline.timeline} />
            </BlockStack>
          </Card>
        </Layout.Section>
      )}

      <Layout.Section>
        <Divider />
      </Layout.Section>

      {/* Section 2: Conversion Funnel */}
      <Layout.Section>
        <Text variant="headingMd" fontWeight="bold">AI Conversion Funnel</Text>
      </Layout.Section>

      <Layout.Section variant="oneHalf">
        <Card>
          <BlockStack gap="400">
            <Text variant="headingSm" fontWeight="bold">Funnel Stages</Text>
            <FunnelChart steps={funnel?.funnel || []} />
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section variant="oneHalf">
        <Card>
          <BlockStack gap="400">
            <Text variant="headingSm" fontWeight="bold">Conversion Rates</Text>
            <BlockStack gap="300">
              <ConversionRow
                label="Bot Visit → Customer Visit"
                rate={funnel?.conversionRates?.botToVisit}
              />
              <ConversionRow
                label="Customer Visit → Add to Cart"
                rate={funnel?.conversionRates?.visitToCart}
              />
              <ConversionRow
                label="Add to Cart → Purchase"
                rate={funnel?.conversionRates?.cartToPurchase}
              />
              <Divider />
              <ConversionRow
                label="Overall (Bot → Purchase)"
                rate={funnel?.conversionRates?.overallConversion}
                bold
              />
            </BlockStack>
          </BlockStack>
        </Card>
      </Layout.Section>

      {/* Add to Cart stats */}
      {addToCart && addToCart.totalAddToCart > 0 && (
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" fontWeight="bold">Add to Cart from AI</Text>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <MiniStat label="AI Page Views" value={addToCart.aiPageViews} />
                <MiniStat label="Add to Cart" value={addToCart.totalAddToCart} />
                <MiniStat label="Checkouts" value={addToCart.totalCheckouts} />
                <MiniStat label="Cart → Checkout" value={`${addToCart.conversionRate}%`} />
              </div>
              {addToCart.topProducts?.length > 0 && (
                <>
                  <Divider />
                  <Text variant="bodySm" fontWeight="medium">Top Products Added to Cart from AI</Text>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {addToCart.topProducts.slice(0, 5).map(p => (
                      <Badge key={p.name}>{p.name} ({p.count})</Badge>
                    ))}
                  </div>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      )}

      <Layout.Section>
        <Divider />
      </Layout.Section>

      {/* Section 3: Optimized vs Unoptimized Comparison */}
      <Layout.Section>
        <Text variant="headingMd" fontWeight="bold">Optimization ROI</Text>
      </Layout.Section>

      {comparison && (
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingSm" fontWeight="bold">
                AI-Optimized vs Non-Optimized Products
              </Text>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <ComparisonColumn
                  title="Optimized"
                  badge="success"
                  data={comparison.optimized}
                  currency={cur}
                />
                <ComparisonColumn
                  title="Not Optimized"
                  badge="warning"
                  data={comparison.unoptimized}
                  currency={cur}
                />
              </div>
              {parseFloat(comparison.optimized?.avgAIVisits) > parseFloat(comparison.unoptimized?.avgAIVisits) && (
                <Banner tone="success">
                  <p>
                    Optimized products receive{' '}
                    <strong>
                      {(
                        (parseFloat(comparison.optimized.avgAIVisits) /
                          Math.max(parseFloat(comparison.unoptimized.avgAIVisits), 0.01) - 1) * 100
                      ).toFixed(0)}% more
                    </strong>{' '}
                    AI bot visits on average. Keep optimizing to increase your AI visibility!
                  </p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      )}

      <Layout.Section>
        <Divider />
      </Layout.Section>

      {/* Section 4: Product Performance Table */}
      <Layout.Section>
        <Text variant="headingMd" fontWeight="bold">Product Performance</Text>
      </Layout.Section>

      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <Text variant="headingSm" fontWeight="bold">Per-Product AI Analytics</Text>
            {products?.products?.length > 0 ? (
              <DataTable
                columnContentTypes={['text', 'numeric', 'numeric', 'numeric', 'text', 'text']}
                headings={['Product', 'AI Visits', 'Orders', 'Revenue', 'Add to Cart', 'Status']}
                rows={products.products.slice(0, 50).map(p => [
                  p.title?.length > 40 ? p.title.slice(0, 40) + '...' : p.title,
                  p.aiVisits,
                  p.totalOrders,
                  formatCurrency(p.revenue, cur),
                  p.addToCart,
                  getStatusBadges(p),
                ])}
                totals={['', 
                  products.products.reduce((s, p) => s + p.aiVisits, 0),
                  products.products.reduce((s, p) => s + p.totalOrders, 0),
                  formatCurrency(products.products.reduce((s, p) => s + parseFloat(p.revenue), 0), cur),
                  products.products.reduce((s, p) => s + p.addToCart, 0),
                  ''
                ]}
                showTotalsInFooter
              />
            ) : (
              <Text color="subdued">No product data available. Sync your products first.</Text>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

// --- Sub-components ---

function ConversionRow({ label, rate, bold }) {
  const val = parseFloat(rate || 0);
  return (
    <InlineStack align="space-between">
      <Text variant="bodySm" fontWeight={bold ? 'bold' : 'regular'}>{label}</Text>
      <Text variant="bodySm" fontWeight="bold" tone={val > 0 ? 'success' : 'subdued'}>
        {val.toFixed(2)}%
      </Text>
    </InlineStack>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={{ padding: '8px 0' }}>
      <Text variant="bodySm" color="subdued">{label}</Text>
      <Text variant="headingSm" fontWeight="bold">{typeof value === 'number' ? value.toLocaleString() : value}</Text>
    </div>
  );
}

function ComparisonColumn({ title, badge, data, currency }) {
  return (
    <div style={{ padding: 16, background: '#f9fafb', borderRadius: 12 }}>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Text variant="headingSm" fontWeight="bold">{title}</Text>
          <Badge tone={badge}>{data?.productCount || 0} products</Badge>
        </InlineStack>
        <Divider />
        <InlineStack align="space-between">
          <Text variant="bodySm">Avg AI Bot Visits</Text>
          <Text variant="bodySm" fontWeight="bold">{data?.avgAIVisits || 0}</Text>
        </InlineStack>
        <InlineStack align="space-between">
          <Text variant="bodySm">Total Orders</Text>
          <Text variant="bodySm" fontWeight="bold">{data?.totalOrders || 0}</Text>
        </InlineStack>
        <InlineStack align="space-between">
          <Text variant="bodySm">Total Revenue</Text>
          <Text variant="bodySm" fontWeight="bold">{formatCurrency(data?.totalRevenue, currency)}</Text>
        </InlineStack>
        <InlineStack align="space-between">
          <Text variant="bodySm">Avg Revenue / Product</Text>
          <Text variant="bodySm" fontWeight="bold">{formatCurrency(data?.avgRevenue, currency)}</Text>
        </InlineStack>
      </BlockStack>
    </div>
  );
}

function getStatusBadges(product) {
  const badges = [];
  if (product.isAIEnhanced) badges.push(<Badge key="ai" tone="success">AI Enhanced</Badge>);
  else if (product.isOptimized) badges.push(<Badge key="seo" tone="info">SEO</Badge>);
  if (product.hasAdvancedSchema) badges.push(<Badge key="schema" tone="attention">Schema</Badge>);
  if (!badges.length) badges.push(<Badge key="none" tone="new">Not optimized</Badge>);
  return <InlineStack gap="100">{badges}</InlineStack>;
}
