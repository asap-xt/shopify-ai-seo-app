// frontend/src/App.jsx
import React, { useEffect, useMemo, useState } from 'react';
import '@shopify/polaris/build/esm/styles.css';
import {
  AppProvider, Frame, Page, Layout, Card, Text, Box,
  Button, TextField, Select, InlineStack, Divider, Toast
} from '@shopify/polaris';

import AppHeader from './components/AppHeader.jsx';
import SideNav from './components/SideNav.jsx';

const I18N = { Polaris: { ResourceList: { sortingLabel: 'Sort by' } } };

// -------- utils
const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; }
};
const pretty = (v) => JSON.stringify(v, null, 2);
const toProductGID = (val) => {
  if (!val) return val;
  const s = String(val).trim();
  return s.startsWith('gid://') ? s : `gid://shopify/Product/${s}`;
};
async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text || 'null'); }
  catch { return { __raw: text, error: 'Unexpected non-JSON response' }; }
}

// -------- Admin left nav (App Bridge v4). Only <a> inside <ui-nav-menu>.
function AdminNavMenu({ active }) {
  const isDash = active === '/' || active.startsWith('/dashboard');
  const isSeo  = active.startsWith('/ai-seo');
  const isBill = active.startsWith('/billing');
  const isSett = active.startsWith('/settings');

  return (
    <ui-nav-menu>
      <a href="/dashboard" {...(isDash ? {'aria-current':'page'} : {})}>Dashboard</a>
      <a href="/ai-seo"    {...(isSeo  ? {'aria-current':'page'} : {})}>AI SEO</a>
      <a href="/billing"   {...(isBill ? {'aria-current':'page'} : {})}>Billing</a>
      <a href="/settings"  {...(isSett ? {'aria-current':'page'} : {})}>Settings</a>
    </ui-nav-menu>
  );
}

function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname || '/dashboard');
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/dashboard');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return { path, setPath };
}

// -------- Dashboard (fetch /plans/me)
function DashboardCard() {
  const [state, setState] = useState({ loading: false, err: '', data: null });

  useEffect(() => {
    const shop = qs('shop', '');
    if (!shop) { setState({ loading: false, err: 'Missing ?shop in URL', data: null }); return; }
    (async () => {
      try {
        setState({ loading: true, err: '', data: null });
        const r = await fetch(`/plans/me?shop=${encodeURIComponent(shop)}`, { credentials: 'include' });
        const j = await readJson(r);
        if (!r.ok) throw new Error(j?.error || 'Failed to load plan');
        setState({ loading: false, err: '', data: j });
      } catch (e) {
        setState({ loading: false, err: e.message, data: null });
      }
    })();
  }, []);

  const Row = ({ k, v }) => (
    <InlineStack wrap={false} gap="200" align="space-between">
      <Text as="span" variant="bodyMd" tone="subdued">{k}</Text>
      <Text as="span" variant="bodyMd">{v}</Text>
    </InlineStack>
  );

  return (
    <Card>
      <Box padding="400">
        <Text as="h3" variant="headingMd">Current plan</Text>
        <Divider />
        {state.err && <Box paddingBlockStart="300"><Text tone="critical">{state.err}</Text></Box>}
        {!state.err && !state.data && <Box paddingBlockStart="300"><Text tone="subdued">Loading…</Text></Box>}
        {state.data && (
          <Box paddingBlockStart="300">
            <Row k="Shop" v={state.data.shop || '—'} />
            <Row
              k="AI queries"
              v={state.data.queryLimit ? `${state.data.queryCount ?? 0} / ${state.data.queryLimit}` : '—'}
            />
            <Row k="Product limit" v={state.data.productLimit ?? '—'} />
            <Row
              k="Allowed AI providers"
              v={(state.data.providersAllowed || []).join(', ') || '—'}
            />
            <Row
              k="Trial ends at"
              v={state.data.trialEndsAt ? new Date(state.data.trialEndsAt).toISOString().slice(0, 10) : '—'}
            />
          </Box>
        )}
      </Box>
    </Card>
  );
}

