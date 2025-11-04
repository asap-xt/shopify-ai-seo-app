// frontend/src/pages/Sitemap.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  Box,
  Text,
  Button,
  InlineStack,
  BlockStack,
  Toast,
  Banner,
  Icon,
  Spinner,
  Modal,
} from '@shopify/polaris';
import { CheckIcon, AlertCircleIcon, ClockIcon, ExternalIcon } from '@shopify/polaris-icons';
import { makeSessionFetch } from '../lib/sessionFetch.js';

const qs = (k, d = '') => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };

export default function SitemapPage({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  // plan banner state (restored)
  const [plan, setPlan] = useState(null);
  // PHASE 4: Queue status
  const [queueStatus, setQueueStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const api = useMemo(() => makeSessionFetch(), []);
  
  // Modal states (copied from Settings.jsx)
  const [sitemapModalOpen, setSitemapModalOpen] = useState(false);
  const [sitemapModalContent, setSitemapModalContent] = useState(null);
  const [loadingSitemap, setLoadingSitemap] = useState(false);

  const loadInfo = useCallback(async () => {
    if (!shop) return;
    try {
      // ✅ backend routes live under /api
      const j = await api(`/api/sitemap/info?shop=${shop}`);
      setInfo(j);
    } catch (e) {
      setToast(e.message || 'Failed to load sitemap info');
    }
  }, [shop, api]);

  // restore plan fetch for banner (from working version)
  const loadPlan = useCallback(async () => {
    if (!shop) return;
    try {
      const Q = `
        query PlansMe($shop:String!) {
          plansMe(shop:$shop) {
            shop
            plan
            planKey
            priceUsd
            product_limit
            collection_limit
            language_limit
            providersAllowed
            modelsSuggested
            autosyncCron
            trial {
              active
              ends_at
              days_left
            }
          }
        }
      `;
      const res = await api('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: Q, variables: { shop } }),
      });
      if (res?.errors?.length) throw new Error(res.errors[0]?.message || 'GraphQL error');
      const j = res?.data?.plansMe;
      setPlan(j || null);
    } catch (e) {
      // non-blocking; just log toast optionally
      // setToast(e.message || 'Failed to load plan');
    }
  }, [shop, api]);

  const generate = useCallback(async () => {
    if (!shop) return;
    setBusy(true);
    setQueueStatus(null);
    
    try {
      // PHASE 4: POST generates async, returns queue status
      const response = await fetch(`/api/sitemap/generate?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('[SITEMAP] Generation response:', data);
        
        if (data.success) {
          setToast(data.message || 'Sitemap generation started!');
          setQueueStatus(data.job);
          
          // Start polling for status if queued
          if (data.job?.queued) {
            setPolling(true);
          }
        } else {
          setToast(data.message || 'Sitemap generation failed');
        }
      } else {
        const errorText = await response.text();
        setToast(`Sitemap generation failed: ${errorText}`);
      }
    } catch (e) {
      console.error('[SITEMAP] Generation error:', e);
      setToast(e.message || 'Sitemap generation failed');
    } finally {
      setBusy(false);
    }
  }, [shop]);

  // PHASE 4: Poll for queue status
  const checkStatus = useCallback(async () => {
    if (!shop || !polling) return;
    
    try {
      const status = await api(`/api/sitemap/status?shop=${shop}`);
      console.log('[SITEMAP] Status:', status);
      
      setQueueStatus(status.queue);
      
      // Stop polling if generation is completed or failed
      if (status.queue.status === 'completed' || status.queue.status === 'failed' || status.queue.status === 'idle') {
        setPolling(false);
        setToast(status.queue.message || 'Sitemap generation completed!');
        await loadInfo(); // Reload sitemap info
      }
    } catch (e) {
      console.error('[SITEMAP] Status check error:', e);
    }
  }, [shop, polling, api, loadInfo]);

  // PHASE 4: Polling effect
  useEffect(() => {
    if (polling) {
      const interval = setInterval(checkStatus, 3000); // Check every 3 seconds
      return () => clearInterval(interval);
    }
  }, [polling, checkStatus]);

  // View Sitemap in Modal (copied from Settings.jsx viewJson function)
  const viewSitemap = useCallback(async () => {
    if (!shop) return;
    
    setSitemapModalOpen(true);
    setLoadingSitemap(true);
    setSitemapModalContent(null);
    
    try {
      console.log('[SITEMAP] Loading existing sitemap from database...');
      // Read existing sitemap from database (does NOT regenerate)
      // Uses force=true to trigger the "view existing" code path in backend
      const response = await fetch(`/api/sitemap/generate?shop=${encodeURIComponent(shop)}&force=true&t=${Date.now()}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`
        }
      });
      
      if (response.ok) {
        console.log('[SITEMAP] Sitemap XML loaded successfully');
        const xmlContent = await response.text();
        setSitemapModalContent(xmlContent);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[SITEMAP] Error loading sitemap:', error);
      setSitemapModalContent(`Error loading sitemap: ${error.message}`);
    } finally {
      setLoadingSitemap(false);
    }
  }, [shop]);

  useEffect(() => {
    loadInfo();
    loadPlan();
  }, [loadInfo, loadPlan]);

  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="400">
          {/* Plan Info Banner (restored) */}
          <Banner tone="info">
            <p>
              Your {plan?.plan || 'Starter'} plan includes up to{' '}
              <strong>
                {plan?.product_limit?.toLocaleString() || '70'} products in up to {plan?.language_limit || 1} language{(plan?.language_limit || 1) > 1 ? 's' : ''}
              </strong>
              .
              {info?.productCount && plan?.product_limit &&
                (info.productCount > plan.product_limit) && (
                  <> You have {info.productCount} products, so only the first{' '}
                    {plan.product_limit.toLocaleString()}{' '}
                    will be included in the sitemap.</>
                )}
            </p>
          </Banner>

          {/* PHASE 4: Queue Status Banner */}
          {(polling || queueStatus) && (
            <Banner tone={queueStatus?.status === 'processing' ? 'info' : queueStatus?.status === 'failed' ? 'critical' : 'success'}>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  {polling && <Spinner size="small" />}
                  <Text variant="bodyMd" fontWeight="medium">
                    {queueStatus?.message || 'Processing...'}
                  </Text>
                </InlineStack>
                
                {queueStatus?.position > 0 && (
                  <Text variant="bodySm" tone="subdued">
                    Position in queue: {queueStatus.position} | Estimated time: ~{queueStatus.estimatedTime}s
                  </Text>
                )}
                
                {queueStatus?.queueLength > 0 && (
                  <Text variant="bodySm" tone="subdued">
                    Queue length: {queueStatus.queueLength} job(s)
                  </Text>
                )}
              </BlockStack>
            </Banner>
          )}

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
                      </BlockStack>
                    </Box>

                    <Box>
                      <Button
                        fullWidth
                        onClick={viewSitemap}
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
      
      {/* Sitemap View Modal (copied from Settings.jsx) */}
      {sitemapModalOpen && (
        <Modal
          open={sitemapModalOpen}
          onClose={() => {
            setSitemapModalOpen(false);
            setSitemapModalContent(null);
          }}
          title="AI-Optimized Sitemap"
          primaryAction={{
            content: 'Copy',
            onAction: () => {
              navigator.clipboard.writeText(sitemapModalContent);
              setToast('Copied to clipboard!');
            },
            disabled: loadingSitemap
          }}
          secondaryActions={[{
            content: 'Close',
            onAction: () => {
              setSitemapModalOpen(false);
              setSitemapModalContent(null);
            }
          }]}
        >
          <Modal.Section>
            <Box padding="200" background="bg-surface-secondary" borderRadius="100">
              {loadingSitemap ? (
                <InlineStack align="center" gap="200">
                  <Spinner size="small" />
                  <Text variant="bodyMd">Loading sitemap XML... This may take a moment for large stores.</Text>
                </InlineStack>
              ) : (
                <pre style={{ 
                  whiteSpace: 'pre-wrap', 
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  margin: 0,
                  overflow: 'auto',
                  maxHeight: '400px'
                }}>
                  {sitemapModalContent}
                </pre>
              )}
            </Box>
          </Modal.Section>
        </Modal>
      )}

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </Card>
  );
}