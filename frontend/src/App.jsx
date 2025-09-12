// Force rebuild: $(date +%s)

import React from 'react';
import '@shopify/polaris/build/esm/styles.css';
import { 
  AppProvider, Frame, Page, Card, Text, Box, 
  Button, Layout, BlockStack, InlineStack, Tabs
} from '@shopify/polaris';
import { useEffect, useState, useMemo } from 'react';
import { useAppBridge } from './providers/AppBridgeProvider.jsx';
import { useShopApi } from './hooks/useShopApi.js';
import { makeSessionFetch } from './lib/sessionFetch.js';

import AppHeader from './components/AppHeader.jsx';
const BulkEdit = React.lazy(() => import('./pages/BulkEdit.jsx'));
const Collections = React.lazy(() => import('./pages/Collections.jsx'));
const Sitemap = React.lazy(() => import('./pages/Sitemap.jsx'));
const StoreMetadata = React.lazy(() => import('./pages/StoreMetadata.jsx'));
const SchemaData = React.lazy(() => import('./pages/SchemaData.jsx'));
const Settings = React.lazy(() => import('./pages/Settings.jsx'));
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
function AdminNavMenu({ active, shop }) {
  const isDash = active === '/' || active.startsWith('/dashboard');
  const isSeo = active.startsWith('/ai-seo');
  const isBill = active.startsWith('/billing');
  const isSett = active.startsWith('/settings');
  
  const currentParams = new URLSearchParams(window.location.search);
  const host = currentParams.get('host');
  
  const navParams = new URLSearchParams();
  if (shop) navParams.set('shop', shop);
  if (host) navParams.set('host', host);
  const paramString = navParams.toString() ? `?${navParams.toString()}` : '';

  // Използвай data-active вместо aria-current
  return (
    <ui-nav-menu>
      <a href={`/${paramString}`} rel="home">Home</a>
      <a href={`/dashboard${paramString}`} data-active={isDash ? "true" : undefined}>Dashboard</a>
      <a href={`/ai-seo${paramString}`} data-active={isSeo ? "true" : undefined}>AI SEO</a>
      <a href={`/billing${paramString}`} data-active={isBill ? "true" : undefined}>Billing</a>
      <a href={`/settings${paramString}`} data-active={isSett ? "true" : undefined}>Settings</a>
    </ui-nav-menu>
  );
}


