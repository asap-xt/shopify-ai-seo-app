// frontend/src/pages/Collections.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
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
  BlockStack,
  Divider,
  TextField,
  Thumbnail,
  ChoiceList,
  Popover,
  Checkbox,
  Banner,
  Spinner,
} from '@shopify/polaris';
import { SearchIcon } from '@shopify/polaris-icons';
import { makeSessionFetch } from '../lib/sessionFetch.js';
import UpgradeModal from '../components/UpgradeModal.jsx';
import InsufficientTokensModal from '../components/InsufficientTokensModal.jsx';
import TrialActivationModal from '../components/TrialActivationModal.jsx';
import TokenPurchaseModal from '../components/TokenPurchaseModal.jsx';
import { StoreMetadataBanner } from '../components/StoreMetadataBanner.jsx';

const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; }
  catch { return d; }
};

export default function CollectionsPage({ shop: shopProp, globalPlan }) {
  const shop = shopProp || qs('shop', '');
  // Единен session-aware fetch за компонента
  const api = useMemo(() => makeSessionFetch(), []);
  // Collection list state
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  
  // Selection state
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectAllPages, setSelectAllPages] = useState(false);
  const [selectAllInStore, setSelectAllInStore] = useState(false);
  const [showSelectionPopover, setShowSelectionPopover] = useState(false);
  
  // Processing state
  const [processingMessage, setProcessingMessage] = useState('');
  
  // Filter state
  const [searchValue, setSearchValue] = useState('');
  const [optimizedFilter, setOptimizedFilter] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [showOptimizedPopover, setShowOptimizedPopover] = useState(false);
  const [showLanguagePopover, setShowLanguagePopover] = useState(false);
  const [showTagsPopover, setShowTagsPopover] = useState(false);
  const [showSortPopover, setShowSortPopover] = useState(false);
  
  // Sorting state
  const [sortBy, setSortBy] = useState('updatedAt');
  const [sortOrder, setSortOrder] = useState('desc');
  
  // SEO generation state
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState([]);
  const [selectedLanguages, setSelectedLanguages] = useState([]);
  const [availableLanguages, setAvailableLanguages] = useState([]);
  
  // Progress state
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [currentCollection, setCurrentCollection] = useState('');
  const [errors, setErrors] = useState([]);
  
  // Delete state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  
  // Bulk delete state
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [deleteLanguages, setDeleteLanguages] = useState([]);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  
  // Track selected collections with SEO
  const [selectedHaveSEO, setSelectedHaveSEO] = useState(false);
  
  // Sync state
  const [syncing, setSyncing] = useState(false);
  
  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingDeleteLanguages, setPendingDeleteLanguages] = useState([]);
  
  // Results state
  const [results, setResults] = useState({});
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [appliedSeoData, setAppliedSeoData] = useState({}); // Пази SEO данни след apply
  
  // Preview state
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  
  // Toast
  const [toast, setToast] = useState('');
  
  // AI Enhancement Modal state (legacy - kept for backward compatibility)
  const [showAIEnhanceModal, setShowAIEnhanceModal] = useState(false);
  const [aiEnhanceProgress, setAIEnhanceProgress] = useState({
    processing: false,
    current: 0,
    total: 0,
    currentItem: '',
    results: null
  });
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showInsufficientTokensModal, setShowInsufficientTokensModal] = useState(false);
  const [showTrialActivationModal, setShowTrialActivationModal] = useState(false);
  const [showTokenPurchaseModal, setShowTokenPurchaseModal] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [currentPlan, setCurrentPlan] = useState('starter');
  const [languageLimit, setLanguageLimit] = useState(1); // Default to 1 for Starter
  const [graphqlDataLoaded, setGraphqlDataLoaded] = useState(false); // Track if GraphQL data has been loaded
  
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
        
        // Get languageLimit dynamically from globalPlan (snake_case from GraphQL)
        const newLimit = globalPlan.language_limit || 1;
        setLanguageLimit(newLimit);
      } else if (globalPlan.plan && globalPlan.plan !== '') {
        // Fallback: if planKey is missing, try to derive it from plan name
        const planKey = globalPlan.plan.toLowerCase().replace(/\s+/g, '-');
        setCurrentPlan(planKey);
        
        // Get languageLimit dynamically from globalPlan (snake_case from GraphQL)
        const newLimit = globalPlan.language_limit || 1;
        setLanguageLimit(newLimit);
      }
    }
  }, [globalPlan, currentPlan, graphqlDataLoaded]);
  
  // Background Collection SEO Job status (Generate + Apply combined)
  const [collectionSeoJobStatus, setCollectionSeoJobStatus] = useState({
    inProgress: false,
    status: 'idle',
    message: null,
    totalCollections: 0,
    processedCollections: 0,
    successfulCollections: 0,
    failedCollections: 0,
    skippedCollections: 0,
    completedAt: null
  });
  const collectionSeoPollingRef = useRef(null);
  
  // Background Collection AI Enhancement Job status
  const [collectionAiEnhanceJobStatus, setCollectionAiEnhanceJobStatus] = useState({
    inProgress: false,
    status: 'idle',
    message: null,
    totalCollections: 0,
    processedCollections: 0,
    successfulCollections: 0,
    failedCollections: 0,
    skippedCollections: 0,
    completedAt: null
  });
  const collectionAiEnhancePollingRef = useRef(null);
  
  // Load models and plan on mount
  useEffect(() => {
    if (!shop) return;
    const Q = `
      query PlansMe($shop:String!) {
        plansMe(shop:$shop) {
          plan
          planKey
          modelsSuggested
          language_limit
          product_limit
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
        
        const models = data?.modelsSuggested || ['google/gemini-1.5-flash'];
        setModelOptions(models.map((m) => ({ label: m, value: m })));
        setModel(models[0]);
        setCurrentPlan(data?.planKey || 'starter');
        
        // Set limits from API response (dynamic from backend/plans.js)
        // CRITICAL: Always use GraphQL response as source of truth
        const newLimit = data?.language_limit || 1;
        
        setLanguageLimit(newLimit);
        
        // Mark GraphQL data as loaded to prevent globalPlan from overwriting
        setGraphqlDataLoaded(true);
      })
      .catch((err) => {
        console.error('[COLLECTIONS] GraphQL plansMe failed:', err);
        setToast(`Error loading models: ${err.message}`);
        // Even on error, mark as loaded to prevent infinite fallback attempts
        setGraphqlDataLoaded(true);
      });
  }, [shop, api]);
  
  // Load shop languages
  useEffect(() => {
    if (!shop) return;
    api(`/api/languages/shop/${shop}?shop=${shop}`)
      .then((data) => {
        const langs = data?.shopLanguages || ['en'];
        setAvailableLanguages(langs);
        setSelectedLanguages([]);
      })
      .catch((err) => {
        console.error('[COLLECTIONS] Languages API error:', err);
        setAvailableLanguages(['en']);
        setSelectedLanguages([]);
      });
  }, [shop, api]);
  
  // Sync collections function
  const handleSyncCollections = async () => {
    try {
      setSyncing(true);
      
      const response = await api(`/api/collections/sync?shop=${shop}`, {
        method: 'POST'
      });
      
      if (response?.success) {
        setToast('Collections synced successfully!');
        
        // Reload collections after sync
        await loadCollections();
      } else {
        console.error('[COLLECTIONS] Sync failed:', response);
        setToast('Failed to sync collections');
      }
    } catch (error) {
      console.error('[COLLECTIONS] Sync error:', error);
      setToast('Error syncing collections');
    } finally {
      setSyncing(false);
    }
  };
  
  // Load collections
  const loadCollections = useCallback(async (pageNum = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        shop,
        page: pageNum,
        limit: itemsPerPage,
        ...(searchValue && { search: searchValue }),
        ...(optimizedFilter !== 'all' && { optimized: optimizedFilter }),
        sortBy,
        sortOrder
      });
      
      // Use GraphQL endpoint (from seoController.js, NOT collectionsController.js)
      const endpoint = `/collections/list-graphql?${params}`;
      
      // URL вече съдържа shop → не подаваме {shop}, за да не дублираме
      const data = await api(endpoint);
      
      // Apply client-side filtering for search
      let filteredCollections = data.collections || [];
      
      if (searchValue) {
        const search = searchValue.toLowerCase();
        filteredCollections = filteredCollections.filter(c => 
          c.title.toLowerCase().includes(search) ||
          c.handle.toLowerCase().includes(search)
        );
      }
      
      if (optimizedFilter !== 'all') {
        filteredCollections = filteredCollections.filter(c => 
          optimizedFilter === 'true' ? c.hasSeoData : !c.hasSeoData
        );
      }
      
      setCollections(filteredCollections);
      setPage(pageNum);
      
      // Use pagination data from API
      const total = data.pagination?.total || filteredCollections.length;
      setTotalCount(total);
      setHasMore(data.pagination?.hasNext || false);
      setTotalPages(data.pagination?.totalPages || Math.ceil(total / itemsPerPage) || 1);
    } catch (err) {
      setToast(`Error loading collections: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [shop, searchValue, optimizedFilter, sortBy, sortOrder, itemsPerPage, api]);
  
  // Initial load and filter changes
  useEffect(() => {
    if (shop) {
      loadCollections(1);
      setSelectedHaveSEO(false); // Reset SEO tracking on reload
    }
  }, [shop, optimizedFilter, sortBy, sortOrder, itemsPerPage]);
  
  // Search debounce effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (shop) loadCollections();
    }, 500);
    
    return () => clearTimeout(timer);
  }, [searchValue]);
  
  // Handle selection
  const handleSelectionChange = useCallback((items) => {
    setSelectedItems(items);
    
    // Check if any selected collections have SEO
    const haveSEO = items.some(id => {
      const collection = collections.find(c => c.id === id);
      return collection?.hasSeoData;
    });
    setSelectedHaveSEO(haveSEO);
    
    if (items.length === 0) {
      setSelectAllPages(false);
      setSelectAllInStore(false);
    } else if (items.length < collections.length) {
      // If not all items on page are selected, disable selectAllInStore
      setSelectAllInStore(false);
    }
  }, [collections]);
  
  const handleSelectAllPages = useCallback((checked, forStore = false) => {
    setSelectAllPages(checked);
    setSelectAllInStore(forStore && checked);
    if (checked) {
      setSelectedItems(collections.map(c => c.id));
      // Check if any collections have SEO
      const haveSEO = collections.some(c => c.hasSeoData);
      setSelectedHaveSEO(haveSEO);
    } else {
      setSelectedItems([]);
      setSelectAllInStore(false);
      setSelectedHaveSEO(false);
    }
  }, [collections]);

  const handleSelectAllInStore = useCallback(() => {
    setSelectAllPages(true);
    setSelectAllInStore(true);
    setSelectedItems(collections.map(c => c.id));
    const haveSEO = collections.some(c => c.hasSeoData);
    setSelectedHaveSEO(haveSEO);
    setShowSelectionPopover(false);
  }, [collections]);

  const handleUnselectAll = useCallback(() => {
    setSelectedItems([]);
    setSelectAllPages(false);
    setSelectAllInStore(false);
    setSelectedHaveSEO(false);
    setShowSelectionPopover(false);
  }, []);

  // Pagination handlers
  const handlePreviousPage = useCallback(() => {
    if (page > 1) {
      loadCollections(page - 1);
      setSelectedItems([]);
      setSelectAllPages(false);
      setSelectAllInStore(false);
    }
  }, [page, loadCollections]);

  const handleNextPage = useCallback(() => {
    if (page < totalPages) {
      loadCollections(page + 1);
      setSelectedItems([]);
      setSelectAllPages(false);
      setSelectAllInStore(false);
    }
  }, [page, totalPages, loadCollections]);

  const handleItemsPerPageChange = useCallback((value) => {
    setItemsPerPage(parseInt(value));
    setPage(1);
    setSelectedItems([]);
    setSelectAllPages(false);
    setSelectAllInStore(false);
  }, []);

  // Load SEO data for preview
  const loadSeoDataForPreview = async (collectionId) => {
    setLoadingPreview(true);
    try {
      const url = `/collections/${collectionId.split('/').pop()}/seo-data?shop=${encodeURIComponent(shop)}`;
      const data = await api(url);
      setPreviewData(data);
      setShowPreviewModal(true);
    } catch (err) {
      // Ако бекендът връща 404 за липсващи данни, api ще хвърли грешка със status
      setToast(err?.status === 404 ? 'No SEO data found for this collection' : 'Failed to load SEO data');
    } finally {
      setLoadingPreview(false);
    }
  };

  // ============================================================
  // Background Job Polling Functions
  // ============================================================
  
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
  
  // Fetch Collection SEO job status
  const fetchCollectionSeoJobStatus = useCallback(async () => {
    try {
      const status = await api(`/seo/collection-job-status?shop=${shop}&type=seo`);
      
      setCollectionSeoJobStatus(prevStatus => {
        const justCompleted = prevStatus.inProgress && !status.inProgress && 
          (status.status === 'completed' || status.status === 'failed');
        
        if (justCompleted) {
          if (collectionSeoPollingRef.current) {
            clearInterval(collectionSeoPollingRef.current);
            collectionSeoPollingRef.current = null;
          }
          
          if (status.status === 'completed') {
            setToast(`Optimized ${status.successfulCollections} collection${status.successfulCollections !== 1 ? 's' : ''}`);
          } else if (status.status === 'failed') {
            setToast(`Collection SEO failed: ${status.message || 'Unknown error'}`);
          }
          
          loadCollections();
        }
        
        return status;
      });
      
      return status;
    } catch (error) {
      console.error('[COLLECTIONS] Failed to fetch SEO job status:', error);
    }
  }, [shop, api, loadCollections]);
  
  // Start polling for Collection SEO job status
  const startCollectionSeoPolling = useCallback(() => {
    if (collectionSeoPollingRef.current) {
      clearInterval(collectionSeoPollingRef.current);
    }
    fetchCollectionSeoJobStatus();
    collectionSeoPollingRef.current = setInterval(() => {
      fetchCollectionSeoJobStatus();
    }, 5000);
  }, [fetchCollectionSeoJobStatus]);
  
  // Fetch Collection AI Enhancement job status
  const fetchCollectionAiEnhanceJobStatus = useCallback(async () => {
    try {
      const status = await api(`/ai-enhance/collection-job-status?shop=${shop}`);
      
      setCollectionAiEnhanceJobStatus(prevStatus => {
        const justCompleted = prevStatus.inProgress && !status.inProgress && 
          (status.status === 'completed' || status.status === 'failed');
        
        if (justCompleted) {
          if (collectionAiEnhancePollingRef.current) {
            clearInterval(collectionAiEnhancePollingRef.current);
            collectionAiEnhancePollingRef.current = null;
          }
          
          if (status.status === 'completed') {
            setToast(`AI Enhanced ${status.successfulCollections} collection${status.successfulCollections !== 1 ? 's' : ''}`);
          } else if (status.status === 'failed') {
            setToast(`AI Enhancement failed: ${status.message || 'Unknown error'}`);
          }
          
          loadCollections();
        }
        
        return status;
      });
      
      return status;
    } catch (error) {
      console.error('[COLLECTIONS] Failed to fetch AI Enhancement job status:', error);
    }
  }, [shop, api, loadCollections]);
  
  // Start polling for Collection AI Enhancement job status
  const startCollectionAiEnhancePolling = useCallback(() => {
    if (collectionAiEnhancePollingRef.current) {
      clearInterval(collectionAiEnhancePollingRef.current);
    }
    fetchCollectionAiEnhanceJobStatus();
    collectionAiEnhancePollingRef.current = setInterval(() => {
      fetchCollectionAiEnhanceJobStatus();
    }, 5000);
  }, [fetchCollectionAiEnhanceJobStatus]);
  
  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (collectionSeoPollingRef.current) {
        clearInterval(collectionSeoPollingRef.current);
      }
      if (collectionAiEnhancePollingRef.current) {
        clearInterval(collectionAiEnhancePollingRef.current);
      }
    };
  }, []);
  
  // Check for in-progress jobs on mount
  useEffect(() => {
    if (shop) {
      fetchCollectionSeoJobStatus().then(status => {
        if (status?.inProgress) {
          startCollectionSeoPolling();
        }
      });
      fetchCollectionAiEnhanceJobStatus().then(status => {
        if (status?.inProgress) {
          startCollectionAiEnhancePolling();
        }
      });
    }
  }, [shop, fetchCollectionSeoJobStatus, fetchCollectionAiEnhanceJobStatus, startCollectionSeoPolling, startCollectionAiEnhancePolling]);

  // Calculate maximum NEW languages that can be added
  // Takes into account already optimized languages across selected collections
  // Check if the selected languages would exceed the plan limit for any selected collection
  const checkLanguageLimitExceeded = useMemo(() => {
    if (selectAllPages) {
      // For "select all", just check if we're selecting more than the plan allows
      return selectedLanguages.length > languageLimit;
    }
    
    const selectedCollections = collections.filter(c => selectedItems.includes(c.id));
    if (selectedCollections.length === 0) {
      // No collections selected - just check total selected languages
      return selectedLanguages.length > languageLimit;
    }
    
    // For each selected collection, check if adding the new languages would exceed the limit
    for (const collection of selectedCollections) {
      const existingLanguages = collection.optimizationSummary?.optimizedLanguages || [];
      
      // Find which of the selected languages are actually NEW (not already optimized)
      const newLanguages = selectedLanguages.filter(lang => !existingLanguages.includes(lang));
      
      // Total languages after adding new ones
      const totalLanguages = existingLanguages.length + newLanguages.length;
      
      if (totalLanguages > languageLimit) {
        return true; // Exceeds limit
      }
    }
    
    return false; // All collections are within limit
  }, [collections, selectedItems, selectAllPages, languageLimit, selectedLanguages]);

  // Open language selection modal
  const openLanguageModal = () => {
    if (selectedItems.length === 0 && !selectAllPages) {
      setToast('Please select collections first');
      return;
    }
    setShowLanguageModal(true);
  };
  
  // AI Enhancement function - now uses background queue
  const handleStartEnhancement = async () => {
    // Get selected collections with Basic SEO
    const selectedCollections = collections.filter(c => selectedItems.includes(c.id));
    const selectedWithSEO = selectedCollections.filter(c => 
      c.optimizedLanguages?.length > 0
    );
    
    if (selectedWithSEO.length === 0) {
      setToast('Please select collections with Basic SEO optimization');
      return;
    }

    // Prepare collections for batch processing
    const collectionsForBatch = selectedWithSEO.map(collection => ({
      collectionId: collection.id,
      languages: collection.optimizedLanguages || [],
      title: collection.title
    }));

    try {
      const response = await api(`/ai-enhance/collection-batch?shop=${shop}`, {
        method: 'POST',
        body: {
          shop,
          collections: collectionsForBatch
        }
      });

      if (response.queued) {
        setToast(`Enhancing ${collectionsForBatch.length} collections in background...`);
        setSelectedItems([]);
        setSelectAllPages(false);
        startCollectionAiEnhancePolling();
      } else {
        setToast(response.message || 'Failed to queue AI Enhancement job');
      }
    } catch (error) {
      // Handle plan/token errors
      if (error.status === 403) {
        setTokenError(error);
        setCurrentPlan(error.currentPlan || currentPlan || 'starter');
        setShowUpgradeModal(true);
        return;
      }
      
      if (error.status === 402 || error.requiresPurchase || error.trialRestriction) {
        setTokenError(error);
        setCurrentPlan(error.currentPlan || currentPlan || 'starter');
        
        if (error.trialRestriction && error.requiresActivation) {
          setShowTrialActivationModal(true);
        } else if (error.trialRestriction) {
          setShowUpgradeModal(true);
        } else {
          setShowInsufficientTokensModal(true);
        }
        return;
      }
      
      setToast(`Error: ${error.message || 'Failed to start AI Enhancement'}`);
    }
  };

  // Legacy AI Enhancement function (kept for reference but not used)
  const handleStartEnhancementLegacy = async () => {
    const selectedCollections = collections.filter(c => selectedItems.includes(c.id));
    const selectedWithSEO = selectedCollections.filter(c => 
      c.optimizedLanguages?.length > 0
    );
    
    if (selectedWithSEO.length === 0) {
      setToast('Please select collections with Basic SEO optimization');
      return;
    }

    setShowAIEnhanceModal(true);
    setAIEnhanceProgress({
      processing: true,
      current: 0,
      total: selectedWithSEO.length,
      currentItem: '',
      results: null
    });
    
    const results = { successful: 0, failed: 0, skipped: 0 };
    
    for (let i = 0; i < selectedWithSEO.length; i++) {
      const collection = selectedWithSEO[i];
      
      setAIEnhanceProgress(prev => ({
        ...prev,
        current: i,
        currentItem: collection.title
      }));
      
      try {
        const languagesToEnhance = collection.optimizedLanguages || [];
        
        if (languagesToEnhance.length === 0) {
          results.skipped++;
          continue;
        }
        
        const enhanceData = await api(`/ai-enhance/collection/${encodeURIComponent(collection.id)}`, {
          method: 'POST',
          shop,
          body: {
            shop,
            languages: languagesToEnhance,
          },
        });
        
        if (enhanceData && enhanceData.ok) {
          results.successful++;
        } else {
          results.failed++;
        }
        
      } catch (error) {
        if (error.status === 403) {
          setAIEnhanceProgress({
            processing: false,
            current: 0,
            total: 0,
            currentItem: '',
            results: null
          });
          
          setTokenError(error);
          setCurrentPlan(error.currentPlan || currentPlan || 'starter');
          setShowUpgradeModal(true);
          return;
        }
        
        if (error.status === 402 || error.requiresPurchase || error.trialRestriction) {
          setAIEnhanceProgress({
            processing: false,
            current: 0,
            total: 0,
            currentItem: '',
            results: null
          });
          
          setTokenError(error);
          setCurrentPlan(error.currentPlan || currentPlan || 'starter');
          
          if (error.trialRestriction && error.requiresActivation) {
            setShowTrialActivationModal(true);
          } else if (error.trialRestriction) {
            setShowUpgradeModal(true);
          } else {
            setShowInsufficientTokensModal(true);
          }
          return;
        }
        
        results.failed++;
      }
      
      setAIEnhanceProgress(prev => ({
        ...prev,
        current: i + 1
      }));
    }
    
    setAIEnhanceProgress(prev => ({
      ...prev,
      processing: false,
      results
    }));
    
    setToast(`AI enhancement complete! ${results.successful} collections enhanced.`);
  };
  
  // AI Enhancement Modal - използва Polaris компоненти като другите модали
  const AIEnhanceModal = () => {
    const selectedCollections = collections.filter(c => selectedItems.includes(c.id));
    const selectedWithSEO = selectedCollections.filter(c => 
      c.optimizedLanguages?.length > 0
    );
    
    // This debug function is not used - using handleStartEnhancement instead

    
    const handleClose = () => {
      // Save results BEFORE resetting state
      const results = aiEnhanceProgress.results;
      
      setShowAIEnhanceModal(false);
      setAIEnhanceProgress({
        processing: false,
        current: 0,
        total: 0,
        currentItem: '',
        results: null
      });
      
      // Refresh collections list if any were successfully enhanced
      if (results && results.successful > 0) {
        // Backend already invalidated Redis cache (invalidateShop)
        // Use setTimeout to avoid async race condition with modal close
        setTimeout(() => {
          setCollections([]); // Clear current collections to force re-render
          loadCollections(); // Cache already invalidated by backend
        }, 1500); // 1.5s delay for MongoDB write + Redis invalidation propagation
      }
    };
    
    // Progress modal
    if (aiEnhanceProgress.processing) {
      return (
        <Modal
          open={showAIEnhanceModal}
          title="Processing AI Enhancement"
          onClose={() => {}}
          noScroll
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text variant="bodyMd">
                Processing: {aiEnhanceProgress.currentItem}
              </Text>
              <ProgressBar progress={(aiEnhanceProgress.current / aiEnhanceProgress.total) * 100} />
              <Text variant="bodySm" tone="subdued">
                {aiEnhanceProgress.current} of {aiEnhanceProgress.total} collections 
                ({Math.round((aiEnhanceProgress.current / aiEnhanceProgress.total) * 100)}%)
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      );
    }
    
    // Results modal
    if (aiEnhanceProgress.results !== null) {
      return (
        <Modal
          open={showAIEnhanceModal}
          title="AI Enhancement Results"
          onClose={handleClose}
          primaryAction={{
            content: 'Done',
            onAction: handleClose,
          }}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <InlineStack gap="400">
                <Box>
                  <Text variant="bodyMd" fontWeight="semibold">Successful:</Text>
                  <Text variant="headingLg" fontWeight="bold" tone="success">
                    {aiEnhanceProgress.results.successful}
                  </Text>
                </Box>
                <Box>
                  <Text variant="bodyMd" fontWeight="semibold">Failed:</Text>
                  <Text variant="headingLg" fontWeight="bold" tone="critical">
                    {aiEnhanceProgress.results.failed}
                  </Text>
                </Box>
                <Box>
                  <Text variant="bodyMd" fontWeight="semibold">Skipped:</Text>
                  <Text variant="headingLg" fontWeight="bold" tone="info">
                    {aiEnhanceProgress.results.skipped}
                  </Text>
                </Box>
              </InlineStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      );
    }
    
    return null;
  };
  
  // Generate SEO for selected collections - now uses background queue
  const generateSEO = async () => {
    if (!selectedLanguages.length) {
      setToast('Please select at least one language');
      return;
    }
    
    setShowLanguageModal(false);
    
    try {
      const collectionsToProcess = selectAllPages 
        ? collections 
        : collections.filter(c => selectedItems.includes(c.id));
      
      // Prepare collections for batch processing
      const collectionsForBatch = collectionsToProcess.map(collection => ({
        collectionId: collection.id,
        languages: selectedLanguages,
        title: collection.title
      }));
      
      const response = await api(`/seo/collection-generate-apply-batch?shop=${shop}`, {
        method: 'POST',
        body: {
          shop,
          collections: collectionsForBatch,
          model: model || 'google/gemini-1.5-flash'
        }
      });
      
      if (response.queued) {
        setToast(`Optimizing ${collectionsForBatch.length} collections in background...`);
        setSelectedItems([]);
        setSelectAllPages(false);
        startCollectionSeoPolling();
      } else {
        setToast(response.message || 'Failed to queue optimization job');
      }
    } catch (error) {
      // Handle plan restriction errors
      if (error.status === 403 || error.message?.includes('requires Professional plan')) {
        setTokenError({
          error: error.message || 'Collections SEO requires Professional plan or higher',
          currentPlan: error.currentPlan || currentPlan || 'starter',
          upgradeMessage: error.upgradeMessage || 'Upgrade to Professional plan to optimize collections for AI search'
        });
        setShowUpgradeModal(true);
        return;
      }
      
      setToast(`Error: ${error.message || 'Failed to start optimization'}`);
    }
  };
  
  // Legacy generateSEO with progress modal (kept for reference but not used)
  const generateSEOLegacy = async () => {
    if (!selectedLanguages.length) {
      setToast('Please select at least one language');
      return;
    }
    
    setShowLanguageModal(false);
    setIsProcessing(true);
    setProgress({ current: 0, total: 0, percent: 0 });
    setErrors([]);
    setResults({});
    
    try {
      const collectionsToProcess = selectAllPages 
        ? collections 
        : collections.filter(c => selectedItems.includes(c.id));
      
      const total = collectionsToProcess.length;
      setProgress({ current: 0, total, percent: 0 });
      
      const results = {};
      
      for (let i = 0; i < collectionsToProcess.length; i++) {
        const collection = collectionsToProcess[i];
        setCurrentCollection(collection.title);
        
        try {
          // Използваме session token
          const data = await api('/seo/generate-collection-multi', {
            method: 'POST',
            shop,
            body: JSON.stringify({
              shop,
              collectionId: collection.id,
              model,
              languages: selectedLanguages,
            }),
          });
          
          results[collection.id] = {
            success: true,
            data
          };
        } catch (err) {
          // Check if it's a plan restriction error (403)
          if (err.status === 403 || err.message?.includes('requires Professional plan')) {
            // Stop processing and show upgrade modal
            setIsProcessing(false);
            setCurrentCollection('');
            setTokenError({
              error: err.message || 'Collections SEO requires Professional plan or higher',
              currentPlan: err.currentPlan || currentPlan || 'starter',
              upgradeMessage: err.upgradeMessage || 'Upgrade to Professional plan to optimize collections for AI search'
            });
            setShowUpgradeModal(true);
            return; // Stop loop
          }
          
          results[collection.id] = {
            success: false,
            error: err.message,
          };
          setErrors(prev => [...prev, { collection: collection.title, error: err.message }]);
        }
        
        const current = i + 1;
        const percent = Math.round((current / total) * 100);
        setProgress({ current, total, percent });
      }
      
      setResults(results);
      setShowResultsModal(true);
      
      const successCount = Object.values(results).filter(r => r.success).length;
      setToast(`Generated optimization for ${successCount} collections`);
      
    } catch (err) {
      setToast(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setCurrentCollection('');
    }
  };
  
  // Apply SEO results
  const applySEO = async () => {
    setIsProcessing(true);
    setProgress({ current: 0, total: 0, percent: 0 });
    
    try {
      const successfulResults = Object.entries(results).filter(([_, r]) => r.success);
      const total = successfulResults.length;
      setProgress({ current: 0, total, percent: 0 });
      
      for (let i = 0; i < successfulResults.length; i++) {
        const [collectionId, result] = successfulResults[i];
        const collection = collections.find(c => c.id === collectionId);
        
        if (!collection) continue;
        
        setCurrentCollection(collection.title);
        
        try {
          // Проверка на структурата
          if (!result.data?.results || !Array.isArray(result.data.results)) {
            throw new Error('Invalid results structure');
          }
          
          const data = await api('/seo/apply-collection-multi', {
            method: 'POST',
            shop,
            body: {
              shop,
              collectionId,
              results: result.data.results.map(r => ({
                language: r.language,
                seo: r.data  // Преименуваме 'data' на 'seo'
              })),
              options: {
                updateTitle: true,
                updateDescription: true,
                updateSeo: true,
                updateMetafields: true,
              },
            },
          });
          
          if (!data?.ok) {
            throw new Error(data?.error || 'Apply failed');
          }
          
        } catch (err) {
          console.error('Apply error for collection:', collectionId, err);
          errors.push({ id: collection.id, title: collection.title, message: err.message });
        }
        
        const current = i + 1;
        const percent = Math.round((current / total) * 100);
        setProgress({ current, total, percent });
      }
      
      setToast('Optimization applied successfully!');
      setShowResultsModal(false);
      setResults({});
      setSelectedItems([]);
      await loadCollections();
      setSelectAllPages(false); // Reset Select All checkbox after reload
      
    } catch (err) {
      setToast(`Error applying optimization: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setCurrentCollection('');
    }
  };
  
  // Delete SEO for a single language
  const deleteSeoForLanguage = async (collectionId, language) => {
    setIsDeleting(true);
    setDeleteError('');
    try {
      const response = await api('/collections/delete-seo', {
        method: 'DELETE',
        shop,
        body: { shop, collectionId, language },
      });
      
      setToast(`Deleted ${language.toUpperCase()} optimization successfully`);
      setShowDeleteModal(false);
      setDeleteTarget(null);
      
      // Reset status indicators after delete
      setCollectionSeoJobStatus({
        inProgress: false,
        status: 'idle',
        message: null,
        totalCollections: 0,
        processedCollections: 0,
        successfulCollections: 0,
        failedCollections: 0,
        skippedCollections: 0,
        completedAt: null
      });
      setCollectionAiEnhanceJobStatus({
        inProgress: false,
        status: 'idle',
        message: null,
        totalCollections: 0,
        processedCollections: 0,
        successfulCollections: 0,
        failedCollections: 0,
        skippedCollections: 0,
        completedAt: null
      });
      
      // Reload collections to update badges
      await loadCollections();
      
    } catch (err) {
      console.error('[DELETE-SEO] Error:', err);
      setToast(`Delete error: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };
  
  // Bulk delete SEO for selected collections and languages
  const deleteSeoBulk = async (deleteLanguages = []) => {
    setIsDeletingBulk(true);
    setDeleteError('');
    try {
      const collectionsToProcess = selectAllPages 
        ? collections 
        : collections.filter(c => selectedItems.includes(c.id));
        
      const total = collectionsToProcess.length * deleteLanguages.length;
      let current = 0;
      const errors = [];
      
      for (const collection of collectionsToProcess) {
        for (const language of deleteLanguages) {
          try {
            const response = await api('/collections/delete-seo', {
              method: 'DELETE',
              shop,
              body: { shop, collectionId: collection.id, language },
            });
          } catch (err) {
            console.error(`[DELETE-SEO-BULK] Failed to delete ${language} for ${collection.title}:`, err);
            errors.push({ id: collection.id, title: collection.title, message: err.message });
          } finally {
            current++;
            setProgress({ current, total, percent: Math.round((current / total) * 100) });
          }
        }
      }
      
      setToast(`Deleted optimization for ${deleteLanguages.join(', ').toUpperCase()}`);
      
      // Reset status indicators after bulk delete
      setCollectionSeoJobStatus({
        inProgress: false,
        status: 'idle',
        message: null,
        totalCollections: 0,
        processedCollections: 0,
        successfulCollections: 0,
        failedCollections: 0,
        skippedCollections: 0,
        completedAt: null
      });
      setCollectionAiEnhanceJobStatus({
        inProgress: false,
        status: 'idle',
        message: null,
        totalCollections: 0,
        processedCollections: 0,
        successfulCollections: 0,
        failedCollections: 0,
        skippedCollections: 0,
        completedAt: null
      });
      
      // Important: reload AFTER we finish
      setTimeout(async () => {
        await loadCollections();
        // Reset selections
        setSelectedItems([]);
        setSelectAllPages(false);
        setSelectedHaveSEO(false);
      }, 100);
      
    } catch (err) {
      console.error('[DELETE-SEO-BULK] Error:', err);
      setToast(`Delete error: ${err.message}`);
    } finally {
      setIsDeletingBulk(false);
      setPendingDeleteLanguages([]);
      setDeleteLanguages([]);
    }
  };
  
  // Resource list items
  const renderItem = (collection) => {
    const hasResult = results[collection.id]?.success || appliedSeoData[collection.id];
    const seoData = results[collection.id]?.data || appliedSeoData[collection.id];
    const optimizedLanguages = collection.optimizedLanguages || [];
    
    
    const media = (
      <Box width="40px" height="40px" background="surface-neutral" borderRadius="200" />
    );
    
    return (
      <ResourceItem
        id={collection.id}
        media={media}
        accessibilityLabel={`View details for ${collection.title}`}
      >
        <InlineStack gap="400" align="center" blockAlign="center" wrap={false}>
          <Box style={{ flex: '1 1 30%', minWidth: '200px' }}>
            <Text variant="bodyMd" fontWeight="semibold">{collection.title}</Text>
            <Text variant="bodySm" tone="subdued">Handle: {collection.handle}</Text>
          </Box>
          
          <Box style={{ flex: '0 0 15%', minWidth: '100px', textAlign: 'center' }}>
            <Text variant="bodyMd">{collection.productsCount} products</Text>
          </Box>
          
          <Box style={{ flex: '0 0 25%', minWidth: '160px' }}>
            <InlineStack gap="100" wrap>
              {collection.hasSeoData ? (
                <>
                  {availableLanguages.map(lang => (
                    <Badge
                      key={lang}
                      tone={optimizedLanguages.includes(lang) ? 'success' : 'subdued'}
                      size="small"
                    >
                      {lang.toUpperCase()}
                    </Badge>
                  ))}
                  {collection.aiEnhanced && (
                    <Badge tone="info" size="small">AI✨</Badge>
                  )}
                </>
              ) : (
                <Badge tone="subdued">No AI Search Optimisation</Badge>
              )}
            </InlineStack>
          </Box>
          
          <Box style={{ flex: '0 0 15%', minWidth: '120px' }}>
            {hasResult && (
              <Button
                size="slim"
                onClick={() => {
                  setPreviewData(seoData);
                  setShowPreviewModal(true);
                }}
              >
                Preview JSON
              </Button>
            )}
            {!hasResult && collection.hasSeoData && (
              <Button
                size="slim"
                loading={loadingPreview}
                onClick={() => loadSeoDataForPreview(collection.id)}
              >
                Preview JSON
              </Button>
            )}
          </Box>
        </InlineStack>
      </ResourceItem>
    );
  };
  
  // Progress modal - показва се само когато не се извършва AI Enhancement
  const progressModal = isProcessing && !aiEnhanceProgress.processing && (
    <Modal
      open={isProcessing}
      title="Processing Collections"
      onClose={() => {}}
      noScroll
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd">
            {currentCollection ? `Processing: ${currentCollection}` : 'Preparing...'}
          </Text>
          <ProgressBar progress={progress.percent} />
          <Text variant="bodySm" tone="subdued">
            {progress.current} of {progress.total} collections ({progress.percent}%)
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
      primaryAction={{
        content: 'Generate Optimization for AI Search',
        onAction: generateSEO,
        disabled: selectedLanguages.length === 0 || checkLanguageLimitExceeded,
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: () => setShowLanguageModal(false),
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text variant="bodyMd">Select languages to generate AI Search Optimisation for {selectAllPages ? 'all' : selectedItems.length} selected collections:</Text>
          
          {/* Language Limit Warning Banner */}
          {checkLanguageLimitExceeded && (
            <Banner tone="warning" title="Language limit exceeded">
              <BlockStack gap="200">
                <Text variant="bodyMd">
                  Your {currentPlan} plan supports up to {languageLimit} language{languageLimit > 1 ? 's' : ''} per collection. 
                  {selectedItems.length === 1 && collections.find(c => c.id === selectedItems[0])?.optimizationSummary?.optimizedLanguages?.length > 0 && (
                    <> This collection already has {collections.find(c => c.id === selectedItems[0]).optimizationSummary.optimizedLanguages.length} optimized language(s).</>
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
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
  
  // Results modal
  const resultsModal = (
    <Modal
      open={showResultsModal && !isProcessing}
      title="AI Search Optimisation Results"
      primaryAction={{
        content: 'Apply Optimisation',
        onAction: applySEO,
        disabled: !Object.values(results).some(r => r.success),
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: () => setShowResultsModal(false),
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <InlineStack gap="400">
            <Box>
              <Text variant="bodyMd" fontWeight="semibold">Successful:</Text>
              <Text variant="headingLg" fontWeight="bold" tone="success">
                {Object.values(results).filter(r => r.success && !r.skipped).length}
              </Text>
            </Box>
            <Box>
              <Text variant="bodyMd" fontWeight="semibold">Skipped:</Text>
              <Text variant="headingLg" fontWeight="bold" tone="info">
                {Object.values(results).filter(r => r.skipped).length}
              </Text>
            </Box>
            <Box>
              <Text variant="bodyMd" fontWeight="semibold">Failed:</Text>
              <Text variant="headingLg" fontWeight="bold" tone="critical">
                {Object.values(results).filter(r => !r.success && !r.skipped).length}
              </Text>
            </Box>
          </InlineStack>
          
          {errors.length > 0 && (
            <>
              <Divider />
              <Text variant="bodyMd" fontWeight="semibold">Errors:</Text>
              <Box maxHeight="200px" overflowY="scroll">
                {errors.slice(0, 10).map((err, idx) => (
                  <Text key={idx} variant="bodySm" tone="critical">
                    {err.collection}: {err.error}
                  </Text>
                ))}
                {errors.length > 10 && (
                  <Text variant="bodySm" tone="subdued">
                    ... and {errors.length - 10} more errors
                  </Text>
                )}
              </Box>
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
  
  // Preview modal
  const previewModal = (
    <Modal
      open={showPreviewModal}
      title="SEO Data Preview"
      secondaryActions={[
        {
          content: 'Close',
          onAction: () => {
            setShowPreviewModal(false);
            setPreviewData(null);
          },
        },
      ]}
    >
      <Modal.Section>
        <Box>
          <pre style={{ 
            whiteSpace: 'pre-wrap', 
            wordBreak: 'break-word',
            fontSize: '12px',
            backgroundColor: '#f6f6f7',
            padding: '12px',
            borderRadius: '4px',
            maxHeight: '400px',
            overflow: 'auto'
          }}>
            {previewData ? JSON.stringify(previewData, null, 2) : ''}
          </pre>
        </Box>
      </Modal.Section>
    </Modal>
  );
  
  // Bulk delete modal
  const bulkDeleteModal = (
    <Modal
      open={showBulkDeleteModal}
      title="Delete Optimization for AI Search"
      onClose={() => {
        setShowBulkDeleteModal(false);
        setDeleteLanguages([]);
      }}
      primaryAction={{
        content: 'Continue',
        onAction: () => {
          setPendingDeleteLanguages(deleteLanguages);
          setShowBulkDeleteModal(false);
          setShowConfirmModal(true);
        },
        disabled: deleteLanguages.length === 0
      }}
      secondaryActions={[{
        content: 'Cancel',
        onAction: () => {
          setShowBulkDeleteModal(false);
          setDeleteLanguages([]);
        }
      }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd">
            Select languages to delete AI Search Optimisation from {selectAllPages ? totalCount : selectedItems.length} selected collections:
          </Text>
          
          {/* Custom checkbox row to match Products design */}
          <Box paddingBlockStart="200">
            <InlineStack gap="400" wrap={false}>
              {availableLanguages.map(lang => (
                <label key={lang} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  cursor: 'pointer',
                  userSelect: 'none' 
                }}>
                  <input
                    type="checkbox"
                    checked={deleteLanguages.includes(lang)}
                    onChange={(e) => {
                      setDeleteLanguages(
                        e.target.checked
                          ? [...deleteLanguages, lang]
                          : deleteLanguages.filter(l => l !== lang)
                      );
                    }}
                    style={{ 
                      marginRight: '8px',
                      width: '18px',
                      height: '18px',
                      cursor: 'pointer'
                    }}
                  />
                  <Text variant="bodyMd">{lang.toUpperCase()}</Text>
                </label>
              ))}
            </InlineStack>
          </Box>
          
          {/* Select all button */}
          <Box>
            <Button
              plain
              onClick={() => {
                setDeleteLanguages(
                  deleteLanguages.length === availableLanguages.length
                    ? []
                    : [...availableLanguages]
                );
              }}
            >
              Select all
            </Button>
          </Box>
          
          {/* Warning text */}
          <Box paddingBlockStart="300">
            <Text variant="bodySm">
              Warning: This will permanently delete AI Search Optimisation data for selected languages.
            </Text>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
  
  // Confirmation delete modal
  const confirmDeleteModal = (
    <Modal
      open={showConfirmModal}
      title="Confirm Deletion"
      onClose={() => {
        setShowConfirmModal(false);
        setPendingDeleteLanguages([]);
      }}
      primaryAction={{
        content: 'Delete',
        destructive: true,
        onAction: async () => {
          setShowConfirmModal(false);
          // Small delay to close the modal
          setTimeout(() => {
            deleteSeoBulk(pendingDeleteLanguages);
          }, 100);
        }
      }}
      secondaryActions={[{
        content: 'Cancel',
        onAction: () => {
          setShowConfirmModal(false);
          setPendingDeleteLanguages([]);
          setDeleteLanguages([]);
        }
      }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd">
            Are you sure you want to delete AI Search Optimisation for the following languages?
          </Text>
          
          {/* Language badges */}
          <Box paddingBlockStart="200">
            <InlineStack gap="200">
              {pendingDeleteLanguages.map(lang => (
                <Badge key={lang} tone="warning">
                  {lang.toUpperCase()}
                </Badge>
              ))}
            </InlineStack>
          </Box>
          
          {/* Collection count */}
          <Text variant="bodyMd">
            This will delete optimisation from {selectAllPages ? totalCount : selectedItems.length} selected collections.
          </Text>
          
          {/* Warning */}
          <Box paddingBlockStart="200">
            <Text variant="bodySm" tone="critical">
              This action cannot be undone.
            </Text>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
  
  // Delete progress modal
  const deleteProgressModal = isDeletingBulk && (
    <Modal
      open={isDeletingBulk}
      title="Deleting SEO Data"
      onClose={() => {}}
      noScroll
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd">Deleting selected languages...</Text>
          <ProgressBar progress={progress.percent} />
          <Text variant="bodySm" tone="subdued">
            {progress.current} of {progress.total} operations ({progress.percent}%)
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
  
  const emptyState = (
    <EmptyState
      heading="No collections found"
      action={{ 
        content: 'Clear filters', 
        onAction: () => {
          setSearchValue('');
          setOptimizedFilter('all');
          loadCollections();
        }
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Try adjusting your filters or search terms</p>
    </EmptyState>
  );
  
  return (
    <>
      {/* Store Metadata Banner */}
      <StoreMetadataBanner globalPlan={globalPlan} />
      
      <Card>
        <Box padding="400">
          <BlockStack gap="300">
            {/* First row: Search bar + Generate button */}
            <InlineStack gap="400" align="space-between" blockAlign="center" wrap={false}>
              <Box minWidth="400px">
                <TextField
                  label=""
                  placeholder="Search by collection name..."
                  value={searchValue}
                  onChange={setSearchValue}
                  prefix={<SearchIcon />}
                  clearButton
                  onClearButtonClick={() => setSearchValue('')}
                />
              </Box>
              
              <Box width="320px">
                <Button
                  primary
                  onClick={openLanguageModal}
                  disabled={selectedItems.length === 0 && !selectAllPages}
                  size="medium"
                  fullWidth
                >
                  Generate Optimization for AI Search
                </Button>
              </Box>
            </InlineStack>
            
            {/* Second row: Sync Collections + Dynamic right side */}
            <InlineStack gap="400" align="space-between" blockAlign="start" wrap={false}>
              <Button
                onClick={handleSyncCollections}
                disabled={syncing || loading}
                size="medium"
              >
                {syncing ? 'Syncing...' : 'Sync Collections'}
              </Button>
              
              <Box width="320px">
                <BlockStack gap="200" align="end">
                  {/* AI Enhanced Search Optimisation Button */}
                  {(() => {
                    if (selectedItems.length === 0 && !selectAllPages) return null;
                    
                    const selectedCollections = collections.filter(c => selectedItems.includes(c.id));
                    const hasOptimizedCollections = selectedCollections.some(c => 
                      c.optimizedLanguages?.length > 0
                    );
                    
                    if (!hasOptimizedCollections) return null;
                    
                    // Check if Starter plan (Collections require Professional+)
                    const isStarter = currentPlan.toLowerCase().replace(/_/g, ' ') === 'starter';
                    
                    return (
                      <Button
                        onClick={isStarter ? () => {
                          // Show upgrade modal for Starter plan only
                          setTokenError({
                            error: 'Collections require Professional plan or higher',
                            message: 'Upgrade to Professional plan to access Collections optimization',
                            minimumPlanRequired: 'Professional'
                          });
                          setShowUpgradeModal(true);
                        } : handleStartEnhancement}
                        disabled={selectedItems.length === 0 && !selectAllPages}
                        size="medium"
                        fullWidth
                      >
                        AI Enhanced add-ons
                      </Button>
                    );
                  })()}
                  
                  <Button
                    outline
                    destructive
                    onClick={() => setShowBulkDeleteModal(true)}
                    disabled={selectedItems.length === 0 || !selectedHaveSEO}
                    size="medium"
                    fullWidth
                  >
                    Delete Optimization for AI Search
                  </Button>
                </BlockStack>
              </Box>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>

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
                        { label: 'All collections', value: 'all' },
                        { label: 'Has AI Search Optimisation', value: 'true' },
                        { label: 'No AI Search Optimisation', value: 'false' },
                      ]}
                      selected={[optimizedFilter]}
                      onChange={(value) => {
                        setOptimizedFilter(value[0]);
                        setShowOptimizedPopover(false);
                      }}
                    />
                  </Box>
                </Popover>
                
                {/* Language Status filter - commented out for now */}
                {/* <Popover
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
                        ...(availableLanguages?.map(lang => ({
                          label: `Has ${lang.toUpperCase()}`,
                          value: `has_${lang}`
                        })) || []),
                        ...(availableLanguages?.map(lang => ({
                          label: `Missing ${lang.toUpperCase()}`,
                          value: `missing_${lang}`
                        })) || []),
                      ]}
                      selected={languageFilter ? [languageFilter] : []}
                      onChange={(value) => {
                        setLanguageFilter(value[0] || '');
                        setShowLanguagePopover(false);
                      }}
                    />
                  </Box>
                </Popover> */}
                
                {/* Tags filter - commented out for now */}
                {/* <Popover
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
                </Popover> */}
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
                      <span>
                        {sortBy === 'updatedAt' && sortOrder === 'desc' && 'Newest first'}
                        {sortBy === 'updatedAt' && sortOrder === 'asc' && 'Oldest first'}
                        {sortBy === 'title' && sortOrder === 'asc' && 'Name A-Z'}
                        {sortBy === 'title' && sortOrder === 'desc' && 'Name Z-A'}
                        {sortBy === 'productsCount' && sortOrder === 'desc' && 'Most products'}
                        {sortBy === 'productsCount' && sortOrder === 'asc' && 'Least products'}
                      </span>
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
                      { label: 'Newest first', value: 'updatedAt_desc' },
                      { label: 'Oldest first', value: 'updatedAt_asc' },
                      { label: 'Name A-Z', value: 'title_asc' },
                      { label: 'Name Z-A', value: 'title_desc' },
                      { label: 'Most products', value: 'productsCount_desc' },
                      { label: 'Least products', value: 'productsCount_asc' },
                    ]}
                    selected={[`${sortBy}_${sortOrder}`]}
                    onChange={(value) => {
                      const [field, order] = value[0].split('_');
                      setSortBy(field);
                      setSortOrder(order);
                      setShowSortPopover(false);
                    }}
                  />
                </Box>
              </Popover>
            </InlineStack>
            
            {/* Applied filters */}
            {optimizedFilter !== 'all' && (
              <Box paddingBlockStart="200">
                <InlineStack gap="100" wrap>
                  <Badge onRemove={() => setOptimizedFilter('all')}>
                    {optimizedFilter === 'true' ? 'Has AI Search Optimisation' : 'No AI Search Optimisation'}
                  </Badge>
                  {/* {languageFilter && (
                    <Badge onRemove={() => setLanguageFilter('')}>
                      {languageFilter.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </Badge>
                  )}
                  {selectedTags.map(tag => (
                    <Badge key={tag} onRemove={() => setSelectedTags(prev => prev.filter(t => t !== tag))}>
                      Tag: {tag}
                    </Badge>
                  ))} */}
                </InlineStack>
              </Box>
            )}
          </Box>

          {/* Select all with Shopify-style dropdown */}
          {totalCount > 0 && (
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <InlineStack gap="200" blockAlign="center">
                <Checkbox
                  label=""
                  checked={selectAllPages || selectedItems.length === collections.length}
                  onChange={(checked) => handleSelectAllPages(checked, false)}
                />
                <Popover
                  active={showSelectionPopover}
                  activator={
                    <Button
                      disclosure="down"
                      onClick={() => setShowSelectionPopover(!showSelectionPopover)}
                      removeUnderline
                      plain
                    >
                      Select
                    </Button>
                  }
                  onClose={() => setShowSelectionPopover(false)}
                >
                  <Popover.Pane>
                    <Popover.Section>
                      <BlockStack gap="100">
                        <Button
                          plain
                          textAlign="left"
                          onClick={() => {
                            handleSelectAllPages(true, false);
                            setShowSelectionPopover(false);
                          }}
                          disabled={selectedItems.length === collections.length && !selectAllInStore}
                        >
                          Select all {collections.length} on this page
                        </Button>
                        <Button
                          plain
                          textAlign="left"
                          onClick={handleSelectAllInStore}
                          disabled={selectAllInStore}
                        >
                          Select all {totalCount} in this store
                        </Button>
                        <Button
                          plain
                          textAlign="left"
                          onClick={handleUnselectAll}
                          disabled={selectedItems.length === 0}
                        >
                          Deselect all
                        </Button>
                      </BlockStack>
                    </Popover.Section>
                  </Popover.Pane>
                </Popover>
              </InlineStack>
            </Box>
          )}
        </Card>
      </Box>

      {/* Background Job Status Indicator - Show only the most recent/important one */}
      {/* Priority: AI Enhancement > SEO Job (AI Enhancement requires Basic SEO first) */}
      {(() => {
        const hasAiEnhanceStatus = collectionAiEnhanceJobStatus.inProgress || collectionAiEnhanceJobStatus.status === 'completed' || collectionAiEnhanceJobStatus.status === 'failed';
        const hasSeoJobStatus = collectionSeoJobStatus.inProgress || collectionSeoJobStatus.status === 'completed' || collectionSeoJobStatus.status === 'failed';
        
        if (hasAiEnhanceStatus) {
          return (
            <Box paddingBlockStart="400">
              <Card>
                <Box padding="400">
                  {collectionAiEnhanceJobStatus.inProgress ? (
                    <InlineStack gap="300" align="start" blockAlign="center">
                      <Spinner size="small" />
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">AI Enhancing Collections...</Text>
                        <Text variant="bodySm" tone="subdued">
                          {collectionAiEnhanceJobStatus.message || `Processing ${collectionAiEnhanceJobStatus.processedCollections}/${collectionAiEnhanceJobStatus.totalCollections} collections`}
                        </Text>
                        {collectionAiEnhanceJobStatus.totalCollections > 0 && (
                          <Box paddingBlockStart="100">
                            <ProgressBar progress={(collectionAiEnhanceJobStatus.processedCollections / collectionAiEnhanceJobStatus.totalCollections) * 100} size="small" />
                          </Box>
                        )}
                      </BlockStack>
                    </InlineStack>
                  ) : collectionAiEnhanceJobStatus.status === 'completed' ? (
                    <InlineStack gap="200" align="start" blockAlign="center">
                      <Badge tone="success">AI Enhanced</Badge>
                      <Text variant="bodyMd">
                        Enhanced {collectionAiEnhanceJobStatus.successfulCollections} collection{collectionAiEnhanceJobStatus.successfulCollections !== 1 ? 's' : ''}
                        {collectionAiEnhanceJobStatus.skippedCollections > 0 && <Text as="span" tone="subdued"> ({collectionAiEnhanceJobStatus.skippedCollections} skipped)</Text>}
                        {collectionAiEnhanceJobStatus.failedCollections > 0 && <Text as="span" tone="critical"> ({collectionAiEnhanceJobStatus.failedCollections} failed)</Text>}
                      </Text>
                      <Text variant="bodySm" tone="subdued">· {timeAgo(collectionAiEnhanceJobStatus.completedAt)}</Text>
                    </InlineStack>
                  ) : (
                    <InlineStack gap="200" align="start" blockAlign="center">
                      <Badge tone="critical">AI Enhancement Failed</Badge>
                      <Text variant="bodyMd" tone="critical">{collectionAiEnhanceJobStatus.message || 'Enhancement failed'}</Text>
                    </InlineStack>
                  )}
                </Box>
              </Card>
            </Box>
          );
        }
        
        if (hasSeoJobStatus) {
          return (
            <Box paddingBlockStart="400">
              <Card>
                <Box padding="400">
                  {collectionSeoJobStatus.inProgress ? (
                    <InlineStack gap="300" align="start" blockAlign="center">
                      <Spinner size="small" />
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">Optimizing Collections...</Text>
                        <Text variant="bodySm" tone="subdued">
                          {collectionSeoJobStatus.message || `Processing ${collectionSeoJobStatus.processedCollections}/${collectionSeoJobStatus.totalCollections} collections`}
                        </Text>
                        {collectionSeoJobStatus.totalCollections > 0 && (
                          <Box paddingBlockStart="100">
                            <ProgressBar progress={(collectionSeoJobStatus.processedCollections / collectionSeoJobStatus.totalCollections) * 100} size="small" />
                          </Box>
                        )}
                      </BlockStack>
                    </InlineStack>
                  ) : collectionSeoJobStatus.status === 'completed' ? (
                    <InlineStack gap="200" align="start" blockAlign="center">
                      <Badge tone="success">Completed</Badge>
                      <Text variant="bodyMd">
                        Optimized {collectionSeoJobStatus.successfulCollections} collection{collectionSeoJobStatus.successfulCollections !== 1 ? 's' : ''}
                        {collectionSeoJobStatus.skippedCollections > 0 && <Text as="span" tone="subdued"> ({collectionSeoJobStatus.skippedCollections} skipped)</Text>}
                        {collectionSeoJobStatus.failedCollections > 0 && <Text as="span" tone="critical"> ({collectionSeoJobStatus.failedCollections} failed)</Text>}
                      </Text>
                      <Text variant="bodySm" tone="subdued">· {timeAgo(collectionSeoJobStatus.completedAt)}</Text>
                    </InlineStack>
                  ) : (
                    <InlineStack gap="200" align="start" blockAlign="center">
                      <Badge tone="critical">Failed</Badge>
                      <Text variant="bodyMd" tone="critical">{collectionSeoJobStatus.message || 'Optimization failed'}</Text>
                    </InlineStack>
                  )}
                </Box>
              </Card>
            </Box>
          );
        }
        
        return null;
      })()}

      <Box paddingBlockStart="400">
        <Card>
          <ResourceList
            key={`collections-${collections.length}-${selectedItems.length}`}
            resourceName={{ singular: 'collection', plural: 'collections' }}
            items={collections}
            renderItem={renderItem}
            selectedItems={selectedItems}
            onSelectionChange={handleSelectionChange}
            selectable={true}
            loading={loading}
            totalItemsCount={totalCount}
            emptyState={emptyState}
            showHeader={false}
          />
          
          {/* Pagination Controls */}
          {totalCount > 0 && (
            <Box padding="400" borderBlockStartWidth="025" borderColor="border">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text variant="bodySm" tone="subdued">Show</Text>
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
                
                <InlineStack gap="200" blockAlign="center">
                  <Text variant="bodySm" tone="subdued">
                    {((page - 1) * itemsPerPage) + 1}-{Math.min(page * itemsPerPage, totalCount)} of {totalCount}
                  </Text>
                  <Button
                    icon={<span>‹</span>}
                    disabled={page <= 1}
                    onClick={handlePreviousPage}
                    size="slim"
                  />
                  <Button
                    icon={<span>›</span>}
                    disabled={page >= totalPages}
                    onClick={handleNextPage}
                    size="slim"
                  />
                </InlineStack>
              </InlineStack>
            </Box>
          )}
        </Card>
      </Box>

      {progressModal}
      {languageModal}
      {resultsModal}
      {previewModal}
      {bulkDeleteModal}
      {confirmDeleteModal}
      {deleteProgressModal}
      {AIEnhanceModal()}
      
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        featureName="Collections AI Enhancement"
        currentPlan={currentPlan}
        errorMessage={tokenError?.error || tokenError?.message}
        minimumPlanRequired={tokenError?.minimumPlanRequired}
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
            feature="ai-seo-collection"
            shop={shop}
            needsUpgrade={tokenError.needsUpgrade || false}
            minimumPlan={tokenError.minimumPlanForFeature || null}
            currentPlan={tokenError.currentPlan || currentPlan}
            returnTo="/ai-seo/collections"
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
            feature={tokenError.feature || 'ai-seo-collection'}
            trialEndsAt={tokenError.trialEndsAt}
            currentPlan={tokenError.currentPlan || currentPlan}
            tokensRequired={tokenError.tokensRequired || 0}
            onActivatePlan={async () => {
              // Direct API call to activate plan (no billing page redirect)
              try {
                
                const response = await api('/api/billing/activate', {
                  method: 'POST',
                  body: JSON.stringify({
                    shop,
                    endTrial: true,
                    returnTo: '/ai-seo/collections' // Return to Collections after approval
                  })
                });
                
                // Check if Shopify approval is required
                if (response.requiresApproval && response.confirmationUrl) {
                  // Direct redirect to Shopify approval page
                  window.top.location.href = response.confirmationUrl;
                  return;
                }
                
                // Plan activated successfully without approval
                window.location.reload();
                
              } catch (error) {
                console.error('[COLLECTIONS] ❌ Activation failed:', error);
                
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
        returnTo="/ai-seo/collections"
        inTrial={!!tokenError?.trialEndsAt}
      />
      
      {toast && (
        <Toast content={toast} onDismiss={() => setToast('')} />
      )}
    </>
  );
};