// frontend/src/App.jsx
import React from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Frame, Page } from '@shopify/polaris';
import { Provider as AppBridgeProvider, TitleBar, NavigationMenu } from '@shopify/app-bridge-react';

// Взимаме host/shop от props (идват от main.jsx) и пазим текущия път
export default function App({ host, shop }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Меню за вграденото приложение (ляво таб меню вътре в iframe header менюто)
  const navItems = [
    { label: 'Dashboard', destination: '/dashboard' },
    { label: 'AI SEO',    destination: '/ai-seo' },
    { label: 'Billing',   destination: '/billing' },
    { label: 'Settings',  destination: '/settings' },
  ];

  // Заглавие отгоре (вграденият Shopify header)
  const currentTitle = (() => {
    if (location.pathname.startsWith('/ai-seo'))   return 'AI SEO';
    if (location.pathname.startsWith('/billing'))  return 'Billing';
    if (location.pathname.startsWith('/settings')) return 'Settings';
    return 'Dashboard';
  })();

  // App Bridge Provider (очаква apiKey и host да са инжектирани от main.jsx)
  const appBridgeConfig = {
    apiKey: import.meta.env.VITE_SHOPIFY_API_KEY,
    host,
    // forcedRedirect не е нужен, защото вече сме embedded
  };

  // Малки route компоненти за примера – замени със твоите екрани
  const Dashboard = () => (
    <Page title="AI SEO 2.0">
      <div className="Polaris-Box" style={{ padding: 12 }}>
        <p>Welcome! This is your dashboard.</p>
      </div>
    </Page>
  );

  const AISeo = () => (
    <Page title="AI SEO">
      <div className="Polaris-Box" style={{ padding: 12 }}>
        <p>Generate meta tags, descriptions, alt text…</p>
      </div>
    </Page>
  );

  const Billing = () => (
    <Page title="Billing">
      <div className="Polaris-Box" style={{ padding: 12 }}>
        <p>Plan info, subscribe/upgrade.</p>
      </div>
    </Page>
  );

  const Settings = () => (
    <Page title="Settings">
      <div className="Polaris-Box" style={{ padding: 12 }}>
        <p>Use the top-right menu to switch UI language.</p>
      </div>
    </Page>
  );

  return (
    <AppBridgeProvider config={appBridgeConfig}>
      <Frame>
        {/* Заглавна лента на вграденото приложение */}
        <TitleBar title={currentTitle} />

        {/* Вътрешно навигационно меню на аппа (в Shopify header-а) */}
        <NavigationMenu
          navigationLinks={navItems.map((n) => ({
            label: n.label,
            destination: n.destination,
          }))}
          matcher={(link) => location.pathname.startsWith(link.destination)}
          onNavigation={(link) => navigate(link.destination)}
        />

        {/* Реалните ти екрани */}
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/ai-seo" element={<AISeo />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Frame>
    </AppBridgeProvider>
  );
}
