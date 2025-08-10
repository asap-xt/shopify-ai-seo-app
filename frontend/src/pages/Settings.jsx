import React from 'react';
import { Page, Card, Text, BlockStack } from '@shopify/polaris';

export default function Settings({ i18n }) {
  return (
    <Page title={i18n.settings.title}>
      <Card>
        <BlockStack gap="200">
          <Text>{i18n.settings.languageInfo}</Text>
          <Text>{i18n.settings.notes}</Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
