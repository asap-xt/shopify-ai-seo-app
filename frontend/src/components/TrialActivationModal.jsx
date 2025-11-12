// frontend/src/components/TrialActivationModal.jsx
// Modal that appears when trial user tries to use token-based features

import React, { useState } from 'react';
import {
  Modal,
  BlockStack,
  Text,
  Button,
  ButtonGroup,
  Banner,
  Box,
  InlineStack,
  Divider,
  Badge
} from '@shopify/polaris';

export default function TrialActivationModal({
  open,
  onClose,
  feature,
  trialEndsAt,
  currentPlan,
  tokensRequired,
  onActivatePlan,
  onPurchaseTokens
}) {
  const [action, setAction] = useState(null); // 'plan' or 'tokens'
  const [processing, setProcessing] = useState(false);

  const handleAction = async () => {
    setProcessing(true);
    
    try {
      if (action === 'plan') {
        await onActivatePlan();
      } else if (action === 'tokens') {
        await onPurchaseTokens();
      }
    } catch (error) {
      console.error('[Trial Modal] Action failed:', error);
      // Error handling is done in parent
    } finally {
      setProcessing(false);
    }
  };

  const featureNames = {
    'ai-seo-product-basic': 'AI SEO Optimization (Products)',
    'ai-seo-product-enhanced': 'AI SEO Optimization (Products - Enhanced)',
    'ai-seo-collection': 'AI SEO Optimization (Collections)',
    'ai-testing-simulation': 'AI Testing & Simulation',
    'ai-schema-advanced': 'Advanced Schema Data',
    'ai-sitemap-optimized': 'AI-Optimized Sitemap'
  };

  const featureName = featureNames[feature] || 'This feature';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="🔓 Activate Feature"
      primaryAction={{
        content: processing ? 'Processing...' : action === 'plan' ? 'Activate Plan' : action === 'tokens' ? 'Purchase Tokens' : 'Continue',
        disabled: !action,
        loading: processing,
        onAction: handleAction
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: onClose,
          disabled: processing
        }
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Feature Info */}
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="200">
              <Text variant="headingMd">{featureName}</Text>
              <Text variant="bodySm" tone="subdued">
                This AI-enhanced feature requires tokens or an active plan.
              </Text>
              {tokensRequired > 0 && (
                <InlineStack align="space-between">
                  <Text variant="bodySm">Estimated cost:</Text>
                  <Badge tone="info">{tokensRequired.toLocaleString()} tokens</Badge>
                </InlineStack>
              )}
            </BlockStack>
          </Box>

          {/* Trial Info */}
          <Banner tone="info">
            <BlockStack gap="200">
              <Text variant="bodyMd" fontWeight="semibold">
                You are currently in trial period
              </Text>
              <Text variant="bodySm">
                Trial ends: {new Date(trialEndsAt).toLocaleDateString()}
              </Text>
              <Text variant="bodySm">
                Current plan: <strong>{currentPlan}</strong>
              </Text>
            </BlockStack>
          </Banner>

          <Divider />

          {/* Options */}
          <BlockStack gap="300">
            <Text variant="headingMd">Choose how to proceed:</Text>

            {/* Option 1: Activate Plan */}
            <Box
              padding="400"
              borderWidth="025"
              borderColor={action === 'plan' ? 'border-brand' : 'border'}
              borderRadius="200"
              background={action === 'plan' ? 'bg-surface-selected' : 'bg-surface'}
              onClick={() => setAction('plan')}
              style={{ cursor: 'pointer' }}
            >
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="bodyLg">{action === 'plan' ? '✅' : '⬜'}</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      End Trial & Activate Plan
                    </Text>
                  </InlineStack>
                  {action === 'plan' && <Badge tone="success">Selected</Badge>}
                </InlineStack>
                <Text variant="bodySm" tone="subdued">
                  • Immediate billing for your {currentPlan} plan
                </Text>
                <Text variant="bodySm" tone="subdued">
                  • Unlock all plan features now
                </Text>
                <Text variant="bodySm" tone="subdued">
                  • You can purchase additional tokens anytime
                </Text>
                {currentPlan === 'growth extra' || currentPlan === 'enterprise' ? (
                  <Text variant="bodySm" tone="success" fontWeight="semibold">
                    • Includes monthly tokens in plan price
                  </Text>
                ) : null}
              </BlockStack>
            </Box>

            {/* Option 2: Purchase Tokens Only */}
            <Box
              padding="400"
              borderWidth="025"
              borderColor={action === 'tokens' ? 'border-brand' : 'border'}
              borderRadius="200"
              background={action === 'tokens' ? 'bg-surface-selected' : 'bg-surface'}
              onClick={() => setAction('tokens')}
              style={{ cursor: 'pointer' }}
            >
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="bodyLg">{action === 'tokens' ? '✅' : '⬜'}</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      Purchase Tokens Only
                    </Text>
                  </InlineStack>
                  {action === 'tokens' && <Badge tone="success">Selected</Badge>}
                </InlineStack>
                <Text variant="bodySm" tone="subdued">
                  • Your trial continues until {new Date(trialEndsAt).toLocaleDateString()}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  • One-time purchase (starting from $5)
                </Text>
                <Text variant="bodySm" tone="subdued">
                  • Tokens never expire
                </Text>
                <Text variant="bodySm" tone="subdued">
                  • Plan activates automatically after trial
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>

          {/* Warning */}
          {action === 'plan' && (
            <Banner tone="warning">
              <Text variant="bodySm">
                Your trial will end immediately and you will be charged for the first billing period.
              </Text>
            </Banner>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

