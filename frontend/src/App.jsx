import React, { useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Frame, Navigation } from '@shopify/polaris';
import {
  HomeIcon,
  MagicIcon,
  SettingsIcon,
  CreditCardIcon,
} from '@shopify/polaris-icons';

import TopNav from './components/TopNav.jsx';
import Dashboard from './pages/Dashboard.jsx';
import SeoGenerate from './pages/SeoGenerate.jsx';
import Billing from './pages/Billing.jsx';
import Settings from './pages/Settings.jsx';

import en from './i18n/en.json';
import fr from './i18n/fr.json';
import es from './i18n/es.json';
import de from './i18n/de.json';

const messages = { en, fr, es, de };

export default function App({ host, shop }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [lang, setLang] = useState('en');
  const i18n = messages[lang] || messages.en;

  const navItems = [
    { url: '/', label: i18n.nav.dashboard, icon: HomeIcon },
    { url: '/seo', label: i18n.nav.seo, icon: MagicIcon },
    { url: '/billing', label: i18n.nav.billing, icon: CreditCardIcon },
    { url: '/settings', label: i18n.nav.settings, icon: SettingsIcon },
  ];

  return (
    <Frame
      topBar={<TopNav shop={shop} lang={lang} setLang={setLang} />}
      navigation={
        <Navigation location={location.pathname}>
          <Navigation.Section
            items={navItems.map(n => ({
              label: n.label,
              icon: n.icon,
              selected: location.pathname === n.url,
              onClick: () => navigate(n.url + window.location.search),
            }))}
          />
        </Navigation>
      }
    >
      <Routes>
        <Route path="/" element={<Dashboard i18n={i18n} shop={shop} />} />
        <Route path="/seo" element={<SeoGenerate i18n={i18n} shop={shop} />} />
        <Route path="/billing" element={<Billing i18n={i18n} shop={shop} />} />
        <Route path="/settings" element={<Settings i18n={i18n} />} />
      </Routes>
    </Frame>
  );
}
