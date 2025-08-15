import React, { useState, useMemo } from 'react';
import { Popover, Button, ActionList, InlineStack, Text } from '@shopify/polaris';

// Small flag map (emoji for simplicity). Add more if you need.
const FLAGS = { en: '🇬🇧', de: '🇩🇪', es: '🇪🇸', fr: '🇫🇷', bg: '🇧🇬' };
const LABELS = { en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', bg: 'Български' };

export default function LangButton({ lang = 'en', setLang, t }) {
  const [open, setOpen] = useState(false);

  const activator = (
    <Button onClick={() => setOpen((v) => !v)} disclosure>
      <InlineStack gap="200" blockAlign="center">
        <span aria-hidden>{FLAGS[lang] || '🌐'}</span>
        <Text as="span" variant="bodyMd">{LABELS[lang] || lang.toUpperCase()}</Text>
      </InlineStack>
    </Button>
  );

  const items = useMemo(() =>
    Object.keys(LABELS).map((code) => ({
      content: `${FLAGS[code] || ''} ${LABELS[code]}`,
      active: code === lang,
      onAction: () => {
        try { localStorage.setItem('app_lang', code); } catch {}
        setLang(code);
        setOpen(false);
      },
    })), [lang, setLang]
  );

  return (
    <Popover active={open} activator={activator} onClose={() => setOpen(false)} autofocusTarget="first-node">
      <ActionList items={items} />
    </Popover>
  );
}
