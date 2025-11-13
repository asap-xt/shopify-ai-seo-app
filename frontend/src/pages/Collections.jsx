// frontend/src/pages/Collections.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
} from '@shopify/polaris';
import { SearchIcon } from '@shopify/polaris-icons';
import { makeSessionFetch } from '../lib/sessionFetch.js';
import UpgradeModal from '../components/UpgradeModal.jsx';
import InsufficientTokensModal from '../components/InsufficientTokensModal.jsx';
import TrialActivationModal from '../components/TrialActivationModal.jsx';
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
  
  // Selection state
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectAllPages, setSelectAllPages] = useState(false);
  
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
  
  // AI Enhancement Modal state
  const [showAIEnhanceModal, setShowAIEnhanceModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showInsufficientTokensModal, setShowInsufficientTokensModal] = useState(false);
  const [showTrialActivationModal, setShowTrialActivationModal] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [currentPlan, setCurrentPlan] = useState('starter');
  const [languageLimit, setLanguageLimit] = useState(1); // Default to 1 for Starter
  
  // Update currentPlan when globalPlan changes (e.g., after upgrade)
  useEffect(() => {
    // Only update if globalPlan has valid data (not empty strings)
    if (!globalPlan || typeof globalPlan !== 'object') {
      return;
    }
    
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
  }, [globalPlan]);
  
  const [aiEnhanceProgress, setAIEnhanceProgress] = useState({
    processing: false,
    current: 0,
    total: 0,
    currentItem: '',
    results: null  // Уверете се че е NULL, не {} или {successful:0, failed:0, skipped:0}
  });
  
  // Load models and plan on mount
  useEffect(() => {
    if (!shop) return;
    const Q = `
      query PlansMe($shop:String!) {
        plansMe(shop:$shop) {
          plan
          planKey
          modelsSuggested
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
        
        // Get languageLimit dynamically from backend data (snake_case from GraphQL)
        const newLimit = data?.language_limit || 1;
        setLanguageLimit(newLimit);
      })
      .catch((err) => setToast(`Error loading models: ${err.message}`));
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
  const loadCollections = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        shop,
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
      setTotalCount(filteredCollections.length);
    } catch (err) {
      setToast(`Error loading collections: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [shop, searchValue, optimizedFilter, sortBy, sortOrder, api]);
  
  // Initial load and filter changes
  useEffect(() => {
    if (shop) {
      loadCollections();
      setSelectedHaveSEO(false); // Reset SEO tracking on reload
    }
  }, [shop, optimizedFilter, sortBy, sortOrder, loadCollections]);
  
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
    }
  }, [collections]);
  
  const handleSelectAllPages = useCallback((checked) => {
    setSelectAllPages(checked);
    if (checked) {
      setSelectedItems(collections.map(c => c.id));
      // Check if any collections have SEO
      const haveSEO = collections.some(c => c.hasSeoData);
      setSelectedHaveSEO(haveSEO);
    } else {
      setSelectedItems([]);
      setSelectedHaveSEO(false);
    }
  }, [collections]);

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
  
  // AI Enhancement function - same logic as Products
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

    // Start AI Enhancement with progress tracking
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
        // Get languages for this collection
        const languagesToEnhance = collection.optimizedLanguages || [];
        
        if (languagesToEnhance.length === 0) {
          results.skipped++;
          continue;
        }
        
        // Call AI Enhancement endpoint
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
        
        // Check if it's a 403 error (plan restriction - Collections require Professional+)
        if (error.status === 403) {
          // Stop processing and show upgrade modal
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
          return; // Stop processing
        }
        
        // Check if it's a 402 error (insufficient tokens or trial restriction)
        if (error.status === 402 || error.requiresPurchase || error.trialRestriction) {
          // Stop processing and show appropriate modal
          setAIEnhanceProgress({
            processing: false,
            current: 0,
            total: 0,
            currentItem: '',
            results: null
          });
          
          setTokenError(error);
          setCurrentPlan(error.currentPlan || currentPlan || 'starter');
          
          // Show appropriate modal based on error type
          if (error.trialRestriction && error.requiresActivation) {
            // Growth Extra/Enterprise in trial → Show "Activate Plan" modal
            setShowTrialActivationModal(true);
          } else if (error.trialRestriction) {
            // Old trial restriction logic (fallback)
            setShowUpgradeModal(true);
          } else {
            // Insufficient tokens (with or without upgrade suggestion)
            // InsufficientTokensModal handles both cases via needsUpgrade prop
            setShowInsufficientTokensModal(true);
          }
          return; // Stop processing other collections
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
  
  // Generate SEO for selected collections
  const generateSEO = async () => {
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

          {/* Select all checkbox in table */}
          {totalCount > 0 && (
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <Checkbox
                label={`Select all ${totalCount} collections`}
                checked={selectAllPages}
                onChange={handleSelectAllPages}
              />
            </Box>
          )}

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
                console.log('[COLLECTIONS] 🔓 Activating plan directly...');
                
                const response = await api('/api/billing/activate', {
                  method: 'POST',
                  body: JSON.stringify({
                    shop,
                    endTrial: true,
                    returnTo: '/ai-seo/collections' // Return to Collections after approval
                  })
                });
                
                console.log('[COLLECTIONS] ✅ Activation response:', response);
                
                // Check if Shopify approval is required
                if (response.requiresApproval && response.confirmationUrl) {
                  console.log('[COLLECTIONS] 🔐 Redirecting to Shopify approval...');
                  // Direct redirect to Shopify approval page
                  window.top.location.href = response.confirmationUrl;
                  return;
                }
                
                // Plan activated successfully without approval
                console.log('[COLLECTIONS] ✅ Plan activated, reloading page...');
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
              // Navigate to billing page to purchase tokens (with returnTo)
              const params = new URLSearchParams(window.location.search);
              const host = params.get('host');
              const embedded = params.get('embedded');
              window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host)}&returnTo=${encodeURIComponent('/ai-seo/collections')}`;
            }}
          />
        </>
      )}
      
      {toast && (
        <Toast content={toast} onDismiss={() => setToast('')} />
      )}
    </>
  );
};