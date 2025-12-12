// frontend/src/pages/BulkEdit.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useShopApi } from '../hooks/useShopApi.js';
import {
  Page,
  Card,
  ResourceList,
  ResourceItem,
  Button,
  Select,
  Box,
  InlineStack,
  Text,
  Toast,
  Badge,
  ProgressBar,
  EmptyState,
  Modal,
  Layout,
  Checkbox,
  BlockStack,
  Divider,
  TextField,
  Thumbnail,
  ChoiceList,
  Popover,
  ActionList,
  Banner,
  Spinner,
} from '@shopify/polaris';
import { SearchIcon } from '@shopify/polaris-icons';
import UpgradeModal from '../components/UpgradeModal.jsx';
import InsufficientTokensModal from '../components/InsufficientTokensModal.jsx';
import TrialActivationModal from '../components/TrialActivationModal.jsx';
import TokenPurchaseModal from '../components/TokenPurchaseModal.jsx';
import { StoreMetadataBanner } from '../components/StoreMetadataBanner.jsx';

const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; }
};

const toProductGID = (val) => {
  if (!val) return val;
  const s = String(val).trim();
  return s.startsWith('gid://') ? s : `gid://shopify/Product/${s}`;
};

const extractNumericId = (gid) => {
  if (!gid) return '';
  const match = String(gid).match(/\/(\d+)$/);
  return match ? match[1] : gid;
};

// Helper function to suggest next plan based on product count
const getNextPlanForLimit = (count) => {
  if (count <= 70) return 'Starter';
  if (count <= 200) return 'Professional';
  if (count <= 450) return 'Growth';
  if (count <= 750) return 'Growth Extra';
  return 'Enterprise';
};


