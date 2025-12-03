import React from 'react';
import { Modal, BlockStack, Text, Banner } from '@shopify/polaris';

export default function UpgradeModal({ 
  open, 
  onClose, 
  featureName = "AI Enhancement", 
  currentPlan = "starter",
  errorMessage = null,
  minimumPlanRequired = null,
  features = null, // Array of features to unlock, or null for default
  returnTo = null // Path to return to after upgrade (e.g., '/ai-seo/sitemap')
}) {
  const handleUpgrade = () => {
    onClose();
    // Navigate to billing page - only keep essential parameters to avoid URL length issues
    // Shopify has a 255 character limit for return URLs
    const currentParams = new URLSearchParams(window.location.search);
    const essentialParams = new URLSearchParams();
    
    // Only keep essential parameters
    if (currentParams.get('shop')) essentialParams.set('shop', currentParams.get('shop'));
    if (currentParams.get('embedded')) essentialParams.set('embedded', currentParams.get('embedded'));
    if (currentParams.get('host')) essentialParams.set('host', currentParams.get('host'));
    
    // Add returnTo parameter if provided (should be just the path, not full URL)
    if (returnTo) {
      essentialParams.set('returnTo', returnTo);
    }
    
    const paramString = essentialParams.toString() ? `?${essentialParams.toString()}` : '';
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
