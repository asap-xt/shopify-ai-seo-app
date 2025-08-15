import React from 'react';
import { Box, InlineStack, Text } from '@shopify/polaris';
import LangButton from './LangButton.jsx';

// Simple brand header: app name (left) + language selector (right)
export default function AppHeader({ appName, lang, setLang, t }) {
  return (
    <Box padding="400" borderBlockEndWidth="025" borderColor="border" background="bg">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h1" variant="headingLg">{appName}</Text>
        <LangButton lang={lang} setLang={setLang} t={t} />
      </InlineStack>
    </Box>
  );
}