export default function BulkEdit({ shop: shopProp, globalPlan }) {
  const { api, shop: hookShop } = useShopApi();
  const shop = shopProp || hookShop || qs('shop', '');
  
  // Component mounted debug
  useEffect(() => {
  }, [shop, api]);
  
  // Product list state
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  
  // Selection state
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectAllPages, setSelectAllPages] = useState(false);
  const [selectAllInStore, setSelectAllInStore] = useState(false);
  const [showSelectionPopover, setShowSelectionPopover] = useState(false);
  
  // Filter state
  const [searchValue, setSearchValue] = useState('');
  const [optimizedFilter, setOptimizedFilter] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [selectedTags, setSelectedTags] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [showOptimizedPopover, setShowOptimizedPopover] = useState(false);
  const [showLanguagePopover, setShowLanguagePopover] = useState(false);
  const [showTagsPopover, setShowTagsPopover] = useState(false);
  const [showSortPopover, setShowSortPopover] = useState(false);
  
  // SEO generation state
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState([]);
  const [selectedLanguages, setSelectedLanguages] = useState([]);
  const [availableLanguages, setAvailableLanguages] = useState([]);
  
  // Progress state
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [currentProduct, setCurrentProduct] = useState('');
  const [errors, setErrors] = useState([]);
  
  // Results state
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedDeleteLanguages, setSelectedDeleteLanguages] = useState([]);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  
  // Skip/Fail Reasons Modal
  const [showReasonsModal, setShowReasonsModal] = useState(false);
  const [reasonsModalType, setReasonsModalType] = useState('skipped'); // 'skipped' or 'failed'
  const [reasonsModalData, setReasonsModalData] = useState([]);
  
  // Toast
  const [toast, setToast] = useState('');
  
  // AI Enhancement Job status (background processing)
  const [aiEnhanceJobStatus, setAiEnhanceJobStatus] = useState({
    inProgress: false,
    status: 'idle',
    message: null,
    totalProducts: 0,
    processedProducts: 0,
    successfulProducts: 0,
    failedProducts: 0,
    skippedProducts: 0,
    completedAt: null,
    progress: null, // { current, total, percent, elapsedSeconds, remainingSeconds }
    // Pre-failed products (no Basic SEO) - added locally without sending to backend
    pendingNoSeoFailed: 0,
    pendingNoSeoReasons: []
  });
  const aiEnhancePollingRef = useRef(null);
  
  // Background SEO Job status (Generate + Apply combined)
  const [seoJobStatus, setSeoJobStatus] = useState({
    inProgress: false,
    status: 'idle',
    phase: null,
    message: null,
    totalProducts: 0,
    processedProducts: 0,
    successfulProducts: 0,
    failedProducts: 0,
    skippedProducts: 0,
    progress: null // { current, total, percent, elapsedSeconds, remainingSeconds }
  });
  const seoJobPollingRef = useRef(null); // Use ref to avoid stale closure issues
  const loadProductsRef = useRef(null); // Ref to always have latest loadProducts
  const currentPageRef = useRef(1); // Ref to track current page for refresh after operations
  
  // Live countdown for remaining time (decreases every second)
  const [seoRemainingSeconds, setSeoRemainingSeconds] = useState(0);
  const [aiEnhanceRemainingSeconds, setAiEnhanceRemainingSeconds] = useState(0);
  
  // Update local countdown when server sends new remaining time
  useEffect(() => {
    if (seoJobStatus.progress?.remainingSeconds != null) {
      setSeoRemainingSeconds(seoJobStatus.progress.remainingSeconds);
    }
  }, [seoJobStatus.progress?.remainingSeconds]);
  
  useEffect(() => {
    if (aiEnhanceJobStatus.progress?.remainingSeconds != null) {
      setAiEnhanceRemainingSeconds(aiEnhanceJobStatus.progress.remainingSeconds);
    }
  }, [aiEnhanceJobStatus.progress?.remainingSeconds]);
  
  // Countdown timer - decreases every second when job is in progress
  useEffect(() => {
    if (!seoJobStatus.inProgress) return;
    const interval = setInterval(() => {
      setSeoRemainingSeconds(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [seoJobStatus.inProgress]);
  
  useEffect(() => {
    if (!aiEnhanceJobStatus.inProgress) return;
    const interval = setInterval(() => {
      setAiEnhanceRemainingSeconds(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [aiEnhanceJobStatus.inProgress]);
  
  // Background Delete Job status
  const [deleteJobStatus, setDeleteJobStatus] = useState({
    inProgress: false,
    status: 'idle',
    message: null,
    totalProducts: 0,
    processedProducts: 0,
    deletedProducts: 0,
    failedProducts: 0,
    completedAt: null
  });
  
  // Plan and help modal state
  const [plan, setPlan] = useState(null);
  const [productLimit, setProductLimit] = useState(70); // Default to Starter limit
  const [languageLimit, setLanguageLimit] = useState(1); // Default to 1 for Starter
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [hasVisitedProducts, setHasVisitedProducts] = useState(
    localStorage.getItem('hasVisitedProducts') === 'true'
  );
  const [showPlanUpgradeModal, setShowPlanUpgradeModal] = useState(false);
  const [showInsufficientTokensModal, setShowInsufficientTokensModal] = useState(false);
  const [showTrialActivationModal, setShowTrialActivationModal] = useState(false);
  const [showTokenPurchaseModal, setShowTokenPurchaseModal] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [currentPlan, setCurrentPlan] = useState('starter');
  const [graphqlDataLoaded, setGraphqlDataLoaded] = useState(false); // Track if GraphQL data has been loaded
  
  // Fetch SEO job status from backend
  const fetchSeoJobStatus = useCallback(async () => {
    try {
      const status = await api(`/api/seo/job-status?shop=${shop}`);
      
      // Check previous state to detect completion
      setSeoJobStatus(prevStatus => {
        const wasInProgress = prevStatus.inProgress;
        const justCompleted = wasInProgress && !status.inProgress && 
          (status.status === 'completed' || status.status === 'failed');
        
        if (justCompleted) {
          // Stop polling using ref (no stale closure)
          if (seoJobPollingRef.current) {
            clearInterval(seoJobPollingRef.current);
            seoJobPollingRef.current = null;
          }
          
          // Show toast
          if (status.status === 'completed') {
            const msg = `Applied GEO to ${status.successfulProducts} product${status.successfulProducts !== 1 ? 's' : ''}` +
              (status.skippedProducts > 0 ? ` (${status.skippedProducts} skipped)` : '') +
              (status.failedProducts > 0 ? ` (${status.failedProducts} failed)` : '');
            setToast(msg);
          } else {
            setToast(`GEO optimization failed: ${status.message || 'Unknown error'}`);
          }
          
          // Refresh products list to update badges - stay on current page
          if (loadProductsRef.current) {
            loadProductsRef.current(currentPageRef.current, false, Date.now());
          }
        }
        
        return status;
      });
      
      return status;
    } catch (error) {
      console.error('[BULK-EDIT] Failed to fetch SEO job status:', error);
    }
  }, [shop, api, optimizedFilter, searchValue, sortBy, sortOrder]);
  
  // Start polling for SEO job status
  const startSeoJobPolling = useCallback(() => {
    // Clear any existing polling
    if (seoJobPollingRef.current) {
      clearInterval(seoJobPollingRef.current);
    }
    
    // Set initial state to inProgress so we can detect completion
    setSeoJobStatus(prev => ({ ...prev, inProgress: true }));
    
    fetchSeoJobStatus();
    
    seoJobPollingRef.current = setInterval(() => {
      fetchSeoJobStatus();
    }, 5000); // Poll every 5 seconds
  }, [fetchSeoJobStatus]);
  
  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (seoJobPollingRef.current) {
        clearInterval(seoJobPollingRef.current);
      }
    };
  }, []);
  
  // Fetch SEO job status on mount (to restore state after navigation)
  useEffect(() => {
    if (shop && api) {
      fetchSeoJobStatus().then(status => {
        // If there's an active job, start polling
        if (status?.inProgress) {
          startSeoJobPolling();
        }
      });
    }
  }, [shop]); // Only run on mount
  
  // Update currentPlan when globalPlan changes (e.g., after upgrade)
  // NOTE: This should only be used as fallback - GraphQL query is primary source
  useEffect(() => {
    // Only update if globalPlan has valid data (not empty strings)
    if (!globalPlan || typeof globalPlan !== 'object') {
      return;
    }
    
    // CRITICAL: Only use globalPlan if GraphQL hasn't loaded yet
    // This prevents overwriting correct data from GraphQL with stale cache
    if (!graphqlDataLoaded && currentPlan === 'starter') {
      if (globalPlan.planKey && globalPlan.planKey !== '') {
        setCurrentPlan(globalPlan.planKey);
        
        // Get limits dynamically from globalPlan (snake_case from GraphQL)
        const newLanguageLimit = globalPlan.language_limit || 1;
        const newProductLimit = globalPlan.product_limit || 70;
        setLanguageLimit(newLanguageLimit);
        setProductLimit(newProductLimit);
      } else if (globalPlan.plan && globalPlan.plan !== '') {
        // Fallback: if planKey is missing, try to derive it from plan name
        const planKey = globalPlan.plan.toLowerCase().replace(/\s+/g, '-');
        setCurrentPlan(planKey);
        
        // Get limits dynamically from globalPlan (snake_case from GraphQL)
        const newLanguageLimit = globalPlan.language_limit || 1;
        const newProductLimit = globalPlan.product_limit || 70;
        setLanguageLimit(newLanguageLimit);
        setProductLimit(newProductLimit);
      }
    }
  }, [globalPlan, currentPlan, graphqlDataLoaded]);
  
  // Auto-close upgrade modal if selection is now within limit
  useEffect(() => {
    if (showPlanUpgradeModal && plan) {
      const currentSelection = selectAllInStore ? totalCount : selectedItems.length;
      
      if (currentSelection <= productLimit) {
        setShowPlanUpgradeModal(false);
        setTokenError(null);
      }
    }
  }, [selectedItems.length, selectAllPages, selectAllInStore, totalCount, showPlanUpgradeModal, plan]);
  
  // Load models and plan on mount
  useEffect(() => {
    if (!shop) return;
    const Q = `
      query PlansMe($shop:String!) {
        plansMe(shop:$shop) {
          plan
          planKey
          modelsSuggested
          product_limit
          language_limit
        }
      }
    `;
    api('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: Q, variables: { shop } }),
    })
      .then((res) => {
        if (res?.errors?.length) throw new Error(res.errors[0]?.message || 'GraphQL error');
        const data = res?.data?.plansMe;
        
        const models = data?.modelsSuggested || ['anthropic/claude-3.5-sonnet'];
        setModelOptions(models.map((m) => ({ label: m, value: m })));
        setModel(models[0]);
        setPlan(data?.plan || 'starter');
        setCurrentPlan(data?.planKey || 'starter');
        
        // Set limits from API response (dynamic from backend/plans.js)
        // CRITICAL: Always use GraphQL response as source of truth
        const newProductLimit = data?.product_limit || 70;
        const newLanguageLimit = data?.language_limit || 1;
        
        setProductLimit(newProductLimit);
        setLanguageLimit(newLanguageLimit);
        
        // Mark GraphQL data as loaded to prevent globalPlan from overwriting
        setGraphqlDataLoaded(true);
      })
      .catch((e) => {
        console.error('[BULK-EDIT] GraphQL plansMe failed:', e);
        // Even on error, mark as loaded to prevent infinite fallback attempts
        setGraphqlDataLoaded(true);
      });
  }, [shop, api]);
  
  // Load shop languages
  useEffect(() => {
    if (!shop) {
      return;
    }
    // оставяме :shop в path (бекендът може да го очаква), но пращаме и session token
    
    // Add timeout to detect hanging requests
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('API request timeout after 10 seconds')), 10000);
    });
    
    Promise.race([
      api(`/api/languages/shop/${shop}`),
      timeoutPromise
    ])
      .then((data) => {
        const langs = Array.isArray(data?.shopLanguages) && data.shopLanguages.length ? data.shopLanguages : ['en'];
        setAvailableLanguages(langs.includes('en') ? langs : ['en', ...langs]);
      })
      .catch((error) => {
        console.error('[BULK-EDIT] Languages API error:', error);
        // console.error('[BULK-EDIT] Error details:', error.message, error.stack);
        setAvailableLanguages(['en']);
      });
  }, [shop, api]);

  // Load available tags
  useEffect(() => {
    if (!shop) return;
    // стандартен GET: подаваме shop през опции (по-чист URL)
    api(`/api/products/tags/list`, { shop })
      .then((data) => setAvailableTags(data?.tags || []))
      .catch((err) => console.error('Failed to load tags:', err));
  }, [shop, api]);
  
  // Load products
  const loadProducts = useCallback(async (pageNum = 1, append = false, timestamp = null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        shop,
        page: pageNum,
        limit: itemsPerPage,
        ...(optimizedFilter !== 'all' && { optimized: optimizedFilter }),
        ...(searchValue && { search: searchValue }),
        ...(languageFilter && { languageFilter }),
        ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
        sortBy,
        sortOrder,
        ...(timestamp && { _t: timestamp }) // Cache-busting parameter
      });
      
      // URL вече съдържа shop + params → не подаваме {shop}, за да не дублираме
      const data = await api(`/api/products/list?${params}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (append) {
        setProducts(prev => [...prev, ...data.products]);
      } else {
        setProducts(data.products || []);
      }
      
      setPage(pageNum);
      setHasMore(data.pagination?.hasNext || false);
      const total = data.pagination?.total || 0;
      setTotalCount(total);
      setTotalPages(Math.ceil(total / itemsPerPage) || 1);
    } catch (err) {
      setProducts(append ? products : []);
      setHasMore(false);
      setToast(`Error loading products: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [shop, optimizedFilter, searchValue, languageFilter, selectedTags, sortBy, sortOrder, itemsPerPage]);
  
  // Keep ref updated with latest loadProducts (for use in polling callbacks)
  useEffect(() => {
    loadProductsRef.current = loadProducts;
  }, [loadProducts]);

  // Keep page ref updated (for use in polling callbacks to stay on current page)
  useEffect(() => {
    currentPageRef.current = page;
  }, [page]);
  
  // Initial load and filter changes
  useEffect(() => {
    if (shop) {
      loadProducts(1, false, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop, optimizedFilter, languageFilter, selectedTags, sortBy, sortOrder, itemsPerPage]);
  
  // Mark as visited on first load
  useEffect(() => {
    if (!hasVisitedProducts && shop) {
      localStorage.setItem('hasVisitedProducts', 'true');
      setHasVisitedProducts(true);
    }
  }, [hasVisitedProducts, shop]);

  // Show help modal when no products are loaded initially AND it's first visit OR no products exist
  useEffect(() => {
    if (products.length === 0 && !loading && shop && !hasVisitedProducts) {
      setShowHelpModal(true);
    }
  }, [products.length, loading, shop, hasVisitedProducts]);
  
  // DEBUG: Monitor products and selectedItems changes
  useEffect(() => {
  }, [products, selectedItems]);
  
  // Unified search function
  const handleSearch = useCallback((value) => {
    setSearchValue(value);
  }, []);
  
  // Search debounce effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (shop) {
        loadProducts(1, false, null);
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [searchValue]);
  
  // Handle selection
  const handleSelectionChange = useCallback((items) => {
    
    setSelectedItems(items);
    if (items.length === 0) {
      setSelectAllPages(false);
    } else if (selectAllPages && items.length < products.length) {
      // If some items are deselected while selectAllPages is true, turn it off
      setSelectAllPages(false);
    }
  }, [selectAllPages, products.length]);
  
  const handleSelectAllPages = useCallback((checked) => {
    setSelectAllPages(checked);
    setSelectAllInStore(false);
    if (checked) {
      setSelectedItems(products.map(p => p.id));
    } else {
      setSelectedItems([]);
    }
  }, [products]);
  
  // Handle "Select all in this store" action
  const handleSelectAllInStore = useCallback(async () => {
    setSelectAllInStore(true);
    setSelectAllPages(true);
    setSelectedItems(products.map(p => p.id));
    setShowSelectionPopover(false);
  }, [products]);
  
  // Handle "Unselect all" action
  const handleUnselectAll = useCallback(() => {
    setSelectAllInStore(false);
    setSelectAllPages(false);
    setSelectedItems([]);
    setShowSelectionPopover(false);
  }, []);
  
  // Handle items per page change
  const handleItemsPerPageChange = useCallback((value) => {
    setItemsPerPage(parseInt(value, 10));
    setPage(1);
    setSelectedItems([]);
    setSelectAllPages(false);
    setSelectAllInStore(false);
  }, []);
  
  // Pagination handlers
  const handlePreviousPage = useCallback(() => {
    if (page > 1) {
      loadProducts(page - 1, false, null);
      setSelectedItems([]);
      setSelectAllPages(false);
      setSelectAllInStore(false);
    }
  }, [page, loadProducts]);
  
  const handleNextPage = useCallback(() => {
    if (page < totalPages) {
      loadProducts(page + 1, false, null);
      setSelectedItems([]);
      setSelectAllPages(false);
      setSelectAllInStore(false);
    }
  }, [page, totalPages, loadProducts]);

  // Calculate maximum NEW languages that can be added
  // Takes into account already optimized languages across selected products
  // Check if the selected languages would exceed the plan limit for any selected product
  const checkLanguageLimitExceeded = useMemo(() => {
    if (selectAllInStore) {
      // For "select all in store", just check if we're selecting more than the plan allows
      return selectedLanguages.length > languageLimit;
    }
    
    const selectedProducts = products.filter(p => selectedItems.includes(p.id));
    if (selectedProducts.length === 0) {
      // No products selected - just check total selected languages
      return selectedLanguages.length > languageLimit;
    }
    
    // For each selected product, check if adding the new languages would exceed the limit
    for (const product of selectedProducts) {
      const existingLanguages = product.optimizationSummary?.optimizedLanguages || [];
      
      // Find which of the selected languages are actually NEW (not already optimized)
      const newLanguages = selectedLanguages.filter(lang => !existingLanguages.includes(lang));
      
      // Total languages after adding new ones
      const totalLanguages = existingLanguages.length + newLanguages.length;
      
      if (totalLanguages > languageLimit) {
        return true; // Exceeds limit
      }
    }
    
    return false; // All products are within limit
  }, [products, selectedItems, selectAllInStore, languageLimit, selectedLanguages]);

  // Open language selection modal
  const openLanguageModal = () => {
    if (selectedItems.length === 0 && !selectAllPages && !selectAllInStore) {
      setToast('Please select products first');
      return;
    }
    setShowLanguageModal(true);
  };
  
  // Open delete language selection modal
  const openDeleteModal = () => {
    if (selectedItems.length === 0 && !selectAllPages && !selectAllInStore) {
      setToast('Please select products first');
      return;
    }
    setSelectedDeleteLanguages([]);
    setShowDeleteModal(true);
  };

  // ============================================================
  // AI Enhancement Background Job Functions
  // ============================================================
  
  // Fetch AI Enhancement job status
  const fetchAiEnhanceJobStatus = useCallback(async () => {
    try {
      const status = await api(`/ai-enhance/job-status?shop=${shop}`);
      
      setAiEnhanceJobStatus(prevStatus => {
        const justCompleted = prevStatus.inProgress && !status.inProgress && 
          (status.status === 'completed' || status.status === 'failed');
        
        // Add pending "no SEO" failures to the final count
        const pendingNoSeoFailed = prevStatus.pendingNoSeoFailed || 0;
        const pendingNoSeoReasons = prevStatus.pendingNoSeoReasons || [];
        
        if (justCompleted) {
          // Stop polling
          if (aiEnhancePollingRef.current) {
            clearInterval(aiEnhancePollingRef.current);
            aiEnhancePollingRef.current = null;
          }
          
          // Calculate totals including pre-failed products
          const totalFailed = (status.failedProducts || 0) + pendingNoSeoFailed;
          const totalFailReasons = [...(status.failReasons || []), ...pendingNoSeoReasons];
          
          // Show toast with combined totals
          if (status.status === 'completed') {
            const msg = `AI Enhanced ${status.successfulProducts} product${status.successfulProducts !== 1 ? 's' : ''}` +
              (status.skippedProducts > 0 ? ` (${status.skippedProducts} skipped)` : '') +
              (totalFailed > 0 ? ` (${totalFailed} failed)` : '');
            setToast(msg);
          } else if (status.status === 'failed') {
            setToast(`AI Enhancement failed: ${status.message || 'Unknown error'}`);
          }
          
          // Refresh products to update badges - stay on current page
          if (loadProductsRef.current) {
            loadProductsRef.current(currentPageRef.current, false, Date.now());
        }
        
          // Return status with combined failures
          return {
            ...status,
            failedProducts: totalFailed,
            failReasons: totalFailReasons,
            pendingNoSeoFailed: 0,
            pendingNoSeoReasons: []
          };
        }
        
        // Keep pending values during processing
        return {
          ...status,
          pendingNoSeoFailed,
          pendingNoSeoReasons
        };
      });
      
      return status;
    } catch (error) {
      console.error('[BULK-EDIT] Failed to fetch AI Enhance job status:', error);
    }
  }, [shop, api]);
  
  // Start polling for AI Enhancement job status
  const startAiEnhancePolling = useCallback(() => {
    if (aiEnhancePollingRef.current) {
      clearInterval(aiEnhancePollingRef.current);
    }
    fetchAiEnhanceJobStatus();
    aiEnhancePollingRef.current = setInterval(() => {
      fetchAiEnhanceJobStatus();
    }, 5000);
  }, [fetchAiEnhanceJobStatus]);
  
  // Cleanup AI Enhancement polling on unmount
  useEffect(() => {
    return () => {
      if (aiEnhancePollingRef.current) {
        clearInterval(aiEnhancePollingRef.current);
      }
    };
  }, []);
  
  // Check for in-progress AI Enhancement job on mount
  useEffect(() => {
    if (shop) {
      fetchAiEnhanceJobStatus().then(status => {
        if (status?.inProgress) {
          startAiEnhancePolling();
        }
      });
    }
  }, [shop, fetchAiEnhanceJobStatus, startAiEnhancePolling]);

  // AI Enhancement handler - now uses background queue
  const handleStartEnhancement = async () => {
    let selectedProducts = [];
    
    // Handle "Select all in store" - fetch all products
    if (selectAllInStore) {
      try {
        setToast('Loading all products...');
        const data = await api(`/api/products/list?shop=${encodeURIComponent(shop)}&limit=1000&fields=id,title,gid,optimizationSummary`);
        selectedProducts = data.products || [];
      } catch (error) {
        console.error('[BULK-EDIT] Failed to fetch all products:', error);
        setToast('Failed to load all products');
        return;
      }
    } else {
      selectedProducts = products.filter(p => selectedItems.includes(p.id));
    }
    
    const selectedWithSEO = selectedProducts.filter(p =>
      p.optimizationSummary?.optimizedLanguages?.length > 0
    );
    const selectedWithoutSEO = selectedProducts.filter(p =>
      !p.optimizationSummary?.optimizedLanguages?.length
    );
    
    // Filter out already AI Enhanced products (skip them to save tokens)
    const alreadyEnhanced = selectedWithSEO.filter(p =>
      p.optimizationSummary?.aiEnhanced === true
    );
    const needsEnhancement = selectedWithSEO.filter(p =>
      p.optimizationSummary?.aiEnhanced !== true
    );

    // Check if ALL selected products have no SEO
    if (selectedWithSEO.length === 0 && selectedWithoutSEO.length > 0) {
        setToast(`${selectedWithoutSEO.length} product(s) have no Basic SEO. Generate Basic SEO first.`);
      return;
      }
    
    if (selectedProducts.length === 0) {
      setToast('Please select products');
      return;
    }
    
    // Check if ALL products with SEO are already enhanced
    if (needsEnhancement.length === 0 && alreadyEnhanced.length > 0) {
      setToast(`All ${alreadyEnhanced.length} selected product(s) are already AI Enhanced. No action needed.`);
      return;
    }

    // Check product limit before processing (count only those that need enhancement)
    const selectedCount = needsEnhancement.length;
    
    if (selectedCount > productLimit) {
      // Show upgrade modal instead of processing
      const nextPlan = getNextPlanForLimit(selectedCount);
      setTokenError({
        error: `Product limit exceeded`,
        message: `Your ${plan} plan supports up to ${productLimit} products for AI Enhancement. You have selected ${selectedCount} products that need enhancement.`,
        minimumPlanRequired: nextPlan,
        currentPlan: plan,
        features: [
          `Optimize up to ${productLimit} products`,
          'All features from your current plan',
          nextPlan === 'Growth Extra' || nextPlan === 'Enterprise' ? 'AI-enhanced add-ons at no extra cost' : 'Access to AI-enhanced add-ons',
          nextPlan === 'Enterprise' ? 'Advanced Schema Data' : null
        ].filter(Boolean)
      });
      setShowPlanUpgradeModal(true);
      return;
    }
    
    // Show info toast if some products are being skipped
    if (alreadyEnhanced.length > 0) {
      setToast(`Skipping ${alreadyEnhanced.length} already enhanced product(s). Processing ${needsEnhancement.length} product(s).`);
    }

    // Prepare only products that NEED enhancement for batch processing
    const productsForBatch = needsEnhancement.map(product => ({
      productId: product.gid || toProductGID(product.id),
      languages: product.optimizationSummary.optimizedLanguages,
      title: product.title
    }));
    
    // If no products need enhancement (all skipped), exit early
    if (productsForBatch.length === 0) {
      setToast('No products to enhance. All selected products are either already enhanced or missing Basic SEO.');
      return;
    }
    
    // Track products without SEO to add to report as "failed"
    const productsWithoutSEOCount = selectedWithoutSEO.length;
    const productsWithoutSEOReasons = selectedWithoutSEO.map(p => `${p.title}: Basic SEO missing`);

    // Clear any previous badges when starting AI Enhancement
    setDeleteJobStatus({ inProgress: false, status: 'idle', message: null, completedAt: null });
    setSeoJobStatus({ inProgress: false, status: 'idle', message: null });

    try {
      const response = await api('/ai-enhance/batch', {
        method: 'POST',
        shop,
        body: {
          products: productsForBatch,
          // Include pre-failed products info for email reporting
          preFailed: {
            count: productsWithoutSEOCount,
            reasons: productsWithoutSEOReasons
          }
        }
      });

      if (response.queued) {
        // Calculate estimated time: products × avg languages × 2.8 seconds for AI Enhanced
        const totalLanguages = productsForBatch.reduce((sum, p) => sum + (p.languages?.length || 1), 0);
        const estimatedSeconds = totalLanguages * 2.8;
        
        // Store pending "no SEO" failures to add to final report
        setAiEnhanceJobStatus(prev => ({
          ...prev,
          pendingNoSeoFailed: productsWithoutSEOCount,
          pendingNoSeoReasons: productsWithoutSEOReasons
        }));
        
        // Show toast - include email notification if > 2 minutes
        const totalToProcess = productsForBatch.length + productsWithoutSEOCount;
        if (estimatedSeconds > 120) {
          setToast(`Enhancing ${totalToProcess} products in background. You'll receive an email when complete. Feel free to navigate away & explore other features.`);
        } else {
          setToast(`Enhancing ${totalToProcess} products in background. You can navigate away safely & explore other features.`);
        }
        
        setSelectedItems([]);
        setSelectAllPages(false);
        startAiEnhancePolling();
      } else {
        setToast(response.message || 'Failed to queue AI Enhancement job');
      }
    } catch (error) {
      // Handle plan/token errors
      if (error.status === 403) {
        setTokenError({
          ...error,
          message: error.message || 'AI-enhanced add-ons for Products require Professional plan or higher'
        });
        setCurrentPlan(error.currentPlan || currentPlan);
        
        if (error.needsUpgrade === false && error.requiresPurchase) {
          setShowInsufficientTokensModal(true);
        } else {
          setShowPlanUpgradeModal(true);
        }
        return;
      }
      
      if (error.status === 402 || error.requiresPurchase || error.trialRestriction) {
        setTokenError(error);
        setCurrentPlan(error.currentPlan || plan || 'starter');
        
        if (error.trialRestriction && error.requiresActivation) {
          setShowTrialActivationModal(true);
        } else if (error.trialRestriction) {
          setShowPlanUpgradeModal(true);
        } else {
          setShowInsufficientTokensModal(true);
        }
        return;
      }
      
      setToast(`Error: ${error.message || 'Failed to start AI Enhancement'}`);
    }
  };

  // Legacy: Close AI Enhancement modal (kept for compatibility but no longer used)
  const handleCloseAIEnhancement = () => {
    // No longer needed - background processing doesn't use modal
    const results = null;
    
    setShowAIEnhanceModal(false);
    setAIEnhanceProgress({
      processing: false,
      current: 0,
      total: 0,
      currentItem: '',
      results: null
    });
  };

  // Helper function to format time ago
  const timeAgo = (date) => {
    if (!date) return '';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };
  
  // Generate SEO for selected products
  const generateSEO = async () => {
    if (!selectedLanguages.length) {
      setToast('Please select at least one language');
      return;
    }
    
    // Ensure we have a valid model
    let finalModel = model;
    if (!finalModel || !finalModel.trim()) {
      finalModel = modelOptions[0]?.value || 'anthropic/claude-3.5-sonnet';
    }
    
    try {
      let productsToProcess = [];
      
      if (selectAllInStore) {
        // Fetch all products in store for "Select all in store"
        const data = await api(`/api/products/list?shop=${encodeURIComponent(shop)}&limit=1000&fields=id,title,gid,optimizationSummary`);
        productsToProcess = data.products || [];
      } else {
        productsToProcess = products.filter(p => selectedItems.includes(p.id));
      }
      
      // Filter out products that are ALREADY optimized for ALL selected languages
      // A product needs optimization only if it's missing at least one of the selected languages
      const alreadyOptimized = productsToProcess.filter(p => {
        const existingLangs = p.optimizationSummary?.optimizedLanguages || [];
        // Check if ALL selected languages are already optimized
        return selectedLanguages.every(lang => existingLangs.includes(lang));
      });
      
      const needsOptimization = productsToProcess.filter(p => {
        const existingLangs = p.optimizationSummary?.optimizedLanguages || [];
        // Needs optimization if at least one selected language is missing
        return selectedLanguages.some(lang => !existingLangs.includes(lang));
      });
      
      // Check if ALL products are already optimized
      if (needsOptimization.length === 0 && alreadyOptimized.length > 0) {
        setShowLanguageModal(false);
        setToast(`All ${alreadyOptimized.length} selected product(s) are already optimized for ${selectedLanguages.join(', ')}. No action needed.`);
        return;
      }
      
      if (productsToProcess.length === 0) {
        setShowLanguageModal(false);
        setToast('Please select products');
        return;
      }
      
      // Check if selection exceeds plan limit BEFORE processing (count only those that need optimization)
      const selectedCount = needsOptimization.length;
      
      if (selectedCount > productLimit) {
        setShowLanguageModal(false);
        
        // Show upgrade modal with product limit specific message
        const nextPlan = getNextPlanForLimit(selectedCount);
        setTokenError({
          error: `Product limit exceeded`,
          message: `Your ${currentPlan} plan supports up to ${productLimit} products for SEO optimization. You have selected ${selectedCount} products that need optimization.`,
          minimumPlanRequired: nextPlan,
          currentPlan: currentPlan,
          features: [
            `Optimize more products`,
            'All features from your current plan',
            nextPlan === 'Growth Extra' || nextPlan === 'Enterprise' ? 'AI-enhanced add-ons at no extra cost' : 'Access to AI-enhanced add-ons',
            nextPlan === 'Enterprise' ? 'Advanced Schema Data' : null
          ].filter(Boolean)
        });
        setShowPlanUpgradeModal(true);
        return;
      }
      
      // Close language modal
      setShowLanguageModal(false);
      
      // Show info toast if some products are being skipped
      if (alreadyOptimized.length > 0) {
        setToast(`Skipping ${alreadyOptimized.length} already optimized product(s). Processing ${needsOptimization.length} product(s).`);
      }
      
      // Clear any previous badges when starting optimize
      setDeleteJobStatus({ inProgress: false, status: 'idle', message: null, completedAt: null });
      setAiEnhanceJobStatus({ inProgress: false, status: 'idle', message: null, completedAt: null });
      
      // Prepare batch data for background processing - only products that NEED optimization
      const productsForBatch = needsOptimization.map(product => ({
        productId: product.gid || toProductGID(product.productId || product.id),
        title: product.title || 'Unknown product',
        languages: selectedLanguages,
        existingLanguages: product.optimizationSummary?.optimizedLanguages || []
      }));
      
      // If no products need optimization (all skipped), exit early
      if (productsForBatch.length === 0) {
        setToast('No products to optimize. All selected products are already optimized.');
        return;
      }
      
      // Send batch request for background Generate + Apply
      const response = await api('/api/seo/generate-apply-batch', {
        method: 'POST',
        shop,
        body: {
          shop,
          products: productsForBatch,
          model: finalModel
        }
      });
      
      if (response.queued) {
        // Clear selected items
        setSelectedItems([]);
        setSelectAllPages(false);
        
        // Calculate estimated time: ~1.3 seconds per product (languages processed together)
        const estimatedSeconds = productsForBatch.length * 1.3;
        
        // Show toast - include email notification if > 2 minutes
        if (estimatedSeconds > 120) {
          setToast(`Optimizing ${productsForBatch.length} products in background. You'll receive an email when complete. Feel free to navigate away & explore other features.`);
        } else {
          setToast(`Optimizing ${productsForBatch.length} products in background. You can navigate away safely & explore other features.`);
        }
        
        // Start polling for status
        startSeoJobPolling();
      } else {
        setToast(response.message || 'Failed to queue optimization job');
      }
      
    } catch (err) {
      setToast(`Error: ${err.message}`);
    }
  };
  
  // Delete SEO for selected products - OPTIMIZED: Background processing with inline status
  const deleteSEO = async () => {
    if (!selectedDeleteLanguages.length) {
      setToast('Please select at least one language to delete');
      return;
    }
    
    setShowDeleteModal(false);
    setShowDeleteConfirmModal(false);
    
    try {
      let productsToProcess = [];
      
      if (selectAllInStore) {
        // Fetch all products in store for "Select all in store"
        const data = await api(`/api/products/list?shop=${encodeURIComponent(shop)}&limit=1000&fields=id`);
        productsToProcess = data.products || [];
      } else {
        productsToProcess = products.filter(p => selectedItems.includes(p.id));
      }
      
      // Prepare all items for batch delete
      const itemsToDelete = [];
      let skippedCount = 0;
      
      for (const product of productsToProcess) {
          const productGid = product.gid || toProductGID(product.productId || product.id);
          const optimizedLanguages = product.optimizationSummary?.optimizedLanguages || [];
          
          // Only delete languages that are actually optimized
          const languagesToDelete = selectedDeleteLanguages.filter(lang => 
            optimizedLanguages && optimizedLanguages.length > 0 && optimizedLanguages.includes(lang)
          );
          
          if (languagesToDelete.length === 0) {
            skippedCount++;
            continue;
          }
          
        // Add each language as separate item
        for (const language of languagesToDelete) {
          itemsToDelete.push({ productId: productGid, language });
        }
      }
      
      if (itemsToDelete.length === 0) {
        setToast('No optimized products found to delete');
        return;
      }
      
      // Count unique products (not metafield items)
      const uniqueProductIds = [...new Set(itemsToDelete.map(item => item.productId))];
      const totalProductsToDelete = uniqueProductIds.length;
      
      // Clear any previous badges when starting delete
      setSeoJobStatus({ inProgress: false, status: 'idle', message: null });
      setAiEnhanceJobStatus({ inProgress: false, status: 'idle', message: null, completedAt: null });
      
      // Set initial delete status - shows inline card
      setDeleteJobStatus({
        inProgress: true,
        status: 'processing',
        message: `Deleting 0/${totalProductsToDelete} products...`,
        totalProducts: totalProductsToDelete,
        processedProducts: 0,
        deletedProducts: 0,
        failedProducts: 0,
        completedAt: null
      });
      
      // Start background delete
      await api('/seo/bulk-delete-batch', {
            method: 'POST',
            shop,
        body: { items: itemsToDelete }
      });
      
      // Poll for progress - start immediately, then every 500ms
      const checkStatus = async () => {
        try {
          // Add cache-buster to prevent 304 responses
          const status = await api(`/seo/delete-job-status?shop=${encodeURIComponent(shop)}&_t=${Date.now()}`);
          
          if (status.inProgress) {
            const current = status.processedProducts || status.deletedProducts || 0;
            setDeleteJobStatus({
              inProgress: true,
              status: 'processing',
              message: `Deleting ${current}/${totalProductsToDelete} products...`,
              totalProducts: totalProductsToDelete,
              processedProducts: current,
              deletedProducts: status.deletedProducts || 0,
              failedProducts: status.failedProducts || 0,
              completedAt: null
            });
            return false; // Not done yet
          } else if (status.status === 'completed') {
            // Job completed - show results
            const deletedCount = status.deletedProducts || 0;
            const failedCount = status.failedProducts || 0;
            
            // Update local state - remove deleted languages ONLY for selected products
            // FIX: Only update products that were actually selected for deletion
            const selectedProductIds = new Set(selectedItems.map(id => String(id)));
            
            setProducts(prevProducts => 
              prevProducts.map(prod => {
                // Get product ID as string for comparison
                const prodId = String(prod.productId || prod.id);
                
                // Only update products that were selected for deletion
                if (!selectedProductIds.has(prodId)) {
                  return prod; // Not selected - don't modify
                }
                
                  const currentOptimized = prod.optimizationSummary?.optimizedLanguages || [];
                  const newOptimized = currentOptimized.filter(lang => 
                  !selectedDeleteLanguages.includes(lang)
                  );
                  
                  return {
                    ...prod,
                    optimizationSummary: {
                      ...prod.optimizationSummary,
                      optimizedLanguages: newOptimized,
                      optimized: newOptimized.length > 0,
                    aiEnhanced: newOptimized.length > 0 ? prod.optimizationSummary?.aiEnhanced : false
                  }
                };
              })
            );
            
            // Clear selections
            setSelectedItems([]);
            setSelectAllPages(false);
            
            // Clear the "Completed" badge for optimization
            setSeoJobStatus({
              inProgress: false,
              status: 'idle',
              message: null
            });
            
            // Update delete status to completed
            setDeleteJobStatus({
              inProgress: false,
              status: 'completed',
              message: `Deleted ${deletedCount} product${deletedCount !== 1 ? 's' : ''}${failedCount > 0 ? ` (${failedCount} failed)` : ''}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}`,
              totalProducts: totalProductsToDelete,
              processedProducts: deletedCount + failedCount,
              deletedProducts: deletedCount,
              failedProducts: failedCount,
              completedAt: new Date().toISOString()
            });
            
            return true; // Done
          }
          return false;
        } catch (err) {
          console.error('Poll error:', err);
          return false;
        }
      };
      
      // Start polling
      const pollInterval = setInterval(async () => {
        const done = await checkStatus();
        if (done) {
          clearInterval(pollInterval);
        }
      }, 500);
      
      // Also check immediately after a short delay (in case it's very fast)
      setTimeout(async () => {
        const done = await checkStatus();
        if (done) {
          clearInterval(pollInterval);
        }
      }, 200);
      
      // Safety timeout - stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (deleteJobStatus.inProgress) {
          setDeleteJobStatus(prev => ({
            ...prev,
            inProgress: false,
            status: 'failed',
            message: 'Timeout - please refresh to check status'
          }));
        }
      }, 5 * 60 * 1000);
      
      return; // Don't continue - polling handles the rest
      
    } catch (err) {
      setToast(`Error: ${err.message}`);
      setDeleteJobStatus({
        inProgress: false,
        status: 'failed',
        message: err.message,
        totalProducts: 0,
        processedProducts: 0,
        deletedProducts: 0,
        failedProducts: 0,
        completedAt: null
      });
    }
  };
  
  // Resource list items
  const renderItem = (item) => {
    try {
      const product = item;
      const numericId = extractNumericId(product.productId || product.id);
      const optimizedLanguages = product.optimizationSummary?.optimizedLanguages || [];
      
      

      
      const media = product.images?.[0] ? (
      <Thumbnail
        source={product.images[0].url || product.images[0].src || product.images[0]}
        alt={product.title}
        size="small"
      />
    ) : product.imageUrl ? (
      <Thumbnail
        source={product.imageUrl}
        alt={product.title}
        size="small"
      />
    ) : (
      <Box width="40px" height="40px" background="surface-neutral" borderRadius="200" />
    );
    
    return (
      <ResourceItem
        id={product.id}
        media={media}
        accessibilityLabel={`View details for ${product.title}`}
        onClick={(e) => {
        }}
      >
        <InlineStack gap="400" align="center" blockAlign="center" wrap={false}>
          <Box style={{ flex: '1 1 40%', minWidth: '250px' }}>
            <Text variant="bodyMd" fontWeight="semibold">{product.title}</Text>
            <Text variant="bodySm" tone="subdued">ID: {numericId}</Text>
          </Box>
          
          <Box style={{ flex: '0 0 25%', minWidth: '160px' }}>
            <InlineStack gap="100" wrap>
              {(() => {
                
                if (availableLanguages.length > 0) {
                  return availableLanguages.map(lang => {
                    const isOptimized = optimizedLanguages.includes(lang);
                    const isDraft = product.status === 'DRAFT';
                    return (
                      <Badge
                        key={lang}
                        tone={isDraft ? 'subdued' : (isOptimized ? 'success' : 'subdued')}
                        size="small"
                      >
                        {lang.toUpperCase()}
                      </Badge>
                    );
                  });
                } else {
                  const isDraft = product.status === 'DRAFT';
                  return optimizedLanguages.map(lang => (
                    <Badge
                      key={lang}
                      tone={isDraft ? 'subdued' : 'success'}
                      size="small"
                    >
                      {lang.toUpperCase()}
                    </Badge>
                  ));
                }
              })()}
              {product.optimizationSummary?.aiEnhanced && product.status !== 'DRAFT' && (
                <Badge tone="info" size="small">AI✨</Badge>
              )}
            </InlineStack>
          </Box>
          
          <Box style={{ flex: '0 0 20%', minWidth: '120px', textAlign: 'center' }}>
            {product.status === 'ACTIVE' ? (
              <Badge tone="success">Active</Badge>
            ) : product.status === 'DRAFT' ? (
              <Badge>Draft</Badge>
            ) : product.status === 'ARCHIVED' ? (
              <Badge tone="warning">Archived</Badge>
            ) : (
              <Badge>{product.status || 'Unknown'}</Badge>
            )}
          </Box>
        </InlineStack>
      </ResourceItem>
    );
    } catch (error) {
      console.error('[BULK-EDIT-RENDER] ERROR rendering product:', error);
      console.error('[BULK-EDIT-RENDER] Product data:', item);
      return null;
    }
  };
  
  // Progress modal
  const progressModal = isProcessing && (
    <Modal
      open={isProcessing}
      title="Processing Products"
      onClose={() => {}}
      noScroll
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd">
            {currentProduct ? `Processing: ${currentProduct}` : 'Preparing...'}
          </Text>
          <ProgressBar progress={progress.percent} />
          <Text variant="bodySm" tone="subdued">
            {progress.current} of {progress.total} products ({progress.percent}%)
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );

  // Language selection modal
  const languageModal = (
    <Modal
      open={showLanguageModal}
      title="Select Languages"
      onClose={() => {
        setShowLanguageModal(false);
        setSelectedLanguages([]); // Reset selection
      }}
      primaryAction={{
        content: 'Generate Optimization for AI Search',
        onAction: generateSEO,
        disabled: selectedLanguages.length === 0 || checkLanguageLimitExceeded,
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: () => {
            setShowLanguageModal(false);
            setSelectedLanguages([]); // Reset selection
          },
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text variant="bodyMd">Select languages to generate AI Search Optimisation for {selectAllInStore ? 'all' : selectedItems.length} selected products:</Text>
          
          {/* Language Limit Warning Banner */}
          {checkLanguageLimitExceeded && (
            <Banner tone="warning" title={`Language limit exceeded`}>
              <BlockStack gap="200">
                <Text variant="bodyMd">
                  Your {currentPlan} plan supports up to {languageLimit} language{languageLimit > 1 ? 's' : ''} per product. 
                  {selectedItems.length === 1 && products.find(p => p.id === selectedItems[0])?.optimizationSummary?.optimizedLanguages?.length > 0 && (
                    <> This product already has {products.find(p => p.id === selectedItems[0]).optimizationSummary.optimizedLanguages.length} optimized language(s).</>
                  )}
                </Text>
                <Text variant="bodyMd">
                  Please deselect some languages or upgrade your plan to add more:
                </Text>
                <Button
                  variant="primary"
                  onClick={() => {
                    // Navigate within the same iframe - copy ALL URL parameters
                    const currentParams = new URLSearchParams(window.location.search);
                    const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
                    window.location.href = `/billing${paramString}`;
                  }}
                >
                  Upgrade Plan
                </Button>
              </BlockStack>
            </Banner>
          )}
          
          <Box paddingBlockStart="200">
            <InlineStack gap="200" wrap>
              {availableLanguages.map(lang => (
                <Checkbox
                  key={lang}
                  label={lang.toUpperCase()}
                  checked={selectedLanguages.includes(lang)}
                  onChange={(checked) => {
                    setSelectedLanguages(
                      checked
                        ? [...selectedLanguages, lang]
                        : selectedLanguages.filter(l => l !== lang)
                    );
                  }}
                />
              ))}
            </InlineStack>
          </Box>
          <Box paddingBlockStart="200">
            <Button
              plain
              onClick={() => {
                // Deselect all if all are selected
                if (selectedLanguages.length === availableLanguages.length) {
                  setSelectedLanguages([]);
                } else {
                  // Select all, but limit to languageLimit to trigger warning banner
                  if (availableLanguages.length > languageLimit) {
                    // Select MORE than the limit to show warning banner
                    setSelectedLanguages([...availableLanguages]);
                    setToast(`You selected ${availableLanguages.length} languages. Your ${currentPlan} plan supports ${languageLimit}. Please deselect or upgrade.`);
                  } else {
                    // Within limit, select all normally
                    setSelectedLanguages([...availableLanguages]);
                  }
                }
              }}
            >
              {selectedLanguages.length === availableLanguages.length ? 'Deselect all' : 'Select all'}
            </Button>
          </Box>
          <Text variant="bodySm" tone="subdued">
            Note: AI Search Optimisation will only be generated for languages that don't already have optimisation.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
  
  // Delete language selection modal
  const deleteModal = (
    <Modal
      open={showDeleteModal}
      title="Delete Optimization for AI Search"
      onClose={() => {
        setShowDeleteModal(false);
        setSelectedDeleteLanguages([]); // Reset selection
      }}
      primaryAction={{
        content: 'Continue',
        onAction: () => {
          setShowDeleteModal(false);
          setShowDeleteConfirmModal(true);
        },
        disabled: selectedDeleteLanguages.length === 0,
        destructive: true,
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: () => {
            setShowDeleteModal(false);
            setSelectedDeleteLanguages([]); // Reset selection
          },
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text variant="bodyMd">
            Select languages to delete AI Search Optimisation from {selectAllInStore ? 'all' : selectedItems.length} selected products:
          </Text>
          <Box paddingBlockStart="200">
            <InlineStack gap="200" wrap>
              {availableLanguages.map(lang => (
                <Checkbox
                  key={lang}
                  label={lang.toUpperCase()}
                  checked={selectedDeleteLanguages.includes(lang)}
                  onChange={(checked) => {
                    setSelectedDeleteLanguages(
                      checked
                        ? [...selectedDeleteLanguages, lang]
                        : selectedDeleteLanguages.filter(l => l !== lang)
                    );
                  }}
                />
              ))}
            </InlineStack>
          </Box>
          <Box paddingBlockStart="200">
            <Button
              plain
              onClick={() => {
                setSelectedDeleteLanguages(
                  selectedDeleteLanguages.length === availableLanguages.length
                    ? []
                    : [...availableLanguages]
                );
              }}
            >
              {selectedDeleteLanguages.length === availableLanguages.length ? 'Deselect all' : 'Select all'}
            </Button>
          </Box>
          <Text variant="bodySm" tone="caution">
            Warning: This will permanently delete AI Search Optimisation data for selected languages.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );

  // Delete confirmation modal
  const deleteConfirmModal = (
    <Modal
      open={showDeleteConfirmModal}
      title="Confirm Deletion"
      onClose={() => {
        setShowDeleteConfirmModal(false);
        // Don't reset selectedDeleteLanguages here as user might reopen
      }}
      primaryAction={{
        content: 'Delete',
        onAction: deleteSEO,
        destructive: true,
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: () => setShowDeleteConfirmModal(false),
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text variant="bodyMd" tone="critical">
            Are you sure you want to delete AI Search Optimisation for the following languages?
          </Text>
          <Box paddingBlock="200">
            <InlineStack gap="100">
              {selectedDeleteLanguages.map(lang => (
                <Badge key={lang} tone="critical">{lang.toUpperCase()}</Badge>
              ))}
            </InlineStack>
          </Box>
          <Text variant="bodyMd">
            This will delete optimisation from {selectAllInStore ? 'ALL' : selectedItems.length} selected products.
          </Text>
          <Text variant="bodySm" tone="critical" fontWeight="semibold">
            This action cannot be undone.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
  
  // Sync products from Shopify
  const handleSyncProducts = async () => {
    try {
      setLoading(true);
      setToast('Syncing products from Shopify...');
      
      const response = await api('/api/products/sync', {
        method: 'POST',
        shop
      });
      
      if (response.success) {
        const syncedCount = response.productsCount || response.synced || 0;
        setToast(`✅ Synced ${syncedCount} products successfully!`);
        // Reload products after sync
        setTimeout(() => {
          loadProducts(1, false, Date.now());
        }, 1000);
      } else {
        throw new Error(response.error || 'Sync failed');
      }
    } catch (error) {
      console.error('Sync error:', error);
      setToast(`❌ Sync failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const emptyState = (
    <EmptyState
      heading="No products found"
      action={{ content: 'Clear filters', onAction: () => {
        setSearchValue('');
        setOptimizedFilter('all');
        setLanguageFilter('');
        setSelectedTags([]);
        loadProducts(1, false, null);
      }}}
      secondaryAction={{ content: 'Sync from Shopify', onAction: handleSyncProducts }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Try adjusting your filters or search terms, or sync products from Shopify</p>
    </EmptyState>
  );
  
  
  const sortOptions = [
    { label: 'Newest first', value: 'newest' },
    { label: 'Oldest first', value: 'oldest' },
  ];
  
  return (
    <>
      {/* Store Metadata Banner */}
      <StoreMetadataBanner globalPlan={globalPlan} />
      
      <Card>
        <Box padding="400">
          <BlockStack gap="300">
            {/* Plan Info Banner */}
            {plan && (
              <Banner tone="info">
                <InlineStack gap="200" align="space-between">
                  <Text>
                    Your <strong>{plan}</strong> plan includes up to{' '}
                    <strong>{productLimit}</strong> products for SEO optimization.
                    {totalCount > productLimit && (
                      <> You have {totalCount} products, so only the first {productLimit} will be processed.</>
                    )}
                  </Text>
                  {(selectedItems.length > 0 || selectAllPages || selectAllInStore) && (
                    <Text>
                      Selected: {selectAllInStore ? Math.min(totalCount, productLimit) : selectedItems.length}/{productLimit}
                    </Text>
                  )}
                </InlineStack>
              </Banner>
            )}
            
            {/* Plan Limit Warning Banner */}
            {plan && (selectedItems.length > productLimit || (selectAllInStore && totalCount > productLimit)) && (
              <Banner tone="critical">
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">
                    Product limit exceeded
                  </Text>
                  <Text>
                    Your <strong>{plan}</strong> plan supports up to <strong>{productLimit}</strong> products. 
                    You have selected <strong>{selectAllInStore ? totalCount : selectedItems.length}</strong> products.
                  </Text>
                  <Text>
                    Please deselect some products or upgrade your plan to continue.
                  </Text>
                  <InlineStack gap="200">
                    <Button
                      onClick={() => {
                        setSelectedItems([]);
                        setSelectAllPages(false);
                      }}
                    >
                      Clear Selection
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setTokenError({
                          error: `Product limit exceeded`,
                          message: `Your ${plan} plan supports up to ${productLimit} products. Upgrade to ${getNextPlanForLimit(selectAllInStore ? totalCount : selectedItems.length)} to optimize more products.`,
                          minimumPlanRequired: getNextPlanForLimit(selectAllInStore ? totalCount : selectedItems.length)
                        });
                        setShowPlanUpgradeModal(true);
                      }}
                    >
                      Upgrade Plan
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Banner>
            )}
            
            {/* First row: Search bar + Generate AI button */}
            <InlineStack gap="400" align="space-between" blockAlign="center" wrap={false}>
              <Box minWidth="400px">
                <TextField
                  label=""
                  placeholder="Search by product ID, name, or details..."
                  value={searchValue}
                  onChange={handleSearch}
                  prefix={<SearchIcon />}
                  clearButton
                  onClearButtonClick={() => handleSearch('')}
                />
              </Box>
              
              <Box width="320px">
                <Button
                  primary
                  onClick={openLanguageModal}
                  disabled={selectedItems.length === 0 && !selectAllPages && !selectAllInStore}
                  size="medium"
                  fullWidth
                >
                  Generate Optimization for AI Search
                </Button>
              </Box>
            </InlineStack>
            
            {/* Second row: Sync Products + Dynamic right side */}
            <InlineStack gap="400" align="space-between" blockAlign="start" wrap={false}>
              <Button
                onClick={handleSyncProducts}
                disabled={loading}
                size="medium"
              >
                Sync Products
              </Button>
              
              <Box width="320px">
                <BlockStack gap="200" align="end">
                  {/* AI Enhanced Search Optimisation Button - between Generate and Delete */}
                  {(() => {
                    if (selectedItems.length === 0 && !selectAllPages && !selectAllInStore) return null;
                    
                    const selectedProducts = products.filter(p => selectedItems.includes(p.id));
                    const hasOptimizedProducts = selectedProducts.some(p => 
                      p.optimizationSummary?.optimizedLanguages?.length > 0
                    );
                    
                    if (!hasOptimizedProducts) return null;
                    
                    // Check if Professional+ plan (including Plus plans)
                    const isProfessionalPlus = [
                      'professional', 
                      'professional_plus', 
                      'professional plus',
                      'growth', 
                      'growth_plus',
                      'growth plus',
                      'growth_extra', 
                      'growth extra', 
                      'enterprise'
                    ].includes(currentPlan.toLowerCase().replace(/_/g, ' '));
                    
                    return (
                      <Button
                        onClick={isProfessionalPlus ? handleStartEnhancement : () => {
                          // Show upgrade modal for Starter plans
                          setTokenError({
                            error: 'AI Enhancement requires a higher plan',
                            message: 'Upgrade to Professional plan to access AI-enhanced optimization for Products',
                            minimumPlanRequired: 'Professional'
                          });
                          setShowPlanUpgradeModal(true);
                        }}
                        disabled={selectedItems.length === 0 && !selectAllPages && !selectAllInStore}
                        size="medium"
                        fullWidth
                      >
                        AI Enhanced add-ons
                      </Button>
                    );
                  })()}
                  
                  <Button
                    onClick={openDeleteModal}
                    disabled={(selectedItems.length === 0 && !selectAllPages && !selectAllInStore) || (() => {
                      const selectedProducts = products.filter(p => selectedItems.includes(p.id));
                      const hasOptimizedProducts = selectedProducts.some(p => 
                        p.optimizationSummary?.optimizedLanguages?.length > 0
                      );
                      return !hasOptimizedProducts;
                    })()}
                    destructive
                    size="medium"
                    fullWidth
                  >
                    Delete Optimization for AI Search
                  </Button>
                </BlockStack>
              </Box>
            </InlineStack>
          </BlockStack>
          
          {/* HIDDEN: No longer needed - skip logic handles already optimized products automatically
          {totalCount > 0 && (
            <Box paddingBlockStart="300">
              <Checkbox
                label={`Select all ${totalCount} products in your store`}
                checked={selectAllPages}
                onChange={handleSelectAllPages}
              />
            </Box>
          )}
          */}
        </Box>
      </Card>

      {/* Background Job Status Indicator - Show only the most recent/important one */}
      {/* Priority: AI Enhancement > SEO Job (AI Enhancement requires Basic SEO first) */}
      {(() => {
        // Determine which status to show (AI Enhancement has priority as it's the "higher" operation)
        const hasAiEnhanceStatus = aiEnhanceJobStatus.inProgress || aiEnhanceJobStatus.status === 'completed' || aiEnhanceJobStatus.status === 'failed';
        const hasSeoJobStatus = seoJobStatus.inProgress || seoJobStatus.status === 'completed' || seoJobStatus.status === 'failed';
        
        // If AI Enhancement has any status, show it (it's the more advanced operation)
        if (hasAiEnhanceStatus) {
          return (
            <Box paddingBlockStart="400">
              <Card>
                <Box padding="400">
                  {aiEnhanceJobStatus.inProgress ? (
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="300" blockAlign="center">
                      <Spinner size="small" />
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">AI Enhancing Products...</Text>
                        <Text variant="bodySm" tone="subdued">
                              {(() => {
                                const p = aiEnhanceJobStatus.progress;
                                if (p?.current && p?.total) {
                                  let msg = `Enhancing ${p.current}/${p.total} products`;
                                  // Use live countdown
                                  if (aiEnhanceRemainingSeconds >= 60) {
                                    msg += ` • ~${Math.ceil(aiEnhanceRemainingSeconds / 60)} min remaining`;
                                  } else if (aiEnhanceRemainingSeconds > 0) {
                                    msg += ` • ~${aiEnhanceRemainingSeconds}s remaining`;
                                  }
                                  return msg;
                                }
                                return aiEnhanceJobStatus.message || `Processing ${aiEnhanceJobStatus.processedProducts}/${aiEnhanceJobStatus.totalProducts} products`;
                              })()}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                        <Button 
                          onClick={async () => {
                            try {
                              await api(`/ai-enhance/job-cancel?shop=${shop}`, { method: 'POST' });
                              setToast('Cancellation requested...');
                            } catch (e) {
                              setToast('Failed to cancel');
                            }
                          }} 
                          size="slim" 
                          variant="tertiary"
                        >
                          Cancel
                        </Button>
                      </InlineStack>
                      {(aiEnhanceJobStatus.progress?.percent != null || aiEnhanceJobStatus.totalProducts > 0) && (
                        <ProgressBar 
                          progress={aiEnhanceJobStatus.progress?.percent || (aiEnhanceJobStatus.processedProducts / aiEnhanceJobStatus.totalProducts) * 100} 
                          size="small" 
                        />
                      )}
                    </BlockStack>
                  ) : aiEnhanceJobStatus.status === 'completed' ? (
                    <BlockStack gap="100">
                      <InlineStack gap="200" align="start" blockAlign="center">
                        <Badge tone="success">AI Enhanced</Badge>
                        <Text variant="bodyMd">
                          Enhanced {aiEnhanceJobStatus.successfulProducts} product{aiEnhanceJobStatus.successfulProducts !== 1 ? 's' : ''}
                        </Text>
                        {aiEnhanceJobStatus.skippedProducts > 0 && aiEnhanceJobStatus.skipReasons?.length > 0 && (
                          <Button
                            variant="plain"
                            onClick={() => {
                              setReasonsModalType('skipped');
                              setReasonsModalData(aiEnhanceJobStatus.skipReasons);
                              setShowReasonsModal(true);
                            }}
                          >
                            <Text variant="bodySm" tone="subdued">({aiEnhanceJobStatus.skippedProducts} skipped)</Text>
                          </Button>
                        )}
                        {aiEnhanceJobStatus.skippedProducts > 0 && !aiEnhanceJobStatus.skipReasons?.length && (
                          <Text variant="bodySm" tone="subdued">({aiEnhanceJobStatus.skippedProducts} skipped)</Text>
                        )}
                        {aiEnhanceJobStatus.failedProducts > 0 && aiEnhanceJobStatus.failReasons?.length > 0 && (
                          <Button
                            variant="plain"
                            onClick={() => {
                              setReasonsModalType('failed');
                              setReasonsModalData(aiEnhanceJobStatus.failReasons);
                              setShowReasonsModal(true);
                            }}
                          >
                            <Text variant="bodySm" tone="critical">({aiEnhanceJobStatus.failedProducts} failed)</Text>
                          </Button>
                        )}
                        {aiEnhanceJobStatus.failedProducts > 0 && !aiEnhanceJobStatus.failReasons?.length && (
                          <Text variant="bodySm" tone="critical">({aiEnhanceJobStatus.failedProducts} failed)</Text>
                        )}
                        <Text variant="bodySm" tone="subdued">· {timeAgo(aiEnhanceJobStatus.completedAt)}</Text>
                      </InlineStack>
                    </BlockStack>
                  ) : (
                    <BlockStack gap="100">
                      <InlineStack gap="200" align="start" blockAlign="center">
                        <Badge tone="critical">AI Enhancement Failed</Badge>
                        <Text variant="bodyMd" tone="critical">{aiEnhanceJobStatus.message || 'Enhancement failed'}</Text>
                        {aiEnhanceJobStatus.successfulProducts > 0 && (
                          <Text variant="bodySm" tone="subdued">· {aiEnhanceJobStatus.successfulProducts} succeeded before failure</Text>
                        )}
                        {aiEnhanceJobStatus.failReasons?.length > 0 && (
                          <Button
                            variant="plain"
                            onClick={() => {
                              setReasonsModalType('failed');
                              setReasonsModalData(aiEnhanceJobStatus.failReasons);
                              setShowReasonsModal(true);
                            }}
                          >
                            <Text variant="bodySm" tone="critical">View {aiEnhanceJobStatus.failReasons.length} errors</Text>
                          </Button>
                        )}
                      </InlineStack>
                    </BlockStack>
                  )}
                </Box>
              </Card>
            </Box>
          );
        }
        
        // Otherwise, show SEO job status if available
        if (hasSeoJobStatus) {
          return (
            <Box paddingBlockStart="400">
              <Card>
                <Box padding="400">
                  {seoJobStatus.inProgress ? (
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="300" blockAlign="center">
                      <Spinner size="small" />
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">
                          {seoJobStatus.phase === 'generate' ? 'Generating GEO...' : 'Applying GEO...'}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                              {(() => {
                                const p = seoJobStatus.progress;
                                if (p?.current && p?.total) {
                                  let msg = `Processing ${p.current}/${p.total} products`;
                                  // Use live countdown
                                  if (seoRemainingSeconds >= 60) {
                                    msg += ` • ~${Math.ceil(seoRemainingSeconds / 60)} min remaining`;
                                  } else if (seoRemainingSeconds > 0) {
                                    msg += ` • ~${seoRemainingSeconds}s remaining`;
                                  }
                                  return msg;
                                }
                                return seoJobStatus.message || `Processing ${seoJobStatus.processedProducts}/${seoJobStatus.totalProducts} products`;
                              })()}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                        <Button 
                          onClick={async () => {
                            try {
                              await api(`/api/seo/job-cancel?shop=${shop}`, { method: 'POST' });
                              setToast('Cancellation requested...');
                            } catch (e) {
                              setToast('Failed to cancel');
                            }
                          }} 
                          size="slim" 
                          variant="tertiary"
                        >
                          Cancel
                        </Button>
                      </InlineStack>
                      {(seoJobStatus.progress?.percent != null || seoJobStatus.totalProducts > 0) && (
                        <ProgressBar 
                          progress={seoJobStatus.progress?.percent || (seoJobStatus.processedProducts / seoJobStatus.totalProducts) * 100} 
                          size="small" 
                        />
                      )}
                    </BlockStack>
                  ) : seoJobStatus.status === 'completed' ? (
                    <BlockStack gap="100">
                      <InlineStack gap="200" align="start" blockAlign="center">
                        <Badge tone="success">Completed</Badge>
                        <Text variant="bodyMd">
                          Applied GEO to {seoJobStatus.successfulProducts} product{seoJobStatus.successfulProducts !== 1 ? 's' : ''}
                        </Text>
                        {seoJobStatus.skippedProducts > 0 && seoJobStatus.skipReasons?.length > 0 && (
                          <Button
                            variant="plain"
                            onClick={() => {
                              setReasonsModalType('skipped');
                              setReasonsModalData(seoJobStatus.skipReasons);
                              setShowReasonsModal(true);
                            }}
                          >
                            <Text variant="bodySm" tone="subdued">({seoJobStatus.skippedProducts} skipped)</Text>
                          </Button>
                        )}
                        {seoJobStatus.skippedProducts > 0 && !seoJobStatus.skipReasons?.length && (
                          <Text variant="bodySm" tone="subdued">({seoJobStatus.skippedProducts} skipped)</Text>
                        )}
                        {seoJobStatus.failedProducts > 0 && seoJobStatus.failReasons?.length > 0 && (
                          <Button
                            variant="plain"
                            onClick={() => {
                              setReasonsModalType('failed');
                              setReasonsModalData(seoJobStatus.failReasons);
                              setShowReasonsModal(true);
                            }}
                          >
                            <Text variant="bodySm" tone="critical">({seoJobStatus.failedProducts} failed)</Text>
                          </Button>
                        )}
                        {seoJobStatus.failedProducts > 0 && !seoJobStatus.failReasons?.length && (
                          <Text variant="bodySm" tone="critical">({seoJobStatus.failedProducts} failed)</Text>
                        )}
                        <Text variant="bodySm" tone="subdued">· {timeAgo(seoJobStatus.completedAt)}</Text>
                      </InlineStack>
                    </BlockStack>
                  ) : (
                    <BlockStack gap="100">
                      <InlineStack gap="200" align="start" blockAlign="center">
                        <Badge tone="critical">Failed</Badge>
                        <Text variant="bodyMd" tone="critical">{seoJobStatus.message || 'Optimization failed'}</Text>
                        {seoJobStatus.successfulProducts > 0 && (
                          <Text variant="bodySm" tone="subdued">· {seoJobStatus.successfulProducts} succeeded before failure</Text>
                        )}
                        {seoJobStatus.failReasons?.length > 0 && (
                          <Button
                            variant="plain"
                            onClick={() => {
                              setReasonsModalType('failed');
                              setReasonsModalData(seoJobStatus.failReasons);
                              setShowReasonsModal(true);
                            }}
                          >
                            <Text variant="bodySm" tone="critical">View {seoJobStatus.failReasons.length} errors</Text>
                          </Button>
                        )}
                      </InlineStack>
                    </BlockStack>
                  )}
                </Box>
              </Card>
            </Box>
          );
        }
        
        return null;
      })()}
      
      {/* Delete Job Status - shows independently from other statuses */}
      {(deleteJobStatus.inProgress || deleteJobStatus.status === 'completed' || deleteJobStatus.status === 'failed') && (
        <Box paddingBlockStart="400">
          <Card>
            <Box padding="400">
              {deleteJobStatus.inProgress ? (
                <InlineStack gap="300" align="start" blockAlign="center">
                  <Spinner size="small" />
                  <BlockStack gap="100">
                    <Text variant="bodyMd" fontWeight="semibold">Deleting Optimization Data...</Text>
                    <Text variant="bodySm" tone="subdued">
                      {deleteJobStatus.message || `Processing ${deleteJobStatus.processedProducts}/${deleteJobStatus.totalProducts} products`}
                    </Text>
                    {deleteJobStatus.totalProducts > 0 && (
                      <Box paddingBlockStart="100">
                        <ProgressBar progress={(deleteJobStatus.processedProducts / deleteJobStatus.totalProducts) * 100} size="small" />
                      </Box>
                    )}
                  </BlockStack>
                </InlineStack>
              ) : deleteJobStatus.status === 'completed' ? (
                <BlockStack gap="100">
                  <InlineStack gap="200" align="start" blockAlign="center">
                    <Badge tone="info">Deleted</Badge>
                    <Text variant="bodyMd">{deleteJobStatus.message}</Text>
                    <Text variant="bodySm" tone="subdued">· {timeAgo(deleteJobStatus.completedAt)}</Text>
                    <Button
                      variant="plain"
                      onClick={() => setDeleteJobStatus({ inProgress: false, status: 'idle', message: null })}
                    >
                      <Text variant="bodySm" tone="subdued">Dismiss</Text>
                    </Button>
                  </InlineStack>
                </BlockStack>
              ) : (
                <BlockStack gap="100">
                  <InlineStack gap="200" align="start" blockAlign="center">
                    <Badge tone="critical">Delete Failed</Badge>
                    <Text variant="bodyMd" tone="critical">{deleteJobStatus.message || 'Delete operation failed'}</Text>
                    <Button
                      variant="plain"
                      onClick={() => setDeleteJobStatus({ inProgress: false, status: 'idle', message: null })}
                    >
                      <Text variant="bodySm" tone="subdued">Dismiss</Text>
                    </Button>
                  </InlineStack>
                </BlockStack>
              )}
            </Box>
          </Card>
        </Box>
      )}

      <Box paddingBlockStart="400">
        <Card>
          {/* Filter buttons */}
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <InlineStack gap="200" wrap align="space-between">
              <InlineStack gap="200" wrap>
                {/* AI Search Status filter */}
              <Popover
                active={showOptimizedPopover}
                activator={
                  <Button 
                    disclosure="down"
                    onClick={() => setShowOptimizedPopover(!showOptimizedPopover)}
                    removeUnderline
                  >
                    <InlineStack gap="100" blockAlign="center">
                      <span>AI Search Status</span>
                      {optimizedFilter !== 'all' && (
                        <Box onClick={(e) => {
                          e.stopPropagation();
                          setOptimizedFilter('all');
                        }}>
                          <Text as="span" tone="subdued">✕</Text>
                        </Box>
                      )}
                    </InlineStack>
                  </Button>
                }
                onClose={() => setShowOptimizedPopover(false)}
              >
                <Box padding="300" minWidth="200px">
                  <ChoiceList
                    title="AI Search Status"
                    titleHidden
                    choices={[
                      { label: 'All products', value: 'all' },
                      { label: 'Has AI Search Optimisation', value: 'true' },
                      { label: 'No AI Search Optimisation', value: 'false' },
                    ]}
                    selected={[optimizedFilter]}
                    onChange={(value) => {
                      setOptimizedFilter(value[0]);
                      setLanguageFilter('');
                      setShowOptimizedPopover(false);
                    }}
                  />
                </Box>
              </Popover>
              
              {/* Language Status filter */}
              <Popover
                active={showLanguagePopover}
                activator={
                  <Button 
                    disclosure="down"
                    onClick={() => setShowLanguagePopover(!showLanguagePopover)}
                    removeUnderline
                  >
                    <InlineStack gap="100" blockAlign="center">
                      <span>Language Status</span>
                      {languageFilter && (
                        <Box onClick={(e) => {
                          e.stopPropagation();
                          setLanguageFilter('');
                        }}>
                          <Text as="span" tone="subdued">✕</Text>
                        </Box>
                      )}
                    </InlineStack>
                  </Button>
                }
                onClose={() => setShowLanguagePopover(false)}
              >
                <Box padding="300" minWidth="200px">
                  <ChoiceList
                    title="Language Status"
                    titleHidden
                    choices={[
                      { label: 'All languages', value: '' },
                      ...availableLanguages.map(lang => ({
                        label: `Has ${lang.toUpperCase()}`,
                        value: `has_${lang}`
                      })),
                      ...availableLanguages.map(lang => ({
                        label: `Missing ${lang.toUpperCase()}`,
                        value: `missing_${lang}`
                      })),
                    ]}
                    selected={languageFilter ? [languageFilter] : []}
                    onChange={(value) => {
                      setLanguageFilter(value[0] || '');
                      setShowLanguagePopover(false);
                    }}
                  />
                </Box>
              </Popover>
              
              {/* Tags filter */}
              <Popover
                active={showTagsPopover}
                activator={
                  <Button 
                    disclosure="down"
                    onClick={() => setShowTagsPopover(!showTagsPopover)}
                    removeUnderline
                  >
                    <InlineStack gap="100" blockAlign="center">
                      <span>Tags</span>
                      {selectedTags.length > 0 && (
                        <Box onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTags([]);
                        }}>
                          <Text as="span" tone="subdued">✕</Text>
                        </Box>
                      )}
                    </InlineStack>
                  </Button>
                }
                onClose={() => setShowTagsPopover(false)}
              >
                <Box padding="300" minWidth="200px">
                  <ChoiceList
                    title="Tags"
                    titleHidden
                    allowMultiple
                    choices={availableTags.map(tag => ({ label: tag, value: tag }))}
                    selected={selectedTags}
                    onChange={(value) => {
                      setSelectedTags(value);
                    }}
                  />
                  <Box paddingBlockStart="200">
                    <Button
                      size="slim"
                      onClick={() => setShowTagsPopover(false)}
                    >
                      Apply
                    </Button>
                  </Box>
                </Box>
              </Popover>
              </InlineStack>
              
              {/* Sort dropdown - same style as other filters */}
              <Popover
                active={showSortPopover}
                activator={
                  <Button 
                    disclosure="down"
                    onClick={() => setShowSortPopover(!showSortPopover)}
                    removeUnderline
                  >
                    <InlineStack gap="100" blockAlign="center">
                      <span>{sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}</span>
                    </InlineStack>
                  </Button>
                }
                onClose={() => setShowSortPopover(false)}
              >
                <Box padding="300" minWidth="200px">
                  <ChoiceList
                    title="Sort Order"
                    titleHidden
                    choices={[
                      { label: 'Newest first', value: 'desc' },
                      { label: 'Oldest first', value: 'asc' },
                    ]}
                    selected={[sortOrder]}
                    onChange={(value) => {
                      setSortOrder(value[0]);
                      setShowSortPopover(false);
                    }}
                  />
                </Box>
              </Popover>
            </InlineStack>
            
            {/* Applied filters */}
            {(optimizedFilter !== 'all' || languageFilter || selectedTags.length > 0) && (
              <Box paddingBlockStart="200">
                <InlineStack gap="100" wrap>
                  {optimizedFilter !== 'all' && (
                    <Badge onRemove={() => setOptimizedFilter('all')}>
                      {optimizedFilter === 'true' ? 'Has AI Search Optimisation' : 'No AI Search Optimisation'}
                    </Badge>
                  )}
                  {languageFilter && (
                    <Badge onRemove={() => setLanguageFilter('')}>
                      {languageFilter.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </Badge>
                  )}
                  {selectedTags.map(tag => (
                    <Badge key={tag} onRemove={() => setSelectedTags(prev => prev.filter(t => t !== tag))}>
                      Tag: {tag}
                    </Badge>
                  ))}
                </InlineStack>
              </Box>
            )}
          </Box>

          <Box>
            <Box paddingBlockEnd="200" paddingInlineStart="300">
              <InlineStack gap="200" align="start" blockAlign="center">
                <Popover
                  active={showSelectionPopover}
                  activator={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => setShowSelectionPopover(!showSelectionPopover)}>
                <Checkbox
                        checked={selectedItems.length > 0 && (selectedItems.length === products.length || selectAllInStore)}
                        indeterminate={selectedItems.length > 0 && selectedItems.length < products.length && !selectAllInStore}
                  onChange={handleSelectAllPages}
                  label=""
                />
                <Text variant="bodyMd" fontWeight="semibold">
                        {selectedItems.length > 0 
                          ? selectAllInStore 
                            ? (optimizedFilter !== 'all' || languageFilter || selectedTags.length > 0)
                              ? `All ${totalCount} matching filter`
                              : `All ${totalCount} selected`
                            : `${selectedItems.length} selected`
                          : 'Select'}
                </Text>
                      <span style={{ fontSize: '10px', color: '#637381' }}>▼</span>
                    </div>
                  }
                  onClose={() => setShowSelectionPopover(false)}
                  preferredAlignment="left"
                >
                  <ActionList
                    items={[
                      {
                        content: `Select all ${products.length} on this page`,
                        onAction: () => {
                          handleSelectAllPages(true);
                          setShowSelectionPopover(false);
                        },
                        disabled: selectedItems.length === products.length && !selectAllInStore
                      },
                      // Show "Select all matching filter" when a filter is active
                      ...(optimizedFilter !== 'all' || languageFilter || selectedTags.length > 0 ? [{
                        content: `Select all ${totalCount} matching filter`,
                        onAction: () => {
                          handleSelectAllInStore();
                          setShowSelectionPopover(false);
                        },
                        disabled: selectAllInStore
                      }] : [{
                        content: `Select all ${totalCount} in this store`,
                        onAction: handleSelectAllInStore,
                        disabled: selectAllInStore
                      }]),
                      {
                        content: 'Deselect all',
                        onAction: handleUnselectAll,
                        disabled: selectedItems.length === 0
                      }
                    ]}
                  />
                </Popover>
              </InlineStack>
            </Box>
            <ResourceList
              key={`products-${products.length}-${selectedItems.length}`}
              resourceName={{ singular: 'product', plural: 'products' }}
              items={products}
              renderItem={renderItem}
              selectedItems={selectedItems}
              onSelectionChange={handleSelectionChange}
              selectable={true}
              loading={loading}
              totalItemsCount={totalCount}
              emptyState={emptyState}
              showHeader={false}
            />
          </Box>
          
          {/* Pagination Controls */}
          <Box padding="400" borderBlockStart="divider">
            <InlineStack align="space-between" blockAlign="center">
              {/* Items per page selector */}
              <InlineStack gap="200" blockAlign="center">
                <Text variant="bodySm" tone="subdued">Show:</Text>
                <Select
                  label=""
                  labelHidden
                  options={[
                    { label: '10', value: '10' },
                    { label: '20', value: '20' },
                    { label: '50', value: '50' },
                    { label: '100', value: '100' }
                  ]}
                  value={String(itemsPerPage)}
                  onChange={handleItemsPerPageChange}
                />
                <Text variant="bodySm" tone="subdued">per page</Text>
              </InlineStack>
              
              {/* Page info and navigation */}
              <InlineStack gap="300" blockAlign="center">
                <Text variant="bodySm" tone="subdued">
                  {totalCount > 0 
                    ? `${(page - 1) * itemsPerPage + 1}-${Math.min(page * itemsPerPage, totalCount)} of ${totalCount}`
                    : '0 products'
                  }
                </Text>
                <InlineStack gap="100">
                  <Button
                    icon={<span style={{ fontSize: '16px' }}>‹</span>}
                    disabled={page <= 1 || loading}
                    onClick={handlePreviousPage}
                    accessibilityLabel="Previous page"
                  />
                  <Button
                    icon={<span style={{ fontSize: '16px' }}>›</span>}
                    disabled={page >= totalPages || loading}
                    onClick={handleNextPage}
                    accessibilityLabel="Next page"
                  />
                </InlineStack>
              </InlineStack>
            </InlineStack>
            </Box>
        </Card>
      </Box>

      {progressModal}
      {languageModal}
      {deleteModal}
      {deleteConfirmModal}
      
      {/* Skip/Fail Reasons Modal */}
      <Modal
        open={showReasonsModal}
        onClose={() => setShowReasonsModal(false)}
        title={reasonsModalType === 'skipped' ? 'Skipped Products' : 'Failed Products'}
        primaryAction={{
          content: 'Close',
          onAction: () => setShowReasonsModal(false)
        }}
        secondaryActions={[
          {
            content: 'Copy to Clipboard',
            onAction: async () => {
              const text = reasonsModalData.join('\n');
              try {
                await navigator.clipboard.writeText(text);
                setToast('Copied to clipboard');
              } catch (err) {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                setToast('Copied to clipboard');
              }
            }
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodyMd" tone="subdued">
              {reasonsModalType === 'skipped' 
                ? 'These products were skipped because they are already optimized for the selected languages:'
                : 'These products failed to optimize:'}
            </Text>
            <Box paddingBlockStart="200">
              <BlockStack gap="200">
                {reasonsModalData.map((reason, index) => (
                  <Box key={index} padding="200" background="bg-surface-secondary" borderRadius="100">
                    <Text variant="bodySm" tone={reasonsModalType === 'failed' ? 'critical' : 'subdued'}>
                      {reason}
                    </Text>
                  </Box>
                ))}
              </BlockStack>
            </Box>
          </BlockStack>
        </Modal.Section>
      </Modal>
      
      {/* Help Modal for first-time users */}
      <Modal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Sync your products"
        primaryAction={{
          content: 'Sync Products',
          onAction: () => {
            setShowHelpModal(false);
            handleSyncProducts();
          }
        }}
        secondaryActions={[
          {
            content: 'Skip for now',
            onAction: () => setShowHelpModal(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodyMd">
              To get started with AI SEO optimization, you need to sync your products from Shopify first.
            </Text>
            <Text variant="bodyMd">
              This will import all your products so you can optimize them for better search visibility.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      
      <UpgradeModal
        open={showPlanUpgradeModal}
        onClose={() => {
          setShowPlanUpgradeModal(false);
          setTokenError(null);
        }}
        featureName={tokenError?.error || "Feature"}
        errorMessage={tokenError?.message}
        currentPlan={tokenError?.currentPlan || currentPlan}
        minimumPlanRequired={tokenError?.minimumPlanRequired}
        features={tokenError?.features}
      />
      
      {tokenError && (
        <>
          <InsufficientTokensModal
            open={showInsufficientTokensModal}
            onClose={() => {
              setShowInsufficientTokensModal(false);
              setTokenError(null);
            }}
            tokensRequired={tokenError.tokensRequired || 0}
            tokensAvailable={tokenError.tokensAvailable || 0}
            tokensNeeded={tokenError.tokensNeeded || 0}
            feature="ai-seo-product-enhanced"
            shop={shop}
            needsUpgrade={tokenError.needsUpgrade || false}
            minimumPlan={tokenError.minimumPlanForFeature || null}
            currentPlan={tokenError.currentPlan || currentPlan}
            returnTo="/ai-seo"
            onBuyTokens={() => {
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
            feature={tokenError.feature || 'ai-seo-product-enhanced'}
            trialEndsAt={tokenError.trialEndsAt}
            currentPlan={tokenError.currentPlan || currentPlan}
            tokensRequired={tokenError.tokensRequired || 0}
            onActivatePlan={async () => {
              // Direct API call to activate plan (no billing page redirect)
              try {
                
                const response = await api('/api/billing/activate', {
                  method: 'POST',
                  body: {
                    shop,
                    endTrial: true,
                    returnTo: '/ai-seo' // Return to Products (BulkEdit) after approval
                  }
                });
                
                // Check if Shopify approval is required
                if (response.requiresApproval && response.confirmationUrl) {
                  // Direct redirect to Shopify approval page
                  window.top.location.href = response.confirmationUrl;
                  return;
                }
                
                // Already activated (shouldn't happen, but handle gracefully)
                window.location.reload();
                
              } catch (error) {
                console.error('[BULK-EDIT] ❌ Activation failed:', error);
                
                // Fallback: Navigate to billing page
                const params = new URLSearchParams(window.location.search);
                const host = params.get('host');
                const embedded = params.get('embedded');
                
                window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host)}`;
              }
            }}
            onPurchaseTokens={() => {
              setShowTrialActivationModal(false);
              setShowTokenPurchaseModal(true);
            }}
          />
        </>
      )}

      {/* Token Purchase Modal */}
      <TokenPurchaseModal
        open={showTokenPurchaseModal}
        onClose={() => {
          setShowTokenPurchaseModal(false);
          setTokenError(null);
        }}
        shop={shop}
        returnTo="/ai-seo"
        inTrial={!!tokenError?.trialEndsAt}
      />
      
      {toast && (
        <Toast content={toast} onDismiss={() => setToast('')} />
      )}
    </>
  );
}