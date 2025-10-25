import React from 'react';
import { Modal, BlockStack, Text, Banner } from '@shopify/polaris';

export default function UpgradeModal({ 
  open, 
  onClose, 
  featureName = "AI Enhancement", 
  currentPlan = "starter",
  errorMessage = null,
  minimumPlanRequired = null,
  features = null // Array of features to unlock, or null for default
}) {
  const handleUpgrade = () => {
    onClose();
    // Navigate to billing page - copy ALL current URL parameters (including embedded=1)
    const currentParams = new URLSearchParams(window.location.search);
    const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
    window.location.href = `/billing${paramString}`;
  };
  
  // Default features if none provided
  const defaultFeatures = [
    'Collections optimization (Professional+)',
    'AI Enhancement features with pay-per-use tokens',
    'Advanced AI features',
    'Growth Extra includes 100M monthly tokens',
    'Enterprise includes 300M monthly tokens'
  ];
  
  const featuresToShow = features || defaultFeatures;

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
              {featuresToShow.map((feature, index) => (
                <Text key={index} variant="bodyMd">✓ {feature}</Text>
              ))}
            </BlockStack>
          </BlockStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