// -------- AI SEO (Generate → Apply) WITH dynamic output language from shop/product
function AiSeoPanel() {
  const [shop, setShop] = useState(() => qs('shop', ''));
  const [productId, setProductId] = useState('');
  const [model, setModel] = useState(''); // will be set from /plans/me
  const [modelOptions, setModelOptions] = useState([{ label: 'Loading…', value: '' }]);

  // Dynamic languages
  const [shopLanguages, setShopLanguages] = useState([]);
  const [productLanguages, setProductLanguages] = useState([]);
  const [primaryLanguage, setPrimaryLanguage] = useState('en');
  const [availableLanguages, setAvailableLanguages] = useState([]); // effective
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [language, setLanguage] = useState('en'); // selected; may be 'all'

  // Result/UI state
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState('');

  // Load model list dynamically from /plans/me for this shop
  useEffect(() => {
    const s = shop || qs('shop', '');
    if (!s) return;
    (async () => {
      try {
        const r = await fetch(`/plans/me?shop=${encodeURIComponent(s)}`, { credentials: 'include' });
        const j = await readJson(r);
        if (!r.ok) throw new Error(j?.error || 'Failed to load plan');
        const opts = (j.modelsSuggested || []).map(m => ({ label: m, value: m }));
        if (opts.length) {
          setModelOptions(opts);
          setModel(prev => opts.find(o => o.value === prev)?.value || opts[0].value);
        } else {
          const fallback = [
            'anthropic/claude-3.5-sonnet',
            'openai/gpt-4o-mini',
          ];
          setModelOptions(fallback.map(m => ({ label: m, value: m })));
          setModel(fallback[0]);
        }
      } catch (e) {
        setToast(`Failed to load plan: ${e.message}`);
      }
    })();
  }, [shop]);

  // Load languages for shop/product (hides selector when single)
  useEffect(() => {
    const s = shop || qs('shop', '');
    const pid = (productId || '').trim();
    if (!s || !pid) {
      setShopLanguages([]); setProductLanguages([]); setPrimaryLanguage('en');
      setAvailableLanguages([]); setShowLanguageSelector(false); setLanguage('en');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // product-level languages; backend uses session, shop in path is only informative
        const url = `/api/languages/product/${encodeURIComponent(s)}/${encodeURIComponent(pid)}`;
        const r = await fetch(url, { credentials: 'include' });
        const j = await readJson(r);
        if (cancelled) return;
        if (!r.ok) throw new Error(j?.error || 'Failed to fetch languages');

        const shopLangs = j.shopLanguages || [];
        const prodLangs = j.productLanguages || [];
        const primary = j.primaryLanguage || (shopLangs[0] || 'en');
        const effective = (prodLangs.length ? prodLangs : shopLangs).map(x => x.toLowerCase());
        const showSel = effective.length > 1;

        setShopLanguages(shopLangs);
        setProductLanguages(prodLangs);
        setPrimaryLanguage(primary);
        setAvailableLanguages(effective);
        setShowLanguageSelector(showSel);

        // default selected language:
        setLanguage(showSel ? (language && effective.includes(language) ? language : effective[0]) : primary);
      } catch (e) {
        if (!cancelled) {
          // Fallback (single EN, hide selector)
          setShopLanguages(['en']);
          setProductLanguages(['en']);
          setPrimaryLanguage('en');
          setAvailableLanguages(['en']);
          setShowLanguageSelector(false);
          setLanguage('en');
          setToast(`Languages fallback: ${e.message}`);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop, productId]);

  async function generate() {
    setBusy(true); setResult(null); setToast('');
    try {
      const productIdGID = toProductGID(productId);
      let r, j;

      // Multi-language when "All" is selected
      if (language === 'all') {
        const langs = availableLanguages.slice();
        if (!langs.length) throw new Error('No languages available');
        r = await fetch('/api/seo/generate-multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ shop, productId: productIdGID, model, languages: langs }),
        });
        j = await readJson(r);
        if (!r.ok) throw new Error(j?.error || 'Generate failed');
        setResult(j);
      } else {
        r = await fetch(`/seo/generate?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ shop, productId: productIdGID, model, language }),
        });
        j = await readJson(r);
        if (!r.ok) throw new Error(j?.error || 'Generate failed');
        setResult(j);
      }
    } catch (e) {
      setResult({ error: e.message });
      if (String(e.message).toLowerCase().includes('not a valid model')) {
        setToast('Selected model is not enabled/valid. Pick another model from the list.');
      } else {
        setToast(`Generate error: ${e.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!result) return;
    setBusy(true); setToast('');
    try {
      // MULTI: result.results[]
      if (Array.isArray(result.results)) {
        const pid = toProductGID(productId || result.productId || '');
        const results = result.results
          .filter(r => r && r.seo) // keep only successful ones
          .map(r => ({ language: r.language, seo: r.seo }));
        if (!results.length) throw new Error('Nothing to apply (no successful generations)');
        const r = await fetch('/api/seo/apply-multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            shop,
            productId: pid,
            results,
            options: {
              updateTitle: true, updateBody: true, updateSeo: true,
              updateBullets: true, updateFaq: true, updateAlt: false, dryRun: false,
            },
          }),
        });
        const j = await readJson(r);
        if (!r.ok || j?.ok === false) {
          const err = (j?.errors || []).join('; ') || j?.error || 'Apply failed';
          throw new Error(err);
        }
      } else {
        // SINGLE
        const pidRaw = (result.productId || productId || '').trim();
        const productIdGID = toProductGID(pidRaw);
        const r = await fetch(`/seo/apply?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            shop,
            productId: productIdGID,
            seo: result.seo,
            options: {
              updateTitle: true, updateBody: true, updateSeo: true,
              updateBullets: true, updateFaq: true, updateAlt: false, dryRun: false,
            },
          }),
        });
        const j = await readJson(r);
        if (!r.ok || j?.ok === false) {
          const err = (j?.errors || []).join('; ') || j?.error || 'Apply failed';
          throw new Error(err);
        }
      }
      setToast('Applied ✓');
    } catch (e) {
      setToast(`Apply error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // Build language options (dynamic). Hide selector if only 1 language.
  const languageOptions = [
    ...(showLanguageSelector ? [{ label: 'All languages', value: 'all' }] : []),
    ...availableLanguages.map(l => ({ label: l.toUpperCase(), value: l })),
  ];

  return (
    <>
      <Card>
        <Box padding="400">
          <Text as="h3" variant="headingMd">AI SEO</Text>
          <Box paddingBlockStart="300">
            <Layout>
              <Layout.Section oneHalf>
                <TextField
                  label="Shop"
                  value={shop}
                  onChange={setShop}
                  placeholder="your-shop.myshopify.com"
                  autoComplete="off"
                />
              </Layout.Section>
              <Layout.Section oneHalf>
                <TextField
                  label="Product ID (numeric or GID)"
                  value={productId}
                  onChange={setProductId}
                  placeholder="1496335… or gid://shopify/Product/1496335…"
                  autoComplete="off"
                />
              </Layout.Section>
              <Layout.Section oneHalf>
                <Select
                  label="Model"
                  options={modelOptions}
                  value={model}
                  onChange={setModel}
                />
              </Layout.Section>

              {/* Output language selector — hidden if only one language */}
              {showLanguageSelector && (
                <Layout.Section oneHalf>
                  <Select
                    label="Language (output)"
                    options={languageOptions}
                    value={language}
                    onChange={setLanguage}
                  />
                </Layout.Section>
              )}

              <Layout.Section>
                <InlineStack gap="300">
                  <Button
                    loading={busy}
                    onClick={generate}
                    variant="primary"
                    disabled={!shop || !productId || !model}
                  >
                    Generate
                  </Button>
                  <Button onClick={apply} disabled={!result || busy}>
                    Apply to product
                  </Button>
                </InlineStack>
              </Layout.Section>
            </Layout>
          </Box>
        </Box>
      </Card>

      <Box paddingBlockStart="300">
        <Card>
          <Box padding="400">
            <Text as="h3" variant="headingMd">Result</Text>
            <Divider />
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, marginTop: 12 }}>
{`${result ? pretty(result) : '—'}`}
            </pre>
          </Box>
        </Card>
      </Box>

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </>
  );
}

export default function App() {
  const { path } = useRoute();
  const [lang, setLang] = useState('en');
  const isEmbedded = !!(new URLSearchParams(window.location.search).get('host'));

  const sectionTitle = useMemo(() => {
    if (path.startsWith('/ai-seo')) return 'AI SEO';
    if (path.startsWith('/billing')) return 'Billing';
    if (path.startsWith('/settings')) return 'Settings';
    return 'Dashboard';
  }, [path]);

  return (
    <AppProvider i18n={I18N}>
      {isEmbedded && <AdminNavMenu active={path} />}
      <Frame navigation={isEmbedded ? undefined : <SideNav />}>
        <Page>
          {/* Header language selector (UI only, 4 languages) remains */}
          <AppHeader sectionTitle={sectionTitle} lang={lang} setLang={setLang} t={(k, d) => d} />
          {path.startsWith('/ai-seo') ? (
            <AiSeoPanel />
          ) : path.startsWith('/billing') ? (
            <Card><Box padding="400"><Text>Billing page</Text></Box></Card>
          ) : path.startsWith('/settings') ? (
            <Card><Box padding="400"><Text>Settings page</Text></Box></Card>
          ) : (
            <DashboardCard />
          )}
        </Page>
      </Frame>
    </AppProvider>
  );
}
