import React from 'react';
import { Modal, BlockStack, Text, Banner } from '@shopify/polaris';

export default function UpgradeModal({ 
  open, 
  onClose, 
  featureName = "AI Enhancement", 
  currentPlan = "starter",
  errorMessage = null,
  minimumPlanRequired = null
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
      title={`Upgrade Required`}
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
          <Banner tone="warning">
            <Text variant="bodyMd" fontWeight="semibold">
              {errorMessage || `${featureName} requires a higher plan`}
            </Text>
          </Banner>
          
          <Text variant="bodyMd">
            <strong>Current plan: {currentPlan}</strong>
          </Text>
          
          {minimumPlanRequired && (
            <Text variant="bodyMd">
              <strong>Required plan: {minimumPlanRequired} or higher</strong>
            </Text>
          )}
          
          <BlockStack gap="200">
            <Text variant="bodyMd">
              <strong>Upgrade to unlock:</strong>
            </Text>
            <BlockStack gap="100">
              <Text variant="bodyMd">✓ Collections optimization (Professional+)</Text>
              <Text variant="bodyMd">✓ AI Enhancement with tokens</Text>
              <Text variant="bodyMd">✓ Advanced AI features</Text>
              <Text variant="bodyMd">✓ Growth Extra & Enterprise include monthly tokens</Text>
            </BlockStack>
          </BlockStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
