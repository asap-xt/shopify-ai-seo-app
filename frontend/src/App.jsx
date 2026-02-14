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
import { devLog } from './utils/devLog.js';

import AppHeader from './components/AppHeader.jsx';
const Dashboard = React.lazy(() => import('./pages/Dashboard.jsx'));
const BulkEdit = React.lazy(() => import('./pages/BulkEdit.jsx'));
const Collections = React.lazy(() => import('./pages/Collections.jsx'));
const Sitemap = React.lazy(() => import('./pages/Sitemap.jsx'));
const StoreMetadata = React.lazy(() => import('./pages/StoreMetadata.jsx'));
const SchemaData = React.lazy(() => import('./pages/SchemaData.jsx'));
const Settings = React.lazy(() => {
  devLog('[APP] ===== LOADING SETTINGS COMPONENT =====');
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
    // - /apps/{subpath} (any app proxy subpath like indexaize, indexaize-staging, etc.)
    // - /indexaize-unlock-ai-search (production custom handle)
    const normalized = pathname
      .replace(/^\/apps\/[^/]+/, '') // Remove /apps/{subpath} prefix
      .replace(/^\/indexaize-unlock-ai-search/, '') // Remove custom handle prefix
      || '/';
    return normalized;
  };
  
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  
  useEffect(() => {
    const handleLocationChange = () => {
      const normalized = normalizePath(window.location.pathname);
      devLog('[useRoute] Location changed to:', normalized);
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

// -------- Admin left nav (App Bridge v4). Only <a> inside <ui-nav-menu>. Updated 2025-12-03.
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
      <a href={`/ai-seo${paramString}`}>Store Optimization for AI</a>
      <a href={`/settings${paramString}`}>AI Discovery Features</a>
      <a href={`/ai-testing${paramString}`}>AI Testing</a>
      <a href={`/billing${paramString}`}>Plans & Billing</a>
      <a href={`/clean-uninstall${paramString}`}>Clean & Uninstall</a>
      <a href={`/contact-support${paramString}`}>Contact Support</a>
    </ui-nav-menu>
  );
}


// -------- AI Search Optimisation Panel with Tabs
const AiSearchOptimisationPanel = React.memo(({ shop: shopProp, plan }) => {
  const shop = shopProp || qs('shop', '');
  const path = window.location.pathname;
  
  // Определи активния таб от URL - поддържа и /ai-seo и /ai-seo/products
  // CRITICAL: Also support paths with /apps/{subpath} prefix (from redirects after token purchase)
  const getActiveTab = () => {
    // Normalize path: remove /apps/{subpath} prefix if present (matches any app proxy subpath)
    const normalizedPath = path.replace(/^\/apps\/[^/]+/, '');
    
    if (normalizedPath === '/ai-seo' || normalizedPath === '/ai-seo/products') return 'products';
    if (normalizedPath === '/ai-seo/collections') return 'collections';
    if (normalizedPath === '/ai-seo/sitemap') return 'sitemap';
    if (normalizedPath === '/ai-seo/store-metadata') return 'store-metadata';
    if (normalizedPath === '/ai-seo/schema-data') return 'schema-data';
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
  // CRITICAL: Only use cached plan if it has language_limit (new format)
  // Old cached plans without language_limit will cause incorrect display
  const [plan, setPlan] = useState(() => {
    try {
      const cached = sessionStorage.getItem(`plan_${shop}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        // If cached plan doesn't have language_limit, it's stale - ignore it
        if (!parsed || typeof parsed.language_limit === 'undefined') {
          // Clear stale cache
          sessionStorage.removeItem(`plan_${shop}`);
          return null;
        }
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });
  // Removed forceBillingPage - backend (auth.js) now redirects to /billing directly
  // App is installed via Shopify Install Modal, no frontend install button needed

  // Token exchange logic
  useEffect(() => {
    devLog('[APP] useEffect triggered, shop:', shop, 'path:', window.location.pathname);
    
    const handleTokenExchange = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const shop = urlParams.get('shop');
      const idToken = urlParams.get('id_token');
      
      // Първо направи token exchange ако има id_token
      if (shop && idToken) {
        try {
          devLog('[APP] Performing initial token exchange for shop:', shop);
          
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
            const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
            devLog('[APP] Token exchange failed:', errorData);
            // Don't return - try to load data anyway
          } else {
            const result = await response.json();
            devLog('[APP] Token exchange successful');
            devLog('[APP] Token exchange successful:', result);
          }
          
          // Премахни id_token от URL
          const newUrl = new URL(window.location);
          newUrl.searchParams.delete('id_token');
          window.history.replaceState({}, '', newUrl);
          
          // Сега зареди данните
          await loadInitialData(shop);
          
        } catch (error) {
          devLog('[APP] Token exchange error:', error);
          // Fallback: Try to load data anyway
          if (shop) {
            devLog('[APP] Token exchange failed, trying to load data anyway...');
            await loadInitialData(shop);
          }
        }
      } else if (shop) {
        // Няма id_token, опитай се да заредиш данните директно
        await loadInitialData(shop);
      }
    };
    
    const loadInitialData = async (shop) => {
      devLog('[APP] loadInitialData called for shop:', shop);
      
      if (!shop) {
        devLog('[APP] No shop provided, cannot load data');
        return;
      }
      
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
              language_limit
              collection_limit
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
        
        const graphqlUrl = '/graphql';
        
        devLog('[APP] Making GraphQL request to /graphql for shop:', shop);
        devLog('[APP] Full URL:', window.location.href);
        devLog('[APP] GraphQL query:', Q);
        devLog('[APP] GraphQL variables:', { shop });
        devLog('[APP] Fetching from:', graphqlUrl);
        
        // Retry logic for CORS errors during App Bridge initialization
        const MAX_RETRIES = 5;
        const BASE_DELAY = 800;
        let plansResponse = null;
        let lastFetchError = null;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const fetchStartTime = Date.now();
            plansResponse = await fetch(graphqlUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: Q, variables: { shop } }),
            });
            const fetchDuration = Date.now() - fetchStartTime;
            devLog('[APP] GraphQL fetch completed, status:', plansResponse.status, 'duration:', fetchDuration + 'ms');
            break; // Success, exit retry loop
          } catch (fetchError) {
            lastFetchError = fetchError;
            const isCorsError = fetchError.message?.includes('Failed to fetch') || 
                               fetchError.message?.includes('NetworkError') ||
                               fetchError.message?.includes('CORS') ||
                               fetchError.message?.includes('access control') ||
                               fetchError.name === 'TypeError';
            
            if (isCorsError && attempt < MAX_RETRIES) {
              const retryDelay = BASE_DELAY * attempt;
              devLog(`[APP] CORS/Network error on attempt ${attempt}/${MAX_RETRIES}, retrying in ${retryDelay}ms...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              continue;
            }
            throw fetchError;
          }
        }
        
        if (!plansResponse) {
          throw lastFetchError || new Error('GraphQL fetch failed after retries');
        }
        
        devLog('[APP] GraphQL fetch successful after retries');
        
        if (plansResponse.status === 202) {
          // Token exchange required - но това не трябва да се случва ако token exchange е направен на сървъра
          // Ако стигнем до тук, значи има проблем - пренасочи към billing за да може user да избере план
          const errorData = await plansResponse.json().catch(() => ({}));
          devLog('[APP] Token exchange required (unexpected):', errorData);
          
          // Set default plan and redirect to billing
          const defaultPlan = {
            shop: shop,
            plan: null,
            planKey: null,
            subscriptionStatus: 'pending',
            product_limit: 0,
            language_limit: 0,
            collection_limit: 0,
            providersAllowed: [],
            modelsSuggested: [],
            trial: { active: false }
          };
          setPlan(defaultPlan);
          
          // Redirect to billing instead of OAuth (token exchange should have happened on server)
          const params = new URLSearchParams(window.location.search);
          const host = params.get('host');
          const embedded = params.get('embedded');
          const currentPath = window.location.pathname;
          const isAlreadyOnBilling = currentPath.includes('/billing');
          
          if (!isAlreadyOnBilling) {
            devLog('[APP] Redirecting to billing due to token exchange issue');
            window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host || '')}`;
          }
          return;
        }
        
        if (!plansResponse.ok) {
          const errorText = await plansResponse.text();
          devLog('[APP] Failed to load plans:', plansResponse.status, errorText);
          
          // Fallback: Set default plan and redirect to billing
          const defaultPlan = {
            shop: shop,
            plan: null,
            planKey: null,
            subscriptionStatus: 'pending',
            product_limit: 0,
            language_limit: 0,
            collection_limit: 0,
            providersAllowed: [],
            modelsSuggested: [],
            trial: { active: false }
          };
          setPlan(defaultPlan);
          
          // CRITICAL: Redirect to billing to prevent infinite loading
          const params = new URLSearchParams(window.location.search);
          const host = params.get('host');
          const embedded = params.get('embedded');
          const currentPath = window.location.pathname;
          const isAlreadyOnBilling = currentPath.includes('/billing');
          
          if (!isAlreadyOnBilling) {
            devLog('[APP] GraphQL failed, redirecting to billing');
            window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host || '')}`;
          }
          return;
        }
        
        // Заредени са плановете, запази ги в state
        const plansData = await plansResponse.json();
        devLog('[APP] GraphQL response data:', plansData);
        const pm = plansData?.data?.plansMe;
        if (pm) {
          devLog('[APP] Plan loaded successfully:', pm);
          setPlan(pm);
          // Persist plan in sessionStorage to survive React remounts
          try {
            sessionStorage.setItem(`plan_${shop}`, JSON.stringify(pm));
          } catch (e) {
            devLog('[APP] Failed to cache plan:', e);
          }
          
          // CRITICAL: Redirect to billing if subscription is pending
          // Note: Backend redirect only works on first install (OAuth flow)
          // On reinstall, Shopify skips OAuth and loads app directly → must check here
          const currentPath = window.location.pathname;
          const isAlreadyOnBilling = currentPath.includes('/billing');
          
          if ((pm.subscriptionStatus === 'pending' || !pm.plan) && !isAlreadyOnBilling) {
            devLog('[APP] No active subscription, redirecting to billing...');
            
            // Clear localStorage to reset Getting Started card state
            try {
              localStorage.removeItem(`onboardingOpen_${shop}`);
            } catch (e) {
              devLog('[APP] Failed to clear onboarding state:', e);
            }
            
            const params = new URLSearchParams(window.location.search);
            const host = params.get('host');
            const embedded = params.get('embedded');
            window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host)}`;
            return; // Stop execution
          }
        }
        
      } catch (error) {
        devLog('[APP] Error loading initial data:', error);
        
        // Fallback: Set default plan and redirect to billing to prevent infinite loading
        const shop = new URLSearchParams(window.location.search).get('shop');
        if (shop) {
          const defaultPlan = {
            shop: shop,
            plan: null,
            planKey: null,
            subscriptionStatus: 'pending',
            product_limit: 0,
            language_limit: 0,
            collection_limit: 0,
            providersAllowed: [],
            modelsSuggested: [],
            trial: { active: false }
          };
          setPlan(defaultPlan);
          
          // CRITICAL: Redirect to billing to prevent infinite loading
          const params = new URLSearchParams(window.location.search);
          const host = params.get('host');
          const embedded = params.get('embedded');
          const currentPath = window.location.pathname;
          const isAlreadyOnBilling = currentPath.includes('/billing');
          
          if (!isAlreadyOnBilling) {
            devLog('[APP] Exception caught, redirecting to billing');
            window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host || '')}`;
          }
        }
      }
    };
    
    handleTokenExchange();
  }, []);
  
  const sectionTitle = useMemo(() => {
    if (path.startsWith('/ai-seo')) return 'Store Optimization for AI';
    if (path.startsWith('/billing')) return 'Plans & Billing';
    if (path.startsWith('/settings')) return 'AI Discovery Features';
    if (path.startsWith('/ai-testing')) return 'AI Testing';
    if (path.startsWith('/clean-uninstall')) return 'Clean & Uninstall';
    if (path.startsWith('/contact-support')) return 'Contact Support';
    return 'Dashboard';
  }, [path]);


  // Обнови routing логиката да поддържа под-страници:
  const getPageComponent = () => {
    // Normalize path: remove /apps/{subpath} prefix if present (from redirects after token purchase)
    const normalizedPath = path.replace(/^\/apps\/[^/]+/, '');
    
    // Dashboard
    if (normalizedPath === '/' || normalizedPath === '/dashboard') {
      return <Dashboard shop={shop} />;
    } 
    // Store Optimization for AI и под-страници
    else if (normalizedPath.startsWith('/ai-seo')) {
      return <AiSearchOptimisationPanel shop={shop} plan={plan} />;
    } 
    // Billing
    else if (path === '/billing') {
      return <Billing shop={shop} />;
    } 
    // Settings
    else if (path === '/settings') {
      devLog('[APP] ===== RENDERING SETTINGS PAGE =====');
      return <Settings shop={shop} />;
    }
    // Contact Support
    else if (path === '/contact-support') {
      devLog('[APP] ===== RENDERING CONTACT SUPPORT PAGE =====');
      return <ContactSupport shop={shop} />;
    }
    // AI Testing
    else if (path === '/ai-testing') {
      devLog('[APP] ===== RENDERING AI TESTING PAGE =====');
      devLog('[APP] Path:', path);
      devLog('[APP] Shop:', shop);
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
  // Add timeout to prevent infinite loading if GraphQL fails
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  
  useEffect(() => {
    // If plan is not loaded after 5 seconds, set timeout flag
    const timer = setTimeout(() => {
      if (!plan) {
        devLog('[APP] Plan not loaded after 5 seconds, setting timeout flag');
        setLoadingTimeout(true);
      }
    }, 5000);
    
    return () => clearTimeout(timer);
  }, [plan]);
  
  if (!plan && !loadingTimeout) {
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
  
  // If timeout reached and no plan, show error or redirect to billing
  if (!plan && loadingTimeout) {
    devLog('[APP] Plan loading timeout - redirecting to billing');
    const params = new URLSearchParams(window.location.search);
    const shop = params.get('shop');
    const host = params.get('host');
    const embedded = params.get('embedded');
    
    // Set default plan to prevent infinite loop
    const defaultPlan = {
      shop: shop || '',
      plan: null,
      planKey: null,
      subscriptionStatus: 'pending',
      product_limit: 0,
      language_limit: 0,
      collection_limit: 0,
      providersAllowed: [],
      modelsSuggested: [],
      trial: { active: false }
    };
    
    // Only redirect if not already on billing page
    if (!window.location.pathname.includes('/billing') && shop) {
      window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host || '')}`;
    }
    
    // Show loading while redirecting
    return (
      <AppProvider i18n={I18N}>
        <Frame>
          <Page>
            <Box padding="400">
              <Text>Redirecting to billing...</Text>
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