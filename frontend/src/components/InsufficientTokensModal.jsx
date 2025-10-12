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
  onPurchaseTokens
}) {
  const [customAmount, setCustomAmount] = useState('');
  const [selectedAmount, setSelectedAmount] = useState(PRESET_AMOUNTS[0]);
  const [purchasing, setPurchasing] = useState(false);

  const calculateTokens = (usdAmount) => {
    // Backend calculates: $10 → $6 for tokens → 60M tokens at $0.10/1M rate
    const tokenBudget = usdAmount * 0.60; // 60% goes to tokens (internal)
    const geminiRate = 0.10; // $0.10 per 1M tokens
    const tokensPerMillion = 1000000;
    const tokens = Math.floor((tokenBudget / geminiRate) * tokensPerMillion);
    return tokens;
  };

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      await onPurchaseTokens(parseFloat(customAmount || selectedAmount));
    } catch (error) {
      console.error('[Insufficient Tokens Modal] Purchase failed:', error);
    } finally {
      setPurchasing(false);
    }
  };

  const selectedAmountValue = parseFloat(customAmount || selectedAmount);
  const tokensFromPurchase = calculateTokens(selectedAmountValue);
  const willBeEnough = tokensFromPurchase >= tokensNeeded;

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
        content: purchasing ? 'Processing...' : 'Purchase Tokens',
        loading: purchasing,
        onAction: handlePurchase
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: onClose,
          disabled: purchasing
        }
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Current Balance */}
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text variant="bodyMd" fontWeight="semibold">
                You don't have enough tokens
              </Text>
              <InlineStack gap="400">
                <Box>
                  <Text variant="bodySm" tone="subdued">Required:</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {tokensRequired.toLocaleString()} tokens
                  </Text>
                </Box>
                <Box>
                  <Text variant="bodySm" tone="subdued">Available:</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {tokensAvailable.toLocaleString()} tokens
                  </Text>
                </Box>
                <Box>
                  <Text variant="bodySm" tone="subdued">Needed:</Text>
                  <Text variant="bodyMd" fontWeight="semibold" tone="critical">
                    {tokensNeeded.toLocaleString()} tokens
                  </Text>
                </Box>
              </InlineStack>
            </BlockStack>
          </Banner>

          <Divider />

          {/* Feature Info */}
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="200">
              <Text variant="headingMd">{featureName}</Text>
              <Text variant="bodySm" tone="subdued">
                Purchase tokens to unlock this AI-enhanced feature
              </Text>
            </BlockStack>
          </Box>

          {/* Amount Selection */}
          <BlockStack gap="300">
            <Text variant="headingMd">Select Amount</Text>
            
            <ButtonGroup variant="segmented" fullWidth>
              {PRESET_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  pressed={selectedAmount === amount && !customAmount}
                  onClick={() => {
                    setSelectedAmount(amount);
                    setCustomAmount('');
                  }}
                  size="large"
                >
                  ${amount}
                </Button>
              ))}
            </ButtonGroup>
            
            <Text variant="bodySm" tone="subdued">
              Or enter a custom amount (multiples of $5)
            </Text>
            
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
          </BlockStack>

          <Divider />

          {/* Purchase Summary */}
          <Box 
            background={willBeEnough ? 'bg-surface-success' : 'bg-surface-secondary'} 
            padding="400" 
            borderRadius="200"
          >
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodyMd">Amount</Text>
                <Text variant="bodyMd" fontWeight="semibold">
                  ${selectedAmountValue.toFixed(2)}
                </Text>
              </InlineStack>
              
              <InlineStack align="space-between">
                <Text variant="bodyMd">You'll receive</Text>
                <Text variant="bodyMd" fontWeight="semibold">
                  {tokensFromPurchase.toLocaleString()} tokens
                </Text>
              </InlineStack>
              
              <InlineStack align="space-between">
                <Text variant="bodyMd">New balance</Text>
                <Text variant="bodyMd" fontWeight="semibold">
                  {(tokensAvailable + tokensFromPurchase).toLocaleString()} tokens
                </Text>
              </InlineStack>
              
              <Divider />
              
              {willBeEnough ? (
                <InlineStack align="center" blockAlign="center" gap="200">
                  <Text variant="bodySm" tone="success" fontWeight="semibold">
                    ✓ Enough to use this feature
                  </Text>
                </InlineStack>
              ) : (
                <InlineStack align="center" blockAlign="center" gap="200">
                  <Text variant="bodySm" tone="critical" fontWeight="semibold">
                    ⚠ Still not enough (need {(tokensNeeded - tokensFromPurchase).toLocaleString()} more)
                  </Text>
                </InlineStack>
              )}
            </BlockStack>
          </Box>

          {/* Info */}
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">
                💡 Tokens are used for AI-powered features
              </Text>
              <Text variant="bodySm" tone="subdued">
                ♻️ Tokens never expire and roll over indefinitely
              </Text>
            </BlockStack>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

