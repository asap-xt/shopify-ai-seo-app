// App.jsx — Embedded UI with Shopify Admin left nav (App Bridge actions) + debug
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Frame, Page, Layout, Card, BlockStack, Text,
  Divider, InlineStack, Button, TextField, Select, Toast,
} from '@shopify/polaris';
import { TitleBar as ABTitleBar, NavigationMenu } from '@shopify/app-bridge/actions';
import useI18n from './hooks/useI18n.js';
import TopNav from './components/TopNav.jsx';
import { appBridge } from './main.jsx';

// Route resolver (simple, no react-router)
function useRoute(t) {
  const path = (typeof window !== 'undefined' ? window.location.pathname : '/') || '/';
  return useMemo(() => {
    if (path === '/' || path.startsWith('/dashboard')) return { key: 'dashboard', title: t('nav.dashboard', 'Dashboard') };
    if (path.startsWith('/ai-seo'))                 return { key: 'seo',       title: t('nav.seo', 'AI SEO') };
    if (path.startsWith('/billing'))               return { key: 'billing',   title: t('nav.billing', 'Billing') };
    if (path.startsWith('/settings'))              return { key: 'settings',  title: t('nav.settings', 'Settings') };
    return { key: 'dashboard', title: t('nav.dashboard', 'Dashboard') };
  }, [path, t]);
}

// Sections
function Dashboard({ t }) {
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">{t('dashboard.plan', 'Current plan')}</Text>
            <Divider />
            <Text>{t('dashboard.shop', 'Shop')}: My Test Shop</Text>
            <Text>{t('dashboard.queries', 'AI queries')}: 120</Text>
            <Text>{t('dashboard.products', 'Product limit')}: 50</Text>
            <Text>{t('dashboard.providers', 'Allowed AI providers')}: OpenAI, Claude</Text>
            <Text>{t('dashboard.trial', 'Trial ends at')}: 2025-09-01</Text>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

// Lazy loader for getIdToken without top-level await
let getIdToken = async () => '';
async function ensureGetIdToken() {
  if (ensureGetIdToken._loaded) return;
  try {
    const mod = await import('./main.jsx');
    getIdToken = typeof mod.getIdToken === 'function' ? mod.getIdToken : async () => '';
  } catch { getIdToken = async () => ''; }
  finally { ensureGetIdToken._loaded = true; }
}

function AiSeo({ t }) {
  const [productId, setProductId] = useState('');
  const [provider, setProvider] = useState('openai');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, content: '' });
  const providers = [{ label: 'OpenAI', value: 'openai' }, { label: 'Claude', value: 'claude' }];

  const handleGenerate = async () => {
    setLoading(true); setResult('');
    try {
      await ensureGetIdToken();
      const token = await getIdToken().catch(() => '');
      const res = await fetch('/seo/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ productId, provider }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      const out = data?.result ?? data;
      setResult(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
      setToast({ open: true, content: t('seo.result', 'Result') + ' ✓' });
    } catch (e) {
      setToast({ open: true, content: `Error: ${e.message}` });
    } finally { setLoading(false); }
  };

  return (
    <>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">{t('seo.title', 'Generate SEO')}</Text>
              <Divider />
              <InlineStack gap="300" align="start">
                <TextField label={t('seo.productId', 'Product ID')} value={productId} onChange={setProductId} autoComplete="off" />
                <Select label={t('seo.provider', 'AI Provider')} options={providers} value={provider} onChange={setProvider} />
                <Button variant="primary" loading={loading} onClick={handleGenerate}>{t('seo.generate', 'Generate')}</Button>
              </InlineStack>
              {result && (<Card><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result}</pre></Card>)}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      {toast.open && (<Toast content={toast.content} onDismiss={() => setToast({ open: false, content: '' })} />)}
    </>
  );
}

function Billing({ t }) {
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">{t('billing.title', 'Plans & Billing')}</Text>
            <Divider />
            <Text>{t('billing.choose', 'Choose your plan:')}</Text>
            <InlineStack gap="300">
              <Button variant="primary" onClick={() => window.location.assign('/billing')}>
                {t('billing.activate', 'Activate')}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

function Settings({ t }) {
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">{t('settings.title', 'Settings')}</Text>
            <Divider />
            <Text>{t('settings.languageInfo', 'Use the top-right menu to switch UI language.')}</Text>
            <Text>{t('settings.notes', 'More settings will appear here later.')}</Text>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

// ---------- App ----------
export default function App() {
  const { lang, setLang, t } = useI18n();
  const { key, title } = useRoute(t);

  // TitleBar via actions API + debug
  const tbRef = useRef(null);
  useEffect(() => {
    if (!appBridge) return;
    if (!tbRef.current) {
      tbRef.current = ABTitleBar.create(appBridge, { title });
      console.debug('[AB] TitleBar created with title:', title);
    } else {
      tbRef.current.set({ title });
      console.debug('[AB] TitleBar updated to:', title);
    }
  }, [title]);

  // Shopify Admin left nav via actions API + debug
  const navRef = useRef(null);
  useEffect(() => {
    if (!appBridge) return;

    const items = [
      { label: t('nav.dashboard', 'Dashboard'), destination: '/dashboard' },
      { label: t('nav.seo', 'AI SEO'),         destination: '/ai-seo' },
      { label: t('nav.billing', 'Billing'),     destination: '/billing' },
      { label: t('nav.settings', 'Settings'),   destination: '/settings' },
    ];

    if (!navRef.current) {
      navRef.current = NavigationMenu.create(appBridge, { items });
      console.debug('[AB] NavigationMenu created with items:', items);
    } else {
      navRef.current.set({ items });
      console.debug('[AB] NavigationMenu updated with items:', items);
    }
  }, [t, lang]);

  return (
    <Frame topBar={<TopNav lang={lang} setLang={setLang} t={t} />}>
      <Page title={title} fullWidth>
        {key === 'dashboard' && <Dashboard t={t} />}
        {key === 'seo' && <AiSeo t={t} />}
        {key === 'billing' && <Billing t={t} />}
        {key === 'settings' && <Settings t={t} />}
      </Page>
    </Frame>
  );
}
