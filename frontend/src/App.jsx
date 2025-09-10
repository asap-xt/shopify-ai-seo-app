// Force rebuild: $(date +%s)

import React from 'react';
import '@shopify/polaris/build/esm/styles.css';
import { 
  AppProvider, Frame, Page, Card, Text, Box, 
  Button, Layout, BlockStack, InlineStack, Tabs
} from '@shopify/polaris';
import { useEffect, useState, useMemo } from 'react';
import { sessionFetch } from './lib/sessionFetch.js';

import AppHeader from './components/AppHeader.jsx';
import SideNav from './components/SideNav.jsx';
import BulkEdit from './pages/BulkEdit.jsx';
import Collections from './pages/Collections.jsx';
import Sitemap from './pages/Sitemap.jsx';
import StoreMetadata from './pages/StoreMetadata.jsx';
import SchemaData from './pages/SchemaData.jsx';
import Settings from './pages/Settings.jsx';
import useI18n from './hooks/useI18n.js';

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

// -------- Simple routing hook
function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  
  useEffect(() => {
    const handleLocationChange = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);
  
  return { path };
}

// -------- Admin left nav (App Bridge v4). Only <a> inside <ui-nav-menu>.
function AdminNavMenu({ active }) {
  const isDash = active === '/' || active.startsWith('/dashboard');
  const isSeo  = active.startsWith('/ai-seo');
  // const isStore = active.startsWith('/store-metadata');
  const isBill = active.startsWith('/billing');
  const isSett = active.startsWith('/settings');

  return (
    <ui-nav-menu>
      <a href="/dashboard" {...(isDash ? {'aria-current':'page'} : {})}>Dashboard</a>
      <a href="/ai-seo"    {...(isSeo  ? {'aria-current':'page'} : {})}>AI Search Optimisation</a>
      {/* <a href="/store-metadata" {...(isStore ? {'aria-current':'page'} : {})}>Store metadata</a> //*/}
      <a href="/billing"   {...(isBill ? {'aria-current':'page'} : {})}>Billing</a>
      <a href="/settings"  {...(isSett ? {'aria-current':'page'} : {})}>Settings</a>
    </ui-nav-menu>
  );
}

// -------- Dashboard
function DashboardCard() {
  const [plan, setPlan] = useState(null);
  const shop = qs('shop', '');

  useEffect(() => {
    if (!shop) return;
    fetch(`/plans/me?shop=${encodeURIComponent(shop)}`, { credentials: 'include' })
      .then(readJson)
      .then((data) => { if (data && !data.error) setPlan(data); })
      .catch((e) => console.error('Failed to load plan:', e));
  }, [shop]);

  // Ð•Ð´Ð½Ð¾ÐºÑ€Ð°Ñ‚Ð½Ð° Ð¸Ð½Ð¸Ñ†Ð¸Ð°Ð»Ð¸Ð·Ð°Ñ†Ð¸Ñ Ð½Ð° collection metafield definitions
  useEffect(() => {
    if (!shop) return;
    
    fetch(`/collections/check-definitions?shop=${encodeURIComponent(shop)}`, {
      credentials: 'include'
    })
      .then(r => r.json())
      .then(data => {

        // Ð¡ÑŠÐ·Ð´Ð°Ð¹ ÑÐ°Ð¼Ð¾ Ð»Ð¸Ð¿ÑÐ²Ð°Ñ‰Ð¸Ñ‚Ðµ definitions
        const existingKeys = (data.definitions || []).map(d => d.key);
        const requiredLangs = ['en', 'bg', 'fr'];
        const missingLangs = requiredLangs.filter(lang => !existingKeys.includes(`seo__${lang}`));
        
        if (missingLangs.length > 0) {
          return fetch('/collections/create-definitions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ shop, languages: missingLangs })
          });
        }
      })
      .then(r => r && r.json())

      .catch(err => console.error('Definitions error:', err));
  }, [shop]);

  if (!plan) {
    return (
      <Card>
        <Box padding="400">
          <Text>Loading plan info...</Text>
        </Box>
      </Card>
    );
  }

  return (
    <Card title="Dashboard">
      <Box padding="400">
        <InlineStack gap="800" wrap={false}>
          <Box>
            <Text variant="headingMd" as="h3">Current plan</Text>
            <Text>{plan.plan || 'Free'}</Text>
          </Box>
          <Box>
            <Text variant="headingMd" as="h3">Shop</Text>
            <Text>{plan.shop || 'â€”'}</Text>
          </Box>
          <Box>
            <Text variant="headingMd" as="h3">AI queries</Text>
            <Text>{plan.ai_queries_used || 0} / {plan.ai_queries_limit || 0}</Text>
          </Box>
          <Box>
            <Text variant="headingMd" as="h3">Product limit</Text>
            <Text>{plan.product_limit || 0}</Text>
          </Box>
        </InlineStack>
        <Box paddingBlockStart="400">
          <Text variant="headingMd" as="h3">Allowed AI providers</Text>
          <Text>{plan.providersAllowed?.join(', ') || 'None'}</Text>
        </Box>
        {plan.trial_ends_at && (
          <Box paddingBlockStart="400">
            <Text variant="headingMd" as="h3">Trial ends at</Text>
            <Text>{new Date(plan.trial_ends_at).toLocaleDateString()}</Text>
          </Box>
        )}
      </Box>
    </Card>
  );
}

