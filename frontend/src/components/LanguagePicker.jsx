import React, { useCallback, useState } from 'react';
import { ActionList, Popover, Button } from '@shopify/polaris';

const options = [
  { content: 'English', value: 'en' },
  { content: 'Français', value: 'fr' },
  { content: 'Español', value: 'es' },
  { content: 'Deutsch', value: 'de' },
];

export default function LanguagePicker({ lang, setLang }) {
  const [active, setActive] = useState(false);
  const toggle = useCallback(() => setActive((a) => !a), []);

  const items = options.map(o => ({
    content: o.content,
    onAction: () => { setLang(o.value); setActive(false); }
  }));

  return (
    <Popover active={active} activator={
      <Button onClick={toggle} disclosure>{lang.toUpperCase()}</Button>
    } onClose={toggle}>
      <ActionList items={items} />
    </Popover>
  );
}
