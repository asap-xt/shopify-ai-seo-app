// frontend/src/pages/Settings.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Card,
  Box,
  Text,
  Button,
  BlockStack,
  InlineStack,
  Checkbox,
  Banner,
  Modal,
  TextField,
  Divider,
  Icon,
  Link,
  Badge,
  Toast,
  Spinner,
  ProgressBar,
  InlineGrid
} from '@shopify/polaris';
import { ClipboardIcon, ExternalIcon, ViewIcon, ArrowDownIcon } from '@shopify/polaris-icons';
import { makeSessionFetch } from '../lib/sessionFetch.js';
import InsufficientTokensModal from '../components/InsufficientTokensModal.jsx';
import TrialActivationModal from '../components/TrialActivationModal.jsx';
import TokenPurchaseModal from '../components/TokenPurchaseModal.jsx';
import { PLAN_HIERARCHY_LOWERCASE, getPlanIndex } from '../hooks/usePlanHierarchy.js';
import { estimateTokens } from '../utils/tokenEstimates.js';

// Dev-only debug logger (hidden in production builds)
const isDev = import.meta.env.DEV;
const debugLog = (...args) => {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

export default function Settings() {
  
  // ===== 1. ÐšÐžÐÐ¡Ð¢ÐÐÐ¢Ð˜ Ð˜ HELPERS (Ð‘Ð•Ð— HOOKS) =====
  const qs = (k, d = '') => {
    try { return new URLSearchParams(window.location.search).get(k) || d; } 
    catch { return d; }
  };

  const normalizePlan = (plan) => {
    return (plan || 'starter').toLowerCase().replace(' ', '_');
  };

  // ===== 2. Ð˜Ð—Ð’Ð›Ð˜Ð§ÐÐÐ• ÐÐ shop =====
  const shop = qs('shop', '');

  // ===== 3. ВСИЧКИ useState HOOKS (ИЗВЪН try блок!) =====
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const [robotsTxt, setRobotsTxt] = useState('');
  const [showRobotsModal, setShowRobotsModal] = useState(false);
  const [toast, setToast] = useState('');
  const [toastTimeout, setToastTimeout] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);
  const [showViewButtons, setShowViewButtons] = useState(false);
  const [showProductsJsonView, setShowProductsJsonView] = useState(false);
  const [showCollectionsJsonView, setShowCollectionsJsonView] = useState(false);
  const [showStoreMetadataView, setShowStoreMetadataView] = useState(false);
  // const [showAiSitemapView, setShowAiSitemapView] = useState(false); // MOVED TO Sitemap.jsx
  const [showWelcomePageView, setShowWelcomePageView] = useState(false);
  const [showSchemaDataView, setShowSchemaDataView] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showNoBotsModal, setShowNoBotsModal] = useState(false);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [jsonModalTitle, setJsonModalTitle] = useState('');
  const [jsonModalContent, setJsonModalContent] = useState(null);
  const [jsonModalFeature, setJsonModalFeature] = useState(null); // Track which feature is being viewed
  const [loadingJson, setLoadingJson] = useState(false);
  const [originalSettings, setOriginalSettings] = useState(null);
  const [advancedSchemaEnabled, setAdvancedSchemaEnabled] = useState(false);
  
  // Insufficient Tokens Modal state
  const [showInsufficientTokensModal, setShowInsufficientTokensModal] = useState(false);
  const [showTrialActivationModal, setShowTrialActivationModal] = useState(false);
  const [showTokenPurchaseModal, setShowTokenPurchaseModal] = useState(false);
  const [tokenModalData, setTokenModalData] = useState({
    feature: '',
    tokensRequired: 0,
    tokensAvailable: 0,
    tokensNeeded: 0
  });
  const [tokenError, setTokenError] = useState(null);
  const [processingSchema, setProcessingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState('');
  const [advancedSchemaStatus, setAdvancedSchemaStatus] = useState({
    enabled: false,
    generating: false,
    generated: false,
    progress: ''
  });
  const [showSchemaErrorModal, setShowSchemaErrorModal] = useState(false);
  const [schemaErrorType, setSchemaErrorType] = useState(null); // 'NO_OPTIMIZED_PRODUCTS' or 'ONLY_BASIC_SEO'
  
  // AI Sitemap background generation status - MOVED TO Sitemap.jsx
  // const [sitemapStatus, setSitemapStatus] = useState({
  //   inProgress: false,
  //   status: 'idle',
  //   message: null,
  //   position: null,
  //   estimatedTime: null,
  //   generatedAt: null,
  //   productCount: 0
  // });
  // const [sitemapPollingInterval, setSitemapPollingInterval] = useState(null);
  
  // Advanced Schema background generation status (same as sitemap)
  const [schemaStatus, setSchemaStatus] = useState({
    inProgress: false,
    status: 'idle', // idle, queued, processing, completed, failed
    message: null,
    position: null,
    estimatedTime: null,
    generatedAt: null,
    schemaCount: 0
  });
  const [schemaPollingInterval, setSchemaPollingInterval] = useState(null);
  
  // DEPRECATED: Old schema generation states (kept for backward compatibility with old code)
  const [schemaGenerating, setSchemaGenerating] = useState(false);
  const [schemaComplete, setSchemaComplete] = useState(false);
  const [schemaProgress, setSchemaProgress] = useState({
    current: 0,
    total: 0,
    percent: 0,
    currentProduct: '',
    stats: {
      siteFAQ: false,
      products: 0,
      totalSchemas: 0
    }
  });
  
  // ===== 4. API MEMO =====
  const api = useMemo(() => makeSessionFetch(), []);
  
  
  
  // ===== 6. Ð“Ð›ÐÐ’ÐÐÐ¢Ð Ð¤Ð£ÐÐšÐ¦Ð˜Ð¯ (Ð¡Ð›Ð•Ð” helper Ñ„ÑƒÐ½ÐºÑ†Ð¸Ð¸Ñ‚Ðµ) =====
  // Ð’ÐÐ–ÐÐž: ÐœÐ°Ñ…Ð½Ð¸ 'shop' Ð¾Ñ‚ dependencies Ñ‚ÑƒÐº - Ð²ÐµÑ‡Ðµ Ðµ Ð² Ð¿Ð¾Ð¼Ð¾Ñ‰Ð½Ð¸Ñ‚Ðµ Ñ„ÑƒÐ½ÐºÑ†Ð¸Ð¸
  
  // ===== 7. useEffect (ÐŸÐžÐ¡Ð›Ð•Ð”Ð•Ð) =====
  
  // Auto-clear toast after 5 seconds
  useEffect(() => {
    if (toast) {
      // Clear existing timeout
      if (toastTimeout) {
        clearTimeout(toastTimeout);
      }
      
      // Set new timeout to clear toast after 5 seconds
      const timeout = setTimeout(() => {
        setToast('');
      }, 5000);
      
      setToastTimeout(timeout);
    }
  }, [toast]);
  
  // AI Sitemap polling functions - MOVED TO Sitemap.jsx
  // const fetchSitemapStatus = useCallback(async () => { ... });
  // const startSitemapPolling = useCallback(() => { ... });
  // useEffect cleanup for sitemapPollingInterval - removed
  
  // Function to fetch schema status from backend (same as sitemap)
  const fetchSchemaStatus = useCallback(async () => {
    try {
      const status = await api(`/api/schema/status?shop=${shop}`);
      
      setSchemaStatus({
        inProgress: status.inProgress || false,
        status: status.status || 'idle',
        message: status.message || null,
        position: status.queue?.position || null,
        estimatedTime: status.queue?.estimatedTime || null,
        generatedAt: status.schema?.generatedAt || null,
        schemaCount: status.schema?.schemaCount || 0
      });
      
      // If completed, stop polling and uncheck the checkbox
      if (status.status === 'completed' && !status.inProgress) {
        if (schemaPollingInterval) {
          clearInterval(schemaPollingInterval);
          setSchemaPollingInterval(null);
        }
        
        // Always uncheck the schemaData checkbox after successful generation
        setSettings(prev => ({
          ...prev,
          features: {
            ...prev.features,
            schemaData: false
          }
        }));
        
        // Show success toast only once (when transitioning from inProgress to completed)
        if (schemaStatus.inProgress) {
          setToast(`Advanced Schema Data generated successfully! (${status.schema?.schemaCount || 0} schemas)`);
        }
      }
      
      // If failed, check if there's a newer successful generation
      if (status.status === 'failed') {
        // Check if schema was generated AFTER the failure (user retried with forceBasicSeo)
        const failedAt = status.shopStatus?.failedAt ? new Date(status.shopStatus.failedAt) : null;
        const generatedAt = status.schema?.generatedAt ? new Date(status.schema.generatedAt) : null;
        
        // If schema exists and was generated after the failure, treat as success
        if (status.schema?.exists && generatedAt && failedAt && generatedAt > failedAt) {
          // This is actually a success - a new generation completed after the failure
          if (schemaPollingInterval) {
            clearInterval(schemaPollingInterval);
            setSchemaPollingInterval(null);
          }
          
          // Always uncheck the schemaData checkbox after successful generation
          setSettings(prev => ({
            ...prev,
            features: {
              ...prev.features,
              schemaData: false
            }
          }));
          
          // Show success toast only once (when transitioning from inProgress to completed)
          if (schemaStatus.inProgress) {
            setToast(`Advanced Schema Data generated successfully! (${status.schema?.schemaCount || 0} schemas)`);
          }
          return status;
        }
        
        // It's a real failure - stop polling and show appropriate error modal
        if (schemaPollingInterval) {
          clearInterval(schemaPollingInterval);
          setSchemaPollingInterval(null);
        }
        
        // Check for specific error types and show modals
        if (status.message === 'NO_OPTIMIZED_PRODUCTS') {
          setSchemaErrorType('NO_OPTIMIZED_PRODUCTS');
          setShowSchemaErrorModal(true);
        } else if (status.message === 'ONLY_BASIC_SEO') {
          setSchemaErrorType('ONLY_BASIC_SEO');
          setShowSchemaErrorModal(true);
        } else {
          // Generic error toast
          setToast(`Advanced Schema Data generation failed: ${status.message || 'Unknown error'}`);
        }
      }
      
      return status;
    } catch (error) {
      console.error('[SETTINGS] Failed to fetch schema status:', error);
    }
  }, [shop, api, schemaPollingInterval, schemaStatus.inProgress]);
  
  // Function to start polling for schema status
  const startSchemaPolling = useCallback(() => {
    // Clear any existing polling
    if (schemaPollingInterval) {
      clearInterval(schemaPollingInterval);
    }
    
    // Poll immediately
    fetchSchemaStatus();
    
    // Then poll every 10 seconds
    const interval = setInterval(() => {
      fetchSchemaStatus();
    }, 10000); // 10 seconds
    
    setSchemaPollingInterval(interval);
  }, [fetchSchemaStatus, schemaPollingInterval]);
  
  // Cleanup schema polling on unmount
  useEffect(() => {
    return () => {
      if (schemaPollingInterval) {
        clearInterval(schemaPollingInterval);
      }
    };
  }, [schemaPollingInterval]);
  
  // Start polling on mount if sitemap is generating - MOVED TO Sitemap.jsx
  // useEffect(() => {
  //   if (shop && !sitemapPollingInterval) {
  //     fetchSitemapStatus().then(status => {
  //       if (status?.inProgress) {
  //         startSitemapPolling();
  //       }
  //     });
  //   }
  // }, [shop]);
  
  // Start polling on mount if schema is generating
  useEffect(() => {
    if (shop && !schemaPollingInterval) {
      fetchSchemaStatus().then(status => {
        if (status?.inProgress) {
          startSchemaPolling();
        }
      });
    }
  }, [shop]); // Only run on mount
  
  // DEPRECATED: Old polling function - MOVED TO Sitemap.jsx
  // const startPollingForCompletion = () => { ... };
  
  // ===== 4. API MEMO (ÐŸÐ Ð•Ð”Ð˜ Ð´Ð° ÑÐµ Ð¸Ð·Ð¿Ð¾Ð»Ð·Ð²Ð° Ð² useCallback) =====
  
  // ===== 5. HELPER Ð¤Ð£ÐÐšÐ¦Ð˜Ð˜ (ÐºÐ¾Ð¸Ñ‚Ð¾ ÐÐ• Ð—ÐÐ’Ð˜Ð¡Ð¯Ð¢ Ð¾Ñ‚ Ð´Ñ€ÑƒÐ³Ð¸ callbacks) =====
  const checkProductsData = useCallback(async () => {
    try {
      
      // Use API endpoint instead of GraphQL
      const result = await api(`/api/products/list?shop=${shop}&limit=10&optimized=true`);
      
      
      // Check if any product has optimized languages
      const hasOptimizedProducts = result?.products?.some(product => 
        product?.optimizationSummary?.optimizedLanguages?.length > 0
      );
      
      return hasOptimizedProducts;
    } catch (error) {
      console.error('[SETTINGS] Error checking products data:', error);
      return false;
    }
  }, [shop, api]);

  const checkCollectionsData = useCallback(async () => {
    try {
      
      // Use API endpoint instead of GraphQL
      const result = await api(`/collections/list-graphql?shop=${shop}`);
      
      
      // Check if any collection has optimized languages
      const hasOptimizedCollections = result?.collections?.some(collection => 
        collection?.optimizedLanguages?.length > 0
      );
      
      return hasOptimizedCollections;
    } catch (error) {
      console.error('[SETTINGS] Error checking collections data:', error);
      return false;
    }
  }, [shop, api]);

  const checkStoreMetadata = useCallback(async () => {
    try {
      
      const STORE_METADATA_CHECK_QUERY = `
        query CheckStoreMetadata($shop: String!) {
          storeMetadata(shop: $shop) {
            shopName
            description
          }
        }
      `;
      
      
      const result = await api('/graphql', {
        method: 'POST',
        body: JSON.stringify({
          query: STORE_METADATA_CHECK_QUERY,
          variables: { shop }
        }),
        shop: shop
      });
      
      
      const hasMetadata = !!result?.data?.storeMetadata?.shopName;
      
      return hasMetadata;
    } catch (error) {
      console.error('[SETTINGS] Error checking store metadata:', error);
      console.error('[SETTINGS] Error details:', error?.message, error?.stack);
      return false;
    }
  }, [shop, api]);

  const checkWelcomePage = useCallback(async () => {
    try {
      // Check if welcome page endpoint is accessible (fetch directly, like in viewJson)
      const response = await fetch(`/ai/welcome?shop=${shop}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`
        }
      });
      
      if (response.ok) {
        const htmlContent = await response.text();
        // If we get HTML content with DOCTYPE, the page exists
        return htmlContent.includes('<!DOCTYPE html>') || htmlContent.includes('<!doctype html>');
      }
      
      return false;
    } catch (error) {
      console.error('[SETTINGS] Error checking welcome page:', error);
      return false;
    }
  }, [shop]);

  // ===== 6. ГЛАВНАТА ФУНКЦИЯ =====
  const checkGeneratedData = useCallback(async () => {
    try {
      
      // Check Products JSON Feed
      if (settings?.features?.productsJson) {
        const hasProductsData = await checkProductsData();
        setShowProductsJsonView(hasProductsData);
      } else {
      }
      
      // Check Collections JSON Feed  
      if (settings?.features?.collectionsJson) {
        const hasCollectionsData = await checkCollectionsData();
        setShowCollectionsJsonView(hasCollectionsData);
      } else {
      }
      
      // Check Store Metadata
      if (settings?.features?.storeMetadata) {
        
        const hasStoreMetadata = await checkStoreMetadata();
        
        
        setShowStoreMetadataView(hasStoreMetadata);
        
      } else {
      }
      
      // Check Welcome Page
      if (settings?.features?.welcomePage) {
        const hasWelcomePage = await checkWelcomePage();
        setShowWelcomePageView(hasWelcomePage);
      } else {
        setShowWelcomePageView(false);
      }
      
    } catch (error) {
      console.error('[SETTINGS] Error checking generated data:', error);
    }
  }, [settings?.features, checkProductsData, checkCollectionsData, checkStoreMetadata, checkWelcomePage]);
  
  // Debug useEffect dependencies
  useEffect(() => {
  }, [settings?.features, checkProductsData, checkCollectionsData, checkStoreMetadata, checkWelcomePage]);
  

  // --- GraphQL helper for this page (minimal, local) ---
  const runGQL = async (query, variables) => {
    debugLog('[SETTINGS][DEBUG] runGQL called with query:', query);
    debugLog('[SETTINGS][DEBUG] runGQL variables:', variables);
    
    const body = JSON.stringify({ query, variables });
    debugLog('[SETTINGS][DEBUG] runGQL body:', body);
    
    const res = await api('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });
    
    debugLog('[SETTINGS][DEBUG] runGQL response:', res);
    
    if (res?.errors?.length) {
      console.error(`[DEBUG] GraphQL errors:`, res.errors);
      throw new Error(res.errors[0]?.message || 'GraphQL error');
    }
    return res?.data;
  };
  

  
  useEffect(() => {
    
    if (!shop) {
      setLoading(false);
      return;
    }
    
    loadSettings();
  }, [shop, api]);
  


  // Check schema status when enabled
  useEffect(() => {
    if (advancedSchemaEnabled) {
      checkSchemaStatus();
    }
  }, [advancedSchemaEnabled]);

  // Auto-enable AI Discovery when features are selected
  useEffect(() => {
    if (false && settings && Object.values(settings.features || {}).some(f => f)) { // DISABLED: This was causing features to be auto-enabled on first load
      // ÐÐ²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ñ‡Ð½Ð¾ Ð²ÐºÐ»ÑŽÑ‡Ð²Ð°Ð¼Ðµ AI Discovery Ð°ÐºÐ¾ Ð¸Ð¼Ð° Ð¸Ð·Ð±Ñ€Ð°Ð½Ð¸ features
      setSettings(prev => ({
        ...prev,
        enabled: true,
        discoveryEnabled: true
      }));
    }
  }, [settings?.features]);

  const checkSchemaStatus = async () => {
    try {
      const data = await api(`/api/schema/status?shop=${shop}`);
      setAdvancedSchemaStatus({
        enabled: data.enabled,
        generating: data.generating,
        generated: data.hasSiteFAQ || data.productsWithSchema > 0,
        progress: data.progress || ''
      });
    } catch (error) {
      console.error('Failed to check schema status:', error);
    }
  };

  // Check generation progress - Fixed infinite loop issue with state sync
  // Use ref to track if we should keep checking (avoids closure issues)
  const isGeneratingRef = useRef(false);
  const checkCountRef = useRef(0);
  const maxChecks = 30; // Maximum 30 checks (90 seconds)
  
  const checkGenerationProgress = useCallback(async () => {
    debugLog('[PROGRESS-CHECK] Starting check...');
    debugLog('[PROGRESS-CHECK] isGeneratingRef.current:', isGeneratingRef.current);
    debugLog('[PROGRESS-CHECK] checkCountRef.current:', checkCountRef.current);
    
    // Safety: Don't check if we're not generating
    if (!isGeneratingRef.current) {
      debugLog('[PROGRESS-CHECK] Not generating (ref is false), stopping check');
      return;
    }
    
    // Increment check counter
    checkCountRef.current++;
    
    // Check if we've exceeded maximum checks (90 seconds)
    if (checkCountRef.current > 30) {
      debugLog('[PROGRESS-CHECK] ⏰ Maximum checks reached, stopping');
      isGeneratingRef.current = false;
      checkCountRef.current = 0;
      setSchemaGenerating(false);
      setToast('Schema generation timed out. Please check if data was generated.');
      return;
    }
    
    try {
      // Check generation status from backend
      const statusData = await api(`/api/schema/status?shop=${shop}`);
      debugLog('[PROGRESS-CHECK] Status data:', statusData);
      
      // Check for errors (e.g., no optimized products, only basic SEO, trial restriction, insufficient tokens)
      if (statusData.error === 'NO_OPTIMIZED_PRODUCTS' || statusData.error === 'ONLY_BASIC_SEO') {
        debugLog('[PROGRESS-CHECK] ❌ Schema error:', statusData.error);
        
        // Stop checking
        isGeneratingRef.current = false;
        checkCountRef.current = 0;
        setSchemaGenerating(false);
        
        // Show modal with appropriate options
        setToast(null); // Clear any previous toasts
        setSchemaErrorType(statusData.error);
        setShowSchemaErrorModal(true);
        
        return; // Stop checking
      }
      
      // Check for TRIAL_RESTRICTION error
      if (statusData.error === 'TRIAL_RESTRICTION') {
        // Stop checking
        isGeneratingRef.current = false;
        checkCountRef.current = 0;
        setSchemaGenerating(false);
        
        // Show toast and redirect to billing (same as AI Sitemap behavior)
        setToast(statusData.errorMessage || 'Advanced Schema Data is locked during trial. Please activate your plan to use included tokens.');
        
        // Navigate to billing page after 2 seconds
        setTimeout(() => {
          const params = new URLSearchParams(window.location.search);
          const host = params.get('host');
          const embedded = params.get('embedded');
          window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host)}`;
        }, 2000);
        
        return; // Stop checking
      }
      
      // Check for INSUFFICIENT_TOKENS error
      if (statusData.error === 'INSUFFICIENT_TOKENS') {
        // Stop checking
        isGeneratingRef.current = false;
        checkCountRef.current = 0;
        setSchemaGenerating(false);
        
        // Show toast message
        setToast(statusData.errorMessage || 'Insufficient token balance for Advanced Schema generation. Please purchase tokens.');
        
        return; // Stop checking
      }
      
      // Check the new dataReady flag - this is the source of truth
      if (statusData.dataReady) {
        // Data is ready, generation is complete
        debugLog('[PROGRESS-CHECK] ✅ Data is ready! Generation complete!');
        
        // Stop checking
        isGeneratingRef.current = false;
        checkCountRef.current = 0;
        setSchemaGenerating(false);
        setSchemaComplete(true);
        
        // Update progress to 100%
        setSchemaProgress(prev => ({
          ...prev,
          percent: 100,
          currentProduct: 'Complete!',
          stats: {
            siteFAQ: statusData.hasSiteFAQ || false,
            products: statusData.productsWithSchema || 0,
            totalSchemas: statusData.productsWithSchema || 0
          }
        }));
        
        return; // Stop checking
      }
      
      // Check if still generating
      if (statusData.generating) {
        debugLog('[PROGRESS-CHECK] Still generating, updating progress...');
        
        // Parse progress percentage
        let progressPercent = 0;
        if (statusData.progress) {
          const match = statusData.progress.match(/(\d+)%/);
          if (match) {
            progressPercent = parseInt(match[1]);
          }
        }
        
        // Ensure progress doesn't go backwards
        setSchemaProgress(prev => ({
          ...prev,
          percent: Math.max(prev.percent, progressPercent),
          currentProduct: statusData.currentProduct || `Processing... (${checkCountRef.current}/30)`
        }));
        
        // Check again in 3 seconds
        setTimeout(() => {
          if (isGeneratingRef.current) {
            checkGenerationProgress();
          }
        }, 3000);
        
      } else {
        // Not generating and no data ready - might be an error state
        debugLog('[PROGRESS-CHECK] ⚠️ Not generating but no data ready');
        
        // Try one more time to check for data directly
        try {
          const finalData = await api(`/ai/schema-data.json?shop=${shop}`);
          
            if (finalData && finalData.schemas && finalData.schemas.length > 0) {
              debugLog('[PROGRESS-CHECK] Found data on direct check!');
            
            // Mark as complete
            isGeneratingRef.current = false;
            checkCountRef.current = 0;
            setSchemaGenerating(false);
            setSchemaComplete(true);
            
            // Calculate statistics
            const products = [...new Set(finalData.schemas.map(s => 
              s.url?.split('/products/')[1]?.split('#')[0]
            ))].filter(Boolean);
            
            setSchemaProgress(prev => ({
              ...prev,
              percent: 100,
              currentProduct: 'Complete!',
              stats: {
                siteFAQ: finalData.siteFAQ ? true : false,
                products: products.length,
                totalSchemas: finalData.schemas.length
              }
            }));
            
          } else {
            // No data found - generation might have failed
            debugLog('[PROGRESS-CHECK] No data found, generation may have failed');
            isGeneratingRef.current = false;
            checkCountRef.current = 0;
            setSchemaGenerating(false);
            setToast('Schema generation may have failed. Please try again.');
          }
        } catch (err) {
          console.error('[PROGRESS-CHECK] Error checking for final data:', err);
          isGeneratingRef.current = false;
          checkCountRef.current = 0;
          setSchemaGenerating(false);
          setToast('Unable to verify schema generation status.');
        }
      }
      
    } catch (err) {
      console.error('[PROGRESS-CHECK] ❌ Error:', err);
      
      // On error, retry a few times before giving up
      if (checkCountRef.current < 5) {
        debugLog('[PROGRESS-CHECK] Retrying after error...');
        setTimeout(() => {
          if (isGeneratingRef.current) {
            checkGenerationProgress();
          }
        }, 5000);
      } else {
        // Too many errors, stop checking
        isGeneratingRef.current = false;
        checkCountRef.current = 0;
        setSchemaGenerating(false);
        setToast('Error checking generation status. Please refresh and try again.');
      }
    }
  }, [api, shop]);

  const loadSettings = async () => {
    try {
      
      const data = await api(`/api/ai-discovery/settings?shop=${shop}`);
      
      
      // Debug: Check if any features are true
      const trueFeatures = Object.entries(data?.features || {}).filter(([key, value]) => value === true);
      
      // If AI Sitemap already exists, uncheck the checkbox to prevent accidental re-generation
      if (data.hasAiSitemap && data.features?.aiSitemap) {
        data.features.aiSitemap = false;
      }
      
      // If Advanced Schema already exists, uncheck the checkbox to prevent accidental re-generation
      if (data.hasAdvancedSchema && data.features?.schemaData) {
        data.features.schemaData = false;
      }
      
      setSettings(data);
      setOriginalSettings(data); // Save original settings
      
      // Set Advanced Schema enabled state
      setAdvancedSchemaEnabled(data.advancedSchemaEnabled || false);
      
      // Show AI Sitemap View button - MOVED TO Sitemap.jsx
      // if (data.hasAiSitemap) {
      //   setShowAiSitemapView(true);
      // }
      
      // Generate robots.txt preview
      generateRobotsTxt(data);
      
    } catch (error) {
      console.error('[SETTINGS] ===== LOAD SETTINGS ERROR =====');
      console.error('[SETTINGS] Failed to load settings:', error);
      setToast('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const generateRobotsTxt = async (currentSettings = settings) => {
    debugLog('[GENERATE ROBOTS] Called with shop:', shop);
    
    try {
      const txt = await api(`/api/ai-discovery/robots-txt?shop=${shop}`, { 
        responseType: 'text'  // <-- Ð’Ð°Ð¶Ð½Ð¾!
      });
      
      debugLog('[GENERATE ROBOTS] Received:', txt);
      
      // ÐÐºÐ¾ Ðµ Ð¿Ñ€Ð°Ð·ÐµÐ½ Ð¾Ñ‚Ð³Ð¾Ð²Ð¾Ñ€ (304), Ð³ÐµÐ½ÐµÑ€Ð¸Ñ€Ð°Ð¹ Ð±Ð°Ð·Ð¾Ð² robots.txt
      if (!txt) {
        const defaultTxt = 'User-agent: *\nDisallow: /';
        setRobotsTxt(defaultTxt);
      } else {
        setRobotsTxt(txt);
      }
    } catch (error) {
      console.error('[GENERATE ROBOTS] Error:', error);
      setRobotsTxt('# Error generating robots.txt\n# ' + error.message);
    }
  };

  // Test log to check if generateRobotsTxt function exists (after definition)

  const toggleBot = (botKey) => {
    // Safety check - don't proceed if settings not loaded
    if (!settings || !settings.bots) {
      console.warn('[SETTINGS] toggleBot called but settings not loaded yet');
      return;
    }
    
    if (!settings?.availableBots?.includes(botKey)) {
      setToast(`Upgrade to ${requiredPlan} plan to enable ${settings.bots[botKey]?.name || botKey}`);
      return;
    }
    
    setSettings(prev => ({
      ...prev,
      bots: {
        ...prev.bots,
        [botKey]: {
          ...prev.bots[botKey],
          enabled: !prev.bots[botKey].enabled
        }
      }
    }));
    
    setHasUnsavedChanges(true); // Mark that there are changes
  };

  const toggleFeature = async (featureKey) => {
    // Safety check - don't proceed if settings not loaded
    if (!settings || !settings.features) {
      console.warn('[SETTINGS] toggleFeature called but settings not loaded yet');
      return;
    }
    
    if (!isFeatureAvailable(featureKey)) {
      const feature = {
        productsJson: 'Products JSON Feed',
        aiSitemap: 'AI-Optimized Sitemap',
        welcomePage: 'AI Welcome Page',
        collectionsJson: 'Collections JSON Feed',
        storeMetadata: 'Store Metadata',
        schemaData: 'Schema Data'
      };
      setToast(`Upgrade your plan to enable ${feature[featureKey] || featureKey}`);
      return;
    }
    
    // Check if we're enabling a feature (toggling ON)
    const isEnabling = !settings.features[featureKey];
    
    if (isEnabling && requiresTokensForPlusPlans(featureKey)) {
      // Check tokens before enabling
      try {
        const balance = await api(`/api/billing/tokens/balance?shop=${shop}`);
        if (balance.balance <= 0) {
          // Show InsufficientTokensModal instead of toast
          const featureMapping = {
            aiSitemap: 'ai-sitemap-optimized',
            schemaData: 'ai-schema-advanced',
            welcomePage: 'ai-welcome-page',
            collectionsJson: 'ai-collections-json',
            storeMetadata: 'ai-store-metadata'
          };
          
          // Use dynamic token estimation with actual product count
          const featureId = featureMapping[featureKey] || featureKey;
          const productCount = settings?.productCount || 0;
          const tokenEstimate = estimateTokens(featureId, { productCount });
          
          console.log('[SETTINGS] Token estimate for', featureId, ':', { productCount, ...tokenEstimate });
          
          setTokenModalData({
            feature: featureId,
            tokensRequired: tokenEstimate.withMargin,
            tokensAvailable: balance.balance || 0,
            tokensNeeded: tokenEstimate.withMargin
          });
          setShowInsufficientTokensModal(true);
          return; // Don't toggle the feature ON
        }
      } catch (error) {
        console.error('[SETTINGS] Error checking token balance:', error);
        setToast('Error checking token balance');
        return;
      }
    }
    
    setSettings(prev => ({
      ...prev,
      features: {
        ...prev.features,
        [featureKey]: !prev.features[featureKey]
      }
    }));
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await api(`/api/ai-discovery/settings?shop=${shop}`, {
        method: 'POST',
        body: {
          shop,
          bots: settings.bots,
          features: settings.features,
          richAttributes: settings.richAttributes
        }
      });
      
      setHasUnsavedChanges(false);
      setOriginalSettings(settings);
      generateRobotsTxt();
      
      // AI-Optimized Sitemap logic moved to Store Optimization → Sitemap page
      // const normalizedPlan = normalizePlan(settings?.plan);
      // const plansWithUnlimitedAISitemap = ['growth_extra', 'growth extra', 'enterprise'];
      // const plusPlans = ['professional_plus', 'professional plus', 'growth_plus', 'growth plus'];
      // const isPlusPlan = plusPlans.includes(normalizedPlan);
      // const hasUnlimitedAccess = plansWithUnlimitedAISitemap.includes(normalizedPlan);
      // if (settings.features?.aiSitemap) { ... } - REMOVED
      
      // Show success toast
      setToast('');
      setTimeout(() => {
        const hasEnabledBots = Object.values(settings?.bots || {}).some(bot => bot.enabled);
        if (hasEnabledBots) {
          setToast('Settings saved! Scroll down to configure robots.txt (REQUIRED for AI Discovery).');
        } else {
          setToast('Settings saved successfully');
        }
      }, 100);
      
    } catch (error) {
      console.error('Failed to save settings:', error);
      
      // Check for 402 status (payment required) - SHOW MODAL INSTEAD OF REDIRECT
      if (error.status === 402) {
        setSaving(false);
        
        // Set error data for modals
        setTokenError(error);
        
        // Show appropriate modal based on error type (same logic as Collections)
        if (error.trialRestriction && error.requiresActivation) {
          // Growth Extra/Enterprise in trial → Show "Activate Plan" modal
          setShowTrialActivationModal(true);
        } else if (error.requiresPurchase) {
          // Insufficient tokens → Show "Purchase Tokens" modal
          setShowInsufficientTokensModal(true);
        } else {
          // Fallback: Generic trial restriction
          setToast('AI-Optimized Sitemap requires tokens. Please upgrade or purchase tokens.');
        }
        return;
      }
      
      setToast('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(robotsTxt);
    setToast('Copied to clipboard!');
  };

  /**
   * ⚠️ NOT IN USE - Requires Shopify Protected Scope Approval
   * 
   * This function is preserved for future use but is currently NOT called from the UI.
   * The backend endpoint returns 501 Not Implemented until Shopify approves write_themes_assets scope.
   * 
   * See: backend/controllers/aiDiscoveryController.js (line ~248) for backend status
   */
  const applyRobotsTxt = async () => {
    try {
      const data = await api(`/api/ai-discovery/apply-robots?shop=${shop}`, {
        method: 'POST',
        body: { shop }
      });
      
      setToast('robots.txt applied successfully!');
    } catch (error) {
      console.error('Failed to apply robots.txt:', error);
      setToast(error.message);
    }
  };

  const isFeatureAvailable = (featureKey) => {
    // Use getPlanIndex directly (it handles case-insensitivity and spaces)
    const planIndex = getPlanIndex(settings?.plan);
    
    // Plan requirements by feature (index in PLAN_HIERARCHY)
    const requirements = {
      productsJson: 0,        // Starter+
      storeMetadata: 1,       // Professional+
      welcomePage: 2,         // Professional Plus+
      collectionsJson: 2,     // Professional Plus+
      aiSitemap: 2,           // Professional Plus+ (requires tokens for Plus plans)
      schemaData: 2           // Professional Plus+ (requires tokens for Plus plans, Enterprise gets more)
    };
    
    const requiredIndex = requirements[featureKey];
    const isAvailable = requiredIndex !== undefined && planIndex >= requiredIndex;
    
    
    return isAvailable;
  };

  // Get upgrade text for unavailable features
  const getUpgradeText = (featureKey) => {
    const plan = normalizePlan(settings?.plan);
    
    // Feature upgrade paths based on current plan
    const upgradeTexts = {
      storeMetadata: {
        starter: 'Available in Professional or higher'
      },
      welcomePage: {
        starter: 'Available in Professional Plus (pay-per-use tokens) or Growth+',
        professional: 'Available in Professional Plus (pay-per-use tokens) or Growth+'
      },
      collectionsJson: {
        starter: 'Available in Professional Plus (pay-per-use tokens) or Growth+',
        professional: 'Available in Professional Plus (pay-per-use tokens) or Growth+'
      },
      aiSitemap: {
        starter: 'Available in Professional Plus (pay-per-use tokens) or Growth Extra+',
        professional: 'Available in Professional Plus (pay-per-use tokens) or Growth Extra+',
        growth: 'Available in Growth Plus (pay-per-use tokens) or Growth Extra+'
      },
      schemaData: {
        starter: 'Available in Professional Plus (pay-per-use tokens), Growth Plus (pay-per-use tokens) or Enterprise',
        professional: 'Available in Professional Plus (pay-per-use tokens), Growth Plus (pay-per-use tokens) or Enterprise',
        growth: 'Available in Growth Plus (pay-per-use tokens) or Enterprise',
        growth_extra: 'Available in Enterprise'
      }
    };
    
    return upgradeTexts[featureKey]?.[plan] || `Upgrade to enable this feature`;
  };

  // Test Plan Switcher - commented out for production
  /*
  const setTestPlan = async (plan) => {
    console.log(`[DEBUG] setTestPlan called with plan: ${plan}, shop: ${shop}`);
    try {
      const MUT = `
        mutation SetPlan($shop:String!, $plan: PlanEnum) {
          setPlanOverride(shop:$shop, plan:$plan) { shop plan }
        }
      `;
      console.log(`[DEBUG] GraphQL mutation:`, MUT);
      console.log(`[DEBUG] Variables:`, { shop, plan });
      
      const result = await runGQL(MUT, { shop, plan });
      console.log(`[DEBUG] GraphQL result:`, result);
      
      setToast(`Test plan set to ${plan || 'actual'}`);
      // ÐºÑ€Ð°Ñ‚ÑŠÐº refresh, Ð·Ð° Ð´Ð° ÑÐµ Ð¿Ñ€ÐµÐ·Ð°Ñ€ÐµÐ´Ð¸ GraphQL Ð¿Ð»Ð°Ð½Ð¾Ð²ÐµÑ‚Ðµ Ð¸ Ð±ÐµÐ¹Ð´Ð¶Ð°/Ð³ÐµÐ¹Ñ‚Ð¸Ð½Ð³Ð°
      setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      console.error('[DEBUG] Failed to set test plan', error);
    }
  };
  */

  // Check if Plus plan needs tokens for a feature
  const requiresTokensForPlusPlans = (featureKey) => {
    const plan = normalizePlan(settings?.plan);
    
    // Features that Plus plans need tokens for
    const plusPlansRequireTokens = {
      professional_plus: ['welcomePage', 'collectionsJson', 'aiSitemap', 'schemaData'], // Store Metadata is included (no tokens)
      growth_plus: ['aiSitemap', 'schemaData'] // Store Metadata, Welcome Page, Collections JSON are included (no tokens)
    };
    
    return plusPlansRequireTokens[plan]?.includes(featureKey) || false;
  };

  // Check tokens before viewing/using a feature
  const checkTokensBeforeAction = async (featureKey) => {
    if (!requiresTokensForPlusPlans(featureKey)) {
      return true; // No token check needed
    }
    
    try {
      const balance = await api(`/api/billing/tokens/balance?shop=${shop}`);
      if (balance.balance <= 0) {
        // Show InsufficientTokensModal instead of toast
        const featureMapping = {
          aiSitemap: 'ai-sitemap-optimized',
          schemaData: 'ai-schema-advanced',
          welcomePage: 'ai-welcome-page',
          collectionsJson: 'ai-collections-json',
          storeMetadata: 'ai-store-metadata'
        };
        
        // Use dynamic token estimation with actual product count
        const featureId = featureMapping[featureKey] || featureKey;
        const productCount = settings?.productCount || 0;
        const tokenEstimate = estimateTokens(featureId, { productCount });
        
        console.log('[SETTINGS] Token estimate for trial check', featureId, ':', { productCount, ...tokenEstimate });
        
        setTokenModalData({
          feature: featureId,
          tokensRequired: tokenEstimate.withMargin,
          tokensAvailable: balance.balance || 0,
          tokensNeeded: tokenEstimate.withMargin
        });
        setShowInsufficientTokensModal(true);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[SETTINGS] Error checking token balance:', error);
      setToast('Error checking token balance');
      return false;
    }
  };

  const viewJson = async (feature, title) => {
    // Check tokens first for Plus plans
    const canProceed = await checkTokensBeforeAction(feature);
    if (!canProceed) {
      return; // Stop if tokens are required but not available
    }
    
    setJsonModalTitle(title);
    setJsonModalFeature(feature); // Track which feature is being viewed
    setJsonModalOpen(true);
    setLoadingJson(true);
    setJsonModalContent(null);

    try {
      const endpoints = {
        productsJson: `/ai/products.json?shop=${shop}`,
        collectionsJson: `/ai/collections-feed.json?shop=${shop}`,
        storeMetadata: `/ai/store-metadata.json?shop=${shop}`,
        schemaData: `/ai/schema-data.json?shop=${shop}`,
        aiSitemap: `/api/sitemap/generate?shop=${shop}&force=true`, // Use the actual sitemap endpoint
        welcomePage: `/ai/welcome?shop=${shop}`
      };

      if (feature === 'aiSitemap') {
        // Read existing sitemap from database (does NOT regenerate)
        // Uses force=true to trigger the "view existing" code path in backend
        const response = await fetch(endpoints[feature], {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`
          }
        });
        
        if (response.ok) {
          const xmlContent = await response.text();
          setJsonModalContent(xmlContent);
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } else if (feature === 'welcomePage') {
        // For welcome page, fetch as text since it's HTML
        const response = await fetch(endpoints[feature], {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`
          }
        });
        
        if (response.ok) {
          const htmlContent = await response.text();
          setJsonModalContent(htmlContent);
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } else {
        // For other features, use the regular API call
        const data = await api(endpoints[feature]);
        setJsonModalContent(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      console.error('[SETTINGS] Error loading data:', error);
      setJsonModalContent(`Error loading data: ${error.message}`);
    } finally {
      setLoadingJson(false);
    }
  };

  // ===== 8. useEffect HOOKS (В КРАЯ!) =====
  // Debug showViewButtons state changes
  useEffect(() => {
  }, [showViewButtons]);
  
  // Reset showViewButtons on component mount to prevent showing from previous sessions
  useEffect(() => {
    setShowViewButtons(false);
    
    // Also reset schema generation states
    setSchemaGenerating(false);
    setSchemaComplete(false);
    
    // CRITICAL: Reset refs to prevent infinite loops from previous sessions
    isGeneratingRef.current = false;
    checkCountRef.current = 0;
  }, []); // Run only on mount

  // Check generated data when settings change
  
  useEffect(() => {
    
    if (settings?.features && shop) {
      checkGeneratedData();
    } else {
    }
  }, [settings?.features, shop, checkGeneratedData]);
  

  // Force check on mount
  useEffect(() => {
    
    // If we're in a generating state but there's no active generation, reset it
    if (isGeneratingRef.current && !schemaGenerating) {
      isGeneratingRef.current = false;
      checkCountRef.current = 0;
    }
    
    if (shop && settings?.features) {
      checkGeneratedData();
    } else {
    }
  }, []); // Run only on mount

  // ===== 9. RENDER =====
  try {
    if (!shop) {
      return (
        <Card>
          <Box padding="400">
            <Text tone="critical">Missing shop parameter</Text>
          </Box>
        </Card>
      );
    }

    if (loading) {
      return (
        <Card>
          <Box padding="400">
            <InlineStack align="center">
              <Spinner size="small" />
              <Text>Loading settings...</Text>
            </InlineStack>
          </Box>
        </Card>
      );
    }

    // Safety check - don't render if settings not loaded
    if (!settings || !settings.features) {
      return (
        <Card>
          <Box padding="400">
            <Banner status="critical">
              <Text>Failed to load settings. Please refresh the page.</Text>
            </Banner>
          </Box>
        </Card>
      );
    }

    return (
    <BlockStack gap="600">
      {/* AI Bot Access Control */}
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">AI Bot Access Control</Text>
              {settings?.plan && (
                <Badge tone="info">
                  {settings.plan.charAt(0).toUpperCase() + settings.plan.slice(1)} Plan
                </Badge>
              )}
            </InlineStack>
            
            <Text variant="bodyMd" tone="subdued">
              Choose which AI bots can access your store's structured data
            </Text>
            
            <Banner status="info">
              <BlockStack gap="200">
                <Text variant="bodyMd" fontWeight="semibold">How it works:</Text>
                <ol style={{ marginLeft: '20px', marginBottom: 0 }}>
                  <li>Select AI bots below</li>
                  <li>Configure AI Discovery Features below</li>
                  <li>Click "Save Settings" at the bottom</li>
                  <li>Configure robots.txt (instructions will appear)</li>
                </ol>
              </BlockStack>
            </Banner>
            
            <Divider />
            
            <BlockStack gap="300">
              {/* Row 1: Meta AI, Anthropic (Claude) */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '1rem' 
              }}>
                {['meta', 'anthropic'].map(key => {
                  const bot = settings?.bots?.[key];
                  if (!bot) return null;
                  
                  // Available bots per plan based on billing descriptions
                  const availableBotsByPlan = {
                    starter: ['meta', 'anthropic'],
                    professional: ['meta', 'anthropic', 'google'],
                    growth: ['meta', 'anthropic', 'google', 'openai'],
                    growth_extra: ['meta', 'anthropic', 'google', 'openai', 'perplexity'],
                    enterprise: ['meta', 'anthropic', 'google', 'openai', 'perplexity', 'others']
                  };
                  
                  const normalizedPlan = normalizePlan(settings?.plan);
                  const availableBots = availableBotsByPlan[normalizedPlan] || availableBotsByPlan.starter;
                  const isAvailable = availableBots.includes(key);
                  
                  const requiredPlan = 
                    key === 'google' ? 'Professional' :
                    key === 'openai' ? 'Growth' :
                    key === 'perplexity' ? 'Growth Extra' :
                    key === 'others' ? 'Enterprise' :
                    null;
                  
                  return (
                    <Box key={key} 
                      padding="200" 
                      background={isAvailable ? "bg-surface" : "bg-surface-secondary"}
                      borderRadius="200"
                      borderWidth="025"
                      borderColor="border"
                    >
                      <BlockStack gap="100">
                        <Checkbox
                          label={
                            <InlineStack gap="200" align="center">
                              <Text variant={isAvailable ? "bodyMd" : "bodySm"} tone={isAvailable ? "base" : "subdued"}>
                                {bot.name || key}
                              </Text>
                              {!isAvailable && requiredPlan && (
                                <Badge tone="info" size="small">
                                  Upgrade
                                </Badge>
                              )}
                            </InlineStack>
                          }
                          checked={!!settings?.bots?.[key]?.enabled}
                          onChange={() => toggleBot(key)}
                          disabled={!isAvailable}
                          helpText={
                            !isAvailable ? 
                              `Upgrade to ${requiredPlan} plan to enable this AI bot` :
                              key === 'meta' ? 'Meta AI platforms' :
                              key === 'anthropic' ? 'Claude AI assistant' :
                              key === 'google' ? 'Google Gemini' :
                              key === 'openai' ? 'ChatGPT' :
                              key === 'perplexity' ? 'AI-powered search' :
                              key === 'others' ? 'Deepseek, Bytespider & others' :
                              ''
                          }
                        />
                      </BlockStack>
                    </Box>
                  );
                })}
              </div>

              {/* Row 2: Google (Gemini), OpenAI (ChatGPT) */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '1rem' 
              }}>
                {['google', 'openai'].map(key => {
                  const bot = settings?.bots?.[key];
                  if (!bot) return null;
                  
                  const isAvailable = settings?.availableBots?.includes(key);
                  const requiredPlan = 
                    key === 'google' ? 'Professional' :
                    key === 'openai' ? 'Growth' :
                    key === 'perplexity' ? 'Growth Extra' :
                    key === 'others' ? 'Enterprise' :
                    null;
                  
                  return (
                    <Box key={key} 
                      padding="200" 
                      background={isAvailable ? "bg-surface" : "bg-surface-secondary"}
                      borderRadius="200"
                      borderWidth="025"
                      borderColor="border"
                    >
                      <BlockStack gap="100">
                        <Checkbox
                          label={
                            <InlineStack gap="200" align="center">
                              <Text variant={isAvailable ? "bodyMd" : "bodySm"} tone={isAvailable ? "base" : "subdued"}>
                                {bot.name || key}
                              </Text>
                              {!isAvailable && requiredPlan && (
                                <Badge tone="info" size="small">
                                  Upgrade
                                </Badge>
                              )}
                            </InlineStack>
                          }
                          checked={!!settings?.bots?.[key]?.enabled}
                          onChange={() => toggleBot(key)}
                          disabled={!isAvailable}
                          helpText={
                            !isAvailable ? 
                              `Upgrade to ${requiredPlan} plan to enable this AI bot` :
                              key === 'meta' ? 'Meta AI platforms' :
                              key === 'anthropic' ? 'Claude AI assistant' :
                              key === 'google' ? 'Google Gemini' :
                              key === 'openai' ? 'ChatGPT' :
                              key === 'perplexity' ? 'AI-powered search' :
                              key === 'others' ? 'Deepseek, Bytespider & others' :
                              ''
                          }
                        />
                      </BlockStack>
                    </Box>
                  );
                })}
              </div>

              {/* Row 3: Perplexity, Others (Deepseek, Bytespider) */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '1rem' 
              }}>
                {['perplexity', 'others'].map(key => {
                  const bot = settings?.bots?.[key];
                  if (!bot) return null;
                  
                  const isAvailable = settings?.availableBots?.includes(key);
                  const requiredPlan = 
                    key === 'google' ? 'Professional' :
                    key === 'openai' ? 'Growth' :
                    key === 'perplexity' ? 'Growth Extra' :
                    key === 'others' ? 'Enterprise' :
                    null;
                  
                  return (
                    <Box key={key} 
                      padding="200" 
                      background={isAvailable ? "bg-surface" : "bg-surface-secondary"}
                      borderRadius="200"
                      borderWidth="025"
                      borderColor="border"
                    >
                      <BlockStack gap="100">
                <Checkbox
                          label={
                            <InlineStack gap="200" align="center">
                              <Text variant={isAvailable ? "bodyMd" : "bodySm"} tone={isAvailable ? "base" : "subdued"}>
                                {bot.name || key}
                              </Text>
                              {!isAvailable && requiredPlan && (
                                <Badge tone="info" size="small">
                                  Upgrade
                                </Badge>
                              )}
                            </InlineStack>
                          }
                          checked={!!settings?.bots?.[key]?.enabled}
                          onChange={() => toggleBot(key)}
                          disabled={!isAvailable}
                          helpText={
                            !isAvailable ? 
                              `Upgrade to ${requiredPlan} plan to enable this AI bot` :
                              key === 'meta' ? 'Meta AI platforms' :
                              key === 'anthropic' ? 'Claude AI assistant' :
                              key === 'google' ? 'Google Gemini' :
                              key === 'openai' ? 'ChatGPT' :
                              key === 'perplexity' ? 'AI-powered search' :
                              key === 'others' ? 'Deepseek, Bytespider & others' :
                              ''
                          }
                        />
                      </BlockStack>
                    </Box>
                  );
                })}
              </div>
            </BlockStack>
          </BlockStack>
        </Box>
      </Card>

      {/* AI Discovery Features */}
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">AI Discovery Features</Text>
            <Text variant="bodyMd" tone="subdued">
              Select the features you want to enable for AI bots to consume your store data.
            </Text>
            
            <Banner status="info">
              Don't forget to click "Save Settings" after making changes.
            </Banner>
            
            <Divider />
            
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
              gap: '1rem' 
            }}>
              {[
                {
                  key: 'productsJson',
                  name: 'Products JSON Feed',
                  description: 'Bulk product data for AI consumption',
                  requiredPlan: 'Starter'
                },
                {
                  key: 'storeMetadata',
                  name: 'Store Metadata for AI Search',
                  description: 'Organization schema & AI metadata',
                  requiredPlan: 'Professional'
                },
                {
                  key: 'welcomePage',
                  name: 'AI Welcome Page',
                  description: 'Landing page for AI bots',
                  requiredPlan: 'Growth'
                },
                {
                  key: 'collectionsJson',
                  name: 'Collections JSON Feed',
                  description: 'Category data for better AI understanding',
                  requiredPlan: 'Growth'
                },
                // AI-Optimized Sitemap moved to Store Optimization → Sitemap page
                // {
                //   key: 'aiSitemap',
                //   name: 'AI-Optimized Sitemap',
                //   description: 'Enhanced sitemap with AI hints',
                //   requiredPlan: 'Growth Extra'
                // },
                // Advanced Schema Data moved to Store Optimization → Schema Data page
                // {
                //   key: 'schemaData',
                //   name: 'Advanced Schema Data',
                //   description: 'BreadcrumbList, FAQPage & more',
                //   requiredPlan: 'Enterprise'
                // }
              ].map((feature) => {
                const isAvailable = isFeatureAvailable(feature.key);
                const isEnabled = !!settings?.features?.[feature.key];
                
                return (
                  <Box key={feature.key}
                    padding="200" 
                    background={isAvailable ? "bg-surface" : "bg-surface-secondary"}
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border"
                  >
                    {isAvailable ? (
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Box flexGrow={1}>
                            <Checkbox
                              label={feature.name}
                              checked={isEnabled}
                              onChange={() => toggleFeature(feature.key)}
                              helpText={feature.description}
                            />
                          </Box>
                          
                          {/* AI Sitemap View button - MOVED TO Sitemap.jsx */}
                          {/* {feature.key === 'aiSitemap' && showAiSitemapView && !sitemapStatus.inProgress && (
                            <Button
                              size="slim"
                              onClick={() => viewJson(feature.key, feature.name)}
                            >
                              View
                            </Button>
                          )} */}
                          
                          {/* Products JSON View button */}
                          {feature.key === 'productsJson' && showProductsJsonView && (
                            <Button
                              size="slim"
                              onClick={() => viewJson(feature.key, feature.name)}
                            >
                              View
                            </Button>
                          )}
                          
                          {/* Collections JSON View button */}
                          {feature.key === 'collectionsJson' && showCollectionsJsonView && (
                            <Button
                              size="slim"
                              onClick={() => viewJson(feature.key, feature.name)}
                            >
                              View
                            </Button>
                          )}
                          
                          {/* Store Metadata - View button or Configure button */}
                          {feature.key === 'storeMetadata' && isEnabled && (
                            showStoreMetadataView ? (
                              <Button
                                size="slim"
                                onClick={() => viewJson(feature.key, feature.name)}
                              >
                                View
                              </Button>
                            ) : (
                              <Button
                                size="slim"
                                variant="primary"
                                onClick={async () => {
                                  // Check tokens first for Plus plans
                                  const canProceed = await checkTokensBeforeAction('storeMetadata');
                                  if (!canProceed) {
                                    return; // Stop if tokens are required but not available
                                  }
                                  
                                  // Open Store Metadata tab in new window
                                  const storeMetadataUrl = `/ai-seo/store-metadata?shop=${shop}`;
                                  window.open(storeMetadataUrl, '_blank');
                                }}
                              >
                                Configure
                              </Button>
                            )
                          )}
                          
                          {/* Welcome Page View button */}
                          {feature.key === 'welcomePage' && showWelcomePageView && (
                            <Button
                              size="slim"
                              onClick={() => viewJson(feature.key, feature.name)}
                            >
                              View
                            </Button>
                          )}
                        </InlineStack>
                        
                        {/* AI Sitemap Status Indicator */}
                        {feature.key === 'aiSitemap' && isEnabled && sitemapStatus.inProgress && (
                          <Box paddingInlineStart="800" paddingBlockStart="200">
                            <InlineStack gap="200" blockAlign="center">
                              <Spinner size="small" />
                              <BlockStack gap="100">
                                <Text variant="bodyMd" tone="subdued">
                                  {sitemapStatus.message || 'Generating sitemap...'}
                                </Text>
                                {sitemapStatus.position > 0 && (
                                  <Text variant="bodySm" tone="subdued">
                                    Queue position: {sitemapStatus.position} · Est. {Math.ceil(sitemapStatus.estimatedTime / 60)} min
                                  </Text>
                                )}
                                {sitemapStatus.status === 'processing' && sitemapStatus.productCount > 0 && (
                                  <Text variant="bodySm" tone="subdued">
                                    Processing {sitemapStatus.productCount} products...
                                  </Text>
                                )}
                              </BlockStack>
                            </InlineStack>
                          </Box>
                        )}
                        
                        {/* AI Sitemap Completion Status - shown even if checkbox is unchecked */}
                        {feature.key === 'aiSitemap' && !sitemapStatus.inProgress && sitemapStatus.status === 'completed' && sitemapStatus.generatedAt && (
                          <Box paddingInlineStart="800" paddingBlockStart="200">
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone="success">Generated</Badge>
                              <Text variant="bodySm" tone="subdued">
                                {sitemapStatus.productCount} products · {(() => {
                                  const now = new Date();
                                  const generated = new Date(sitemapStatus.generatedAt);
                                  const diff = Math.floor((now - generated) / 1000 / 60);
                                  if (diff < 1) return 'Just now';
                                  if (diff < 60) return `${diff} min ago`;
                                  const hours = Math.floor(diff / 60);
                                  if (hours < 24) return `${hours}h ago`;
                                  const days = Math.floor(hours / 24);
                                  return `${days}d ago`;
                                })()}
                              </Text>
                            </InlineStack>
                          </Box>
                        )}
                        
                        {/* Advanced Schema Status Indicator - MOVED TO Schema Data page */}
                        {/* {feature.key === 'schemaData' && isEnabled && schemaStatus.inProgress && (
                          <Box paddingInlineStart="800" paddingBlockStart="200">
                            <InlineStack gap="200" blockAlign="center">
                              <Spinner size="small" />
                              <BlockStack gap="100">
                                <Text variant="bodyMd" tone="subdued">
                                  {schemaStatus.message || 'Generating schema data...'}
                                </Text>
                                {schemaStatus.position > 0 && (
                                  <Text variant="bodySm" tone="subdued">
                                    Queue position: {schemaStatus.position} · Est. {Math.ceil(schemaStatus.estimatedTime / 60)} min
                                  </Text>
                                )}
                                {schemaStatus.status === 'processing' && schemaStatus.schemaCount > 0 && (
                                  <Text variant="bodySm" tone="subdued">
                                    Processing {schemaStatus.schemaCount} schemas...
                                  </Text>
                                )}
                              </BlockStack>
                            </InlineStack>
                          </Box>
                        )} */}
                        
                        {/* Advanced Schema Completion Status - MOVED TO Schema Data page */}
                        {/* {feature.key === 'schemaData' && !schemaStatus.inProgress && schemaStatus.status === 'completed' && schemaStatus.generatedAt && (
                          <Box paddingInlineStart="800" paddingBlockStart="200">
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone="success">Generated</Badge>
                              <Text variant="bodySm" tone="subdued">
                                {schemaStatus.schemaCount} schemas · {(() => {
                                  const now = new Date();
                                  const generated = new Date(schemaStatus.generatedAt);
                                  const diff = Math.floor((now - generated) / 1000 / 60);
                                  if (diff < 1) return 'Just now';
                                  if (diff < 60) return `${diff} min ago`;
                                  const hours = Math.floor(diff / 60);
                                  if (hours < 24) return `${hours}h ago`;
                                  const days = Math.floor(hours / 24);
                                  return `${days}d ago`;
                                })()}
                              </Text>
                            </InlineStack>
                          </Box>
                        )} */}
                      </BlockStack>
                    ) : (
                      <Checkbox
                        label={
                          <InlineStack gap="200" align="center">
                            <Text variant="bodySm" tone="subdued">
                              {feature.name}
                            </Text>
                            {feature.requiredPlan && (
                              <Badge tone="info" size="small">
                                Upgrade
                              </Badge>
                            )}
                          </InlineStack>
                        }
                        checked={false}
                        onChange={() => toggleFeature(feature.key)}
                        disabled={true}
                        helpText={getUpgradeText(feature.key)}
                      />
                    )}
                  </Box>
                );
              })}
            </div>
          </BlockStack>
        </Box>
      </Card>

      {/* Available Endpoints - commented out, now using View buttons */}
      {/* {(settings?.features?.productsJson || settings?.features?.collectionsJson || settings?.features?.storeMetadata || settings?.features?.schemaData || settings?.features?.aiSitemap || settings?.features?.welcomePage) && (
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Available AI Endpoints</Text>
              
              <BlockStack gap="200">
                {settings?.features?.productsJson && (
                  <InlineStack align="space-between">
                    <Text>Products Feed:</Text>
                    <Link url={`/ai/products.json?shop=${shop}`} external>
                      /ai/products.json
                    </Link>
                  </InlineStack>
                )}
                
                {settings?.features?.collectionsJson && (
                  <InlineStack align="space-between">
                    <Text>Collections Feed:</Text>
                    <Link url={`/ai/collections-feed.json?shop=${shop}`} external>
                      /ai/collections-feed.json
                    </Link>
                  </InlineStack>
                )}
                
                {settings?.features?.storeMetadata && (
                  <InlineStack align="space-between">
                    <Text>Store Metadata:</Text>
                    <Link url={`/ai/store-metadata.json?shop=${shop}`} external>
                      /ai/store-metadata.json
                    </Link>
                  </InlineStack>
                )}
                
                {settings?.features?.schemaData && (
                  <InlineStack align="space-between">
                    <Text>Advanced Schema Data:</Text>
                    <Link url={`/ai/schema-data.json?shop=${shop}`} external>
                      /ai/schema-data.json
                    </Link>
                  </InlineStack>
                )}
                
                {settings?.features?.aiSitemap && (
                  <InlineStack align="space-between">
                    <Text>AI Sitemap:</Text>
                    <Link url={`/ai/sitemap-feed.xml?shop=${shop}`} external>
                      /ai/sitemap-feed.xml
                    </Link>
                  </InlineStack>
                )}
                
                {settings?.features?.welcomePage && (
                  <InlineStack align="space-between">
                    <Text>Welcome Page:</Text>
                    <Link url={`/ai/welcome?shop=${shop}`} external>
                      /ai/welcome
                    </Link>
                  </InlineStack>
                )}
              </BlockStack>
            </BlockStack>
          </Box>
        </Card>
      )} */}

      {/* Advanced Schema Data Management - MOVED TO Store Optimization → Schema Data page */}
      {/* {(() => {
        const plan = normalizePlan(settings?.plan);
        const planIndex = getPlanIndex(plan);
        const planCheck = planIndex >= 2; // Professional Plus+ (index 2)
        const settingsCheck = settings?.features?.schemaData;
        const originalCheck = originalSettings?.features?.schemaData;
        
        return planCheck && settingsCheck && originalCheck;
      })() && (
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Advanced Schema Data Management</Text>
              <Text variant="bodyMd" tone="subdued">
                Generate and manage structured data for your products
              </Text>
              
              <InlineStack gap="300">
                <Button
                  primary
                  onClick={async () => {
                    try {
                      const existingData = await api(`/ai/schema-data.json?shop=${shop}`);
                      
                      if (existingData.schemas && existingData.schemas.length > 0) {
                        if (!confirm('This will replace existing schema data. Continue?')) {
                          return;
                        }
                      }
                      
                      const data = await api(`/api/schema/generate-all?shop=${shop}`, {
                        method: 'POST',
                        shop,
                        body: { shop }
                      });
                      
                      setToast('Advanced Schema Data generation started in background.');
                      startSchemaPolling();
                      
                    } catch (apiError) {
                      if (apiError.status === 402) {
                        setTokenError(apiError);
                        if (apiError.trialRestriction && apiError.requiresActivation) {
                          setShowTrialActivationModal(true);
                        } else if (apiError.requiresPurchase) {
                          setShowInsufficientTokensModal(true);
                        } else {
                          setToast('Advanced Schema Data requires activation or token purchase.');
                        }
                        return;
                      }
                      
                      if (apiError.message?.includes('NO_OPTIMIZED_PRODUCTS') || apiError.error?.includes('NO_OPTIMIZED_PRODUCTS')) {
                        setSchemaErrorType('NO_OPTIMIZED_PRODUCTS');
                        setShowSchemaErrorModal(true);
                        return;
                      }
                      
                      if (apiError.message?.includes('ONLY_BASIC_SEO') || apiError.error?.includes('ONLY_BASIC_SEO')) {
                        setSchemaErrorType('ONLY_BASIC_SEO');
                        setShowSchemaErrorModal(true);
                        return;
                      }
                      
                      console.error('[SCHEMA-GEN] Error:', apiError);
                      setToast('Failed to generate schema: ' + (apiError.message || 'Unknown error'));
                    }
                  }}
                >
                  Generate/Update Schema Data
                </Button>
                
                <Button onClick={() => { window.open(`/ai/schema-data.json?shop=${shop}`, '_blank'); }}>
                  View Generated Schema
                </Button>
                
                <Button
                  destructive
                  onClick={async () => {
                    if (confirm('This will delete all advanced schema data. Are you sure?')) {
                      try {
                        await api(`/api/schema/delete?shop=${shop}`, { method: 'DELETE', shop, body: { shop } });
                        setToast('Schema data deleted successfully');
                      } catch (err) {
                        setToast('Failed to delete schema data');
                      }
                    }
                  }}
                >
                  Delete Schema Data
                </Button>
              </InlineStack>
              
              <Card>
                <Box padding="300">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Rich Product Attributes</Text>
                    <Text variant="bodyMd" tone="subdued">
                      Select which AI-generated attributes to include in product schemas
                    </Text>
                    
                    <InlineGrid columns={2} gap="400">
                      {[
                        { key: 'material', label: 'Material', description: 'Product material (cotton, leather, metal, etc.)' },
                        { key: 'color', label: 'Color', description: 'Product color information' },
                        { key: 'size', label: 'Size', description: 'Product size or dimensions' },
                        { key: 'weight', label: 'Weight', description: 'Product weight information' },
                        { key: 'dimensions', label: 'Dimensions', description: 'Product measurements' },
                        { key: 'category', label: 'Category', description: 'Product category classification' },
                        { key: 'audience', label: 'Target Audience', description: 'Intended user group (men, women, kids, etc.)' },
                        { key: 'reviews', label: 'Review Schemas', description: 'AI-generated product reviews for schema.org' },
                        { key: 'ratings', label: 'Rating Schemas', description: 'AI-generated ratings and aggregate ratings' },
                        { key: 'enhancedDescription', label: 'Enhanced Descriptions', description: 'AI-enhanced product descriptions' },
                        { key: 'organization', label: 'Organization Schema', description: 'Brand organization information' }
                      ].map(attr => (
                        <Checkbox
                          key={attr.key}
                          label={attr.label}
                          helpText={attr.description}
                          checked={settings?.richAttributes?.[attr.key] || false}
                          onChange={(checked) => {
                            setSettings(prev => ({
                              ...prev,
                              richAttributes: { ...prev.richAttributes, [attr.key]: checked }
                            }));
                          }}
                        />
                      ))}
                    </InlineGrid>
                  </BlockStack>
                </Box>
              </Card>
              
              <Banner status="info" tone="subdued">
                <p>Generation creates BreadcrumbList, FAQPage, WebPage and more schemas for each product.</p>
              </Banner>
            </BlockStack>
          </Box>
        </Card>
      )} */}

      {/* Save and Reset Buttons */}
      <InlineStack gap="200" align="end">
        <Button
          tone="critical"
          onClick={async () => {
            if (window.confirm('Are you sure you want to reset all AI Discovery settings to defaults?')) {
              try {
                await api(`/api/ai-discovery/settings?shop=${shop}`, {
                  method: 'DELETE',
                  shop
                });
                
                setToast('Settings reset successfully');
                setOriginalSettings(null); // Clear original settings too
                setTimeout(() => {
                  window.location.reload();
                }, 1000);
              } catch (error) {
                console.error('Failed to reset:', error);
                setToast('Failed to reset settings');
              }
            }
          }}
        >
          Reset to Defaults
        </Button>
        
        <Button
          primary
          size="large"
          loading={saving}
          onClick={saveSettings}
        >
          Save Settings
        </Button>
      </InlineStack>

      {/* robots.txt Configuration - Shows after Save Settings */}
      {!hasUnsavedChanges && Object.values(settings?.bots || {}).some(bot => bot.enabled) && (
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">📋 robots.txt Configuration</Text>
                <Badge tone="critical">REQUIRED</Badge>
              </InlineStack>
              
              <Banner status="critical" title="⚠️ IMPORTANT: AI Discovery will NOT work without this step!">
                <BlockStack gap="300">
                  <p><strong>Your AI bot settings are saved, but they can't access your store yet.</strong></p>
                  <p>You must manually add robots.txt to your theme for AI bots to discover your products.</p>
                  <p>Click the button below to see your custom robots.txt code and installation instructions.</p>
                </BlockStack>
              </Banner>
              
              <Button 
                primary
                size="large"
                onClick={async () => {
                  try {
                    const hasSelectedBots = Object.values(settings?.bots || {}).some(bot => bot.enabled);
                    
                    if (!hasSelectedBots) {
                      setShowNoBotsModal(true);
                    } else {
                      await generateRobotsTxt();
                      setShowRobotsModal(true);
                    }
                  } catch (error) {
                    console.error('[GENERATE ROBOTS] Error:', error);
                    setToast('Error generating robots.txt: ' + error.message);
                  }
                }}
              >
                📋 View & Copy robots.txt Code
              </Button>
              
              <Divider />
              
              <BlockStack gap="300">
                <Text variant="headingMd">Installation Instructions:</Text>
                <ol style={{ marginLeft: '20px', marginTop: '10px', lineHeight: '1.8' }}>
                  <li><strong>Generate & Copy:</strong> Click the button above to see your custom robots.txt code, then copy it</li>
                  <li><strong>Open Theme Editor:</strong> Go to <strong>Online Store → Themes</strong> in Shopify admin</li>
                  <li><strong>Edit Code:</strong> Click <strong>Actions → Edit code</strong> on your active theme</li>
                  <li><strong>Check Existing File:</strong> In the file browser, look for <code>templates/robots.txt.liquid</code></li>
                  <li><strong>If File Exists:</strong> Click on it to edit. <strong>Add</strong> the copied code to the end of the existing content (don't replace it)</li>
                  <li><strong>If File Doesn't Exist:</strong> Click <strong>Add a new file</strong>, type <code>templates/robots.txt.liquid</code>, and paste the copied code</li>
                  <li><strong>Save:</strong> Click the green <strong>Save</strong> button (top right)</li>
                </ol>
                
                <Banner status="warning">
                  <p><strong>⚠️ Important:</strong> If you already have a <code>robots.txt.liquid</code> file with custom rules, <strong>add</strong> our code to the end instead of replacing it. This ensures both your existing rules and AI bot access work correctly.</p>
                </Banner>
                
                <Banner tone="info">
                  <p><strong>💡 Note:</strong> Our generated robots.txt does NOT block standard search engines (Google, Bing, etc.). It only configures access for AI bots. The default Shopify robots.txt rules will still apply for standard crawlers.</p>
                </Banner>
              </BlockStack>
              
              <Banner status="info">
                <p>💡 <strong>Why this matters:</strong> The robots.txt file tells AI bots (OpenAI, Anthropic, Google, etc.) which pages and endpoints they can access to properly understand and index your products for AI search results and recommendations.</p>
              </Banner>

              {/* COMMENTED OUT - Auto apply for Growth+ plans (future feature)
              {['growth', 'growth_extra', 'enterprise'].includes(normalizePlan(settings?.plan)) && (
                <>
                  <Divider />
                  <BlockStack gap="200">
                    <Text variant="bodyMd" tone="subdued">
                      <strong>Growth+ Plan:</strong> Automatic installation coming soon!
                    </Text>
                  </BlockStack>
                </>
              )}
              */}
            </BlockStack>
          </Box>
        </Card>
      )}

      {/* Robots.txt Modal */}
      {showRobotsModal && (
        <Modal
          open={showRobotsModal}
          onClose={() => setShowRobotsModal(false)}
          title="robots.txt Configuration"
          primaryAction={{
            content: 'Copy to clipboard',
            onAction: () => {
              navigator.clipboard.writeText(robotsTxt);
              setToast('Copied to clipboard!');
            }
          }}
          secondaryActions={[
            {
              content: 'Close',
              onAction: () => setShowRobotsModal(false)
            }
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {!['growth', 'growth_extra', 'enterprise'].includes(normalizePlan(settings?.plan)) && (
                <Banner status="info" title="Manual Configuration Steps">
                  <ol style={{ marginLeft: '20px', marginTop: '10px' }}>
                    <li>Copy the robots.txt content below</li>
                    <li>Go to <strong>Online Store → Themes</strong></li>
                    <li>Click <strong>Actions → Edit code</strong> on your active theme</li>
                    <li>In the file browser, look for <strong>templates/robots.txt.liquid</strong></li>
                    <li><strong>If file exists:</strong> Add the copied code to the end (don't replace existing content)</li>
                    <li><strong>If file doesn't exist:</strong> Click <strong>Add a new file</strong>, type <code>templates/robots.txt.liquid</code>, and paste the code</li>
                    <li>Click <strong>Save</strong></li>
                  </ol>
                </Banner>
              )}
              
              <Box padding="200" background="bg-surface-secondary" borderRadius="100">
                <pre style={{ 
                  whiteSpace: 'pre-wrap', 
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  margin: 0,
                  overflow: 'auto',
                  maxHeight: '400px'
                }}>
                  {robotsTxt}
                </pre>
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* No Bots Selected Modal */}
      {showNoBotsModal && (
        <Modal
          open={showNoBotsModal}
          onClose={() => setShowNoBotsModal(false)}
          title="No AI Bots Selected"
          primaryAction={{
            content: 'Got it',
            onAction: () => setShowNoBotsModal(false)
          }}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner status="warning">
                <p>You haven't selected any AI bots yet.</p>
              </Banner>
              
              <Text>To configure robots.txt:</Text>
              <ol style={{ marginLeft: '20px', marginTop: '10px' }}>
                <li>Select AI bots from the "AI Bot Access Control" section above</li>
                <li>Click "Save Settings" to save your selections</li>
                <li>Then click "Generate robots.txt" to configure</li>
              </ol>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Test Plan Switcher - commented out for production */}
      {/*
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Test Plan Switcher (Dev Only)</Text>
            <InlineStack gap="200">
              <Button onClick={() => setTestPlan('starter')}>Starter</Button>
              <Button onClick={() => setTestPlan('professional')}>Professional</Button>
              <Button onClick={() => setTestPlan('growth')}>Growth</Button>
              <Button onClick={() => setTestPlan('growth_extra')}>Growth Extra</Button>
              <Button onClick={() => setTestPlan('enterprise')}>Enterprise</Button>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>
      */}

      {/* JSON View Modal */}
      {jsonModalOpen && (
        <Modal
          open={jsonModalOpen}
          onClose={() => {
            setJsonModalOpen(false);
            setJsonModalContent(null);
            setJsonModalFeature(null);
          }}
          title={jsonModalTitle}
          primaryAction={{
            content: 'Copy',
            onAction: () => {
              navigator.clipboard.writeText(jsonModalContent);
              setToast('Copied to clipboard!');
            },
            disabled: loadingJson
          }}
          secondaryActions={[{
            content: 'Close',
            onAction: () => {
              setJsonModalOpen(false);
              setJsonModalContent(null);
              setJsonModalFeature(null);
            }
          }]}
        >
          <Modal.Section>
            <Box padding="200" background="bg-surface-secondary" borderRadius="100">
              {loadingJson ? (
                <InlineStack align="center" gap="200">
                  <Spinner size="small" />
                  <Text variant="bodyMd">
                    {jsonModalTitle === 'AI-Optimized Sitemap' 
                      ? 'Loading sitemap XML... This may take a moment for large stores.' 
                      : 'Loading...'}
                  </Text>
                </InlineStack>
              ) : jsonModalFeature === 'welcomePage' ? (
                // HTML Preview for Welcome Page
                <div style={{
                  border: '1px solid #e1e3e5',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  maxHeight: '600px',
                  backgroundColor: '#fff'
                }}>
                  <iframe
                    srcDoc={jsonModalContent}
                    style={{
                      width: '100%',
                      height: '600px',
                      border: 'none',
                      display: 'block'
                    }}
                    title="AI Welcome Page Preview"
                    sandbox="allow-same-origin"
                  />
                </div>
              ) : (
                <pre style={{ 
                  whiteSpace: 'pre-wrap', 
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  margin: 0,
                  overflow: 'auto',
                  maxHeight: '400px'
                }}>
                  {jsonModalContent}
                </pre>
              )}
            </Box>
          </Modal.Section>
        </Modal>
      )}

      {/* Schema modals removed - now using background queue with status indicator (like AI Sitemap) */}

      {/* Schema Error Modal - No Optimized Products */}
      {showSchemaErrorModal && schemaErrorType === 'NO_OPTIMIZED_PRODUCTS' && (
        <Modal
          open={true}
          title="No Optimized Products Found"
          onClose={async () => {
            setShowSchemaErrorModal(false);
            setSchemaErrorType(null);
            // Dismiss the error in backend so it doesn't show again on page reload
            try {
              await api(`/api/schema/dismiss-error?shop=${shop}`, { method: 'POST' });
            } catch (e) { /* ignore */ }
          }}
          primaryAction={{
            content: 'Go to Search Optimization',
            onAction: async () => {
              setShowSchemaErrorModal(false);
              setSchemaErrorType(null);
              // Dismiss the error in backend
              try {
                await api(`/api/schema/dismiss-error?shop=${shop}`, { method: 'POST' });
              } catch (e) { /* ignore */ }
              // Navigate to AISEO generation page with current params (embedded=1, shop, host, etc.)
              const currentParams = new URLSearchParams(window.location.search);
              const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
              window.location.href = `/ai-seo${paramString}`;
            }
          }}
          secondaryActions={[{
            content: 'Cancel',
            onAction: async () => {
              setShowSchemaErrorModal(false);
              setSchemaErrorType(null);
              // Dismiss the error in backend
              try {
                await api(`/api/schema/dismiss-error?shop=${shop}`, { method: 'POST' });
              } catch (e) { /* ignore */ }
            }
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner status="warning">
                <p>No optimized products were found in your store.</p>
              </Banner>
              
              <Text>
                Advanced Schema Data requires at least basic AISEO optimization on your products. 
                Please run AISEO optimization first, then try generating schemas again.
              </Text>
              
              <Text variant="bodyMd" fontWeight="semibold">
                You can choose:
              </Text>
              <BlockStack gap="200">
                <Text>• <strong>Basic AISEO</strong> - Free AISEO optimization</Text>
                <Text>• <strong>AI-Enhanced AISEO</strong> - Advanced optimization (requires tokens)</Text>
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Schema Error Modal - Only Basic SEO */}
      {showSchemaErrorModal && schemaErrorType === 'ONLY_BASIC_SEO' && (
        <Modal
          open={true}
          title="AI-Enhanced Optimization Recommended"
          onClose={async () => {
            setShowSchemaErrorModal(false);
            setSchemaErrorType(null);
            // Dismiss the error in backend so it doesn't show again on page reload
            try {
              await api(`/api/schema/dismiss-error?shop=${shop}`, { method: 'POST' });
            } catch (e) { /* ignore */ }
          }}
          primaryAction={{
            content: 'Generate AI-Enhanced Add-ons',
            onAction: async () => {
              setShowSchemaErrorModal(false);
              setSchemaErrorType(null);
              // Dismiss the error in backend
              try {
                await api(`/api/schema/dismiss-error?shop=${shop}`, { method: 'POST' });
              } catch (e) { /* ignore */ }
              // Navigate to AISEO generation page with current params (embedded=1, shop, host, etc.)
              const currentParams = new URLSearchParams(window.location.search);
              const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
              window.location.href = `/ai-seo${paramString}`;
            }
          }}
          secondaryActions={[{
            content: 'Proceed with Basic AISEO',
            onAction: async () => {
              // Close modal first
              setShowSchemaErrorModal(false);
              setSchemaErrorType(null);
              
              // Trigger schema generation with forceBasicSeo flag
              try {
                setToast('Starting schema generation with basic AISEO...');
                
                await api(`/api/schema/generate-all?shop=${shop}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ forceBasicSeo: true })
                });
                
                // Start polling for status updates (new background queue approach)
                startSchemaPolling();
              } catch (err) {
                console.error('[SCHEMA-GEN] Error:', err);
                setToast('Failed to generate schema: ' + (err.message || 'Unknown error'));
              }
            }
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner status="info">
                <p>Only basic AISEO optimization was found on your products.</p>
              </Banner>
              
              <Text>
                For best results with Advanced Schema Data, we recommend running AI-Enhanced 
                AISEO optimization first. This will provide richer product data for schema generation.
              </Text>
              
              <Text variant="bodyMd" fontWeight="semibold">
                What would you like to do?
              </Text>
              <BlockStack gap="200">
                <Text>• <strong>Generate AI-Enhanced Add-ons</strong> - Get the best results (requires tokens)</Text>
                <Text>• <strong>Proceed with Basic AISEO</strong> - Continue with current basic AISEO</Text>
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Toast notifications */}
      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
      
      {/* Modals for Token/Trial Restrictions */}
      {tokenError && (
        <>
          <InsufficientTokensModal
            open={showInsufficientTokensModal}
            onClose={() => {
              setShowInsufficientTokensModal(false);
              setTokenError(null);
            }}
            feature={tokenError.feature || 'ai-sitemap-optimized'}
            tokensRequired={tokenError.tokensRequired || 0}
            tokensAvailable={tokenError.tokensAvailable || 0}
            tokensNeeded={tokenError.tokensNeeded || 0}
            shop={shop}
            needsUpgrade={tokenError.needsUpgrade || false}
            minimumPlan={tokenError.minimumPlanForFeature || null}
            currentPlan={tokenError.currentPlan || settings?.plan || 'starter'}
            returnTo="/settings"
            onBuyTokens={() => {
              // Close InsufficientTokensModal and open TokenPurchaseModal
              setShowInsufficientTokensModal(false);
              setShowTokenPurchaseModal(true);
            }}
          />
          
          <TrialActivationModal
            open={showTrialActivationModal}
            onClose={() => {
              setShowTrialActivationModal(false);
              setTokenError(null);
            }}
            feature={tokenError.feature || 'ai-sitemap-optimized'}
            trialEndsAt={tokenError.trialEndsAt}
            currentPlan={tokenError.currentPlan || settings?.plan || 'enterprise'}
            tokensRequired={tokenError.tokensRequired || 0}
            onActivatePlan={async () => {
              // Direct API call to activate plan (same as Collections)
              try {
                const response = await api('/api/billing/activate', {
                  method: 'POST',
                  body: JSON.stringify({
                    shop,
                    endTrial: true,
                    returnTo: '/settings' // Return to Settings after approval
                  })
                });
                
                // Check if Shopify approval is required
                if (response.requiresApproval && response.confirmationUrl) {
                  // CRITICAL: Use window.top to break out of iframe (X-Frame-Options: DENY)
                  window.top.location.href = response.confirmationUrl;
                  return;
                }
                
                // Plan activated successfully without approval
                window.location.reload();
                
              } catch (error) {
                console.error('[SETTINGS] Activation failed:', error);
                
                // Fallback: Navigate to billing page
                const params = new URLSearchParams(window.location.search);
                const host = params.get('host');
                const embedded = params.get('embedded');
                window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host)}`;
              }
            }}
            onPurchaseTokens={() => {
              // Close TrialActivationModal and open TokenPurchaseModal
              setShowTrialActivationModal(false);
              setShowTokenPurchaseModal(true);
            }}
            shop={shop}
          />
        </>
      )}
      
      {/* Fallback: Old Insufficient Tokens Modal (for non-error cases) */}
      {!tokenError && showInsufficientTokensModal && (
        <InsufficientTokensModal
          open={showInsufficientTokensModal}
          onClose={() => setShowInsufficientTokensModal(false)}
          feature={tokenModalData.feature}
          tokensRequired={tokenModalData.tokensRequired}
          tokensAvailable={tokenModalData.tokensAvailable}
          tokensNeeded={tokenModalData.tokensNeeded}
          shop={shop}
          needsUpgrade={false}
          minimumPlan={null}
          currentPlan={settings?.plan || 'starter'}
          returnTo="/settings"
          onBuyTokens={() => {
            // Close InsufficientTokensModal and open TokenPurchaseModal
            setShowInsufficientTokensModal(false);
            setShowTokenPurchaseModal(true);
          }}
        />
      )}

      {/* Token Purchase Modal - opens directly from TrialActivationModal */}
      <TokenPurchaseModal
        open={showTokenPurchaseModal}
        onClose={() => {
          setShowTokenPurchaseModal(false);
          setTokenError(null);
        }}
        shop={shop}
        returnTo="/settings"
        inTrial={true}
      />
      
    </BlockStack>
    );
  } catch (error) {
    console.error('[SETTINGS] Component render error:', error);
    return (
      <BlockStack gap="400">
        <Card>
          <Box padding="400">
            <Text variant="headingMd">Settings Error</Text>
            <Box paddingBlockStart="200">
              <Text>Failed to load settings: {error.message}</Text>
            </Box>
          </Box>
        </Card>
      </BlockStack>
    );
  }
}