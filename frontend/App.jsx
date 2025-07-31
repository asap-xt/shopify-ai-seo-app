import React, { useEffect, useState } from 'react';
import { AppProvider, Page, Spinner, Text } from '@shopify/polaris';
import { useAppBridge } from '@shopify/app-bridge-react';
import { getSessionToken } from '@shopify/app-bridge-utils';
import translations from './i18n/en.json'; // По-късно ще зареждаме по език

function App() {
  const app = useAppBridge();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    async function exchangeToken() {
      try {
        const sessionToken = await getSessionToken(app);
        const response = await fetch('/token-exchange', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionToken,
            shop: window.location.hostname,
          }),
        });

        if (response.ok) {
          setConnected(true);
        } else {
          console.error('Token exchange failed');
        }
      } catch (error) {
        console.error('Token exchange error:', error);
      } finally {
        setLoading(false);
      }
    }

    exchangeToken();
  }, [app]);

  if (loading) {
    return (
      <AppProvider i18n={translations}>
        <Page>
          <Spinner accessibilityLabel="Loading" size="large" />
        </Page>
      </AppProvider>
    );
  }

  return (
    <AppProvider i18n={translations}>
      <Page title="AI SEO 2.0">
        {connected ? (
          <Text variant="headingLg">✅ App is connected to your store</Text>
        ) : (
          <Text color="critical">❌ Failed to connect. Please reload.</Text>
        )}
      </Page>
    </AppProvider>
  );
}

export default App;
