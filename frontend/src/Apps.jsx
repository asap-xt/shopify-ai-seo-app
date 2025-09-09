import React from 'react';
import '@shopify/polaris/build/esm/styles.css';
import { 
  AppProvider, Frame, Page, Card, Text, Box, 
  Button, Layout, BlockStack 
} from '@shopify/polaris';

const translations = {
  Polaris: {
    ResourceList: { sortingLabel: 'Sort by' }
  }
};

export default function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const shop = urlParams.get('shop');
  const host = urlParams.get('host');
  
  // Debug log
  console.log('App loaded with params:', { shop, host, url: window.location.href });

  return (
    <AppProvider i18n={translations}>
      <Frame>
        <Page title="Dashboard">
          <Layout>
            <Layout.Section>
              <Card>
                <Box padding="400">
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h2">
                      Welcome to NEW AI SEO
                    </Text>
                    <Text>Shop: {shop || 'No shop parameter'}</Text>
                    <Text>Host: {host ? 'Present' : 'Missing'}</Text>
                    <Text variant="bodySm" color="subdued">
                      URL: {window.location.href}
                    </Text>
                    <Button variant="primary">
                      Get Started
                    </Button>
                  </BlockStack>
                </Box>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      </Frame>
    </AppProvider>
  );
}