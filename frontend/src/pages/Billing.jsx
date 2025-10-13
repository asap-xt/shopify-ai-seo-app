// frontend/src/pages/Billing.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  ButtonGroup,
  Badge,
  Banner,
  ProgressBar,
  Stack,
  TextField,
  Modal,
  DataTable,
  Spinner,
  Icon,
  Box,
  BlockStack,
  InlineStack,
  Divider
} from '@shopify/polaris';
import { 
  CreditCardIcon
} from '@shopify/polaris-icons';

const PRESET_AMOUNTS = [10, 20, 50, 100];

export default function Billing({ shop }) {
  const [loading, setLoading] = useState(true);
  const [billingInfo, setBillingInfo] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [selectedAmount, setSelectedAmount] = useState(PRESET_AMOUNTS[0]);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState(null);

  // Fetch billing info
  const fetchBillingInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/billing/info?shop=${shop}`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setBillingInfo(data);
    } catch (err) {
      console.error('[Billing] Error fetching info:', err);
      setError('Failed to load billing information');
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    fetchBillingInfo();
  }, [fetchBillingInfo]);

  // Subscribe to a plan
  const handleSubscribe = async (plan) => {
    try {
      setPurchasing(true);
      setError(null);
      
      const response = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          shop,
          plan,
          endTrial: billingInfo?.subscription?.inTrial || false
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create subscription');
      }
      
      // Redirect to Shopify confirmation page
      if (data.confirmationUrl) {
        window.top.location.href = data.confirmationUrl;
      }
    } catch (err) {
      console.error('[Billing] Subscribe error:', err);
      setError(err.message);
    } finally {
      setPurchasing(false);
      setShowPlanModal(false);
    }
  };

  // Purchase tokens
  const handlePurchaseTokens = async (amount) => {
    try {
      setPurchasing(true);
      setError(null);
      
      const response = await fetch('/api/billing/tokens/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          shop,
          amount: parseFloat(amount)
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to purchase tokens');
      }
      
      // Redirect to Shopify confirmation page
      if (data.confirmationUrl) {
        window.top.location.href = data.confirmationUrl;
      }
    } catch (err) {
      console.error('[Billing] Purchase error:', err);
      setError(err.message);
    } finally {
      setPurchasing(false);
      setShowTokenModal(false);
    }
  };

  // Calculate token value
  // Backend calculates: $10 → $6 for tokens → 60M tokens at $0.10/1M rate
  const calculateTokens = (usdAmount) => {
    const tokenBudget = usdAmount * 0.60; // 60% goes to tokens (internal)
    const geminiRate = 0.10; // $0.10 per 1M tokens
    const tokensPerMillion = 1000000;
    const tokens = Math.floor((tokenBudget / geminiRate) * tokensPerMillion);
    return tokens;
  };

  // Render loading state
  if (loading) {
    return (
      <Page title="Billing & Subscriptions">
        <Layout>
          <Layout.Section>
            <Card>
              <Box padding="800">
                <InlineStack align="center" blockAlign="center">
                  <Spinner size="large" />
                  <Text variant="bodyMd">Loading billing information...</Text>
                </InlineStack>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const subscription = billingInfo?.subscription;
  const tokens = billingInfo?.tokens;
  const plans = billingInfo?.plans || [];

  return (
    <Page
      title="Billing & Plans"
    >
      <Layout>
        {/* Error Banner */}
        {error && (
          <Layout.Section>
            <Banner
              title="Error"
              tone="critical"
              onDismiss={() => setError(null)}
            >
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Trial Info Banner - ONLY if in trial */}
        {subscription?.inTrial && (
          <Layout.Section>
            <Banner
              title="Trial Period Active"
              tone="info"
              action={{
                content: 'Activate Plan',
                onAction: () => setShowPlanModal(true)
              }}
            >
              <p>
                Your trial ends on {new Date(subscription.trialEndsAt).toLocaleDateString()}. 
                Activate a plan to continue using all features after {new Date(subscription.trialEndsAt).toLocaleDateString()}.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Available Plans - 2/3 width */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingLg">Available Plans</Text>
              <Divider />
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                {plans.map((plan) => (
                  <Card key={plan.key}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingMd">{plan.name}</Text>
                        {subscription?.plan === plan.key && (
                          <Badge tone="success">Current</Badge>
                        )}
                      </InlineStack>
                      
                      <Text variant="heading2xl">${plan.price}</Text>
                      <Text variant="bodySm" tone="subdued">per month</Text>
                      
                      <Divider />
                      
                      {/* Product Limit */}
                      <InlineStack align="space-between">
                        <Text variant="bodySm" tone="subdued">Products</Text>
                        <Text variant="bodySm" fontWeight="semibold">
                          up to {plan.productLimit?.toLocaleString() || 'N/A'}
                        </Text>
                      </InlineStack>
                      
                      {/* Language Support */}
                      <InlineStack align="space-between">
                        <Text variant="bodySm" tone="subdued">Supported languages</Text>
                        <Text variant="bodySm" fontWeight="semibold">
                          {plan.languageLimit || 1}
                        </Text>
                      </InlineStack>
                      
                      {/* Included Tokens - only for plans without them (Starter, Professional, Growth) */}
                      {plan.includedTokens > 0 && !['growth extra', 'enterprise'].includes(plan.key) && (
                        <Badge tone="info">
                          +{plan.includedTokens.toLocaleString()} tokens/month
                        </Badge>
                      )}
                      
                      {/* Features List */}
                      {plan.features && plan.features.length > 0 && (
                        <Box>
                          <Text variant="bodySm" fontWeight="semibold">Features:</Text>
                          <BlockStack gap="100">
                            {plan.features.slice(0, 5).map((feature, idx) => (
                              <Text key={idx} variant="bodySm" tone="subdued">
                                ✓ {feature}
                              </Text>
                            ))}
                            {plan.features.length > 5 && (
                              <Text variant="bodySm" tone="subdued">
                                + {plan.features.length - 5} more...
                              </Text>
                            )}
                          </BlockStack>
                        </Box>
                      )}
                      
                      <Button
                        variant={subscription?.plan === plan.key ? 'plain' : 'primary'}
                        fullWidth
                        disabled={subscription?.plan === plan.key}
                        onClick={() => {
                          setSelectedPlan(plan);
                          setShowPlanModal(true);
                        }}
                      >
                        {subscription?.plan === plan.key ? 'Current Plan' : 'Select Plan'}
                      </Button>
                    </BlockStack>
                  </Card>
                ))}
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Token Balance - 1/3 width */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd">Token Balance</Text>
                <Icon source={CreditCardIcon} tone="base" />
              </InlineStack>
              
              <Divider />
              
              <BlockStack gap="300">
                <Box>
                  <Text variant="heading2xl" alignment="center">
                    {tokens?.balance?.toLocaleString() || 0}
                  </Text>
                  <Text variant="bodySm" tone="subdued" alignment="center">
                    tokens available
                  </Text>
                </Box>
                
                <InlineStack align="space-between">
                  <Text variant="bodySm" tone="subdued">Purchased</Text>
                  <Text variant="bodySm">{tokens?.totalPurchased?.toLocaleString() || 0}</Text>
                </InlineStack>
                
                <InlineStack align="space-between">
                  <Text variant="bodySm" tone="subdued">Used</Text>
                  <Text variant="bodySm">{tokens?.totalUsed?.toLocaleString() || 0}</Text>
                </InlineStack>
                
                <Divider />
                
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => setShowTokenModal(true)}
                >
                  Buy Tokens
                </Button>
                
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">
                      💡 Tokens enable AI features
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      ♻️ Never expire, roll over monthly
                    </Text>
                  </BlockStack>
                </Box>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

      </Layout>

      {/* Plan Selection Modal */}
      <Modal
        open={showPlanModal}
        onClose={() => {
          setShowPlanModal(false);
          setSelectedPlan(null);
        }}
        title="Confirm Plan Selection"
        primaryAction={{
          content: purchasing ? 'Processing...' : 'Confirm',
          loading: purchasing,
          onAction: () => handleSubscribe(selectedPlan?.key || subscription?.plan)
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => {
              setShowPlanModal(false);
              setSelectedPlan(null);
            }
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text>
              You are about to subscribe to the <strong>{selectedPlan?.name || subscription?.plan}</strong> plan.
            </Text>
            {subscription?.inTrial && (
              <Banner tone="warning">
                <p>This will end your trial period and start billing immediately.</p>
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Token Purchase Modal */}
      <Modal
        open={showTokenModal}
        onClose={() => {
          setShowTokenModal(false);
          setCustomAmount('');
          setSelectedAmount(PRESET_AMOUNTS[0]);
        }}
        title="Purchase Tokens"
        primaryAction={{
          content: purchasing ? 'Processing...' : 'Purchase',
          loading: purchasing,
          onAction: () => handlePurchaseTokens(customAmount || selectedAmount)
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => {
              setShowTokenModal(false);
              setCustomAmount('');
              setSelectedAmount(PRESET_AMOUNTS[0]);
            }
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="headingMd">Select Amount</Text>
            
            <ButtonGroup variant="segmented">
              {PRESET_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  pressed={selectedAmount === amount && !customAmount}
                  onClick={() => {
                    setSelectedAmount(amount);
                    setCustomAmount('');
                  }}
                >
                  ${amount}
                </Button>
              ))}
            </ButtonGroup>
            
            <Text variant="bodyMd" tone="subdued">Or enter a custom amount (multiples of $5)</Text>
            
            <TextField
              type="number"
              value={customAmount}
              onChange={(value) => {
                setCustomAmount(value);
                setSelectedAmount(null);
              }}
              placeholder="Enter amount"
              prefix="$"
              min={5}
              step={5}
              autoComplete="off"
            />
            
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Amount</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    ${customAmount || selectedAmount}
                  </Text>
                </InlineStack>
                
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Tokens</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {calculateTokens(parseFloat(customAmount || selectedAmount)).toLocaleString()}
                  </Text>
                </InlineStack>
                
                <Divider />
                
                <Text variant="bodySm" tone="subdued">
                  Tokens never expire and roll over indefinitely
                </Text>
              </BlockStack>
            </Box>
            
            {subscription?.inTrial && (
              <Banner tone="info">
                <p>Your trial will continue after purchasing tokens.</p>
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
