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
  currentPlan = null,
  returnTo = '/billing' // Where to return after purchase
}) {
  // Navigate to billing page within Shopify iframe
  const handleBuyTokens = () => {
    // Copy ALL current URL parameters (including embedded=1, shop, host, etc.)
    const currentParams = new URLSearchParams(window.location.search);
    // Remove existing returnTo if present (avoid overwriting the new one)
    currentParams.delete('returnTo');
    const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
    // Add returnTo so user returns to origin page after purchase
    const separator = paramString ? '&' : '?';
    window.location.href = `/billing${paramString}${separator}returnTo=${encodeURIComponent(returnTo)}`;
  };

  const featureNames = {
    'ai-seo-product-basic': 'AI Search Optimization (Products)',
    'ai-seo-product-enhanced': 'AI Search Optimization (Products - Enhanced)',
    'ai-seo-collection': 'AI Search Optimization (Collections)',
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
              <InlineStack gap="400" align="space-between" blockAlign="center">
                <Box>
                  <Text variant="bodySm" tone="subdued">Current balance:</Text>
                  <Text variant="headingSm" fontWeight="bold">{tokensAvailable?.toLocaleString() || 0} tokens</Text>
                </Box>
                <Box>
                  <Text variant="bodySm" tone="subdued">Required:</Text>
                  <Text variant="headingSm" fontWeight="bold">{((tokensAvailable || 0) + (tokensNeeded || 0)).toLocaleString()} tokens</Text>
                </Box>
                <Box>
                  <Text variant="bodySm" tone="subdued">You need:</Text>
                  <Text variant="headingSm" fontWeight="bold" as="span">
                    <span style={{ color: '#D82C0D' }}>{tokensNeeded?.toLocaleString() || 0} more</span>
                  </Text>
                </Box>
              </InlineStack>
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

