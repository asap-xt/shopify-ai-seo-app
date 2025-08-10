import React from 'react';
import { TopBar } from '@shopify/polaris';
import LanguagePicker from './LanguagePicker.jsx';

export default function TopNav({ shop, lang, setLang }) {
  const userMenu = (
    <TopBar.UserMenu
      actions={[]}
      name={shop || 'Shop'}
      initials={(shop || 'S')[0].toUpperCase()}
    />
  );

  const secondaryMenu = <LanguagePicker lang={lang} setLang={setLang} />;

  return <TopBar userMenu={userMenu} secondaryMenu={secondaryMenu} />;
}
