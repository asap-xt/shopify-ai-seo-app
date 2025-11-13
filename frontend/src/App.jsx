// Force rebuild: $(date +%s) - Railway retry v2

import React from 'react';
import '@shopify/polaris/build/esm/styles.css';
import { 
  AppProvider, Frame, Page, Card, Text, Box, 
  Button, Layout, BlockStack, InlineStack, Tabs
} from '@shopify/polaris';
import { useEffect, useState, useMemo } from 'react';
// import { useAppBridge } from './providers/AppBridgeProvider.jsx'; // Removed - using App Bridge v4
import { useShopApi } from './hooks/useShopApi.js';
import { makeSessionFetch } from './lib/sessionFetch.js';
import { trackPageView, initGA4, initFBPixel } from './utils/analytics.js';

import AppHeader from './components/AppHeader.jsx';
const Dashboard = React.lazy(() => import('./pages/Dashboard.jsx'));
const BulkEdit = React.lazy(() => import('./pages/BulkEdit.jsx'));
const Collections = React.lazy(() => import('./pages/Collections.jsx'));
const Sitemap = React.lazy(() => import('./pages/Sitemap.jsx'));
const StoreMetadata = React.lazy(() => import('./pages/StoreMetadata.jsx'));
const SchemaData = React.lazy(() => import('./pages/SchemaData.jsx'));
const Settings = React.lazy(() => {
  console.log('[APP] ===== LOADING SETTINGS COMPONENT =====');
  return import('./pages/Settings.jsx');
});
const AiTesting = React.lazy(() => import('./pages/AiTesting.jsx'));
const Billing = React.lazy(() => import('./pages/Billing.jsx'));
const CleanUninstall = React.lazy(() => import('./pages/CleanUninstall.jsx'));
const ContactSupport = React.lazy(() => import('./pages/ContactSupport.jsx'));
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
  // Normalize path - remove app prefix for embedded apps
  const normalizePath = (pathname) => {
    // Remove app prefixes:
    // - /apps/new-ai-seo (dev)
    // - /apps/2749a2f6d38ff5796ed256b5c9dc70a1 (embedded)
    // - /indexaize-unlock-ai-search (production custom handle)
    const normalized = pathname
      .replace(/^\/apps\/[^/]+/, '') // Remove /apps/* prefix
      .replace(/^\/indexaize-unlock-ai-search/, '') // Remove custom handle prefix
      || '/';
    return normalized;
  };
  
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  
  useEffect(() => {
    const handleLocationChange = () => {
      const normalized = normalizePath(window.location.pathname);
      console.log('[useRoute] Location changed to:', normalized);
      setPath(normalized);
      
      // Track page view in GA4
      trackPageView(normalized);
    };
    
    // Listen for popstate (browser back/forward)
    window.addEventListener('popstate', handleLocationChange);
    
    // Poll for URL changes (needed for App Bridge navigation)
    // App Bridge changes the URL but doesn't always trigger popstate
    let lastPath = window.location.pathname;
    const checkPath = setInterval(() => {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        handleLocationChange();
      }
    }, 50); // Check every 50ms

    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      clearInterval(checkPath);
    };
  }, []);
  
  // Track initial page view
  useEffect(() => {
    initGA4();
    initFBPixel();
    trackPageView(path);
  }, []); // Only on mount
  
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

  return (
    <ui-nav-menu>
      <a href={`/${paramString}`} rel="home">Home</a>
      <a href={`/dashboard${paramString}`}>Dashboard</a>
      <a href={`/ai-seo${paramString}`}>Search Optimization for AI</a>
      <a href={`/settings${paramString}`}>Settings</a>
      <a href={`/ai-testing${paramString}`}>AI Testing</a>
      <a href={`/billing${paramString}`}>Plans & Billing</a>
      <a href={`/clean-uninstall${paramString}`}>Clean & Uninstall</a>
      <a href={`/contact-support${paramString}`}>Contact Support</a>
    </ui-nav-menu>
  );
}


