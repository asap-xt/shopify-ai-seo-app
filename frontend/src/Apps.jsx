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

  if (!shop || !host) {
    return (
      <div style={{ padding: '20px' }}>
        <h2>Loading...</h2>
        <p>Shop: {shop || 'missing'}</p>
        <p>Host: {host || 'missing'}</p>
      </div>
    );
  }

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
                    <Text>Shop: {shop}</Text>
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

