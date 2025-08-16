// App.jsx — Embedded UI with ui-nav-menu + brand header showing CURRENT SECTION + language button
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Frame, Page, Layout, Card, BlockStack, Text,
  Divider, InlineStack, Button, TextField, Select, Toast,
  Badge, Inline, SkeletonDisplayText, SkeletonBodyText
} from '@shopify/polaris';
import { TitleBar } from '@shopify/app-bridge-react';
import useI18n from './hooks/useI18n.js';
import AppHeader from './components/AppHeader.jsx';

// Resolve current section from pathname (no react-router)
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

function useShopParam() {
  return useMemo(() => {
    try {
      const usp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      return usp.get('shop') || '';
    } catch {
      return '';
    }
  }, []);
}

// ---- Sections ----
function Dashboard({ t }) {
  const shop = useShopParam();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [toast, setToast] = useState({ open: false, content: '' });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/plans/me?shop=${encodeURIComponent(shop)}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setInfo(data);
      } catch (e) {
        setToast({ open: true, content: `Error: ${e.message}` });
      } finally {
        setLoading(false);
      }
    })();
  }, [shop]);

  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <Inline align="space-between" blockAlign="center">
              <Text as="h3" variant="headingMd">{t('dashboard.plan', 'Current plan')}</Text>
              {info?.inTrial && <Badge tone="attention">{t('dashboard.trial', 'Free trial')} • {new Date(info.trialEndsAt).toLocaleDateString()}</Badge>}
            </Inline>
            <Divider />
            {loading ? (
              <>
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={3} />
              </>
            ) : info ? (
              <>
                <Text>{t('dashboard.shop', 'Shop')}: {info.shop}</Text>
                <Text>{t('dashboard.planName', 'Plan')}: {info.plan}</Text>
                <Text>{t('dashboard.queries', 'AI queries')}: {info.queryCount} / {info.queryLimit ?? '∞'}</Text>
                <Text>{t('dashboard.products', 'Product limit')}: {info.productLimit ?? '∞'}</Text>
                <Text>{t('dashboard.providers', 'Allowed AI providers')}: {(info.providersAllowed || []).join(', ') || '—'}</Text>
              </>
            ) : (
              <Text tone="critical">{t('dashboard.noPlan', 'No plan information available.')}</Text>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>

      {toast.open && (
        <Toast content={toast.content} onDismiss={() => setToast({ open: false, content: '' })} />
      )}
    </Layout>
  );
}

// Lazy loader for getIdToken without top-level await (avoid circular import with main.jsx)
let getIdToken = async () => '';
async function ensureGetIdToken() {
  if (ensureGetIdToken._loaded) return;
  try {
    const mod = await import('./main.jsx');
    getIdToken = typeof mod.getIdToken === 'function' ? mod.getIdToken : async () => '';
  } catch {
    getIdToken = async () => '';
  } finally {
    ensureGetIdToken._loaded = true;
  }
}

function AiSeo({ t }) {
  const shop = useShopParam();
  const { lang } = useI18n(); // current UI language → ще го подадем и към генерацията
  const [productId, setProductId] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  const [result, setResult] = useState('');        // raw JSON string от /seo/generate
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState({ open: false, content: '' });

  // load allowed models for this shop
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/plans/me?shop=${encodeURIComponent(shop)}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const opts = (data.modelsSuggested || []).map(m => ({ label: m, value: m }));
        setModels(opts);
        setModel(prev => prev || opts[0]?.value || '');
      } catch (e) {
        setModels([]);
        setModel('');
      }
    })();
  }, [shop]);

  const parsed = useMemo(() => {
    try { return result ? JSON.parse(result) : null; } catch { return null; }
  }, [result]);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setResult('');
    try {
      await ensureGetIdToken();
      const token = await getIdToken().catch(() => '');

      const payload = { shop, productId, model, language: lang || 'en' };
      const res = await fetch('/seo/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
      setToast({ open: true, content: t('seo.result', 'Result') + ' ✓' });
    } catch (e) {
      setToast({ open: true, content: `Error: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }, [shop, productId, model, lang, t]);

  const handleApply = useCallback(async () => {
    if (!parsed?.productId || !parsed?.seo) {
      setToast({ open: true, content: t('seo.invalid', 'Invalid JSON – generate first') });
      return;
    }
    setApplying(true);
    try {
      await ensureGetIdToken();
      const token = await getIdToken().catch(() => '');

      const res = await fetch('/seo/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          shop,
          productId: parsed.productId,
          seo: parsed.seo,
          options: {
            updateTitle: true,
            updateBody: true,
            updateSeo: true,
            updateBullets: true,
            updateFaq: true,
            updateAlt: false,
            dryRun: false,
          },
        }),
      });

      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      setToast({ open: true, content: t('seo.applied', 'Applied to product') + ' ✓' });
    } catch (e) {
      setToast({ open: true, content: `Error: ${e.message}` });
    } finally {
      setApplying(false);
    }
  }, [parsed, shop, t]);

  return (
    <>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">{t('seo.title', 'Generate SEO')}</Text>
              <Divider />
              <InlineStack gap="300" align="start">
                <TextField
                  label={t('seo.productId', 'Product ID')}
                  value={productId}
                  onChange={setProductId}
                  autoComplete="off"
                  placeholder="gid://shopify/Product/1234567890"
                />
                <Select
                  label={t('seo.model', 'Model (OpenRouter)')}
                  options={models}
                  value={model}
                  onChange={setModel}
                />
                <Button variant="primary" loading={loading} onClick={handleGenerate} disabled={!productId || !model}>
                  {t('seo.generate', 'Generate')}
                </Button>
                <Button loading={applying} onClick={handleApply} disabled={!parsed}>
                  {t('seo.apply', 'Apply to product')}
                </Button>
              </InlineStack>

              {result && (
                <Card>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 420, overflow: 'auto' }}>{result}</pre>
                </Card>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {toast.open && (
        <Toast content={toast.content} onDismiss={() => setToast({ open: false, content: '' })} />
      )}
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
            <Text>{t('settings.languageInfo', 'Use the language button at the top-right.')}</Text>
            <Text>{t('settings.notes', 'More settings will appear here later.')}</Text>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

export default function App() {
  const { lang, setLang, t } = useI18n();
  const { key, title } = useRoute(t);

  // App name shown in the Shopify Admin header (we do NOT duplicate it in-page)
  const APP_NAME = import.meta.env.VITE_APP_NAME || 'NEW AI SEO';

  return (
    <>
      {/* App name always visible in Shopify Admin header */}
      <TitleBar title={APP_NAME} />

      {/* Left navigation inside Shopify Admin */}
      <ui-nav-menu>
        <a href="/" rel="home">Home</a>
        <a href="/dashboard">{t('nav.dashboard', 'Dashboard')}</a>
        <a href="/ai-seo">{t('nav.seo', 'AI SEO')}</a>
        <a href="/billing">{t('nav.billing', 'Billing')}</a>
        <a href="/settings">{t('nav.settings', 'Settings')}</a>
      </ui-nav-menu>

      {/* No Polaris TopBar -> no black strip */}
      <Frame>
        {/* In-page brand header: CURRENT SECTION (left) + Language button (right) */}
        <AppHeader sectionTitle={title} lang={lang} setLang={setLang} t={t} />

        {/* Page content */}
        <Page fullWidth>
          {key === 'dashboard' && <Dashboard t={t} />}
          {key === 'seo' && <AiSeo t={t} />}
          {key === 'billing' && <Billing t={t} />}
          {key === 'settings' && <Settings t={t} />}
        </Page>
      </Frame>
    </>
  );
}
