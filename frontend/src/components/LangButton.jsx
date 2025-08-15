import React, { useState, useMemo, useEffect } from 'react';
import { Popover, Button, ActionList, InlineStack, Text } from '@shopify/polaris';

// Supported languages only (no BG anywhere)
const ALLOWED = ['en', 'de', 'es', 'fr'];
const FLAGS = { en: '🇬🇧', de: '🇩🇪', es: '🇪🇸', fr: '🇫🇷' };
const LABELS = { en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français' };

export default function LangButton({ lang = 'en', setLang, t }) {
  const [open, setOpen] = useState(false);

  // Harden: if current lang is not supported, force EN and normalize storage
  useEffect(() => {
    if (!ALLOWED.includes(lang)) {
      try { localStorage.setItem('app_lang', 'en'); } catch {}
      if (typeof setLang === 'function') setLang('en');
    }
  }, [lang, setLang]);

  const current = ALLOWED.includes(lang) ? lang : 'en';

  const activator = (
    <Button onClick={() => setOpen((v) => !v)} disclosure>
      <InlineStack gap="200" blockAlign="center">
        <span aria-hidden>{FLAGS[current]}</span>
        <Text as="span" variant="bodyMd">{LABELS[current]}</Text>
      </InlineStack>
    </Button>
  );

  const items = useMemo(
    () =>
      ALLOWED.map((code) => ({
        content: `${FLAGS[code]} ${LABELS[code]}`,
        active: code === current,
        onAction: () => {
          try { localStorage.setItem('app_lang', code); } catch {}
          if (typeof setLang === 'function') setLang(code);
          setOpen(false);
        },
      })),
    [current, setLang]
  );

  return (
    <Popover active={open} activator={activator} onClose={() => setOpen(false)} autofocusTarget="first-node">
      <ActionList items={items} />
    </Popover>
  );
}