// -------- Old Dashboard (replaced by pages/Dashboard.jsx)
/*
const DashboardCard = React.memo(({ shop }) => {
  const [plan, setPlan] = useState(null);
  const { api } = useShopApi();
  const currentShop = shop || qs('shop', '');
  const apiSession = useMemo(() => makeSessionFetch(), []);

  // локален помощник за GraphQL
  const runGQL = async (query, variables) => {
    const res = await apiSession('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (res?.errors?.length) throw new Error(res.errors[0]?.message || 'GraphQL error');
    return res?.data;
  };

  useEffect(() => {
    if (!currentShop) return;
    const Q = `
      query PlansMe($shop:String!) {
        plansMe(shop:$shop) {
          shop
          plan
          planKey
          priceUsd
          product_limit
          providersAllowed
          modelsSuggested
          autosyncCron
          trial {
            active
            ends_at
            days_left
          }
        }
      }
    `;
    runGQL(Q, { shop: currentShop })
      .then((d) => { const pm = d?.plansMe; if (pm) setPlan(pm); })
      .catch((e) => console.error('Failed to load plan via GraphQL:', e));
  }, [currentShop, apiSession]);

//   // Ð•Ð´Ð½Ð¾ÐºÑ€Ð°Ñ‚Ð½Ð° Ð¸Ð½Ð¸Ñ†Ð¸Ð°Ð»Ð¸Ð·Ð°Ñ†Ð¸Ñ Ð½Ð° collection metafield definitions
//   useEffect(() => {
//     if (!currentShop) return;
// 
//     // 1) Проверка на definitions със session token
//     api(`/collections/check-definitions?shop=${currentShop}`)
//       .then(data => {
// 
//         // Ð¡ÑŠÐ·Ð´Ð°Ð¹ ÑÐ°Ð¼Ð¾ Ð»Ð¸Ð¿ÑÐ²Ð°Ñ‰Ð¸Ñ‚Ðµ definitions
//         const existingKeys = (data.definitions || []).map(d => d.key);
//         const requiredLangs = ['en', 'bg', 'fr'];
//         const missingLangs = requiredLangs.filter(lang => !existingKeys.includes(`seo__${lang}`));
//         
//         if (missingLangs.length > 0) {
//           // 2) Създай липсващите definitions със session token
//           return api(`/collections/create-definitions?shop=${currentShop}`, {
//             method: 'POST',
//             body: { shop: currentShop, languages: missingLangs },
//           });
//         }
//       })
// 
//       .catch(err => console.error('Definitions error:', err));
//   }, [currentShop, api]);

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
            <Text>{plan.shop || 'â€"'}</Text>
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
  // Load models from GraphQL - старият /plans/me endpoint е премахнат

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
const AiSearchOptimisationPanel = React.memo(({ shop: shopProp, plan }) => {
  const shop = shopProp || qs('shop', '');
  const path = window.location.pathname;
  
  // Определи активния таб от URL - поддържа и /ai-seo и /ai-seo/products
  const getActiveTab = () => {
    if (path === '/ai-seo' || path === '/ai-seo/products') return 'products';
    if (path === '/ai-seo/collections') return 'collections';
    if (path === '/ai-seo/sitemap') return 'sitemap';
    if (path === '/ai-seo/store-metadata') return 'store-metadata';
    if (path === '/ai-seo/schema-data') return 'schema-data';
    return 'products'; // default
  };
  
  const activeTab = getActiveTab();
  
  // Функция за създаване на линкове с параметри
  const createTabLink = (tabPath) => {
    const params = new URLSearchParams(window.location.search);
    const paramString = params.toString() ? `?${params.toString()}` : '';
    
    // За products таба използвай само /ai-seo
    if (tabPath === 'products') {
      return `/ai-seo${paramString}`;
    }
    return `/ai-seo/${tabPath}${paramString}`;
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
  
  // Използвай обикновени <a> тагове вместо Button url
  return (
    <div>
      {/* Tab navigation */}
      <Box paddingBlockEnd="400">
        <Card>
          <Box padding="200">
            <InlineStack gap="100">
              <a 
                href={createTabLink('products')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  backgroundColor: activeTab === 'products' ? '#008060' : '#f6f6f7',
                  color: activeTab === 'products' ? 'white' : '#202223',
                  textDecoration: 'none',
                  display: 'inline-block'
                }}
              >
                Products
              </a>
              <a 
                href={createTabLink('collections')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  backgroundColor: activeTab === 'collections' ? '#008060' : '#f6f6f7',
                  color: activeTab === 'collections' ? 'white' : '#202223',
                  textDecoration: 'none',
                  display: 'inline-block'
                }}
              >
                Collections
              </a>
              <a 
                href={createTabLink('sitemap')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  backgroundColor: activeTab === 'sitemap' ? '#008060' : '#f6f6f7',
                  color: activeTab === 'sitemap' ? 'white' : '#202223',
                  textDecoration: 'none',
                  display: 'inline-block'
                }}
              >
                Sitemap
              </a>
              <a 
                href={createTabLink('store-metadata')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  backgroundColor: activeTab === 'store-metadata' ? '#008060' : '#f6f6f7',
                  color: activeTab === 'store-metadata' ? 'white' : '#202223',
                  textDecoration: 'none',
                  display: 'inline-block'
                }}
              >
                Store metadata
              </a>
              <a 
                href={createTabLink('schema-data')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  backgroundColor: activeTab === 'schema-data' ? '#008060' : '#f6f6f7',
                  color: activeTab === 'schema-data' ? 'white' : '#202223',
                  textDecoration: 'none',
                  display: 'inline-block'
                }}
              >
                Schema Data
              </a>
            </InlineStack>
          </Box>
        </Card>
      </Box>
      
      {/* Tab content */}
      <div>
        {activeTab === 'products' && <BulkEdit shop={shop} globalPlan={plan} />}
        {activeTab === 'collections' && <Collections shop={shop} globalPlan={plan} />}
        {activeTab === 'sitemap' && <Sitemap shop={shop} />}
        {activeTab === 'store-metadata' && <StoreMetadata shop={shop} />}
        {activeTab === 'schema-data' && <SchemaData shop={shop} />}
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
  // const app = useAppBridge(); // Removed - using App Bridge v4
  const { path } = useRoute();
  const { lang, setLang, t } = useI18n();
  const isEmbedded = !!(new URLSearchParams(window.location.search).get('host'));
  const shop = qs('shop', '');
  // Persist plan in sessionStorage to survive React remounts (StrictMode, navigation)
  const [plan, setPlan] = useState(() => {
    try {
      const cached = sessionStorage.getItem(`plan_${shop}`);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  // Removed forceBillingPage - backend (auth.js) now redirects to /billing directly
  // App is installed via Shopify Install Modal, no frontend install button needed

  // Token exchange logic
  useEffect(() => {
    const handleTokenExchange = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const shop = urlParams.get('shop');
      const idToken = urlParams.get('id_token');
      
      // Първо направи token exchange ако има id_token
      if (shop && idToken) {
        try {
          console.log('[APP] Performing initial token exchange for shop:', shop);
          
          const response = await fetch('/token-exchange', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              shop: shop,
              id_token: idToken
            })
          });

          if (!response.ok) {
            const errorData = await response.json();
            console.error('[APP] Token exchange failed:', errorData);
            return;
          }

          const result = await response.json();
          console.log('[APP] Token exchange successful:', result);
          
          // Премахни id_token от URL
          const newUrl = new URL(window.location);
          newUrl.searchParams.delete('id_token');
          window.history.replaceState({}, '', newUrl);
          
          // Сега зареди данните
          await loadInitialData(shop);
          
        } catch (error) {
          console.error('[APP] Token exchange error:', error);
        }
      } else if (shop) {
        // Няма id_token, опитай се да заредиш данните директно
        await loadInitialData(shop);
      }
    };
    
    const loadInitialData = async (shop) => {
      try {
        // Опитай се да заредиш планове през GraphQL
        const Q = `
          query PlansMe($shop:String!) {
            plansMe(shop:$shop) {
              shop
              plan
              planKey
              priceUsd
              product_limit
              providersAllowed
              modelsSuggested
              subscriptionStatus
              trial {
                active
                ends_at
                days_left
              }
            }
          }
        `;
        const plansResponse = await fetch('/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: Q, variables: { shop } }),
        });
        
        if (plansResponse.status === 202) {
          // Трябва token exchange
          const errorData = await plansResponse.json();
          if (errorData.error === 'token_exchange_required') {
            console.log('[APP] Token exchange required, but no id_token available');
            // Пренасочи към OAuth flow
            window.location.href = `/auth?shop=${encodeURIComponent(shop)}`;
            return;
          }
        }
        
        if (!plansResponse.ok) {
          console.error('[APP] Failed to load plans:', await plansResponse.text());
          return;
        }
        
        // Заредени са плановете, запази ги в state
        const plansData = await plansResponse.json();
        const pm = plansData?.data?.plansMe;
        if (pm) {
          setPlan(pm);
          // Persist plan in sessionStorage to survive React remounts
          try {
            sessionStorage.setItem(`plan_${shop}`, JSON.stringify(pm));
          } catch (e) {
            console.error('[APP] Failed to cache plan:', e);
          }
          
          // CRITICAL: Redirect to billing if subscription is pending
          // Note: Backend redirect only works on first install (OAuth flow)
          // On reinstall, Shopify skips OAuth and loads app directly → must check here
          const currentPath = window.location.pathname;
          const isAlreadyOnBilling = currentPath.includes('/billing');
          
          if ((pm.subscriptionStatus === 'pending' || !pm.plan) && !isAlreadyOnBilling) {
            console.log('[APP] No active subscription, redirecting to billing...');
            
            // Clear localStorage to reset Getting Started card state
            try {
              localStorage.removeItem(`onboardingOpen_${shop}`);
            } catch (e) {
              console.error('[APP] Failed to clear onboarding state:', e);
            }
            
            const params = new URLSearchParams(window.location.search);
            const host = params.get('host');
            const embedded = params.get('embedded');
            window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host)}`;
            return; // Stop execution
          }
        }
        
      } catch (error) {
        console.error('[APP] Error loading initial data:', error);
      }
    };
    
    handleTokenExchange();
  }, []);
  
  const sectionTitle = useMemo(() => {
    if (path.startsWith('/ai-seo')) return 'Search Optimization for AI';
    if (path.startsWith('/billing')) return 'Plans & Billing';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/ai-testing')) return 'AI Testing';
    if (path.startsWith('/clean-uninstall')) return 'Clean & Uninstall';
    if (path.startsWith('/contact-support')) return 'Contact Support';
    return 'Dashboard';
  }, [path]);


  // Обнови routing логиката да поддържа под-страници:
  const getPageComponent = () => {
    // Dashboard
    if (path === '/' || path === '/dashboard') {
      return <Dashboard shop={shop} />;
    } 
    // Search Optimization for AI и под-страници
    else if (path.startsWith('/ai-seo')) {
      return <AiSearchOptimisationPanel shop={shop} plan={plan} />;
    } 
    // Billing
    else if (path === '/billing') {
      return <Billing shop={shop} />;
    } 
    // Settings
    else if (path === '/settings') {
      console.log('[APP] ===== RENDERING SETTINGS PAGE =====');
      return <Settings shop={shop} />;
    }
    // Contact Support
    else if (path === '/contact-support') {
      console.log('[APP] ===== RENDERING CONTACT SUPPORT PAGE =====');
      return <ContactSupport shop={shop} />;
    }
    // AI Testing
    else if (path === '/ai-testing') {
      console.log('[APP] ===== RENDERING AI TESTING PAGE =====');
      console.log('[APP] Path:', path);
      console.log('[APP] Shop:', shop);
      return <AiTesting shop={shop} />;
    }
    // Clean & Uninstall
    else if (path === '/clean-uninstall') {
      return <CleanUninstall shop={shop} />;
    }
    // 404
    else {
      return (
        <Card>
          <Box padding="400">
            <Text variant="headingMd">Page not found</Text>
            <Box paddingBlockStart="200">
              <Text>The page "{path}" does not exist.</Text>
            </Box>
          </Box>
        </Card>
      );
    }
  };

  // CRITICAL: Show loading ONLY while plan data is being fetched (first load)
  // This prevents Dashboard from flashing before redirecting to Billing
  // Once plan is loaded, never show this loading screen again
  if (!plan) {
    return (
      <AppProvider i18n={I18N}>
        <Frame>
          <Page>
            <Box padding="400">
              <Text>Loading...</Text>
            </Box>
          </Page>
        </Frame>
      </AppProvider>
    );
  }

  return (
    <AppProvider i18n={I18N}>
      {isEmbedded && <AdminNavMenu active={path} shop={shop} />}
      <Frame>
        <Page>
          <AppHeader sectionTitle={sectionTitle} lang={lang} setLang={setLang} t={t} shop={shop} />
          {getPageComponent()}
        </Page>
      </Frame>
    </AppProvider>
  );
}