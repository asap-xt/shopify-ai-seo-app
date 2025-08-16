// frontend/src/App.jsx
// Classic Shopify shell: TopBar + left nav + routed pages (Polaris Frame)
// Uses your own components: TopNav, SideNav, AppHeader (now under ./components).
// Embeds the working AiSeoPanel (Generate → Preview/JSON → Apply).

import React, { useEffect, useMemo, useState } from 'react';
import '@shopify/polaris/build/esm/styles.css';
import { AppProvider, Frame, Page, Box, Text } from '@shopify/polaris';

import TopNav from './components/TopNav.jsx';
import SideNav from './components/SideNav.jsx';
import AppHeader from './components/AppHeader.jsx';
import AiSeoPanel from './components/AiSeoPanel.jsx';

// ---- Minimal i18n for Polaris
const POLARIS_I18N = {
  Polaris: {
    ResourceList: { sortingLabel: 'Sort by' },
  },
};

// ---- Tiny router (no external deps)
function useRouter() {
  const [path, setPath] = useState(() => window.location.pathname || '/dashboard');
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/dashboard');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (to) => {
    if (!to || to === window.location.pathname) return;
    window.history.pushState({}, '', to);
    setPath(to);
  };
  return { path, navigate };
}

// ---- Error boundary to avoid blank screens
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message || 'Unknown error' };
  }
  componentDidCatch(err) {
    // eslint-disable-next-line no-console
    console.error('FE ErrorBoundary:', err);
  }
  render() {
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

function Section({ title, lang, setLang, children }) {
  return (
    <Page>
      <AppHeader sectionTitle={title} lang={lang} setLang={setLang} />
      <Box padding="400">{children}</Box>
    </Page>
  );
}

// ---- Simple placeholders
function DashboardPage() {
  return (
    <Box padding="400" background="bg" borderRadius="200" borderWidth="025" borderColor="border">
      Welcome to the dashboard. Use the left navigation to open <b>AI SEO</b>.
    </Box>
  );
}
function BillingPage() {
  return (
    <Box padding="400" background="bg" borderRadius="200" borderWidth="025" borderColor="border">
      Billing page placeholder.
    </Box>
  );
}
function SettingsPage() {
  return (
    <Box padding="400" background="bg" borderRadius="200" borderWidth="025" borderColor="border">
      Settings page placeholder.
    </Box>
  );
}
function NotFound() {
  return (
    <Box padding="400" background="bg" borderRadius="200" borderWidth="025" borderColor="border">
      Page not found.
    </Box>
  );
}

export default function App() {
  // Language persistence (used by AppHeader/LangButton)
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('app_lang') || 'en'; } catch { return 'en'; }
  });
  useEffect(() => {
    try { localStorage.setItem('app_lang', lang || 'en'); } catch {}
  }, [lang]);

  const { path, navigate } = useRouter();

  const title = useMemo(() => {
    if (path.startsWith('/billing')) return 'Billing';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/ai-seo')) return 'AI SEO';
    if (path === '/' || path.startsWith('/dashboard')) return 'Dashboard';
    return 'Shopify App';
  }, [path]);

  return (
    <AppProvider i18n={POLARIS_I18N}>
      <ErrorBoundary>
        <Frame
          topBar={<TopNav lang={lang} setLang={setLang} t={(k, d) => d} />}
          navigation={<SideNav navigate={navigate} activePath={path} />}
        >
          {/* ROUTES */}
          {(path === '/' || path.startsWith('/dashboard')) && (
            <Section title={title} lang={lang} setLang={setLang}>
              <DashboardPage />
            </Section>
          )}

          {path.startsWith('/ai-seo') && (
            <Section title="AI SEO" lang={lang} setLang={setLang}>
              <AiSeoPanel />
            </Section>
          )}

          {path.startsWith('/billing') && (
            <Section title="Billing" lang={lang} setLang={setLang}>
              <BillingPage />
            </Section>
          )}

          {path.startsWith('/settings') && (
            <Section title="Settings" lang={lang} setLang={setLang}>
              <SettingsPage />
            </Section>
          )}

          {/* Fallback */}
          {!['/','/dashboard','/ai-seo','/billing','/settings'].some(p => path === p || path.startsWith(p)) && (
            <Section title={title} lang={lang} setLang={setLang}>
              <NotFound />
            </Section>
          )}
        </Frame>
      </ErrorBoundary>
    </AppProvider>
  );
}