// -------- Single Product Panel (original AiSeoPanel content) - Ð—ÐÐšÐžÐœÐ•ÐÐ¢Ð˜Ð ÐÐÐž
/*
function SingleProductPanel({ shop }) {
  // Form states
  const [productId, setProductId] = useState('');
  const [model, setModel] = useState('none'); // ÐŸÐ ÐžÐœÐ•ÐÐ•ÐÐž: Ð¥Ð°Ñ€Ð´ÐºÐ¾Ð´Ð½Ð°Ñ‚Ð¾ Ð·Ð° Ð»Ð¾ÐºÐ°Ð»Ð½Ð¾ Ð³ÐµÐ½ÐµÑ€Ð¸Ñ€Ð°Ð½Ðµ
  const [language, setLanguage] = useState('en');
  const [models, setModels] = useState([]); // Ð’ÐµÑ‡Ðµ Ð½Ðµ ÑÐµ Ð¸Ð·Ð¿Ð¾Ð»Ð·Ð²Ð°, Ð½Ð¾ Ð·Ð°Ð¿Ð°Ð·Ð²Ð°Ð¼Ðµ Ð·Ð° Ð±ÑŠÐ´ÐµÑ‰Ðµ
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [result, setResult] = useState(null);

  // Language handling states
  const [showLanguageSelector, setShowLanguageSelector] = useState(true);
  const [availableLanguages, setAvailableLanguages] = useState(['en']);
  const [shopLanguages, setShopLanguages] = useState([]);
  const [productLanguages, setProductLanguages] = useState([]);
  const [primaryLanguage, setPrimaryLanguage] = useState('en');

  // Ð—ÐÐšÐžÐœÐ•ÐÐ¢Ð˜Ð ÐÐÐž - Ð²ÐµÑ‡Ðµ Ð½Ðµ Ð¸Ð·Ð¿Ð¾Ð»Ð·Ð²Ð°Ð¼Ðµ AI Ð¼Ð¾Ð´ÐµÐ»Ð¸
  // Load models from /plans/me - ÐºÐ¾Ð¼ÐµÐ½Ñ‚Ð°Ñ€ Ð·Ð°Ð¿Ð°Ð·ÐµÐ½ Ð·Ð° Ð¸ÑÑ‚Ð¾Ñ€Ð¸Ñ

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
        console.error('Failed to load languages:', e);
        setShowLanguageSelector(true);
      }
    })();
    return () => { cancelled = true; };
  }, [shop, productId]);

  // Ð˜Ð½Ð¸Ñ†Ð¸Ð°Ð»Ð¸Ð·Ð¸Ñ€Ð°Ð¹ metafield definitions Ð·Ð° ÐºÐ¾Ð»ÐµÐºÑ†Ð¸Ð¸ Ð¿Ñ€Ð¸ Ð¿ÑŠÑ€Ð²Ð¾ Ð·Ð°Ñ€ÐµÐ¶Ð´Ð°Ð½Ðµ
  useEffect(() => {
    const s = shop || qs('shop', '');
    if (!s) return;
    
    // Ð˜Ð½Ð¸Ñ†Ð¸Ð°Ð»Ð¸Ð·Ð¸Ñ€Ð°Ð¹ metafield definitions Ð·Ð° ÐºÐ¾Ð»ÐµÐºÑ†Ð¸Ð¸
    fetch('/collections/init-metafields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ shop: s })
    })
    .then(r => r.json())

    .catch(err => console.error('Failed to init collection metafields:', err));
  }, [shop]);

  const handleGenerate = async () => {
    if (!shop || !productId) { // ÐŸÐ ÐžÐœÐ•ÐÐ•ÐÐž: ÐŸÑ€ÐµÐ¼Ð°Ñ…Ð½Ð°Ñ…Ð¼Ðµ Ð¿Ñ€Ð¾Ð²ÐµÑ€ÐºÐ°Ñ‚Ð° Ð·Ð° model
      setToast('Please fill in all fields');
      return;
    }
    setLoading(true);
    setToast('');
    setResult(null);

    try {
      const gid = toProductGID(productId);
      let response, data;

      if (language === 'all') {
        // Multi-language generation
        response = await fetch('/api/seo/generate-multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ 
            shop, 
            productId: gid, 
            model, 
            languages: availableLanguages 
          }),
        });
      } else {
        // Single language generation
        response = await fetch('/seo/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ shop, productId: gid, model, language }),
        });
      }

      data = await readJson(response);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      setResult(data);
      
      setToast('SEO generated successfully');
    } catch (e) {
      const msg = e?.message || 'Failed to generate SEO';
      setToast(msg);
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!shop || !result) {
      setToast('No SEO data to apply');
      return;
    }
    setLoading(true);
    setToast('');



    try {
      const gid = toProductGID(productId);
      let response, data;

      // Check if this is a multi-language result
      if (result.results && Array.isArray(result.results)) {
        // Multi-language apply
        const validResults = result.results
          .filter(r => r && r.seo)
          .map(r => ({
            language: r.language,
            seo: r.seo
          }));
          
        if (!validResults.length) {
          throw new Error('No valid SEO results to apply');
        }

        response = await fetch('/api/seo/apply-multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            shop,
            productId: gid,
            results: validResults,
            primaryLanguage,
            options: {
              updateTitle: true,
              updateBody: true,
              updateSeo: true,
              updateBullets: true,
              updateFaq: true,
            },
          }),
        });
      } else {
        // IMPORTANT FIX: Always use the language from dropdown since result doesn't have it
        const applyLanguage = language !== 'all' ? language : primaryLanguage;
        
        const isPrimary = applyLanguage.toLowerCase() === primaryLanguage.toLowerCase();
        
        const requestBody = {
          shop,
          productId: gid,
          seo: result.seo || result,
          language: applyLanguage,  // USE DROPDOWN LANGUAGE
          options: {
            updateTitle: isPrimary,
            updateBody: isPrimary,
            updateSeo: isPrimary,
            updateBullets: true,
            updateFaq: true,
          },
        };
        
        response = await fetch('/seo/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(requestBody),
        });
      }

      data = await readJson(response);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      
      // Show success with language info
      const appliedLangs = result.results 
        ? result.results.filter(r => r.seo).map(r => r.language).join(', ')
        : language;
      
      setToast(`SEO applied successfully for: ${appliedLangs.toUpperCase()}`);
    } catch (e) {
      const msg = e?.message || 'Failed to apply SEO';
      setToast(msg);
      console.error('Apply error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setResult(null);
    setToast('');
  };

  const languageOptions = showLanguageSelector
    ? [
        { label: 'All languages', value: 'all' },
        ...availableLanguages.map(l => ({ label: l.toUpperCase(), value: l }))
      ]
    : [];

  return (
    <>
      <Box paddingBlockEnd="400">
        <Card title="Generate SEO">
          <Box padding="400">
            <InlineStack gap="400" blockAlign="end">
              <TextField
                label="Product ID"
                value={productId}
                onChange={setProductId}
                placeholder="123456789 or gid://shopify/Product/123456789"
                autoComplete="off"
              />
              {showLanguageSelector && (
                <Select
                  label="Output Language"
                  options={languageOptions}
                  value={language}
                  onChange={setLanguage}
                />
              )}
              <Button primary onClick={handleGenerate} loading={loading}>
                Generate
              </Button>
              {result && (
                <>
                  <Button onClick={handleApply} loading={loading}>Apply</Button>
                  <Button onClick={handleClear}>Clear</Button>
                </>
              )}
            </InlineStack>
          </Box>
        </Card>
      </Box>

      <Box>
        <Card title="Result">
          <Box padding="400">
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {result ? pretty(result) : 'â€”'}
            </pre>
          </Box>
        </Card>
      </Box>

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </>
  );
}
*/

