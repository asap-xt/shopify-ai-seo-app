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
  Divider,
  SkeletonPage,
  SkeletonBodyText,
  SkeletonDisplayText
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
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false); // Welcome banner for first-time users
  const [isRedirecting, setIsRedirecting] = useState(false); // Show redirecting state

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
      
      // Show welcome banner ONLY on first load (no active subscription)
      if (data.subscription?.status === 'pending' || !data.subscription) {
        setShowWelcomeBanner(true);
      }
    } catch (err) {
      console.error('[Billing] Error fetching info:', err);
      setError('Failed to load billing information');
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    // Check for success callback FIRST (before fetching billing info)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('success') === 'true') {
      const host = urlParams.get('host');
      const embedded = urlParams.get('embedded');
      
      // Show redirecting state immediately (hide billing UI)
      setIsRedirecting(true);
      
      // Only redirect if we have embedded params (second load from Shopify)
      if (host && embedded) {
        // Immediate redirect (no delay for faster UX)
        const dashboardUrl = `/dashboard?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host)}`;
        window.location.href = dashboardUrl;
      }
    } else {
      // Normal billing page load
      fetchBillingInfo();
    }
  }, [fetchBillingInfo, shop]);

  // Subscribe to a plan
  const handleSubscribe = async (plan) => {
    try {
      setPurchasing(true);
      setError(null);
      
      // Hide welcome banner when user selects a plan
      setShowWelcomeBanner(false);
      
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
      
      // Get returnTo from URL if present
      const urlParams = new URLSearchParams(window.location.search);
      const returnTo = urlParams.get('returnTo') || '/billing';
      
      const response = await fetch('/api/billing/tokens/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          shop,
          amount: parseFloat(amount),
          returnTo: returnTo
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

  // Show elegant redirecting state after plan activation
  if (isRedirecting) {
    return (
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="800">
              <BlockStack gap="400" align="center">
                <Spinner size="large" />
                <Text variant="headingMd" alignment="center">
                  Plan Activated Successfully! 🎉
                </Text>
                <Text variant="bodyMd" tone="subdued" alignment="center">
                  Redirecting to your Dashboard...
                </Text>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    );
  }

  // Render skeleton loader while fetching data
  if (loading) {
    return (
      <SkeletonPage title="Plans & Billing" primaryAction>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={3} />
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SkeletonDisplayText size="medium" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                  {[1, 2, 3, 4].map((i) => (
                    <Card key={i}>
                      <BlockStack gap="200">
                        <SkeletonDisplayText size="small" />
                        <SkeletonBodyText lines={5} />
                      </BlockStack>
                    </Card>
                  ))}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  const subscription = billingInfo?.subscription;
  const tokens = billingInfo?.tokens;
  const allPlans = billingInfo?.plans || [];
  
  // Filter out Starter & Growth plans (hidden temporarily)
  const plans = allPlans.filter(plan => 
    !['starter', 'growth'].includes(plan.key)
  );

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

        {/* Welcome Banner - ONLY on first load (no active subscription) */}
        {showWelcomeBanner && (
          <Layout.Section>
            <Banner
              title="🤖 Future-Proof Your Product Discovery"
              tone="success"
              onDismiss={() => setShowWelcomeBanner(false)}
            >
              <BlockStack gap="200">
                <p>
                  Traditional SEO isn't enough anymore. AI assistants like ChatGPT, Gemini & Perplexity need structured data to recommend your products.
                </p>
                <p>
                  indexAIze transforms your product data into structured formats optimized for AI search engines, making it easy for ChatGPT, Gemini, Perplexity and others to find and recommend your products.
                </p>
                <p>
                  <strong>✅ Smart approach:</strong> Start with a smaller plan to test optimization. Upgrade anytime to scale across your entire catalog.
                </p>
              </BlockStack>
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
                onAction: async () => {
                  try {
                    setPurchasing(true);
                    setError(null);
                    
                    const response = await fetch('/api/billing/activate', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        shop,
                        endTrial: true // End trial and activate immediately
                      })
                    });
                    
                    const data = await response.json();
                    
                    if (!response.ok) {
                      throw new Error(data.error || 'Failed to activate plan');
                    }
                    
                    // Check if Shopify approval is required (ending trial early)
                    if (data.requiresApproval && data.confirmationUrl) {
                      // Redirect to Shopify to approve charge (ending trial = new charge)
                      window.top.location.href = data.confirmationUrl;
                      return;
                    }
                    
                    // Clear cache and reload to reflect changes
                    // Add cache buster to force fresh data
                    const cacheBuster = Date.now();
                    window.location.href = `/billing?shop=${encodeURIComponent(shop)}&_t=${cacheBuster}&embedded=${new URLSearchParams(window.location.search).get('embedded')}&host=${encodeURIComponent(new URLSearchParams(window.location.search).get('host')|| '')}`;
                    
                  } catch (err) {
                    console.error('[Billing] Activation error:', err);
                    setError(err.message);
                  } finally {
                    setPurchasing(false);
                  }
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
                const isGrowthExtra = planKey === 'growth extra';
                const isEnterprise = planKey === 'enterprise';
                
                if (!isGrowthExtra && !isEnterprise) {
                  return null;
                }
                
                const tokensText = isGrowthExtra ? '100M' : '300M';
                
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
                    // Starter plan cannot buy tokens - show upgrade modal
                    if (subscription?.plan === 'starter') {
                      setShowTokenUpgradeModal(true);
                    } else {
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
