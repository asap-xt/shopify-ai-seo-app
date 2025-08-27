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
import { CheckIcon, AlertCircleIcon, ClockIcon, ExternalIcon } from '@shopify/polaris-icons';

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
        console.log('[SITEMAP UI] Plan loaded:', data);
      }
    } catch (err) {
      console.error('[SITEMAP UI] Failed to load plan:', err);
    }
  };

  const loadSitemapInfo = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/sitemap/info?shop=${encodeURIComponent(shop)}`, {
        credentials: 'include'
      });
      const data = await response.json();
      console.log('[SITEMAP UI] Info loaded:', data);
      
      if (response.ok) {
        setSitemapInfo(data);
        // Check 'generated' field
        setStatus(data.generated ? 'success' : null);
      }
    } catch (err) {
      console.error('[SITEMAP UI] Failed to load sitemap info:', err);
      setToast('Failed to load sitemap info');
    } finally {
      setLoading(false);
    }
  };

  const generateSitemap = async () => {
    setStatus('generating');
    setProgress(0);
    
    try {
      console.log('[SITEMAP UI] Starting generation for shop:', shop);
      
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

      console.log('[SITEMAP UI] Generation successful');
      
      // Reload sitemap info
      await loadSitemapInfo();
      setStatus('success');
      setToast('Sitemap generated successfully!');
      setProgress(100);

    } catch (err) {
      console.error('[SITEMAP UI] Generation error:', err);
      setStatus('error');
      setToast(err.message);
    }
  };

  const getPlanLimit = () => {
    if (!plan) return 50;
    switch (plan.plan) {
      case 'Growth': return 650;
      case 'Professional': return 300;
      case 'Growth Extra': return 2000;
      case 'Enterprise': return 5000;
      default: return 50; // Starter
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString();
  };

  const sitemapUrl = `/api/sitemap/generate?shop=${encodeURIComponent(shop)}`;

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
              
              {status !== 'success' || !sitemapInfo?.generated ? (
                <Button
                  primary
                  onClick={generateSitemap}
                  loading={status === 'generating'}
                  disabled={status === 'generating'}
                >
                  {status === 'generating' ? 'Generating...' : 'Generate Sitemap'}
                </Button>
              ) : (
                <InlineStack gap="200">
                  <Button
                    onClick={generateSitemap}
                    loading={status === 'generating'}
                  >
                    Regenerate
                  </Button>
                  <Button
                    primary
                    external
                    url={sitemapUrl}
                  >
                    View Sitemap
                  </Button>
                </InlineStack>
              )}
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
                    {sitemapInfo.generated && status === 'success' ? (
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
                    <BlockStack gap="400">
                      {/* Info Table */}
                      <Box>
                        <BlockStack gap="200">
                          <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                            <InlineStack align="space-between">
                              <Text variant="bodyMd" color="subdued">Products included</Text>
                              <Text variant="bodyMd" fontWeight="semibold">{sitemapInfo.lastProductCount || 0} URLs</Text>
                            </InlineStack>
                          </Box>
                          <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                            <InlineStack align="space-between">
                              <Text variant="bodyMd" color="subdued">File size</Text>
                              <Text variant="bodyMd" fontWeight="semibold">{sitemapInfo.size ? `${(sitemapInfo.size / 1024).toFixed(2)} KB` : 'Unknown'}</Text>
                            </InlineStack>
                          </Box>
                          <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                            <InlineStack align="space-between">
                              <Text variant="bodyMd" color="subdued">Last updated</Text>
                              <Text variant="bodyMd" fontWeight="semibold">{formatDate(sitemapInfo.generatedAt)}</Text>
                            </InlineStack>
                          </Box>
                          <Box paddingBlockEnd="200">
                            <InlineStack align="space-between">
                              <Text variant="bodyMd" color="subdued">Sitemap URL</Text>
                              <Text variant="bodyMd" fontWeight="semibold" breakWord>
                                /api/sitemap/generate?shop={shop}
                              </Text>
                            </InlineStack>
                          </Box>
                        </BlockStack>
                      </Box>

                      {/* View Button */}
                      <Box>
                        <Button
                          fullWidth
                          external
                          url={sitemapUrl}
                          icon={ExternalIcon}
                        >
                          View Sitemap
                        </Button>
                      </Box>
                    </BlockStack>
                  )}
                </BlockStack>
              </Box>
            )}

            {/* Features */}
            <Box paddingBlockStart="400">
              <Text variant="headingMd" as="h4">What's included:</Text>
              <Box paddingBlockStart="200">
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="start">
                    <Box minWidth="24px">
                      <Icon source={CheckIcon} tone="positive" />
                    </Box>
                    <Text>All active products with structured URLs for AI parsing</Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <Box minWidth="24px">
                      <Icon source={CheckIcon} tone="positive" />
                    </Box>
                    <Text>Priority rankings to help AI models understand product importance</Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <Box minWidth="24px">
                      <Icon source={CheckIcon} tone="positive" />
                    </Box>
                    <Text>Multi-language URLs for international AI search coverage</Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <Box minWidth="24px">
                      <Icon source={CheckIcon} tone="positive" />
                    </Box>
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