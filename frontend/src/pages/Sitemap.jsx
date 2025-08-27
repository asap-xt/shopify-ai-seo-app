// frontend/src/pages/Sitemap.jsx
import React, { useState, useEffect } from 'react';
import {
  Card,
  Box,
  Text,
  Button,
  InlineStack,
  BlockStack,
  Badge,
  Toast,
  ProgressBar,
  Link,
  Banner,
  Icon,
} from '@shopify/polaris';
import { CheckIcon, AlertCircleIcon, ClockIcon } from '@shopify/polaris-icons';

export default function Sitemap({ shop }) {
  const [status, setStatus] = useState(null); // null, 'generating', 'success', 'error'
  const [sitemapInfo, setSitemapInfo] = useState(null);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [progress, setProgress] = useState(0);

  // Load plan info and sitemap status
  useEffect(() => {
    if (!shop) return;
    loadSitemapInfo();
    loadPlanInfo();
  }, [shop]);

  const loadPlanInfo = async () => {
    try {
      const response = await fetch(`/plans/me?shop=${encodeURIComponent(shop)}`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        setPlan(data);
      }
    } catch (err) {
      console.error('Failed to load plan:', err);
    }
  };

  const loadSitemapInfo = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/sitemap/info?shop=${encodeURIComponent(shop)}`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        setSitemapInfo(data);
        // Проверяваме 'generated' вместо 'exists'
        setStatus(data.generated ? 'success' : null);
      }
    } catch (err) {
      setToast('Failed to load sitemap info');
    } finally {
      setLoading(false);
    }
  };

  const generateSitemap = async () => {
    setStatus('generating');
    setProgress(0);
    
    try {
      // Start generation
      const response = await fetch('/api/sitemap/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ shop }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Generation failed');
      }

      // При успешен response
      if (response.ok) {
        // Директно презареждаме информацията
        await loadSitemapInfo();
        setStatus('success');
        setToast('Sitemap generated successfully!');
        setProgress(100);
        return; // Не е нужно polling
      }

    } catch (err) {
      setStatus('error');
      setToast(err.message);
    }
  };

  const getPlanLimit = () => {
    if (!plan) return 50;
    switch (plan.plan) {
      case 'Growth': return 650;  // Променено от 500 на 650
      case 'Professional': return 300;  // Променено от 100 на 300
      case 'Growth Extra': return 2000;  // Добавено
      case 'Enterprise': return 5000;  // Добавено
      default: return 50; // Starter
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString();
  };

  const sitemapUrl = sitemapInfo?.url || `https://${shop}/sitemap.xml`;

  return (
    <BlockStack gap="400">
      {/* Plan Info Banner */}
      <Banner tone="info">
        <p>
          Your {plan?.plan || 'Starter'} plan includes up to <strong>{getPlanLimit()} URLs</strong> in the sitemap.
          {sitemapInfo?.productCount > getPlanLimit() && (
            <> You have {sitemapInfo.productCount} products, so only the first {getPlanLimit()} will be included.</>
          )}
        </p>
      </Banner>

      {/* Main Card */}
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Box>
                <Text variant="headingMd" as="h3">Sitemap Generator</Text>
                <Text variant="bodySm" tone="subdued">
                  Generate structured sitemap for AI models to discover and index your products
                </Text>
              </Box>
              
              <Button
                primary
                onClick={generateSitemap}
                loading={status === 'generating'}
                disabled={status === 'generating'}
              >
                {status === 'generating' ? 'Generating...' : 'Generate Sitemap'}
              </Button>
            </InlineStack>

            {/* Progress Bar */}
            {status === 'generating' && (
              <Box>
                <ProgressBar progress={progress} />
                <Text variant="bodySm" tone="subdued">
                  Processing products... {Math.round(progress)}%
                </Text>
              </Box>
            )}

            {/* Status Section */}
            {sitemapInfo && status !== 'generating' && (
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    {status === 'success' ? (
                      <>
                        <Icon source={CheckIcon} tone="success" />
                        <Text variant="bodyMd" fontWeight="semibold" tone="success">
                          Sitemap Active
                        </Text>
                      </>
                    ) : status === 'error' ? (
                      <>
                        <Icon source={AlertCircleIcon} tone="critical" />
                        <Text variant="bodyMd" fontWeight="semibold" tone="critical">
                          Generation Failed
                        </Text>
                      </>
                    ) : (
                      <>
                        <Icon source={ClockIcon} />
                        <Text variant="bodyMd" fontWeight="semibold">
                          No Sitemap Found
                        </Text>
                      </>
                    )}
                  </InlineStack>

                  {sitemapInfo.generated && (
                    <>
                      <BlockStack gap="200">
                        <InlineStack gap="400">
                          <Box>
                            <Text variant="bodySm" tone="subdued">Products included:</Text>
                            <Text variant="bodyMd">{sitemapInfo.lastProductCount || 0} URLs</Text>
                          </Box>
                          <Box>
                            <Text variant="bodySm" tone="subdued">File size:</Text>
                            <Text variant="bodyMd">{sitemapInfo.size ? `${(sitemapInfo.size / 1024).toFixed(2)} KB` : 'Unknown'}</Text>
                          </Box>
                          <Box>
                            <Text variant="bodySm" tone="subdued">Last updated:</Text>
                            <Text variant="bodyMd">{formatDate(sitemapInfo.generatedAt)}</Text>
                          </Box>
                        </InlineStack>

                        <Box paddingBlockStart="200">
                          <InlineStack gap="200" align="start">
                            <Text variant="bodySm" tone="subdued">Sitemap URL:</Text>
                            <Link url={`/api/sitemap/generate?shop=${encodeURIComponent(shop)}`} external monochrome>
                              /api/sitemap/generate?shop={shop}
                            </Link>
                          </InlineStack>
                          <Box paddingBlockStart="100">
                            <Button plain external url={`/api/sitemap/generate?shop=${encodeURIComponent(shop)}`}>
                              Open Sitemap →
                            </Button>
                          </Box>
                        </Box>
                      </BlockStack>
                    </>
                  )}
                </BlockStack>
              </Box>
            )}

            {/* Features */}
            <Box paddingBlockStart="400">
              <Text variant="headingMd" as="h4">What's included:</Text>
              <Box paddingBlockStart="200">
                <BlockStack gap="200">
                  <InlineStack gap="200" align="start">
                    <Icon source={CheckIcon} tone="positive" />
                    <Text>All active products with structured URLs for AI parsing</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Icon source={CheckIcon} tone="positive" />
                    <Text>Priority rankings to help AI models understand product importance</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Icon source={CheckIcon} tone="positive" />
                    <Text>Multi-language URLs for international AI search coverage</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Icon source={CheckIcon} tone="positive" />
                    <Text>Standard XML format that AI crawlers understand</Text>
                  </InlineStack>
                </BlockStack>
              </Box>
            </Box>

            {/* Instructions */}
            <Box paddingBlockStart="200">
              <Text variant="headingMd" as="h4">How it helps AI models:</Text>
              <Box paddingBlockStart="200">
                <BlockStack gap="200">
                  <Text>1. Click "Generate Sitemap" to create a structured map of your products</Text>
                  <Text>2. The sitemap is automatically saved and available to AI crawlers</Text>
                  <Text>3. AI models can discover and understand your product catalog structure</Text>
                  <Text>4. Regenerate when you add new products to keep AI models updated</Text>
                </BlockStack>
              </Box>
            </Box>
          </BlockStack>
        </Box>
      </Card>

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </BlockStack>
  );
}