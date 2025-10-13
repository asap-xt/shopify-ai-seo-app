// frontend/src/components/InsufficientTokensModal.jsx
// Modal that appears when user has insufficient tokens

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
  TextField,
  Divider,
  Badge
} from '@shopify/polaris';

const PRESET_AMOUNTS = [10, 20, 50, 100];

export default function InsufficientTokensModal({
  open,
  onClose,
  feature,
  tokensRequired,
  tokensAvailable,
  tokensNeeded,
  shop,
  needsUpgrade = false,
  minimumPlan = null,
  currentPlan = null
}) {
  // Navigate to billing page within Shopify iframe
  const handleBuyTokens = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const host = searchParams.get('host') || '';
    window.location.href = `/billing?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;
  };

  const handleUpgradePlan = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const host = searchParams.get('host') || '';
    window.location.href = `/billing?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;
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
      title="💳 Insufficient Tokens"
      primaryAction={{
        content: 'Go to Billing',
        onAction: handleBuyTokens
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: onClose
        }
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Current Balance */}
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text variant="bodyMd" fontWeight="semibold">
                You don't have enough tokens to use AI Enhancement
              </Text>
              <Text variant="bodySm">
                Purchase tokens to unlock this feature and continue using AI-enhanced SEO optimization.
              </Text>
            </BlockStack>
          </Banner>

          {/* Feature Info */}
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="200">
              <Text variant="headingMd">{featureName}</Text>
              <Text variant="bodySm" tone="subdued">
                ✅ Buy tokens to use this AI-enhanced feature
              </Text>
              {needsUpgrade && minimumPlan && (
                <Text variant="bodySm" tone="subdued">
                  ✨ Or upgrade to {minimumPlan} plan to get tokens included
                </Text>
              )}
            </BlockStack>
          </Box>

          {/* Upgrade Suggestion (for Starter/Professional/Growth plans) */}
          {needsUpgrade && minimumPlan && (
            <Banner tone="info">
              <BlockStack gap="200">
                <Text variant="bodyMd" fontWeight="semibold">
                  💡 Upgrade to {minimumPlan} to get tokens included
                </Text>
                <Text variant="bodySm">
                  Current plan: <strong>{currentPlan}</strong>
                </Text>
                <Text variant="bodySm" tone="subdued">
                  {minimumPlan} plans include AI tokens every month. 
                  Or you can purchase tokens separately while staying on your current plan.
                </Text>
              </BlockStack>
            </Banner>
          )}

          {/* Info */}
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">
                💡 Tokens enable AI-powered features like AI Enhancement and AI Testing
              </Text>
              <Text variant="bodySm" tone="subdued">
                ♻️ Tokens never expire and roll over indefinitely
              </Text>
              <Text variant="bodySm" tone="subdued">
                🛒 Purchase tokens or upgrade your plan from the Billing page
              </Text>
            </BlockStack>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

