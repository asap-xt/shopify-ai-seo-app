import React, { useEffect, useMemo, useState } from 'react';
import '@shopify/polaris/build/esm/styles.css';
import {
  AppProvider, Frame, Page, Layout, Card, Text, Box,
  Button, TextField, Select, InlineStack, Divider, Toast
} from '@shopify/polaris';

import TopNav from './components/TopNav.jsx';         // твоята лента с езиците (без TitleBar)
import AppHeader from './components/AppHeader.jsx';   // вътрешен хедър със секция + език
import SideNav from './components/SideNav.jsx';       // fallback меню за локален преглед

const I18N = { Polaris: { ResourceList: { sortingLabel: 'Sort by' } } };

// ---- helpers
const qs = (k, d='') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; }
};
const pretty = (v) => JSON.stringify(v, null, 2);

// ---- Admin LEFT sidebar via App Bridge v4 custom elements
function AdminNavMenu({ active }) {
  // Shopify ще “изтегли” тези елементи и ще покажe подменюто под Apps → NEW AI SEO
  return (
    <ui-nav-menu>
      <ui-nav-menu-item url="/dashboard" selected={active.startsWith('/dashboard') || active === '/'}>Dashboard</ui-nav-menu-item>
      <ui-nav-menu-item url="/ai-seo"   selected={active.startsWith('/ai-seo')}>AI SEO</ui-nav-menu-item>
      <ui-nav-menu-item url="/billing"  selected={active.startsWith('/billing')}>Billing</ui-nav-menu-item>
      <ui-nav-menu-item url="/settings" selected={active.startsWith('/settings')}>Settings</ui-nav-menu-item>
    </ui-nav-menu>
  );
}

// ---- mini router
function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname || '/dashboard');
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/dashboard');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return { path, setPath };
}

// ---- Dashboard (както на снимката – текущ план)
function DashboardCard() {
  const [state, setState] = useState({ loading:false, err:'', data:null });

  useEffect(() => {
    const shop = qs('shop','');
    if (!shop) { setState({loading:false, err:'Missing ?shop in URL', data:null}); return; }
    (async () => {
      try {
        setState({loading:true, err:'', data:null});
        const r = await fetch(`/plans/me?shop=${encodeURIComponent(shop)}`);
        const j = await r.json();
        setState({ loading:false, err:'', data:j });
      } catch(e) {
        setState({ loading:false, err:e.message, data:null });
      }
    })();
  }, []);

  const Row = ({k,v}) => (
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
            <Row k="AI queries" v={
              state.data.queryLimit
                ? `${state.data.queryCount ?? 0} / ${state.data.queryLimit}`
                : '—'
            } />
            <Row k="Product limit" v={state.data.productLimit ?? '—'} />
            <Row k="Allowed AI providers" v={(state.data.providersAllowed||[]).join(', ') || '—'} />
            <Row k="Trial ends at" v={state.data.trialEndsAt ? new Date(state.data.trialEndsAt).toISOString().slice(0,10) : '—'} />
          </Box>
        )}
      </Box>
    </Card>
  );
}

// ---- AI SEO (Generate → JSON → Apply) – запазва бекенд пътищата
function AiSeoPanel() {
  const [shop, setShop] = useState(() => qs('shop',''));
  const [productId, setProductId] = useState('');
  const [model, setModel] = useState('anthropic/claude-3.5-sonnet');
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState('');

  async function generate() {
    setBusy(true); setResult(null);
    try {
      const r = await fetch('/seo/generate', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ shop, productId, model, language }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Generation failed');
      setResult(j);
    } catch(e) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!result || !result.seo) return;
    setBusy(true);
    try {
      const payload = {
        shop,
        productId: result.productId || productId,
        seo: result.seo,
        options: {
          updateTitle: true,
          updateBody: true,
          updateSeo: true,
          updateBullets: true,
          updateFaq: true,
          updateAlt: false
        }
      };
      const r = await fetch('/seo/apply', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error((j.errors && j.errors[0]) || j.error || 'Apply failed');
      setToast('Applied ✓');
    } catch(e) {
      setToast(`Apply error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <Box padding="400">
          <Text as="h3" variant="headingMd">AI SEO</Text>
          <Box paddingBlockStart="300">
            <Layout>
              <Layout.Section oneHalf>
                <TextField label="Shop" value={shop} onChange={setShop} placeholder="your-shop.myshopify.com" autoComplete="off" />
              </Layout.Section>
              <Layout.Section oneHalf>
                <TextField label="Product ID" value={productId} onChange={setProductId} placeholder="gid://shopify/Product/…" autoComplete="off" />
              </Layout.Section>
              <Layout.Section oneHalf>
                <Select
                  label="Model"
                  options={[
                    {label:'anthropic/claude-3.5-sonnet', value:'anthropic/claude-3.5-sonnet'},
                    {label:'openai/gpt-4o-mini', value:'openai/gpt-4o-mini'},
                    {label:'google/gemini-1.5-flash', value:'google/gemini-1.5-flash'},
                  ]}
                  value={model}
                  onChange={setModel}
                />
              </Layout.Section>
              <Layout.Section oneHalf>
                <Select
                  label="Language"
                  options={[
                    {label:'EN', value:'en'},
                    {label:'DE', value:'de'},
                    {label:'ES', value:'es'},
                    {label:'FR', value:'fr'},
                  ]}
                  value={language}
                  onChange={setLanguage}
                />
              </Layout.Section>
              <Layout.Section>
                <InlineStack gap="300">
                  <Button loading={busy} onClick={generate} variant="primary" disabled={!shop || !productId}>Generate</Button>
                  <Button onClick={apply} disabled={!result || !result.seo || busy}>Apply to product</Button>
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
            <pre style={{whiteSpace:'pre-wrap', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize:12, marginTop:12}}>
{`${result ? pretty(result) : '—'}`}
            </pre>
          </Box>
        </Card>
      </Box>

      {toast && <Toast content={toast} onDismiss={()=>setToast('')} />}
    </>
  );
}

// ---- App
export default function App() {
  const { path } = useRoute();
  const [lang, setLang] = useState('en');

  const isEmbedded = !!(new URLSearchParams(window.location.search).get('host')); // ако е в Admin – Shopify ще изрисува лявото меню от <ui-nav-menu>

  const sectionTitle = useMemo(() => {
    if (path.startsWith('/ai-seo')) return 'AI SEO';
    if (path.startsWith('/billing')) return 'Billing';
    if (path.startsWith('/settings')) return 'Settings';
    return 'Dashboard';
  }, [path]);

  return (
    <AppProvider i18n={I18N}>
      {isEmbedded && <AdminNavMenu active={path} /> /* НЯМА TitleBar; само лявото меню */}
      <Frame
        navigation={isEmbedded ? undefined : <SideNav /> /* fallback локално */}
        topBar={<TopNav lang={lang} setLang={setLang} t={(k,d)=>d} />}
      >
        <Page>
          <AppHeader sectionTitle={sectionTitle} lang={lang} setLang={setLang} t={(k,d)=>d} />
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
