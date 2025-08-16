// App frame with real LEFT Shopify sidebar menu via App Bridge actions (no TitleBar).
// Keeps your TopNav, AppHeader and the working AiSeoPanel (Generate → Apply).
// Outside Admin (no ?host) shows fallback internal SideNav so nothing breaks during local preview.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import '@shopify/polaris/build/esm/styles.css';
import { AppProvider, Frame, Page, Box, Text } from '@shopify/polaris';
import { NavigationMenu as ABNavigationMenu } from '@shopify/app-bridge/actions';

import TopNav from './components/TopNav.jsx';
import AppHeader from './components/AppHeader.jsx';
import AiSeoPanel from './components/AiSeoPanel.jsx';
import SideNav from './components/SideNav.jsx'; // fallback only

const POLARIS_I18N = { Polaris: { ResourceList: { sortingLabel: 'Sort by' } } };

function useRouter() {
  const [path, setPath] = useState(() => window.location.pathname || '/dashboard');
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/dashboard');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return { path, setPath };
}

class ErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state={hasError:false,message:''}; }
  static getDerivedStateFromError(err){ return {hasError:true,message:err?.message||'Unknown error'}; }
  componentDidCatch(err){ console.error('FE ErrorBoundary:', err); }
  render(){
    if (this.state.hasError) {
      return (
        <Page>
          <Box padding="400">
            <Text as="h2" variant="headingMd">Something went wrong.</Text>
            <Text as="p" tone="critical">{this.state.message}</Text>
          </Box>
        </Page>
      );
    }
    return this.props.children;
  }
}

// Simple placeholders (Dashboard/Billing/Settings panes)
function DashboardPage() {
  return (
    <Box padding="400" background="bg" borderRadius="200" borderWidth="025" borderColor="border">
      Welcome to the dashboard. Use Shopify’s left sidebar to open <b>AI SEO</b>.
    </Box>
  );
}
function BillingPage() { return <Box padding="400" background="bg" borderRadius="200" borderWidth="025" borderColor="border">Billing page placeholder.</Box>; }
function SettingsPage() { return <Box padding="400" background="bg" borderRadius="200" borderWidth="025" borderColor="border">Settings page placeholder.</Box>; }
function NotFound() { return <Box padding="400" background="bg" borderRadius="200" borderWidth="025" borderColor="border">Page not found.</Box>; }

export default function App() {
  // App Bridge instance (set in main.jsx when ?host is present)
  const app = typeof window !== 'undefined' ? window.__APP_BRIDGE__ : null;

  const navRef = useRef(null);

  // UI language for AppHeader/LangButton (generation language is inside AiSeoPanel)
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('app_lang') || 'en'; } catch { return 'en'; }
  });
  useEffect(() => { try { localStorage.setItem('app_lang', lang || 'en'); } catch {} }, [lang]);

  const { path, setPath } = useRouter();

  // Compute section title for AppHeader
  const sectionTitle = useMemo(() => {
    if (path.startsWith('/billing')) return 'Billing';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/ai-seo')) return 'AI SEO';
    if (path === '/' || path.startsWith('/dashboard')) return 'Dashboard';
    return 'Shopify App';
  }, [path]);

  // Create LEFT sidebar menu via App Bridge (no TitleBar)
  useEffect(() => {
    if (!app) return;

    const items = [
      { label: 'Dashboard', destination: '/dashboard' },
      { label: 'AI SEO',    destination: '/ai-seo' },
      { label: 'Billing',   destination: '/billing' },
      { label: 'Settings',  destination: '/settings' },
    ];

    if (!navRef.current) {
      navRef.current = ABNavigationMenu.create(app, {
        items,
        active: window.location.pathname || '/dashboard',
      });

      // (Optional) react to menu navigate events if present in your App Bridge version
      try {
        navRef.current.subscribe(ABNavigationMenu.Action.NAVIGATE, ({ id, destination }) => {
          if (destination && destination !== window.location.pathname) {
            window.history.pushState({}, '', destination);
            setPath(destination);
          }
        });
      } catch { /* safe no-op for versions without NAVIGATE */ }
    } else {
      navRef.current.set({ items, active: window.location.pathname || '/dashboard' });
    }
  }, [app, setPath]);

  // Keep highlight in sync on client-side route changes
  useEffect(() => {
    if (navRef.current) navRef.current.set({ active: path || '/dashboard' });
  }, [path]);

  const isInAdmin = !!app; // if false → use fallback internal SideNav (local preview)

  return (
    <AppProvider i18n={POLARIS_I18N}>
      <ErrorBoundary>
        <Frame
          navigation={isInAdmin ? undefined : <SideNav />} // no in-iframe menu when embedded
          topBar={<TopNav lang={lang} setLang={setLang} t={(k, d) => d} />}
        >
          {(path === '/' || path.startsWith('/dashboard')) && (
            <Page>
              <AppHeader sectionTitle={sectionTitle} lang={lang} setLang={setLang} />
              <Box padding="400"><DashboardPage /></Box>
            </Page>
          )}

          {path.startsWith('/ai-seo') && (
            <Page>
              <AppHeader sectionTitle="AI SEO" lang={lang} setLang={setLang} />
              <Box padding="400"><AiSeoPanel /></Box>
            </Page>
          )}

          {path.startsWith('/billing') && (
            <Page>
              <AppHeader sectionTitle="Billing" lang={lang} setLang={setLang} />
              <Box padding="400"><BillingPage /></Box>
            </Page>
          )}

          {path.startsWith('/settings') && (
            <Page>
              <AppHeader sectionTitle="Settings" lang={lang} setLang={setLang} />
              <Box padding="400"><SettingsPage /></Box>
            </Page>
          )}

          {!['/','/dashboard','/ai-seo','/billing','/settings'].some(p => path === p || path.startsWith(p)) && (
            <Page>
              <AppHeader sectionTitle={sectionTitle} lang={lang} setLang={setLang} />
              <Box padding="400"><NotFound /></Box>
            </Page>
          )}
        </Frame>
      </ErrorBoundary>
    </AppProvider>
  );
}