// -------- AI Search Optimisation Panel with Tabs
function AiSearchOptimisationPanel() {
  const shop = qs('shop', '');
  const [selectedTab, setSelectedTab] = useState(0);
  
  const tabs = [
    // Ð—ÐÐšÐžÐœÐ•ÐÐ¢Ð˜Ð ÐÐÐž Single Product Ñ‚Ð°Ð±
    // {
    //   id: 'single-product',
    //   content: 'Single Product',
    //   panelID: 'single-product-panel',
    // },
    {
      id: 'products',
      content: 'Products',
      panelID: 'products-panel',
    },
    {
      id: 'collections',
      content: 'Collections',
      panelID: 'collections-panel',
    },
    {
      id: 'sitemap',
      content: 'Sitemap',
      panelID: 'sitemap-panel',
    },
    {
      id: 'store-metadata',
      content: 'Store metadata for AI search',
      panelID: 'store-metadata-panel',
    },
    {
      id: 'schema-data',
      content: 'Schema Data',
      panelID: 'schema-data-panel',
    },
  ];
  
  return (
    <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
     {selectedTab === 0 ? (
      <BulkEdit shop={shop} />
    ) : selectedTab === 1 ? (
      <Collections shop={shop} />
    ) : selectedTab === 2 ? (
      <Sitemap shop={shop} />
    ) : selectedTab === 3 ? (
      <StoreMetadata shop={shop} />
    ) : (
      <SchemaData shop={shop} />
    )}
    </Tabs>
  );
}

