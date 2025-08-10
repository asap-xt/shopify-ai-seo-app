import React, { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { Card, Page, Text, InlineStack, BlockStack, Badge } from '@shopify/polaris';
import { useApi } from '../hooks/useApi.js';

export default function Dashboard({ i18n, shop }) {
  const api = useApi(shop);
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/billing/plan').then(setData).catch(() => setData(null));
  }, []);

  return (
    <Page title="AI SEO 2.0">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <InlineStack gap="400" align="space-between">
              <Text as="h2" variant="headingMd">{i18n.dashboard.plan}</Text>
              <Badge tone="success">{data?.plan?.toUpperCase() || '...'}</Badge>
            </InlineStack>
            <Text>{i18n.dashboard.shop}: {shop}</Text>
            <Text>{i18n.dashboard.queries}: {data?.queryCount ?? '–'} / {data?.queryLimit ?? '–'}</Text>
            <Text>{i18n.dashboard.products}: {data?.productLimit ?? '–'}</Text>
            <Text>{i18n.dashboard.providers}: {(data?.aiProviders || []).join(', ')}</Text>
            {data?.trialEndsAt && (
              <Text>{i18n.dashboard.trial}: {new Date(data.trialEndsAt).toLocaleString()}</Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
