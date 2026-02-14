// frontend/src/components/TokenPurchaseModal.jsx
// Reusable modal for purchasing tokens - can be used from any page

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
  Divider
} from '@shopify/polaris';

const PRESET_AMOUNTS = [10, 20, 50, 100];

export default function TokenPurchaseModal({
  open,
  onClose,
  shop,
  returnTo = '/billing', // Where to return after purchase
  inTrial = false // Show trial info banner
}) {
  const [customAmount, setCustomAmount] = useState('');
  const [selectedAmount, setSelectedAmount] = useState(PRESET_AMOUNTS[0]);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState(null);

  // Calculate token value (matches backend calculation)
  // 15% of the amount buys tokens; uses real OpenRouter rate
  // Gemini 2.5 Flash Lite via OpenRouter:
  //   Input:  $0.10 per 1M tokens (80% of usage)
  //   Output: $0.40 per 1M tokens (20% of usage)
  //   Weighted average: $0.16 per 1M tokens
  // Example: $10 → $1.50 for tokens → $1.50 / $0.16 per 1M = 9,375,000 tokens
  const calculateTokens = (usdAmount) => {
    const tokenBudget = usdAmount * 0.15; // 15% goes to tokens (revenue split)
    
    // OpenRouter pricing for Gemini 2.5 Flash Lite:
    // Input: $0.10 per 1M, Output: $0.40 per 1M
    // Weighted (80% input, 20% output): $0.16 per 1M
    const ratePer1M = 0.16; // Matches backend weighted rate
    
    // Calculate how many millions of tokens we can buy
    const tokensInMillions = tokenBudget / ratePer1M;
    const tokens = Math.floor(tokensInMillions * 1_000_000);
    return tokens;
  };

  const handlePurchase = async () => {
    const amount = parseFloat(customAmount || selectedAmount);
    
    if (!amount || amount < 5 || amount % 5 !== 0) {
      setError('Please enter a valid amount (minimum $5, multiples of $5)');
      return;
    }

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
          amount,
          returnTo
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to purchase tokens');
      }
      
      // Redirect to Shopify confirmation page
      // After approval, Shopify will redirect back to returnTo
      if (data.confirmationUrl) {
        window.top.location.href = data.confirmationUrl;
      }
    } catch (err) {
      console.error('[TokenPurchase] Error:', err);
      setError(err.message);
      setPurchasing(false);
    }
  };

  const handleClose = () => {
    setCustomAmount('');
    setSelectedAmount(PRESET_AMOUNTS[0]);
    setError(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Purchase Tokens"
      primaryAction={{
        content: purchasing ? 'Processing...' : 'Purchase',
        loading: purchasing,
        onAction: handlePurchase
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: handleClose
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
                  {calculateTokens(parseFloat(customAmount || selectedAmount) || 0).toLocaleString()}
                </Text>
              </InlineStack>
              
              <Divider />
              
              <Text variant="bodySm" tone="subdued">
                Tokens never expire and roll over indefinitely
              </Text>
            </BlockStack>
          </Box>
          
          {inTrial && (
            <Banner tone="info">
              <p>Your trial will continue after purchasing tokens.</p>
            </Banner>
          )}

          {error && (
            <Banner tone="critical">
              <p>{error}</p>
            </Banner>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

