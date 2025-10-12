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
  CreditCardIcon, 
  RefreshIcon,
  CircleTickIcon,
  CircleAlertIcon
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
  const calculateTokens = (usdAmount) => {
    const tokenBudget = usdAmount * 0.60; // 60% goes to tokens
    const tokensPerDollar = 10000; // Simplified (adjust based on actual rate)
    return Math.floor(tokenBudget * tokensPerDollar);
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
      title="Billing & Subscriptions"
      primaryAction={{
        content: 'Purchase Tokens',
        icon: CreditCardIcon,
        onAction: () => setShowTokenModal(true)
      }}
      secondaryActions={[
        {
          content: 'Refresh',
          icon: RefreshIcon,
          onAction: fetchBillingInfo
        }
      ]}
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

        {/* Trial Warning */}
        {subscription?.inTrial && (
          <Layout.Section>
            <Banner
              title="You are in trial period"
              tone="info"
              action={{
                content: 'Activate Plan',
                onAction: () => setShowPlanModal(true)
              }}
            >
              <p>
                Your trial ends on {new Date(subscription.trialEndsAt).toLocaleDateString()}.
                AI-enhanced features require plan activation or token purchase.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Current Subscription */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd">Current Plan</Text>
                {subscription && (
                  <Badge tone={subscription.inTrial ? 'attention' : 'success'}>
                    {subscription.inTrial ? 'Trial' : 'Active'}
                  </Badge>
                )}
              </InlineStack>
              
              <Divider />
              
              {subscription ? (
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text variant="bodyMd" tone="subdued">Plan</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)}
                    </Text>
                  </InlineStack>
                  
                  <InlineStack align="space-between">
                    <Text variant="bodyMd" tone="subdued">Price</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      ${subscription.price}/month
                    </Text>
                  </InlineStack>
                  
                  {subscription.inTrial && (
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" tone="subdued">Trial ends</Text>
                      <Text variant="bodyMd" fontWeight="semibold">
                        {new Date(subscription.trialEndsAt).toLocaleDateString()}
                      </Text>
                    </InlineStack>
                  )}
                  
                  <Button
                    variant="primary"
                    fullWidth
                    onClick={() => setShowPlanModal(true)}
                  >
                    Change Plan
                  </Button>
                </BlockStack>
              ) : (
                <BlockStack gap="300">
                  <Text variant="bodyMd" tone="subdued">
                    No active subscription
                  </Text>
                  <Button
                    variant="primary"
                    fullWidth
                    onClick={() => setShowPlanModal(true)}
                  >
                    Choose a Plan
                  </Button>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Token Balance */}
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
                
                <ProgressBar
                  progress={Math.min(100, (tokens?.balance / 10000) * 100)}
                  size="small"
                  tone="primary"
                />
                
                <InlineStack align="space-between">
                  <Text variant="bodySm" tone="subdued">Purchased</Text>
                  <Text variant="bodySm">{tokens?.totalPurchased?.toLocaleString() || 0}</Text>
                </InlineStack>
                
                <InlineStack align="space-between">
                  <Text variant="bodySm" tone="subdued">Used</Text>
                  <Text variant="bodySm">{tokens?.totalUsed?.toLocaleString() || 0}</Text>
                </InlineStack>
                
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => setShowTokenModal(true)}
                >
                  Buy More Tokens
                </Button>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Available Plans */}
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
                      
                      {plan.includedTokens > 0 && (
                        <Badge tone="info">
                          +{plan.includedTokens.toLocaleString()} tokens/month
                        </Badge>
                      )}
                      
                      <Button
                        variant={subscription?.plan === plan.key ? 'secondary' : 'primary'}
                        fullWidth
                        disabled={subscription?.plan === plan.key}
                        onClick={() => {
                          setSelectedPlan(plan.key);
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
          onAction: () => handleSubscribe(selectedPlan || subscription?.plan)
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
              You are about to subscribe to the <strong>{selectedPlan || subscription?.plan}</strong> plan.
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
                  60% goes to tokens, 40% to app maintenance
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
