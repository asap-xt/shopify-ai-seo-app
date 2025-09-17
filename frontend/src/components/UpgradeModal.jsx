import React from 'react';
import { Modal, BlockStack, Text } from '@shopify/polaris';

export default function UpgradeModal({ 
  open, 
  onClose, 
  featureName = "AI Enhancement", 
  currentPlan = "starter" 
}) {
  const handleUpgrade = () => {
    onClose();
    // Navigate to billing page using window.location
    const currentParams = new URLSearchParams(window.location.search);
    const shop = currentParams.get('shop');
    const newUrl = `/billing${shop ? `?shop=${encodeURIComponent(shop)}` : ''}`;
    window.location.href = newUrl;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Unlock ${featureName} Features`}
      primaryAction={{
        content: 'Upgrade Plan',
        onAction: handleUpgrade,
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd">
            This feature is available for Growth Extra and Enterprise plans only.
          </Text>
          
          <Text variant="bodyMd">
            <strong>Current plan: {currentPlan}</strong>
          </Text>
          
          <BlockStack gap="200">
            <Text variant="bodyMd">
              <strong>Upgrade now to get:</strong>
            </Text>
            <BlockStack gap="100">
              <Text variant="bodyMd">✓ AI-optimized bullets and FAQs</Text>
              <Text variant="bodyMd">✓ Enhanced collection descriptions</Text>
              <Text variant="bodyMd">✓ Other AI-enhanced features</Text>
            </BlockStack>
          </BlockStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