// -------- Dashboard
const DashboardCard = React.memo(({ shop }) => {
  const [plan, setPlan] = useState(null);
  const { api } = useShopApi();
  const currentShop = shop || qs('shop', '');

  useEffect(() => {
    if (!currentShop) return;
    api(`/plans/me`, { shop: currentShop })
      .then((data) => { if (data && !data.error) setPlan(data); })
      .catch((e) => console.error('Failed to load plan:', e));
  }, [currentShop, api]);

  // Ð•Ð´Ð½Ð¾ÐºÑ€Ð°Ñ‚Ð½Ð° Ð¸Ð½Ð¸Ñ†Ð¸Ð°Ð»Ð¸Ð·Ð°Ñ†Ð¸Ñ Ð½Ð° collection metafield definitions
  useEffect(() => {
    if (!currentShop) return;

    // 1) Проверка на definitions със session token
    api(`/collections/check-definitions`, { shop: currentShop })
      .then(data => {

        // Ð¡ÑŠÐ·Ð´Ð°Ð¹ ÑÐ°Ð¼Ð¾ Ð»Ð¸Ð¿ÑÐ²Ð°Ñ‰Ð¸Ñ‚Ðµ definitions
        const existingKeys = (data.definitions || []).map(d => d.key);
        const requiredLangs = ['en', 'bg', 'fr'];
        const missingLangs = requiredLangs.filter(lang => !existingKeys.includes(`seo__${lang}`));
        
        if (missingLangs.length > 0) {
          // 2) Създай липсващите definitions със session token
          return api('/collections/create-definitions', {
            method: 'POST',
            shop: currentShop,
            body: { shop: currentShop, languages: missingLangs },
          });
        }
      })

      .catch(err => console.error('Definitions error:', err));
  }, [currentShop, api]);

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
});

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
        const j = await api(url, { shop: s });
        if (cancelled) return;

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
    api('/collections/init-metafields', {
      method: 'POST',
      shop: s,
      body: { shop: s }
    })
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
        response = await api('/api/seo/generate-multi', {
          method: 'POST',
          shop,
          body: { 
            shop, 
            productId: gid, 
            model, 
            languages: availableLanguages 
          }
        });
        
        // Проверка за валидни резултати
        if (response?.results && Array.isArray(response.results)) {
          const validResults = response.results.filter(r => r && r.seo && !r.error);
          if (validResults.length === 0) {
            throw new Error('No valid SEO data generated for any language');
          }
        }
      } else {
        // Single language generation
        response = await api('/seo/generate', {
          method: 'POST',
          shop,
          body: { shop, productId: gid, model, language }
        });
      }

      setResult(response);
      
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

        response = await api('/api/seo/apply-multi', {
          method: 'POST',
          shop,
          body: {
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
            }
          }
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
        
        response = await api('/seo/apply', {
          method: 'POST',
          shop,
          body: requestBody
        });
      }

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
const AiSearchOptimisationPanel = React.memo(() => {
  const shop = qs('shop', '');
  const [selectedTab, setSelectedTab] = useState(0);
  
  // Рендерирай съдържанието без Polaris Tabs компонент
  const renderContent = () => {
    switch(selectedTab) {
      case 0: return <BulkEdit shop={shop} />;
      case 1: return <Collections shop={shop} />;
      case 2: return <Sitemap shop={shop} />;
      case 3: return <StoreMetadata shop={shop} />;
      case 4: return <SchemaData shop={shop} />;
      default: return <BulkEdit shop={shop} />;
    }
  };
  
  // const tabs = [
    // Ð—ÐÐšÐžÐœÐ•ÐÐ¢Ð˜Ð ÐÐÐž Single Product Ñ‚Ð°Ð±
    // {
    //   id: 'single-product',
    //   content: 'Single Product',
    //   panelID: 'single-product-panel',
    // },
    // {
    //   id: 'products',
    //   content: 'Products',
    //   panelID: 'products-panel',
    // },
    // {
    //   id: 'collections',
    //   content: 'Collections',
    //   panelID: 'collections-panel',
    // },
    // {
    //   id: 'sitemap',
    //   content: 'Sitemap',
    //   panelID: 'sitemap-panel',
    // },
    // {
    //   id: 'store-metadata',
    //   content: 'Store metadata for AI search',
    //   panelID: 'store-metadata-panel',
    // },
    // {
    //   id: 'schema-data',
    //   content: 'Schema Data',
    //   panelID: 'schema-data-panel',
    // },
  // ];
  
  return (
    <div>
      {/* Custom tab navigation */}
      <div style={{ borderBottom: '1px solid #e1e3e5', marginBottom: '16px' }}>
        <InlineStack gap="0">
          <Button 
            primary={selectedTab === 0}
            onClick={() => setSelectedTab(0)}
          >
            Products
          </Button>
          <Button 
            primary={selectedTab === 1}
            onClick={() => setSelectedTab(1)}
          >
            Collections
          </Button>
          <Button 
            primary={selectedTab === 2}
            onClick={() => setSelectedTab(2)}
          >
            Sitemap
          </Button>
          <Button 
            primary={selectedTab === 3}
            onClick={() => setSelectedTab(3)}
          >
            Store metadata
          </Button>
          <Button 
            primary={selectedTab === 4}
            onClick={() => setSelectedTab(4)}
          >
            Schema Data
          </Button>
        </InlineStack>
      </div>
      
      {/* Tab content */}
      <div>
        {renderContent()}
      </div>
    </div>
  );
});

const translations = {
  Polaris: {
    ResourceList: { sortingLabel: 'Sort by' }
  }
};

export default function App() {
  const app = useAppBridge();
  const { path } = useRoute();
  const { lang, setLang, t } = useI18n();
  const isEmbedded = !!(new URLSearchParams(window.location.search).get('host'));
  const shop = qs('shop', '');
  
  const sectionTitle = useMemo(() => {
    if (path.startsWith('/ai-seo')) return 'AI SEO';
    if (path.startsWith('/billing')) return 'Billing';
    if (path.startsWith('/settings')) return 'Settings';
    return 'Dashboard';
  }, [path]);


  return (
    <AppProvider i18n={I18N}>
      {isEmbedded && <AdminNavMenu active={path} shop={shop} />}
      <Frame>
        <Page>
          <AppHeader sectionTitle={sectionTitle} lang={lang} setLang={setLang} t={t} shop={shop} />
          {path === '/' || path.startsWith('/dashboard') ? (
            <DashboardCard shop={shop} />
          ) : path.startsWith('/ai-seo') ? (
            <AiSearchOptimisationPanel shop={shop} />
          ) : path.startsWith('/billing') ? (
            <Card>
              <Box padding="400">
                <Text>Billing page</Text>
              </Box>
            </Card>
          ) : path.startsWith('/settings') ? (
            <Settings shop={shop} />
          ) : (
            <Card>
              <Box padding="400">
                <Text>Page not found: {path}</Text>
              </Box>
            </Card>
          )}
        </Page>
      </Frame>
    </AppProvider>
  );
}