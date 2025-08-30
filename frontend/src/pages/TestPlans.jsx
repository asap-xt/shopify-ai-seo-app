// frontend/src/pages/TestPlans.jsx
import React, { useState, useEffect } from 'react';
import {
  Card,
  Box,
  Text,
  Button,
  Select,
  Toast,
  BlockStack,
  InlineStack,
  Badge,
  Banner
} from '@shopify/polaris';

const AVAILABLE_PLANS = [
  { label: 'Starter ($9.99)', value: 'starter' },
  { label: 'Professional ($29.99)', value: 'professional' },
  { label: 'Growth ($49.99)', value: 'growth' },
  { label: 'Growth Extra ($149.99)', value: 'growth_extra' },
  { label: 'Enterprise ($299.99)', value: 'enterprise' }
];

export default function TestPlans({ shop }) {
  const [currentPlan, setCurrentPlan] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    loadCurrentPlan();
  }, [shop]);

  const loadCurrentPlan = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/plans/me?shop=${encodeURIComponent(shop)}`, {
        credentials: 'include'
      });
      const data = await response.json();
      
      if (data && data.planKey) {
        setCurrentPlan(data.planKey);
        setSelectedPlan(data.planKey);
      }
    } catch (err) {
      setToast(`Failed to load plan: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePlan = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/test/set-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          shop,
          plan: selectedPlan
        })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to set plan');
      
      setCurrentPlan(selectedPlan);
      setToast(`Plan changed to ${selectedPlan}. Refresh the page to see changes.`);
      
      // Auto refresh after 2 seconds
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (err) {
      setToast(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const getPlanFeatures = (plan) => {
    const features = {
      starter: {
        products: 50,
        features: ['Products', 'Sitemap.xml']
      },
      professional: {
        products: 300,
        features: ['Products', 'Sitemap.xml', 'Store/Homepage Metadata']
      },
      growth: {
        products: 650,
        features: ['Products', 'Sitemap.xml', 'Store/Homepage Metadata', 'Organization Schema', 'Collections/Categories']
      },
      growth_extra: {
        products: 2000,
        features: ['Products', 'Sitemap.xml', 'Store/Homepage Metadata', 'Organization Schema', 'Collections/Categories', 'BreadcrumbList Schema', 'AI assisted optimization']
      },
      enterprise: {
        products: 5000,
        features: ['Products', 'Sitemap.xml', 'Store/Homepage Metadata', 'Organization Schema', 'BreadcrumbList Schema', 'Collections/Categories', 'LocalBusiness Schema', 'AI assisted optimization']
      }
    };
    
    return features[plan] || features.starter;
  };

  if (loading) {
    return (
      <Card>
        <Box padding="400">
          <Text>Loading plan information...</Text>
        </Box>
      </Card>
    );
  }

  const currentFeatures = getPlanFeatures(currentPlan);
  const selectedFeatures = getPlanFeatures(selectedPlan);

  return (
    <BlockStack gap="400">
      <Banner tone="warning">
        <Text>This is a test feature for development only. It will be removed in production.</Text>
      </Banner>

      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">Test Plan Management</Text>
            
            <InlineStack gap="400" align="space-between">
              <Box>
                <Text variant="headingMd">Current Plan</Text>
                <Badge tone="success">{currentPlan.toUpperCase()}</Badge>
              </Box>
              
              <Box>
                <Text variant="headingMd">Product Limit</Text>
                <Text>{currentFeatures.products}</Text>
              </Box>
            </InlineStack>

            <Box>
              <Text variant="headingMd">Current Features</Text>
              <BlockStack gap="100">
                {currentFeatures.features.map((feature, i) => (
                  <Text key={i}>• {feature}</Text>
                ))}
              </BlockStack>
            </Box>
          </BlockStack>
        </Box>
      </Card>

      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">Change Test Plan</Text>
            
            <Select
              label="Select Plan"
              options={AVAILABLE_PLANS}
              value={selectedPlan}
              onChange={setSelectedPlan}
            />

            {selectedPlan !== currentPlan && (
              <Box>
                <Text variant="headingMd">New Features</Text>
                <BlockStack gap="100">
                  {selectedFeatures.features.map((feature, i) => (
                    <Text key={i} tone={currentFeatures.features.includes(feature) ? 'base' : 'success'}>
                      • {feature}
                    </Text>
                  ))}
                </BlockStack>
              </Box>
            )}

            <InlineStack gap="300">
              <Button
                primary
                onClick={handleChangePlan}
                loading={saving}
                disabled={selectedPlan === currentPlan}
              >
                Change Plan
              </Button>
              
              <Button
                onClick={() => setSelectedPlan(currentPlan)}
                disabled={selectedPlan === currentPlan}
              >
                Reset
              </Button>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>

      {toast && (
        <Toast content={toast} onDismiss={() => setToast('')} />
      )}
    </BlockStack>
  );
}