const translations = {
  Polaris: {
    ResourceList: { sortingLabel: 'Sort by' }
  }
};

export default function App() {
  console.log('App component loaded!');
  
  // Всички hooks трябва да са в началото, БЕЗ условия
  const [isLoading, setIsLoading] = useState(true);
  const { path } = useRoute();
  const { lang, setLang, t } = useI18n();
  
  // След hooks можете да имате променливи
  const shop = qs('shop', '');
  const host = qs('host', '');
  const isEmbedded = !!(new URLSearchParams(window.location.search).get('host'));
  
  console.log('App params:', { shop, host, isEmbedded });

  useEffect(() => {
    console.log('App useEffect running...');
    const shop = qs('shop', '');
    const host = qs('host', '');
    
    console.log('About to call /api/auth with:', { shop, host });
    
    if (!shop || !host) {
      console.log('Missing shop or host, stopping auth check');
      setIsLoading(false);
      return;
    }
    
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop, host })
    })
    .then(r => {
      console.log('Auth response received, status:', r.status);
      return r.json();
    })
    .then(data => {
      console.log('Auth response data:', data);
      if (!data.success) {
        console.log('Auth failed, redirecting to:', data.redirectUrl);
        window.location.href = data.redirectUrl;
      } else {
        console.log('Auth successful, setting isLoading to false');
        setIsLoading(false);
      }
    })
    .catch((err) => {
      console.error('Auth request failed:', err);
      setIsLoading(false);
    });
  }, []);

  console.log('Before render check - isLoading:', isLoading);

  if (isLoading) {
    console.log('Returning Loading UI');
    return <div>Loading...</div>;
  }

  console.log('Rendering main app UI');

  return (
    <div style={{ padding: '20px' }}>
      <h1>Testing Polaris</h1>
      <AppProvider i18n={I18N}>
        <div>AppProvider works!</div>
        <Frame>
          <div>Frame works!</div>
          <Page>
            <div>Page works!</div>
            <Card>
              <Text>If you see this, Polaris is OK!</Text>
            </Card>
          </Page>
        </Frame>
      </AppProvider>
    </div>
  );

  /* ЗАКОМЕНТИРАНО - оригинален return блок
  const sectionTitle = useMemo(() => {
    if (path.startsWith('/ai-seo')) return 'AI Search Optimisation';
    if (path.startsWith('/billing')) return 'Billing';
    if (path.startsWith('/settings')) return 'Settings';
    return 'Dashboard';
  }, [path]);

  return (
    <AppProvider i18n={I18N}>
      {isEmbedded && <AdminNavMenu active={path} />}
      <Frame navigation={isEmbedded ? undefined : <SideNav />}>
        <Page>
          <AppHeader sectionTitle={sectionTitle} lang={lang} setLang={setLang} t={t} />
          {path.startsWith('/ai-seo') ? (
            <AiSearchOptimisationPanel />
          ) : path.startsWith('/billing') ? (
            <Card><Box padding="400"><Text>Billing page</Text></Box></Card>
          ) : path.startsWith('/settings') ? (
            <Settings />
          ) : (
            <DashboardCard />
          )}
        </Page>
      </Frame>
    </AppProvider>
  );
  */
}