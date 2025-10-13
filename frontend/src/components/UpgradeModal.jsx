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
    // Navigate to billing page - copy ALL current URL parameters (including embedded=1)
    const currentParams = new URLSearchParams(window.location.search);
    const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
    window.location.href = `/billing${paramString}`;
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
            {featureName} requires tokens. Activate your plan or purchase tokens to use this feature.
          </Text>
          
          <Text variant="bodyMd">
            <strong>Current status: {currentPlan} (Trial)</strong>
          </Text>
          
          <BlockStack gap="200">
            <Text variant="bodyMd">
              <strong>Activate a plan to get:</strong>
            </Text>
            <BlockStack gap="100">
              <Text variant="bodyMd">✓ Purchase tokens to unlock AI features</Text>
              <Text variant="bodyMd">✓ Growth Extra & Enterprise plans include tokens</Text>
              <Text variant="bodyMd">✓ All AI-enhanced features available</Text>
            </BlockStack>
          </BlockStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
