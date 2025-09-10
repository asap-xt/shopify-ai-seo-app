// frontend/src/pages/Sitemap.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { makeSessionFetch } from '../lib/sessionFetch.js';

const qs = (k, d = '') => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };

export default function SitemapPage({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const api = useMemo(() => makeSessionFetch(), []);

  const loadInfo = useCallback(async () => {
    if (!shop) return;
    try {
      const j = await api(`/sitemap/info`, { shop });
      setInfo(j);
    } catch (e) {
      setToast(e.message || 'Failed to load sitemap info');
    }
  }, [shop, api]);

  const generate = useCallback(async () => {
    if (!shop) return;
    setBusy(true);
    try {
      const j = await api(`/sitemap/generate`, {
        method: 'POST',
        shop,
        body: { shop },
      });
      if (j?.ok) setToast('Sitemap generated'); else setToast(j?.error || 'Sitemap failed');
      await loadInfo();
    } catch (e) {
      setToast(e.message || 'Sitemap failed');
    } finally {
      setBusy(false);
    }
  }, [shop, loadInfo, api]);

  useEffect(() => { loadInfo(); }, [loadInfo]);

  return (
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
              onClick={generate}
              loading={busy}
              disabled={busy}
            >
              {busy ? 'Generating...' : 'Generate Sitemap'}
            </Button>
          </InlineStack>

          {info && (
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  {info.generated ? (
                    <>
                      <Icon source={CheckIcon} tone="success" />
                      <Text variant="bodyMd" fontWeight="semibold" tone="success">
                        Sitemap Active
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

                {info.generated && (
                  <BlockStack gap="400">
                    <Box>
                      <BlockStack gap="200">
                        <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" color="subdued">Products included</Text>
                            <Text variant="bodyMd" fontWeight="semibold">{info.lastProductCount || 0} URLs</Text>
                          </InlineStack>
                        </Box>
                        <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" color="subdued">File size</Text>
                            <Text variant="bodyMd" fontWeight="semibold">{info.size ? `${(info.size / 1024).toFixed(2)} KB` : 'Unknown'}</Text>
                          </InlineStack>
                        </Box>
                        <Box paddingBlockEnd="200" borderBlockEndWidth="025" borderColor="border-subdued">
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" color="subdued">Last updated</Text>
                            <Text variant="bodyMd" fontWeight="semibold">{info.generatedAt ? new Date(info.generatedAt).toLocaleString() : 'Unknown'}</Text>
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

                    <Box>
                      <Button
                        fullWidth
                        external
                        url={`/api/sitemap/generate?shop=${encodeURIComponent(shop)}`}
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

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </Card>
  );
}