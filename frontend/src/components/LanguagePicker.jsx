import React from 'react';
import { TopBar, Button } from '@shopify/polaris';

export default function LanguagePicker({ lang = 'en', setLang = () => {} }) {
  return (
    <TopBar.SecondaryMenu>
      <Button onClick={() => setLang(lang === 'en' ? 'bg' : 'en')}>
        Lang: {lang.toUpperCase()}
      </Button>
    </TopBar.SecondaryMenu>
  );
}
