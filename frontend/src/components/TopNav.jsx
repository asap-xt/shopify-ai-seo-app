import React, {useCallback, useState} from 'react';
import {TopBar, Button, Popover, Select, Box, Text} from '@shopify/polaris';

export default function TopNav({ lang, setLang, t }) {
  const [popoverActive, setPopoverActive] = useState(false);
  const togglePopover = useCallback(() => setPopoverActive((a) => !a), []);

  const options = [
    { label: 'English',   value: 'en' },
    { label: 'Deutsch',   value: 'de' },
    { label: 'Español',   value: 'es' },
    { label: 'Français',  value: 'fr' },
  ];

  const secondaryMenu = (
    <Box paddingInlineEnd="300" paddingBlock="100">
      <Popover
        active={popoverActive}
        activator={<Button onClick={togglePopover} disclosure>{(lang || 'en').toUpperCase()}</Button>}
        autofocusTarget="first-node"
        onClose={togglePopover}
      >
        <Box padding="300" minWidth="220px">
          <Text as="p" variant="bodySm" tone="subdued" visuallyHidden>
            {t?.('common.language', 'Language')}
          </Text>
          <Select
            label={t?.('common.language', 'Language')}
            labelHidden
            options={options}
            value={lang || 'en'}
            onChange={(v) => {
              try { localStorage.setItem('app_lang', v); } catch {}
              setLang(v);
              setPopoverActive(false);
            }}
          />
        </Box>
      </Popover>
    </Box>
  );

  return (
    <TopBar
      showNavigationToggle
      secondaryMenu={secondaryMenu}
      onNavigationToggle={() => {}}
    />
  );
}
