import React from 'react';
import { Box, InlineStack, Text } from '@shopify/polaris';
// import LangButton from './LangButton.jsx'; // v2: multi-language UI planned

/**
 * Brand header displayed inside the page:
 * - Left: current section title (Dashboard / AI SEO / Billing / Settings)
 * - Right: language selector button
 */
export default function AppHeader({ sectionTitle, lang, setLang, t }) {
  return (
    <Box padding="400" borderBlockEndWidth="025" borderColor="border" background="bg">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h1" variant="headingLg">{sectionTitle}</Text>
        {/** Language switcher temporarily disabled (v1); will return in v2 */}
        {/* <LangButton lang={lang} setLang={setLang} t={t} /> */}
      </InlineStack>
    </Box>
  );
}
