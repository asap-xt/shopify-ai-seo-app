// frontend/src/pages/Settings.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  ProgressBar
} from '@shopify/polaris';
import { ClipboardIcon, ExternalIcon, ViewIcon, ArrowDownIcon } from '@shopify/polaris-icons';
import { makeSessionFetch } from '../lib/sessionFetch.js';

export default function Settings() {
  console.log('[SETTINGS] ===== SETTINGS COMPONENT LOADED =====');
  console.log('[SETTINGS] Starting component initialization...');
  
  // ===== 1. ÐšÐžÐÐ¡Ð¢ÐÐÐ¢Ð˜ Ð˜ HELPERS (Ð‘Ð•Ð— HOOKS) =====
  const qs = (k, d = '') => {
    try { return new URLSearchParams(window.location.search).get(k) || d; } 
    catch { return d; }
  };

  const normalizePlan = (plan) => {
    return (plan || 'starter').toLowerCase().replace(' ', '_');
  };

  // Debug helper
  const debugLog = (message, data = null) => {
    console.log(`[SETTINGS DEBUG] ${message}`, data || '');
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
  const [showAiSitemapView, setShowAiSitemapView] = useState(false);
  const [showWelcomePageView, setShowWelcomePageView] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showNoBotsModal, setShowNoBotsModal] = useState(false);
  const [showManualInstructions, setShowManualInstructions] = useState(false);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [jsonModalTitle, setJsonModalTitle] = useState('');
  const [jsonModalContent, setJsonModalContent] = useState(null);
  const [loadingJson, setLoadingJson] = useState(false);
  const [originalSettings, setOriginalSettings] = useState(null);
  const [advancedSchemaEnabled, setAdvancedSchemaEnabled] = useState(false);
  const [processingSchema, setProcessingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState('');
  const [advancedSchemaStatus, setAdvancedSchemaStatus] = useState({
    enabled: false,
    generating: false,
    generated: false,
    progress: ''
  });
  const [schemaGenerating, setSchemaGenerating] = useState(false);
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
  const [schemaComplete, setSchemaComplete] = useState(false);
  
  // ===== 4. API MEMO =====
  const api = useMemo(() => makeSessionFetch(), []);
  
  console.log('[SETTINGS] ===== SHOP EXTRACTION DEBUG =====');
  console.log('[SETTINGS] Extracted shop:', shop);
  console.log('[SETTINGS] API function created:', typeof api);
  console.log('[SETTINGS] makeSessionFetch function:', typeof makeSessionFetch);
  
  
  // ===== 6. Ð“Ð›ÐÐ’ÐÐÐ¢Ð Ð¤Ð£ÐÐšÐ¦Ð˜Ð¯ (Ð¡Ð›Ð•Ð” helper Ñ„ÑƒÐ½ÐºÑ†Ð¸Ð¸Ñ‚Ðµ) =====
  // Ð’ÐÐ–ÐÐž: ÐœÐ°Ñ…Ð½Ð¸ 'shop' Ð¾Ñ‚ dependencies Ñ‚ÑƒÐº - Ð²ÐµÑ‡Ðµ Ðµ Ð² Ð¿Ð¾Ð¼Ð¾Ñ‰Ð½Ð¸Ñ‚Ðµ Ñ„ÑƒÐ½ÐºÑ†Ð¸Ð¸
  
  // ===== 7. useEffect (ÐŸÐžÐ¡Ð›Ð•Ð”Ð•Ð) =====
  
  // Debug toast state changes
  useEffect(() => {
    if (toast) {
      console.log('[SETTINGS] Toast state changed to:', toast);
      
      // Clear existing timeout
      if (toastTimeout) {
        clearTimeout(toastTimeout);
      }
      
      // Set new timeout to clear toast after 5 seconds
      const timeout = setTimeout(() => {
        console.log('[SETTINGS] Auto-clearing toast after 5 seconds');
        setToast('');
      }, 5000);
      
      setToastTimeout(timeout);
    }
  }, [toast]);
  
  // Function to start polling for background regeneration completion
  const startPollingForCompletion = () => {
    console.log('[SETTINGS] Starting polling for background regeneration completion...');
    
    // Clear any existing polling
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
    
    let attempts = 0;
    const maxAttempts = 30; // Poll for up to 5 minutes (30 * 10 seconds)
    
    const interval = setInterval(async () => {
      attempts++;
      console.log(`[SETTINGS] Polling attempt ${attempts}/${maxAttempts}`);
      
      try {
        // Check sitemap info to see if it was recently updated
        const info = await api(`/api/sitemap/info?shop=${shop}`);
        console.log('[SETTINGS] Sitemap info:', info);
        
        if (info && info.generatedAt) {
          const generatedTime = new Date(info.generatedAt).getTime();
          const now = Date.now();
          const timeDiff = now - generatedTime;
          
          // If sitemap was generated within the last 2 minutes, consider it complete
          if (timeDiff < 120000) { // 2 minutes
            console.log('[SETTINGS] Background regeneration completed!');
            clearInterval(interval);
            setPollingInterval(null);
            
              // Show completion toast
              setToast('AI-Optimized Sitemap regeneration completed successfully!');
              
              // Show View button only for AI Sitemap
              console.log('[SETTINGS] Setting showAiSitemapView to true for AI sitemap regeneration completion');
              setShowAiSitemapView(true);
              return;
          }
        }
        
        // If we've reached max attempts, stop polling
        if (attempts >= maxAttempts) {
          console.log('[SETTINGS] Polling timeout reached');
          clearInterval(interval);
          setPollingInterval(null);
          setToast('Background regeneration is taking longer than expected. Please check the sitemap manually.');
        }
        
      } catch (error) {
        console.error('[SETTINGS] Polling error:', error);
        // Continue polling on error
      }
    }, 10000); // Poll every 10 seconds
    
    setPollingInterval(interval);
  };
  
  // ===== 4. API MEMO (ÐŸÐ Ð•Ð”Ð˜ Ð´Ð° ÑÐµ Ð¸Ð·Ð¿Ð¾Ð»Ð·Ð²Ð° Ð² useCallback) =====
  
  // ===== 5. HELPER Ð¤Ð£ÐÐšÐ¦Ð˜Ð˜ (ÐºÐ¾Ð¸Ñ‚Ð¾ ÐÐ• Ð—ÐÐ’Ð˜Ð¡Ð¯Ð¢ Ð¾Ñ‚ Ð´Ñ€ÑƒÐ³Ð¸ callbacks) =====
  const checkProductsData = useCallback(async () => {
    try {
      console.log('[SETTINGS DEBUG] ===== CHECKING PRODUCTS DATA =====');
      console.log('[SETTINGS DEBUG] Shop:', shop);
      
      const PRODUCTS_CHECK_QUERY = `
        query CheckProductsData($shop: String!) {
          products(shop: $shop, first: 1) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      `;
      
      console.log('[SETTINGS DEBUG] GraphQL Query:', PRODUCTS_CHECK_QUERY);
      console.log('[SETTINGS DEBUG] Variables:', { shop });
      
      const result = await api('/graphql', {
        method: 'POST',
        body: JSON.stringify({
          query: PRODUCTS_CHECK_QUERY,
          variables: { shop }
        }),
        shop: shop
      });
      
      console.log('[SETTINGS DEBUG] GraphQL Result:', result);
      console.log('[SETTINGS DEBUG] Products edges length:', result?.data?.products?.edges?.length);
      
      const hasProducts = result?.data?.products?.edges?.length > 0;
      console.log('[SETTINGS DEBUG] Has products:', hasProducts);
      console.log('[SETTINGS DEBUG] ===== PRODUCTS CHECK COMPLETE =====');
      
      return hasProducts;
    } catch (error) {
      console.error('[SETTINGS] Error checking products data:', error);
      return false;
    }
  }, [shop, api]);

  const checkCollectionsData = useCallback(async () => {
    try {
      console.log('[SETTINGS DEBUG] ===== CHECKING COLLECTIONS DATA =====');
      console.log('[SETTINGS DEBUG] Shop:', shop);
      
      const COLLECTIONS_CHECK_QUERY = `
        query CheckCollectionsData($shop: String!) {
          collections(shop: $shop, first: 1) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      `;
      
      console.log('[SETTINGS DEBUG] GraphQL Query:', COLLECTIONS_CHECK_QUERY);
      console.log('[SETTINGS DEBUG] Variables:', { shop });
      
      const result = await api('/graphql', {
        method: 'POST',
        body: JSON.stringify({
          query: COLLECTIONS_CHECK_QUERY,
          variables: { shop }
        }),
        shop: shop
      });
      
      console.log('[SETTINGS DEBUG] GraphQL Result:', result);
      console.log('[SETTINGS DEBUG] Collections edges length:', result?.data?.collections?.edges?.length);
      
      const hasCollections = result?.data?.collections?.edges?.length > 0;
      console.log('[SETTINGS DEBUG] Has collections:', hasCollections);
      console.log('[SETTINGS DEBUG] ===== COLLECTIONS CHECK COMPLETE =====');
      
      return hasCollections;
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
      
      return result?.data?.storeMetadata?.shopName;
    } catch (error) {
      console.error('[SETTINGS] Error checking store metadata:', error);
      return false;
    }
  }, [shop, api]);

  const checkWelcomePage = useCallback(async () => {
    try {
      const WELCOME_PAGE_CHECK_QUERY = `
        query CheckWelcomePage($shop: String!) {
          welcomePage(shop: $shop) {
            title
            content
          }
        }
      `;
      
      const result = await api('/graphql', {
        method: 'POST',
        body: JSON.stringify({
          query: WELCOME_PAGE_CHECK_QUERY,
          variables: { shop }
        }),
        shop: shop
      });
      
      return result?.data?.welcomePage?.title;
    } catch (error) {
      console.error('[SETTINGS] Error checking welcome page:', error);
      return false;
    }
  }, [shop, api]);

  // ===== 6. ГЛАВНАТА ФУНКЦИЯ =====
  const checkGeneratedData = useCallback(async () => {
    try {
      console.log('[SETTINGS] ===== CHECKING GENERATED DATA =====');
      
      // Check Products JSON Feed
      if (settings?.features?.productsJson) {
        console.log('[SETTINGS] ===== CHECKING PRODUCTS JSON FEATURE =====');
        console.log('[SETTINGS] Products JSON feature is enabled:', settings?.features?.productsJson);
        const hasProductsData = await checkProductsData();
        console.log('[SETTINGS] Setting showProductsJsonView to:', hasProductsData);
        setShowProductsJsonView(hasProductsData);
        console.log('[SETTINGS] Products JSON data exists:', hasProductsData);
      } else {
        console.log('[SETTINGS] Products JSON feature is disabled');
      }
      
      // Check Collections JSON Feed  
      if (settings?.features?.collectionsJson) {
        console.log('[SETTINGS] ===== CHECKING COLLECTIONS JSON FEATURE =====');
        console.log('[SETTINGS] Collections JSON feature is enabled:', settings?.features?.collectionsJson);
        const hasCollectionsData = await checkCollectionsData();
        console.log('[SETTINGS] Setting showCollectionsJsonView to:', hasCollectionsData);
        setShowCollectionsJsonView(hasCollectionsData);
        console.log('[SETTINGS] Collections JSON data exists:', hasCollectionsData);
      } else {
        console.log('[SETTINGS] Collections JSON feature is disabled');
      }
      
      // Check Store Metadata
      if (settings?.features?.storeMetadata) {
        console.log('[SETTINGS] Checking Store Metadata data...');
        const hasStoreMetadata = await checkStoreMetadata();
        setShowStoreMetadataView(hasStoreMetadata);
        console.log('[SETTINGS] Store Metadata exists:', hasStoreMetadata);
      }
      
      // Check Welcome Page
      if (settings?.features?.welcomePage) {
        console.log('[SETTINGS] Checking Welcome Page data...');
        const hasWelcomePage = await checkWelcomePage();
        setShowWelcomePageView(hasWelcomePage);
        console.log('[SETTINGS] Welcome Page exists:', hasWelcomePage);
      }
      
      console.log('[SETTINGS] ===== GENERATED DATA CHECK COMPLETE =====');
    } catch (error) {
      console.error('[SETTINGS] Error checking generated data:', error);
    }
  }, [settings?.features, checkProductsData, checkCollectionsData, checkStoreMetadata, checkWelcomePage]);
  
  console.log('[SETTINGS] State variables initialized successfully');
  console.log('[SETTINGS] About to create useEffect hooks...');

  // --- GraphQL helper for this page (minimal, local) ---
  const runGQL = async (query, variables) => {
    console.log(`[DEBUG] runGQL called with query:`, query);
    console.log(`[DEBUG] runGQL variables:`, variables);
    
    const body = JSON.stringify({ query, variables });
    console.log(`[DEBUG] runGQL body:`, body);
    
    const res = await api('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });
    
    console.log(`[DEBUG] runGQL response:`, res);
    
    if (res?.errors?.length) {
      console.error(`[DEBUG] GraphQL errors:`, res.errors);
      throw new Error(res.errors[0]?.message || 'GraphQL error');
    }
    return res?.data;
  };
  

  console.log('[SETTINGS] Creating loadSettings useEffect...');
  console.log('[SETTINGS] Current shop value:', shop);
  console.log('[SETTINGS] Shop type:', typeof shop);
  console.log('[SETTINGS] Shop length:', shop?.length);
  
  useEffect(() => {
    console.log('[SETTINGS] ===== LOAD SETTINGS useEffect =====');
    console.log('[SETTINGS] Shop:', shop);
    console.log('[SETTINGS] API function:', typeof api);
    console.log('[SETTINGS] useEffect dependencies - shop:', shop);
    
    if (!shop) {
      console.log('[SETTINGS] No shop, setting loading to false');
      setLoading(false);
      return;
    }
    
    console.log('[SETTINGS] Shop available, calling loadSettings...');
    loadSettings();
  }, [shop]);
  
  console.log('[SETTINGS] loadSettings useEffect created successfully');


  // Check schema status when enabled
  useEffect(() => {
    if (advancedSchemaEnabled) {
      checkSchemaStatus();
    }
  }, [advancedSchemaEnabled]);

  // Auto-enable AI Discovery when features are selected
  useEffect(() => {
    if (settings && Object.values(settings.features || {}).some(f => f)) {
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

  // Check generation progress
  const checkGenerationProgress = async () => {
    try {
      // Check directly in MongoDB for data
      const data = await api(`/ai/schema-data.json?shop=${shop}`);
      
      if (data.schemas && data.schemas.length > 0) {
        // Generation complete
        setSchemaComplete(true);
        setSchemaGenerating(false);
        
        // Calculate statistics
        const products = [...new Set(data.schemas.map(s => s.url?.split('/products/')[1]?.split('#')[0]))].filter(Boolean);
        
        setSchemaProgress(prev => ({
          ...prev,
          percent: 100,
          stats: {
            siteFAQ: data.site_faq ? true : false,
            products: products.length,
            totalSchemas: data.schemas.length
          }
        }));
      } else {
        // Still generating, check again
        setSchemaProgress(prev => ({
          ...prev,
          percent: Math.min(prev.percent + 10, 90), // Simulate progress
          currentProduct: 'Processing products...'
        }));
        
        // Check again in 3 seconds
        setTimeout(checkGenerationProgress, 3000);
      }
    } catch (err) {
      console.error('Progress check error:', err);
      // Try again in 3 seconds
      setTimeout(checkGenerationProgress, 3000);
    }
  };

  const loadSettings = async () => {
    try {
      console.log('[SETTINGS] ===== STARTING LOAD SETTINGS =====');
      console.log('[SETTINGS] Shop:', shop);
      console.log('[SETTINGS] API function:', typeof api);
      console.log('[SETTINGS] Calling API...');
      
      const data = await api(`/api/ai-discovery/settings?shop=${shop}`);
      
      console.log('[SETTINGS] ===== SETTINGS LOADED =====');
      console.log('[SETTINGS] Raw data:', data);
      console.log('[SETTINGS] Settings plan:', data?.plan);
      console.log('[SETTINGS] Normalized plan:', normalizePlan(data?.plan));
      console.log('[SETTINGS] Features:', data?.features);
      console.log('[SETTINGS] Products JSON feature:', data?.features?.productsJson);
      console.log('[SETTINGS] Collections JSON feature:', data?.features?.collectionsJson);
      
      setSettings(data);
      setOriginalSettings(data); // Save original settings
      
      // Set Advanced Schema enabled state
      setAdvancedSchemaEnabled(data.advancedSchemaEnabled || false);
      
      // Generate robots.txt preview
      generateRobotsTxt(data);
      
      console.log('[SETTINGS] ===== LOAD SETTINGS COMPLETE =====');
    } catch (error) {
      console.error('[SETTINGS] ===== LOAD SETTINGS ERROR =====');
      console.error('[SETTINGS] Failed to load settings:', error);
      setToast('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const generateRobotsTxt = async (currentSettings = settings) => {
    console.log('[GENERATE ROBOTS] Called with shop:', shop);
    
    try {
      const txt = await api(`/api/ai-discovery/robots-txt?shop=${shop}`, { 
        responseType: 'text'  // <-- Ð’Ð°Ð¶Ð½Ð¾!
      });
      
      console.log('[GENERATE ROBOTS] Received:', txt);
      
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
  console.log('[SETTINGS DEBUG] generateRobotsTxt function exists:', typeof generateRobotsTxt);

  const toggleBot = (botKey) => {
    if (!settings?.availableBots?.includes(botKey)) {
      setToast(`Upgrade to ${requiredPlan} plan to enable ${settings.bots[botKey].name}`);
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

  const toggleFeature = (featureKey) => {
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
    
    setSettings(prev => ({
      ...prev,
      features: {
        ...prev.features,
        [featureKey]: !prev.features[featureKey]
      }
    }));
  };

  const saveSettings = async () => {
    console.log('[SETTINGS] ===== SAVE SETTINGS CALLED =====');
    console.log('[SETTINGS] Current settings:', settings);
    setSaving(true);
    try {
      await api(`/api/ai-discovery/settings?shop=${shop}`, {
        method: 'POST',
        body: {
          shop,
          bots: settings.bots,
          features: settings.features
        }
      });
      
      // Don't show toast here - will show appropriate toast based on AI sitemap status
      setHasUnsavedChanges(false); // Clear unsaved changes flag
      setOriginalSettings(settings); // Update original settings
      generateRobotsTxt(); // Regenerate robots.txt
      
      // Background sitemap regeneration if AI Sitemap is enabled
      console.log('[SETTINGS] Checking AI Sitemap feature:', settings.features?.aiSitemap);
      if (settings.features?.aiSitemap) {
        try {
          console.log('[SETTINGS] ===== AI SITEMAP BACKGROUND REGENERATION START =====');
          console.log('[SETTINGS] AI Sitemap enabled, starting background regeneration...');
          console.log('[SETTINGS] Shop:', shop);
          
          const REGENERATE_SITEMAP_MUTATION = `
            mutation RegenerateSitemap($shop: String!) {
              regenerateSitemap(shop: $shop) {
                success
                message
                shop
              }
            }
          `;
          
          console.log('[SETTINGS] GraphQL mutation:', REGENERATE_SITEMAP_MUTATION);
          console.log('[SETTINGS] Variables:', { shop });
          
          const result = await api('/graphql', {
            method: 'POST',
            body: JSON.stringify({
              query: REGENERATE_SITEMAP_MUTATION,
              variables: { shop }
            }),
            shop: shop
          });
          
          console.log('[SETTINGS] GraphQL sitemap regeneration result:', result);
          
          if (result?.data?.regenerateSitemap?.success) {
            console.log('[SETTINGS] Background regeneration started successfully');
            console.log('[SETTINGS] Setting toast for AI sitemap regeneration with delay...');
            
            // Clear any existing toast first
            setToast('');
            
          // Set success toast after a short delay to avoid conflicts
          setTimeout(() => {
            setToast('Settings saved! AI-Optimized Sitemap is being regenerated in the background. This may take a few moments.');
            console.log('[SETTINGS] Success toast set after delay');
            
            // Start polling to check when background regeneration completes
            startPollingForCompletion();
          }, 100);
            
          } else {
            console.log('[SETTINGS] Background regeneration failed:', result?.data?.regenerateSitemap);
            console.log('[SETTINGS] Setting toast for failed regeneration...');
            
            // Clear any existing toast first
            setToast('');
            
            // Set error toast after a short delay
            setTimeout(() => {
              setToast('Settings saved, but sitemap regeneration failed');
              console.log('[SETTINGS] Error toast set after delay');
            }, 100);
          }
          
          console.log('[SETTINGS] ===== AI SITEMAP BACKGROUND REGENERATION END =====');
        } catch (error) {
          console.error('[SETTINGS] Failed to start sitemap regeneration:', error);
          setToast('Settings saved, but sitemap regeneration failed');
        }
      } else {
        console.log('[SETTINGS] AI Sitemap disabled, skipping background regeneration');
        console.log('[SETTINGS] Setting toast for basic save with delay...');
        
        // Clear any existing toast first
        setToast('');
        
        // Set basic success toast after a short delay
        setTimeout(() => {
          setToast('Settings saved successfully');
          console.log('[SETTINGS] Basic success toast set after delay');
          
          // Don't show View buttons for basic save - only for AI features
          console.log('[SETTINGS] Basic save completed, not showing View buttons');
        }, 100);
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      setToast('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(robotsTxt);
    setToast('Copied to clipboard!');
  };

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
    const plan = normalizePlan(settings?.plan);
    
    const availability = {
      productsJson: ['starter', 'professional', 'growth', 'growth_extra', 'enterprise'],
      aiSitemap: ['starter', 'professional', 'growth', 'growth_extra', 'enterprise'],
      welcomePage: ['professional', 'growth', 'growth_extra', 'enterprise'],
      collectionsJson: ['growth', 'growth_extra', 'enterprise'],
      storeMetadata: ['growth_extra', 'enterprise'],
      schemaData: ['enterprise']
    };
    
    return availability[featureKey]?.includes(plan) || false;
  };

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
      setToast(`Failed to set test plan: ${error.message}`);
    }
  };

  const viewJson = async (feature, title) => {
    setJsonModalTitle(title);
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
        console.log('[SETTINGS] Loading AI Sitemap XML...');
        // For sitemap, fetch as text since it's XML
        const response = await fetch(endpoints[feature], {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${window.__SHOPIFY_APP_BRIDGE__?.getState()?.session?.token || ''}`
          }
        });
        
        if (response.ok) {
          console.log('[SETTINGS] AI Sitemap XML loaded successfully');
          const xmlContent = await response.text();
          setJsonModalContent(xmlContent);
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
    console.log('[SETTINGS] showViewButtons state changed to:', showViewButtons);
  }, [showViewButtons]);
  
  // Reset showViewButtons on component mount to prevent showing from previous sessions
  useEffect(() => {
    console.log('[SETTINGS] Resetting showViewButtons on component mount');
    setShowViewButtons(false);
  }, []); // Run only on mount

  // Check generated data when settings change
  console.log('[SETTINGS] Creating checkGeneratedData useEffect...');
  console.log('[SETTINGS] Current settings:', settings);
  console.log('[SETTINGS] Current settings features:', settings?.features);
  
  useEffect(() => {
    console.log('[SETTINGS DEBUG] ===== useEffect TRIGGERED =====');
    console.log('[SETTINGS DEBUG] Settings:', settings);
    console.log('[SETTINGS DEBUG] Settings features:', settings?.features);
    console.log('[SETTINGS DEBUG] Shop:', shop);
    console.log('[SETTINGS DEBUG] Conditions check:');
    console.log('[SETTINGS DEBUG] - settings?.features exists:', !!settings?.features);
    console.log('[SETTINGS DEBUG] - shop exists:', !!shop);
    console.log('[SETTINGS DEBUG] - Both conditions met:', !!(settings?.features && shop));
    
    if (settings?.features && shop) {
      console.log('[SETTINGS] Checking for generated data...');
      checkGeneratedData();
    } else {
      console.log('[SETTINGS] Skipping checkGeneratedData - conditions not met');
    }
  }, [settings?.features, shop, checkGeneratedData]);
  
  console.log('[SETTINGS] checkGeneratedData useEffect created successfully');

  // Force check on mount
  useEffect(() => {
    console.log('[SETTINGS] ===== FORCE CHECK ON MOUNT =====');
    console.log('[SETTINGS] Shop:', shop);
    console.log('[SETTINGS] Settings:', settings);
    console.log('[SETTINGS] Settings features:', settings?.features);
    
    if (shop && settings?.features) {
      console.log('[SETTINGS] Both shop and settings available, calling checkGeneratedData...');
      checkGeneratedData();
    } else {
      console.log('[SETTINGS] Missing shop or settings, skipping checkGeneratedData');
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
                  <li>Save Settings</li>
                  <li>Generate robots.txt</li>
                </ol>
              </BlockStack>
            </Banner>
            
            <Divider />
            
            <BlockStack gap="300">
              {/* Row 1: OpenAI, Perplexity */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '1rem' 
              }}>
                {['openai', 'perplexity'].map(key => {
                  const bot = settings?.bots?.[key];
                  if (!bot) return null;
                  
                  // Use normalized plan for availableBots check
                  const availableBotsByPlan = {
                    starter: ['openai', 'perplexity'],
                    professional: ['openai', 'anthropic', 'perplexity'],
                    growth: ['openai', 'anthropic', 'google', 'perplexity', 'meta', 'others'],
                    growth_extra: ['openai', 'anthropic', 'google', 'perplexity', 'meta', 'others'],
                    enterprise: ['openai', 'anthropic', 'google', 'perplexity', 'meta', 'others']
                  };
                  
                  const normalizedPlan = normalizePlan(settings?.plan);
                  const availableBots = availableBotsByPlan[normalizedPlan] || availableBotsByPlan.starter;
                  const isAvailable = availableBots.includes(key);
                  
                  const requiredPlan = 
                    key === 'anthropic' ? 'Professional' :
                    key === 'google' ? 'Growth' :
                    ['meta', 'others'].includes(key) ? 'Growth Extra' : // Changed from 'Growth' to 'Growth Extra'
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
                                  {requiredPlan}+
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
                              key === 'openai' ? 'Most popular AI assistant' :
                              key === 'anthropic' ? 'Claude AI assistant' :
                              key === 'google' ? 'Google Gemini' :
                              key === 'perplexity' ? 'AI-powered search' :
                              key === 'meta' ? 'Meta AI platforms' :
                              key === 'others' ? 'Bytespider, DeepSeek, etc.' :
                              ''
                          }
                        />
                      </BlockStack>
                    </Box>
                  );
                })}
              </div>

              {/* Row 2: Anthropic, Google */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '1rem' 
              }}>
                {['anthropic', 'google'].map(key => {
                  const bot = settings?.bots?.[key];
                  if (!bot) return null;
                  
                  const isAvailable = settings?.availableBots?.includes(key);
                  const requiredPlan = 
                    key === 'anthropic' ? 'Professional' :
                    key === 'google' ? 'Growth' :
                    ['meta', 'others'].includes(key) ? 'Growth Extra' : // Changed from 'Growth' to 'Growth Extra'
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
                                  {requiredPlan}+
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
                              key === 'openai' ? 'Most popular AI assistant' :
                              key === 'anthropic' ? 'Claude AI assistant' :
                              key === 'google' ? 'Google Gemini' :
                              key === 'perplexity' ? 'AI-powered search' :
                              key === 'meta' ? 'Meta AI platforms' :
                              key === 'others' ? 'Bytespider, DeepSeek, etc.' :
                              ''
                          }
                        />
                      </BlockStack>
                    </Box>
                  );
                })}
              </div>

              {/* Row 3: Meta, Others */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '1rem' 
              }}>
                {['meta', 'others'].map(key => {
                  const bot = settings?.bots?.[key];
                  if (!bot) return null;
                  
                  const isAvailable = settings?.availableBots?.includes(key);
                  const requiredPlan = 
                    key === 'anthropic' ? 'Professional' :
                    key === 'google' ? 'Growth' :
                    ['meta', 'others'].includes(key) ? 'Growth Extra' : // Changed from 'Growth' to 'Growth Extra'
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
                                  {requiredPlan}+
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
                              key === 'openai' ? 'Most popular AI assistant' :
                              key === 'anthropic' ? 'Claude AI assistant' :
                              key === 'google' ? 'Google Gemini' :
                              key === 'perplexity' ? 'AI-powered search' :
                              key === 'meta' ? 'Meta AI platforms' :
                              key === 'others' ? 'Bytespider, DeepSeek, etc.' :
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

      {/* robots.txt Configuration */}
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">robots.txt Configuration</Text>
            
            {hasUnsavedChanges && (
              <Banner status="warning" title="Unsaved changes">
                <p>You have unsaved bot selections. Please click "Save Settings" before configuring robots.txt.</p>
              </Banner>
            )}
            
            <Banner>
              <p>
                {['growth', 'growth_extra', 'enterprise'].includes(normalizePlan(settings?.plan)) ? 
                  "With your plan, you can apply robots.txt changes directly to your theme!" :
                  "Copy the generated rules and add them to your theme's robots.txt.liquid file."
                }
              </p>
            </Banner>
            
            <InlineStack gap="200">
              <Button 
                onClick={async () => { // <-- Ð”Ð¾Ð±Ð°Ð²ÐµÑ‚Ðµ async
                  console.log('[ADD MANUAL] Starting...');
                  console.log('[ADD MANUAL] Settings:', settings);
                  
                  try {
                    const hasSelectedBots = Object.values(settings?.bots || {}).some(bot => bot.enabled);
                    console.log('[ADD MANUAL] Has selected bots:', hasSelectedBots);
                    
                    if (!hasSelectedBots) {
                      console.log('[ADD MANUAL] No bots, showing modal');
                      setShowNoBotsModal(true);
                    } else {
                      console.log('[ADD MANUAL] Calling generateRobotsTxt...');
                      await generateRobotsTxt(); // <-- Ð”Ð¾Ð±Ð°Ð²ÐµÑ‚Ðµ await
                      console.log('[ADD MANUAL] Robots.txt generated, showing instructions');
                      setShowManualInstructions(true);
                    }
                  } catch (error) {
                    console.error('[ADD MANUAL] Error:', error);
                    setToast('Error generating robots.txt: ' + error.message);
                  }
                }}
              >
                Add manually
              </Button>
              
              {['growth', 'growth_extra', 'enterprise'].includes(normalizePlan(settings?.plan)) && (
                <Button 
                  primary 
                  onClick={async () => {
                    console.log('[APPLY AUTO] Starting...');
                    console.log('[APPLY AUTO] Settings:', settings);
                    console.log('[APPLY AUTO] Bots:', settings?.bots);
                    
                    try {
                      // Check if any bots are selected
                      const hasSelectedBots = Object.values(settings?.bots || {}).some(bot => bot.enabled);
                      console.log('[APPLY AUTO] Has selected bots:', hasSelectedBots);
                      
                      if (!hasSelectedBots) {
                        console.log('[APPLY AUTO] No bots selected, showing modal');
                        setShowNoBotsModal(true);
                        return;
                      }
                      
                      console.log('[APPLY AUTO] Applying robots.txt...');
                      const data = await api(`/api/ai-discovery/apply-robots?shop=${shop}`, {
                        method: 'POST',
                        shop,
                        body: { shop }
                      });
                      
                      console.log('[APPLY AUTO] Data:', data);
                      
                      setToast(data.message || 'robots.txt applied successfully!');
                    } catch (error) {
                      console.error('[APPLY AUTO] Error:', error);
                      setToast(error.message);
                    }
                  }}
                >
                  Apply Automatically
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>

      {/* Arrow between cards */}
      <Box paddingInlineStart="600" paddingInlineEnd="600">
        <InlineStack align="center" blockAlign="center">
          <Box>
            <Icon source={ArrowDownIcon} color="subdued" />
          </Box>
          <Text variant="bodySm" tone="subdued">
            Configure what data the AI bots can access
          </Text>
        </InlineStack>
      </Box>

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
                  requiredPlan: null
                },
                {
                  key: 'aiSitemap',
                  name: 'AI-Optimized Sitemap',
                  description: 'Enhanced sitemap with AI hints',
                  requiredPlan: null
                },
                {
                  key: 'welcomePage',
                  name: 'AI Welcome Page',
                  description: 'Landing page for AI bots',
                  requiredPlan: 'Professional'
                },
                {
                  key: 'collectionsJson',
                  name: 'Collections JSON Feed',
                  description: 'Category data for better AI understanding',
                  requiredPlan: 'Growth'
                },
                {
                  key: 'storeMetadata',
                  name: 'Store Metadata for AI Search',
                  description: 'Organization & LocalBusiness schema',
                  requiredPlan: 'Growth Extra'
                },
                {
                  key: 'schemaData',
                  name: 'Advanced Schema Data',
                  description: 'BreadcrumbList, FAQPage & more',
                  requiredPlan: 'Enterprise'
                }
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
                      <InlineStack align="space-between" blockAlign="center">
                        <Box flexGrow={1}>
                          <Checkbox
                            label={feature.name}
                            checked={isEnabled}
                            onChange={() => toggleFeature(feature.key)}
                            helpText={feature.description}
                          />
                        </Box>
                        {/* AI Sitemap View button */}
                        {feature.key === 'aiSitemap' && showAiSitemapView && (
                          <Button
                            size="slim"
                            onClick={() => viewJson(feature.key, feature.name)}
                          >
                            View
                          </Button>
                        )}
                        
                        {/* Products JSON View button */}
                        {feature.key === 'productsJson' && (() => {
                          console.log('[SETTINGS DEBUG] Products JSON button check:');
                          console.log('[SETTINGS DEBUG] - feature.key === productsJson:', feature.key === 'productsJson');
                          console.log('[SETTINGS DEBUG] - showProductsJsonView:', showProductsJsonView);
                          console.log('[SETTINGS DEBUG] - Should show button:', feature.key === 'productsJson' && showProductsJsonView);
                          return feature.key === 'productsJson' && showProductsJsonView;
                        })() && (
                          <Button
                            size="slim"
                            onClick={() => viewJson(feature.key, feature.name)}
                          >
                            View
                          </Button>
                        )}
                        
                        {/* Collections JSON View button */}
                        {feature.key === 'collectionsJson' && (() => {
                          console.log('[SETTINGS DEBUG] Collections JSON button check:');
                          console.log('[SETTINGS DEBUG] - feature.key === collectionsJson:', feature.key === 'collectionsJson');
                          console.log('[SETTINGS DEBUG] - showCollectionsJsonView:', showCollectionsJsonView);
                          console.log('[SETTINGS DEBUG] - Should show button:', feature.key === 'collectionsJson' && showCollectionsJsonView);
                          return feature.key === 'collectionsJson' && showCollectionsJsonView;
                        })() && (
                          <Button
                            size="slim"
                            onClick={() => viewJson(feature.key, feature.name)}
                          >
                            View
                          </Button>
                        )}
                        
                        {/* Store Metadata View button */}
                        {feature.key === 'storeMetadata' && showStoreMetadataView && (
                          <Button
                            size="slim"
                            onClick={() => viewJson(feature.key, feature.name)}
                          >
                            View
                          </Button>
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
                    ) : (
                      <Checkbox
                        label={
                          <InlineStack gap="200" align="center">
                            <Text variant="bodySm" tone="subdued">
                              {feature.name}
                            </Text>
                            {feature.requiredPlan && (
                              <Badge tone="info" size="small">
                                {feature.requiredPlan}
                                {feature.requiredPlan !== 'Enterprise' && '+'} 
                              </Badge>
                            )}
                          </InlineStack>
                        }
                        checked={false}
                        onChange={() => toggleFeature(feature.key)}
                        disabled={true}
                        helpText={`Upgrade to ${feature.requiredPlan} plan to enable`}
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

      {/* Advanced Schema Data Management - shows only for Enterprise plan AND if enabled */}
      {normalizePlan(settings?.plan) === 'enterprise' && 
       settings?.features?.schemaData && 
       originalSettings?.features?.schemaData && (
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
                    // First check if there's existing data
                    const existingData = await api(`/ai/schema-data.json?shop=${shop}`);
                    
                    if (existingData.schemas && existingData.schemas.length > 0) {
                      // Has data - ask if to regenerate
                      if (!confirm('This will replace existing schema data. Continue?')) {
                        return;
                      }
                    }
                    
                    // Continue with generation
                    setSchemaGenerating(true);
                    setSchemaComplete(false);
                    setSchemaProgress({
                      current: 0,
                      total: 0,
                      percent: 0,
                      currentProduct: 'Initializing...',
                      stats: {
                        siteFAQ: false,
                        products: 0,
                        totalSchemas: 0
                      }
                    });
                    
                    try {
                      const data = await api(`/api/schema/generate-all?shop=${shop}`, {
                        method: 'POST',
                        shop,
                        body: { shop }
                      });
                      
                      // Start checking progress after 2 seconds
                      setTimeout(checkGenerationProgress, 2000);
                    } catch (err) {
                      console.error('Error:', err);
                      setToast('Failed to generate schema');
                      setSchemaGenerating(false);
                    }
                  }}
                >
                  Generate/Update Schema Data
                </Button>
                
                <Button
                  onClick={() => {
                    window.open(`/ai/schema-data.json?shop=${shop}`, '_blank');
                  }}
                >
                  View Generated Schema
                </Button>
                
                <Button
                  destructive
                  onClick={async () => {
                    if (confirm('This will delete all advanced schema data. Are you sure?')) {
                      try {
                        await api(`/api/schema/delete?shop=${shop}`, {
                          method: 'DELETE',
                          shop,
                          body: { shop }
                        });
                        
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
              
              <Banner status="info" tone="subdued">
                <p>Generation creates BreadcrumbList, FAQPage, WebPage and more schemas for each product. 
                AI can access them at <code>/ai/product/[handle]/schemas.json</code></p>
              </Banner>
            </BlockStack>
          </Box>
        </Card>
      )}

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
          disabled={!settings}
        >
          Save Settings
        </Button>
      </InlineStack>

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
                    <li>Go to <strong>Online Store â†’ Themes</strong></li>
                    <li>Click <strong>Actions â†’ Edit code</strong> on your active theme</li>
                    <li>In the file browser, look for <strong>robots.txt.liquid</strong></li>
                    <li>If it doesn't exist, click <strong>Add a new template</strong> â†’ Select "robots" â†’ Create</li>
                    <li>Replace the content with what you copied</li>
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
                <li>Then click "Apply Automatically" to configure robots.txt</li>
              </ol>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Manual Instructions Modal */}
      {showManualInstructions && (
        <Modal
          open={showManualInstructions}
          onClose={() => setShowManualInstructions(false)}
          title="Manual robots.txt Configuration"
          primaryAction={{
            content: 'Continue',
            onAction: () => {
              setShowManualInstructions(false);
              setShowRobotsModal(true);
            }
          }}
          secondaryActions={[{
            content: 'Cancel',
            onAction: () => setShowManualInstructions(false)
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text variant="headingMd">How to add robots.txt manually:</Text>
              
              <ol style={{ marginLeft: '20px', marginTop: '10px' }}>
                <li>Click "Continue" to see your custom robots.txt content</li>
                <li>Copy the generated content</li>
                  <li>Go to <strong>Online Store â†’ Themes</strong></li>
                  <li>Click <strong>Actions â†’ Edit code</strong> on your active theme</li>
                <li>Find or create <strong>robots.txt.liquid</strong> file</li>
                <li>Paste the content and save</li>
              </ol>
              
              <Banner status="info">
                <p>This allows AI bots to discover and properly index your products.</p>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Test Plan Switcher - for development only */}
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

      {/* JSON View Modal */}
      {jsonModalOpen && (
        <Modal
          open={jsonModalOpen}
          onClose={() => {
            setJsonModalOpen(false);
            setJsonModalContent(null);
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

      {/* Debug log for modal state */}
      {debugLog('Modal states', { 
        schemaGenerating, 
        schemaComplete,
        modalShouldShow: schemaGenerating && !schemaComplete 
      })}

      {/* Simple test modal */}
      {schemaGenerating && !schemaComplete && (
        <Modal
          open={schemaGenerating}
          title="Generating Advanced Schema Data"
          onClose={() => {
            debugLog('Modal close clicked');
            setSchemaGenerating(false);
          }}
        >
          <Modal.Section>
            <Text>Modal is showing! Progress: {schemaProgress.percent}%</Text>
          </Modal.Section>
        </Modal>
      )}

      {/* Schema Generation Complete Modal */}
      {schemaComplete && (
        <Modal
          open={true}
          title="Schema Generation Complete"
          onClose={() => {
            setSchemaGenerating(false);
            setSchemaComplete(false);
          }}
          primaryAction={{
            content: 'View Generated Schemas',
            onAction: () => {
              window.open(`/ai/schema-data.json?shop=${shop}`, '_blank');
              setSchemaGenerating(false);
              setSchemaComplete(false);
            }
          }}
          secondaryActions={[{
            content: 'Close',
            onAction: () => {
              setSchemaGenerating(false);
              setSchemaComplete(false);
            }
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner status="success" title="Generation successful!">
                <p>Advanced schema data has been generated for your products.</p>
              </Banner>
              
              <Text variant="headingMd">Generation Statistics</Text>
              
              <InlineStack gap="600" wrap>
                <Box>
                  <Text variant="bodyMd" tone="subdued">Site FAQ</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.siteFAQ ? 'âœ“' : 'â€”'}
                  </Text>
                </Box>
                
                <Box>
                  <Text variant="bodyMd" tone="subdued">Products Processed</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.products}
                  </Text>
                </Box>
                
                <Box>
                  <Text variant="bodyMd" tone="subdued">Total Schemas</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.totalSchemas}
                  </Text>
                </Box>
              </InlineStack>
              
              <Box paddingBlockStart="200">
                <Text variant="bodySm" tone="subdued">
                  Schemas are now available at /ai/product/[handle]/schemas.json
                </Text>
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Schema Generation Progress Modal */}
      {schemaGenerating && !schemaComplete && (
        <Modal
          open={true}
          title="Generating Advanced Schema Data"
          onClose={() => {}}
          noScroll
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text variant="bodyMd">
                Generating schemas for your products...
              </Text>
              <ProgressBar progress={schemaProgress.percent} size="small" />
              <Text variant="bodySm" tone="subdued">
                This process may take 1-2 minutes depending on the number of products.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Schema Generation Complete Modal */}
      {schemaComplete && (
        <Modal
          open={true}
          title="Schema Generation Complete"
          onClose={() => {
            setSchemaGenerating(false);
            setSchemaComplete(false);
          }}
          primaryAction={{
            content: 'View Generated Schemas',
            onAction: () => {
              window.open(`/ai/schema-data.json?shop=${shop}`, '_blank');
              setSchemaGenerating(false);
              setSchemaComplete(false);
            }
          }}
          secondaryActions={[{
            content: 'Close',
            onAction: () => {
              setSchemaGenerating(false);
              setSchemaComplete(false);
            }
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner status="success" title="Generation successful!">
                <p>Advanced schema data has been generated for your products.</p>
              </Banner>
              
              <Text variant="headingMd">Generation Statistics</Text>
              
              <InlineStack gap="600" wrap>
                <Box>
                  <Text variant="bodyMd" tone="subdued">Site FAQ</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.siteFAQ ? 'âœ“' : 'â€”'}
                  </Text>
                </Box>
                
                <Box>
                  <Text variant="bodyMd" tone="subdued">Products Processed</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.products}
                  </Text>
                </Box>
                
                <Box>
                  <Text variant="bodyMd" tone="subdued">Total Schemas</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {schemaProgress.stats.totalSchemas}
                  </Text>
                </Box>
              </InlineStack>
              
              <Box paddingBlockStart="200">
                <Text variant="bodySm" tone="subdued">
                  Schemas are now available at /ai/product/[handle]/schemas.json
                </Text>
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Toast notifications */}
      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
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

/* 
COMMENTED OLD CODE FOR ADVANCED SCHEMA CHECKBOX - FOR TESTING

onChange={async (checked) => {
  console.log('Advanced Schema checkbox clicked:', checked);
  setAdvancedSchemaEnabled(checked);
  setSchemaError('');
  
  // Save the setting in AI Discovery settings
  try {
    console.log('Saving settings to AI Discovery...');
    await api(`/api/ai-discovery/settings?shop=${shop}`, {
      method: 'POST',
      shop,
      body: {
        shop,
        ...settings,
        advancedSchemaEnabled: checked
      }
    });
    
    console.log('Advanced Schema setting saved successfully');
  } catch (err) {
    console.error('Failed to save Advanced Schema setting:', err);
    setSchemaError('Failed to save settings');
    setAdvancedSchemaEnabled(false);
    return;
  }
  
  // Trigger schema generation if enabled
  if (checked) {
    console.log('Triggering schema generation...');
    console.log('Shop:', shop);
    setSchemaGenerating(true);
    
    try {
      const url = '/api/schema/generate-all';
      console.log('Calling:', url);
      
      const result = await api(url, {
        method: 'POST', 
        shop,
        body: { shop }
      });
      
      console.log('Schema generation result:', result);
      
      // Show progress for 30 seconds
      setTimeout(() => {
        setSchemaGenerating(false);
      }, 30000);
      
    } catch (err) {
      console.error('Schema generation error:', err);
      setSchemaError(err.message);
      setSchemaGenerating(false);
      setAdvancedSchemaEnabled(false);
    }
  }
}}
*/