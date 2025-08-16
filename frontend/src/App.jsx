// frontend/src/App.jsx
// Classic Shopify shell with App Bridge TitleBar + real LEFT sidebar menu via actions.
// Keeps your TopNav, AppHeader, and the working AiSeoPanel (Generate → Apply).
// Includes a fallback internal SideNav ONLY if App Bridge isn't available (e.g. outside Admin).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import '@shopify/polaris/build/esm/styles.css';
import { AppProvider, Frame, Page, Box, Text } from '@shopify/polaris';
import { TitleBar as ABTitleBar, NavigationMenu as ABNavigationMenu } from '@shopify/app-bridge/actions';

import TopNav from './components/TopNav.jsx';
import AppHeader from './components/AppHeader.jsx';
import AiSeoPanel from './components/AiSeoPanel.jsx';
import SideNav from './components/SideNav.jsx'; // Fallback only

const POLARIS_I18N = { Polaris: { ResourceList: { sortingLabel: 'Sort by' } } };

function useRouter() {
  const [path, setPath] = useState(() => window.location.pathname || '/dashboard');
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/dashboard');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return { path };
}

class ErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state={hasError:false,message:''}; }
  static getDerivedStateFromError(err){ return {hasError:true,message:err?.message||'Unknown error'}; }
  componentDidCatch(err){ console.error('FE ErrorBoundary:', err); }
  render(){
    if(this.state.hasError){
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
  // App Bridge instance е вкаран в window от main.jsx (window.__APP_BRIDGE__), ако сме в Admin.
  const app = typeof window !== 'undefined' ? window.__APP_BRIDGE__ : null;
  const navRef = useRef(null);
  const titleRef = useRef(null);

  // UI language (за AppHeader/LangButton). Генерационният език е отделен в AiSeoPanel.
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('app_lang') || 'en'; } catch { return 'en'; }
  });
  useEffect(() => { try { localStorage.setItem('app_lang', lang || 'en'); } catch {} }, [lang]);

  const { path } = useRouter();

  const sectionTitle = useMemo(() => {
    if (path.startsWith('/billing')) return 'Billing';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/ai-seo')) return 'AI SEO';
    if (path === '/' || path.startsWith('/dashboard')) return 'Dashboard';
    return 'Shopify App';
  }, [path]);

  // App Bridge TitleBar + LEFT sidebar menu (реалното Shopify меню), ако сме в Admin
  useEffect(() => {
    if (!app) return;

    if (!titleRef.current) {
      titleRef.current = ABTitleBar.create(app, { title: 'NEW AI SEO' });
    } else {
      titleRef.current.set({ title: 'NEW AI SEO' });
    }

    const items = [
      { label: 'Dashboard', destination: '/dashboard' },
      { label: 'AI SEO',    destination: '/ai-seo' },
      { label: 'Billing',   destination: '/billing' },
      { label: 'Settings',  destination: '/settings' },
    ];
    if (!navRef.current) {
      navRef.current = ABNavigationMenu.create(app, { items });
    } else {
      navRef.current.set({ items });
    }
  }, [app]);

  const isInAdmin = !!app; // ако няма App Bridge (локално без ?host), показваме fallback навигация

  return (
    <AppProvider i18n={POLARIS_I18N}>
      <ErrorBoundary>
        <Frame
          /* В Shopify Admin НЕ подаваме internal navigation (лявото меню идва от App Bridge).
             Извън Admin (без App Bridge) показваме fallback SideNav, за да имаш навигация при локален преглед. */
          navigation={isInAdmin ? undefined : <SideNav />}
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
