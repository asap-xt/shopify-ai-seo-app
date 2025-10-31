// frontend/src/pages/CleanUninstall.jsx
import React, { useState, useMemo } from 'react';
import {
  Card,
  Box,
  Text,
  Button,
  BlockStack,
  InlineStack,
  Banner,
  Modal,
  Divider,
  Badge,
  Toast
} from '@shopify/polaris';
import { makeSessionFetch } from '../lib/sessionFetch.js';

export default function CleanUninstall() {
  const qs = (k, d = '') => {
    try { return new URLSearchParams(window.location.search).get(k) || d; }
    catch { return d; }
  };

  const shop = qs('shop', '');
  const api = useMemo(() => makeSessionFetch(), []);

  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [uninstallProcessing, setUninstallProcessing] = useState(false);
  const [uninstallResults, setUninstallResults] = useState(null);
  const [showUninstallModal, setShowUninstallModal] = useState(false);
  const [toast, setToast] = useState('');

  return (
    <BlockStack gap="400">
      {/* Main Card */}
      <Card>
        <Box padding="600">
          <BlockStack gap="600">
            <BlockStack gap="200">
              <Text variant="bodyMd" tone="subdued">
                Prepare your store for app uninstallation
              </Text>
            </BlockStack>

            <Divider />

            <Banner status="warning" title="Before you uninstall">
              <p>
                We recommend cleaning up all app data from your store before uninstalling. 
                This ensures no unused metafields or configurations are left behind.
              </p>
            </Banner>

            <BlockStack gap="400">
              <Text variant="headingMd">What will be removed:</Text>
              <Box paddingInlineStart="400">
                <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="start">
                <Text variant="bodyMd">•</Text>
                <Text variant="bodyMd">All AI Search optimization content</Text>
              </InlineStack>
              <InlineStack gap="200" blockAlign="start">
                <Text variant="bodyMd">•</Text>
                <Text variant="bodyMd">AI-generated metadata and structured data</Text>
              </InlineStack>
              <InlineStack gap="200" blockAlign="start">
                <Text variant="bodyMd">•</Text>
                <Text variant="bodyMd">Store configuration (brand voice, policies, target audience)</Text>
              </InlineStack>
              <InlineStack gap="200" blockAlign="start">
                <Text variant="bodyMd">•</Text>
                <Text variant="bodyMd">Advanced schema markup</Text>
              </InlineStack>
                </BlockStack>
              </Box>
              
              <Banner status="info">
                <p>
                  ℹ️ <strong>Your product and collection data will NOT be affected.</strong> This will only remove AI-generated content created by our app. 
                  Your original product titles, descriptions, and Shopify SEO metafields will remain unchanged.
                </p>
              </Banner>
            </BlockStack>

            <Divider />

            <BlockStack gap="300">
              <Text variant="headingMd">How it works:</Text>
              <Box paddingInlineStart="400">
                <ol style={{ margin: 0, paddingLeft: '20px' }}>
                  <li>Click "Clean & Prepare for Uninstall" button below</li>
                  <li>Confirm that you want to remove all app data</li>
                  <li>Wait for the cleanup process to complete</li>
                  <li>Follow the instructions to complete uninstall in Shopify Admin</li>
                </ol>
              </Box>
            </BlockStack>

            <Divider />

            <InlineStack gap="200">
              <Button
                variant="primary"
                tone="critical"
                size="large"
                onClick={() => setShowUninstallConfirm(true)}
              >
                Clean & Prepare for Uninstall
              </Button>
            </InlineStack>

            <Banner status="info">
              <p>
                💡 <strong>Important:</strong> This action will NOT uninstall the app automatically. 
                After cleaning, you'll receive instructions on how to complete the uninstall process in Shopify Admin.
              </p>
            </Banner>
          </BlockStack>
        </Box>
      </Card>

      {/* Uninstall Confirmation Modal */}
      {showUninstallConfirm && (
        <Modal
          open={true}
          title="⚠️ Confirm Data Cleanup"
          onClose={() => !uninstallProcessing && setShowUninstallConfirm(false)}
          primaryAction={{
            content: uninstallProcessing ? 'Cleaning...' : 'Yes, Clean Everything',
            onAction: async () => {
              setUninstallProcessing(true);
              try {
                console.log('[UNINSTALL] Starting cleanup...');
                const result = await api(`/api/store/prepare-uninstall?shop=${shop}`, {
                  method: 'POST',
                  shop
                });
                
                console.log('[UNINSTALL] Cleanup result:', result);
                setUninstallResults(result);
                setShowUninstallConfirm(false);
                setShowUninstallModal(true);
              } catch (error) {
                console.error('[UNINSTALL] Cleanup error:', error);
                setToast('Error cleaning app data: ' + error.message);
                setShowUninstallConfirm(false);
              } finally {
                setUninstallProcessing(false);
              }
            },
            loading: uninstallProcessing,
            destructive: true
          }}
          secondaryActions={[{
            content: 'Cancel',
            onAction: () => setShowUninstallConfirm(false),
            disabled: uninstallProcessing
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner status="critical" title="This action cannot be undone!">
                <p>All AI Search optimization content and app configurations will be permanently removed from your store.</p>
              </Banner>
              
              <Text variant="bodyMd">
                <strong>Are you sure you want to proceed?</strong>
              </Text>
              
              <Text variant="bodyMd" tone="subdued">
                This will remove:
              </Text>
              <Box paddingInlineStart="400">
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  <li>All AI Search optimization content for products and collections</li>
                  <li>AI-generated metadata and structured data</li>
                  <li>Store configuration (brand voice, policies, target audience)</li>
                  <li>Advanced schema markup</li>
                </ul>
              </Box>
              
              <Banner status="info">
                <p>
                  ✅ <strong>Your original product and collection data will NOT be affected.</strong> Only AI-generated content will be removed.
                </p>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Uninstall Success Modal */}
      {showUninstallModal && uninstallResults && (
        <Modal
          open={true}
          title="✅ App Data Cleaned Successfully"
          onClose={() => setShowUninstallModal(false)}
          primaryAction={{
            content: 'Go to Apps & Sales Channels',
            onAction: () => {
              window.open('https://admin.shopify.com/store/' + shop.replace('.myshopify.com', '') + '/settings/apps', '_blank');
            }
          }}
          secondaryActions={[{
            content: 'Close',
            onAction: () => setShowUninstallModal(false)
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner status="success" title="Cleanup completed!">
                <p>All app data has been removed from your Shopify store.</p>
              </Banner>
              
              <Text variant="headingMd">Cleanup Summary:</Text>
              
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="start">
                  <Text variant="bodyMd">✓</Text>
                  <Text variant="bodyMd">
                    AI Search optimization data cleared for <strong>{(uninstallResults.results?.productSeoData?.cleared || 0) + (uninstallResults.results?.collectionSeoData?.cleared || 0)}</strong> items
                  </Text>
                </InlineStack>
                
                <InlineStack gap="200" blockAlign="start">
                  <Text variant="bodyMd">✓</Text>
                  <Text variant="bodyMd">
                    Metadata definitions removed: <strong>{uninstallResults.results?.metafieldDefinitions?.deleted || 0}</strong>
                  </Text>
                </InlineStack>
                
                <InlineStack gap="200" blockAlign="start">
                  <Text variant="bodyMd">✓</Text>
                  <Text variant="bodyMd">
                    Store configuration: <strong>{uninstallResults.results?.storeMetadata?.deleted ? 'Removed' : 'Not found'}</strong>
                  </Text>
                </InlineStack>
                
                <InlineStack gap="200" blockAlign="start">
                  <Text variant="bodyMd">✓</Text>
                  <Text variant="bodyMd">
                    Advanced schema markup: <strong>{uninstallResults.results?.advancedSchemas?.deleted ? 'Removed' : 'Not found'}</strong>
                  </Text>
                </InlineStack>
              </BlockStack>
              
              <Banner status="success">
                <p>
                  ✅ <strong>All AI-generated content has been removed.</strong> Your original product data, titles, descriptions, and Shopify SEO metafields remain unchanged.
                </p>
              </Banner>
              
              <Divider />
              
              <Text variant="headingMd">Next Steps:</Text>
              <Box paddingInlineStart="400">
                <ol style={{ margin: 0, paddingLeft: '20px' }}>
                  <li>Go to <strong>Settings → Apps and sales channels</strong></li>
                  <li>Find <strong>"indexAIze - Unlock AI Search"</strong> in the list</li>
                  <li>Click the <strong>three dots (•••)</strong> menu</li>
                  <li>Select <strong>"Uninstall"</strong></li>
                  <li>Confirm the uninstallation</li>
                </ol>
              </Box>
              
              <Banner status="info">
                <p>💡 Your store data is now clean. You can safely uninstall the app without leaving behind any unused metafields or configurations.</p>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Toast notifications */}
      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </BlockStack>
  );
}

