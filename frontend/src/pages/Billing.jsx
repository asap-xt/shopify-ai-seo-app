// frontend/src/pages/Billing.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
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
  Box,
  BlockStack,
  InlineStack,
  Divider
} from '@shopify/polaris';

const PRESET_AMOUNTS = [10, 20, 50, 100];

export default function Billing({ shop }) {
  const [loading, setLoading] = useState(true);
  const [billingInfo, setBillingInfo] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showTokenUpgradeModal, setShowTokenUpgradeModal] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [selectedAmount, setSelectedAmount] = useState(PRESET_AMOUNTS[0]);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState(null);
  const [isActivatingPlan, setIsActivatingPlan] = useState(false); // Track if user is ending trial early

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
    
    // Check for success callback from Shopify (after plan activation)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('success') === 'true') {
      // Clear success param from URL
      const newUrl = window.location.pathname + '?shop=' + shop;
      window.history.replaceState({}, '', newUrl);
      
      // Force expand Shopify Admin sidebar (collapsed after external redirect)
      try {
        const navMenu = document.querySelector('ui-nav-menu');
        if (navMenu) {
          navMenu.setAttribute('open', 'true');
        }
      } catch (e) {
        console.warn('[Billing] Could not expand nav menu:', e);
      }
      
      // Refresh billing info after 1 second to ensure backend updates are reflected
      setTimeout(() => {
        console.log('[Billing] Refreshing after successful activation...');
        fetchBillingInfo();
      }, 1000);
    }
  }, [fetchBillingInfo, shop]);

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
          endTrial: isActivatingPlan // Only end trial if user clicked "Activate Plan" button
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
      setIsActivatingPlan(false); // Reset activation flag
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

  // Calculate token value (matches backend calculation)
  // Policy: 30% of the amount buys tokens; uses real OpenRouter rate
  // Gemini 2.5 Flash Lite via OpenRouter:
  //   Input:  $0.10 per 1M tokens (80% of usage)
  //   Output: $0.40 per 1M tokens (20% of usage)
  //   Weighted average: $0.16 per 1M tokens
  // Example: $10 → $3 for tokens → $3 / $0.16 per 1M = 18,750,000 tokens
  const calculateTokens = (usdAmount) => {
    const tokenBudget = usdAmount * 0.30; // 30% goes to tokens (revenue split)
    
    // OpenRouter pricing for Gemini 2.5 Flash Lite:
    // Input: $0.10 per 1M, Output: $0.40 per 1M
    // Weighted (80% input, 20% output): $0.16 per 1M
    const ratePer1M = 0.16; // Matches backend weighted rate
    
    // Calculate how many millions of tokens we can buy
    const tokensInMillions = tokenBudget / ratePer1M;
    const tokens = Math.floor(tokensInMillions * 1_000_000);
    return tokens;
  };

  // Render loading state
  if (loading) {
    return (
      <>
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
      </>
    );
  }

  const subscription = billingInfo?.subscription;
  const tokens = billingInfo?.tokens;
  const plans = billingInfo?.plans || [];
  
  // Debug: Log subscription plan
  console.log('[Billing] Current plan:', subscription?.plan, 'Type:', typeof subscription?.plan);

  return (
    <>
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
                onAction: () => {
                  setIsActivatingPlan(true); // Mark as ending trial early
                  setShowPlanModal(true);
                }
              }}
            >
              <p>
                Trial ends on {new Date(subscription.trialEndsAt).toLocaleDateString()}. 
                Advanced AI features are locked during trial. Activate your {subscription.plan} plan to use them now.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Available Plans - 2/3 width */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                {plans.map((plan) => (
                  <Card key={plan.key}>
                    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '400px', gap: '12px' }}>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingMd">{plan.name}</Text>
                        {subscription?.plan === plan.key && subscription?.status === 'active' && (
                          <Badge tone="success">Current</Badge>
                        )}
                      </InlineStack>
                      
                      {/* Plan Badge */}
                      {plan.badge && (
                        <Text variant="bodySm" tone="subdued" fontWeight="medium">
                          {plan.badge}
                        </Text>
                      )}
                      
                      <Text variant="heading2xl">${plan.price}</Text>
                      <Text variant="bodySm" tone="subdued">per month</Text>
                      
                      <Divider />
                      
                      {/* Combined Product & Language limit */}
                      <Text variant="bodySm" tone="subdued">
                        Optimize up to <strong>{plan.productLimit?.toLocaleString() || 'N/A'}</strong> products in up to <strong>{plan.languageLimit || 1}</strong> {plan.languageLimit === 1 ? 'language' : 'languages'}
                      </Text>
                      
                      {/* Features List */}
                      {plan.features && plan.features.length > 0 && (
                        <Box>
                          <Text variant="bodySm" fontWeight="semibold">Features:</Text>
                          <BlockStack gap="100">
                            {plan.features.map((feature, idx) => (
                              <Text key={idx} variant="bodySm" tone="subdued">
                                {feature.startsWith('All from') || feature.startsWith('✓') ? feature : `✓ ${feature}`}
                              </Text>
                            ))}
                          </BlockStack>
                        </Box>
                      )}
                      
                      {/* Spacer to push button to bottom */}
                      <div style={{ flexGrow: 1 }} />
                      
                      {subscription?.plan === plan.key && subscription?.status === 'active' ? (
                        <Box 
                          background="bg-surface-secondary" 
                          padding="300" 
                          borderRadius="200"
                          style={{ marginTop: 'auto' }}
                        >
                          <Text variant="bodySm" alignment="center" tone="subdued" fontWeight="medium">
                            Current Plan
                          </Text>
                        </Box>
                      ) : (
                        <Button
                          variant="primary"
                          fullWidth
                          onClick={() => {
                            setSelectedPlan(plan);
                            setShowPlanModal(true);
                          }}
                        >
                          Select Plan
                        </Button>
                      )}
                    </div>
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
              <Text variant="headingMd">Token Balance</Text>
              
              <Divider />
              
        <BlockStack gap="300">
            {/* Show current balance for all plans */}
            <Box>
              <Text variant="heading2xl" alignment="center">
                {tokens?.balance?.toLocaleString() || 0}
              </Text>
              <Text variant="bodySm" tone="subdued" alignment="center">
                tokens available
              </Text>
              {(() => {
                const planKey = subscription?.plan?.toLowerCase().trim();
                console.log('[Billing] Current plan key:', planKey);
                const isGrowthExtra = planKey === 'growth extra';
                const isEnterprise = planKey === 'enterprise';
                const shouldShow = isGrowthExtra || isEnterprise;
                
                console.log('[Billing] Is growth extra?', isGrowthExtra);
                console.log('[Billing] Is enterprise?', isEnterprise);
                console.log('[Billing] Condition result:', shouldShow);
                
                if (!shouldShow) {
                  console.log('[Billing] NOT rendering tokens text');
                  return null;
                }
                
                const tokensText = isGrowthExtra ? '100M' : '300M';
                console.log('[Billing] Rendering tokens text:', tokensText);
                
                return (
                  <Text variant="bodySm" tone="subdued" alignment="center" fontWeight="medium">
                    ({tokensText} included this cycle)
                  </Text>
                );
              })()}
            </Box>
            
            <InlineStack align="space-between">
              <Text variant="bodySm" tone="subdued">
                {(() => {
                  const planKey = subscription?.plan?.toLowerCase().trim();
                  return (planKey === 'growth extra' || planKey === 'enterprise') ? 'Additional Purchased' : 'Purchased';
                })()}
              </Text>
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
                  onClick={() => {
                    console.log('[Billing] Buy Tokens clicked. Plan:', subscription?.plan, 'Comparison:', subscription?.plan === 'starter');
                    // Starter plan cannot buy tokens - show upgrade modal
                    if (subscription?.plan === 'starter') {
                      console.log('[Billing] Showing upgrade modal for Starter plan');
                      setShowTokenUpgradeModal(true);
                    } else {
                      console.log('[Billing] Showing token purchase modal');
                      setShowTokenModal(true);
                    }
                  }}
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
          setIsActivatingPlan(false); // Reset activation flag
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
              setIsActivatingPlan(false); // Reset activation flag
            }
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text>
              You are about to subscribe to the <strong>{selectedPlan?.name || subscription?.plan}</strong> plan.
            </Text>
            {subscription?.inTrial && isActivatingPlan && (
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

      {/* Token Purchase Upgrade Modal (for Starter plan) */}
      <Modal
        open={showTokenUpgradeModal}
        onClose={() => setShowTokenUpgradeModal(false)}
        title="Upgrade Required"
        primaryAction={{
          content: 'View Plans',
          onAction: () => {
            setShowTokenUpgradeModal(false);
            // Scroll to plans section
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowTokenUpgradeModal(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="bodyLg">
              Token purchases require <strong>Professional</strong> plan or higher.
            </Text>
            
            <Text variant="bodyMd" tone="subdued">
              Your current plan: <strong>Starter</strong>
            </Text>
            
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text variant="headingSm">Upgrade to unlock:</Text>
                <Text variant="bodyMd">✓ Token purchases</Text>
                <Text variant="bodyMd">✓ AI-enhanced optimization</Text>
                <Text variant="bodyMd">✓ Store Metadata for AI Search</Text>
                <Text variant="bodyMd">✓ More AI bot access</Text>
                <Text variant="bodyMd">✓ Higher product limits</Text>
              </BlockStack>
            </Box>
            
            <Banner tone="info">
              <p>Professional plan starts at $15.99/month with up to 250 products.</p>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
