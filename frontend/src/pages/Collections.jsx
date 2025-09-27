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
} from '@shopify/polaris';
import { SearchIcon } from '@shopify/polaris-icons';
import { makeSessionFetch } from '../lib/sessionFetch.js';
import UpgradeModal from '../components/UpgradeModal.jsx';

const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; }
  catch { return d; }
};

export default function CollectionsPage({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  console.log('[COLLECTIONS] Component initialized with shop:', shop, 'shopProp:', shopProp);
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
  const [showOptimizedPopover, setShowOptimizedPopover] = useState(false);
  
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
  const [currentPlan, setCurrentPlan] = useState('starter');
  const [aiEnhanceProgress, setAIEnhanceProgress] = useState({
    processing: false,
    current: 0,
    total: 0,
    currentItem: '',
    results: null  // Уверете се че е NULL, не {} или {successful:0, failed:0, skipped:0}
  });
  
  // Load models on mount
  useEffect(() => {
    if (!shop) return;
    const Q = `
      query PlansMe($shop:String!) {
        plansMe(shop:$shop) {
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
      })
      .catch((err) => setToast(`Error loading models: ${err.message}`));
  }, [shop, api]);
  
  // Load shop languages
  useEffect(() => {
    if (!shop) return;
    console.log('[COLLECTIONS] Loading languages for shop:', shop);
    api(`/api/languages/shop/${shop}?shop=${shop}`)
      .then((data) => {
        console.log('[COLLECTIONS] Languages API data:', data);
        const langs = data?.shopLanguages || ['en'];
        console.log('[COLLECTIONS] Extracted languages:', langs);
        setAvailableLanguages(langs);
        setSelectedLanguages([]);
      })
      .catch((err) => {
        console.error('[COLLECTIONS] Languages API error:', err);
        setAvailableLanguages(['en']);
        setSelectedLanguages([]);
      });
  }, [shop, api]);
  
  // Load collections
  const loadCollections = useCallback(async () => {
    setLoading(true);
    try {
      console.log('[COLLECTIONS] Shop value:', shop);
      console.log('[COLLECTIONS] Shop prop:', shopProp);
      console.log('[COLLECTIONS] URL search params:', window.location.search);
      
      const params = new URLSearchParams({
        shop,
        ...(searchValue && { search: searchValue }),
        ...(optimizedFilter !== 'all' && { optimized: optimizedFilter }),
      });
      
      // Use GraphQL endpoint
      const endpoint = `/collections/list-graphql?${params}`;
      
      console.log('[COLLECTIONS] Using GraphQL endpoint:', endpoint);
      
      // URL вече съдържа shop → не подаваме {shop}, за да не дублираме
      const data = await api(endpoint);
      console.log('[COLLECTIONS] API Response data:', data);
      
      // Debug: log first collection's optimizedLanguages
      if (data?.collections?.length > 0) {
        console.log('[COLLECTIONS] First collection optimizedLanguages:', data.collections[0].optimizedLanguages);
        console.log('[COLLECTIONS] First collection full data:', data.collections[0]);
      }
      
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
  }, [shop, searchValue, optimizedFilter, api]);
  
  // Initial load and filter changes
  useEffect(() => {
    if (shop) {
      loadCollections();
      setSelectedHaveSEO(false); // Reset SEO tracking on reload
    }
  }, [shop, optimizedFilter, loadCollections]);
  
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

  // Open language selection modal
  const openLanguageModal = () => {
    if (selectedItems.length === 0 && !selectAllPages) {
      setToast('Please select collections first');
      return;
    }
    setShowLanguageModal(true);
  };
  
  // AI Enhancement function - extracted from modal
  const handleStartEnhancement = async () => {
    try {
      setIsProcessing(true);
      setProcessingMessage('Checking eligibility...');

      // Check eligibility first
      const eligibility = await api('/ai-enhance/check-eligibility', {
        method: 'POST',
        shop,
        body: { shop },
      });

      if (!eligibility.eligible) {
        // Show upgrade modal instead of toast
        setCurrentPlan(eligibility.currentPlan || 'starter');
        setShowAIEnhanceModal(false);
        setShowUpgradeModal(true);
        return;
      }

      // Затваряме AI Enhancement модала и започваме processing
      setShowAIEnhanceModal(false);

      // Process selected collections
      const selectedCollections = collections.filter(c => selectedItems.includes(c.id));
      const selectedWithSEO = selectedCollections.filter(c => 
        c.optimizedLanguages?.length > 0
      );
      
      const total = selectedWithSEO.length;
      setProgress({ current: 0, total, percent: 0 });
      
      const results = {};
      
      for (let i = 0; i < selectedWithSEO.length; i++) {
        const collection = selectedWithSEO[i];
        setCurrentCollection(collection.title);
        
        try {
          // За всяка колекция вземи нейните оптимизирани езици
          const languagesToEnhance = collection.optimizedLanguages || [];
          
          if (languagesToEnhance.length === 0) {
            console.log(`No optimized languages for ${collection.title}, skipping`);
            results[collection.id] = {
              success: false,
              skipped: true,
              error: 'No optimized languages'
            };
            continue;
          }
          
          console.log(`Enhancing ${collection.title} for languages:`, languagesToEnhance);
          
          // Call the enhance endpoint for each collection
          const enhanceResult = await api(`/ai-enhance/collection/${encodeURIComponent(collection.id)}`, {
            method: 'POST',
            shop,
            body: {
              shop,
              languages: languagesToEnhance,
            },
          });
          
          results[collection.id] = {
            success: enhanceResult.ok,
            skipped: false,
            data: enhanceResult,
            error: enhanceResult.ok ? null : (enhanceResult.error || 'Enhancement failed')
          };
          
        } catch (error) {
          console.error('Error enhancing collection:', collection.id, error);
          results[collection.id] = {
            success: false,
            skipped: false,
            error: error.message
          };
        }
        
        const current = i + 1;
        const percent = Math.round((current / total) * 100);
        setProgress({ current, total, percent });
      }

      setResults(results);
      setShowResultsModal(true);
      
      const successCount = Object.values(results).filter(r => r.success).length;
      setToast(`Enhanced ${successCount} collections`);
      
      // Refresh collections list to show updated data
      await loadCollections();
      
    } catch (error) {
      console.error('AI Enhance error:', error);
      setToast('Failed to enhance collections');
    } finally {
      setIsProcessing(false);
      setCurrentCollection('');
    }
  };
  
  // AI Enhancement Modal - използва Polaris компоненти като другите модали
  const AIEnhanceModal = () => {
    const selectedCollections = collections.filter(c => selectedItems.includes(c.id));
    const selectedWithSEO = selectedCollections.filter(c => 
      c.optimizedLanguages?.length > 0
    );
    
    // Debug version of AI enhancement with detailed logging
    const handleAIActionDebug = async (collection) => {
      console.log('=== AI_ENHANCE DEBUG START ===');
      console.log('1. Collection:', collection);
      console.log('2. Selected collections:', selectedCollections);
      console.log('3. Shop:', shop);
      
      try {
        // Check eligibility
        console.log('4. Checking eligibility...');
        const eligibility = await api('/ai-enhance/check-eligibility', {
          method: 'POST',
          shop,
          body: { shop },
        });
        console.log('5. Eligibility response:', eligibility);
        
        if (!eligibility.eligible) {
          console.log('6. Not eligible - showing error');
          setToast('AI Enhanced add-ons not available for your plan');
          return;
        }

        console.log('7. Eligible! Proceeding...');
        
        // Process selected collections or single collection
        const collectionsToProcess = selectedCollections.length > 0 
          ? collections.filter(c => selectedCollections.includes(c.id))
          : [collection];
        
        console.log('8. Collections to process:', collectionsToProcess);
        
        if (collectionsToProcess.length === 0) {
          console.log('9. No collections to process - showing info');
          setToast('Please select collections to enhance');
          return;
        }

        setIsProcessing(true);
        const results = { successful: 0, failed: 0, skipped: 0 };
        const errors = [];

        // Process each collection
        for (const col of collectionsToProcess) {
          console.log(`10. Processing collection: ${col.title} (${col.id})`);
          
          try {
            // Get selected languages from collection
            const languagesToEnhance = col.optimizedLanguages || ['en'];
            console.log(`11. Languages to enhance for ${col.title}:`, languagesToEnhance);
            
            // Make the API call with correct endpoint format
            console.log(`12. Collection ID: ${col.id}`);
            console.log(`12.1. Encoded ID: ${encodeURIComponent(col.id)}`);
            const endpoint = `/ai-enhance/collection/${encodeURIComponent(col.id)}`;
            console.log(`12.2. Calling endpoint: ${endpoint}`);
            console.log('13. Request body:', { shop, languages: languagesToEnhance });
            
            const enhanceData = await api(endpoint, {
              method: 'POST',
              shop,
              body: {
                shop,
                languages: languagesToEnhance,
              },
            });
            
            console.log(`14. Enhance response for ${col.title}:`, enhanceData);
            
            if (enhanceData.ok) {  // Променено от .success на .ok
              results.successful++;
              console.log(`15. Success for ${col.title}`);
            } else {
              results.failed++;
              errors.push(`${col.title}: ${enhanceData.error || 'Unknown error'}`);
              console.log(`16. Failed for ${col.title}:`, enhanceData.error);
            }
          } catch (error) {
            console.error(`17. Error enhancing ${col.title}:`, error);
            results.failed++;
            errors.push(`${col.title}: ${error.message}`);
          }
        }

        setIsProcessing(false);
        console.log('18. Final results:', results);
        console.log('19. Errors:', errors);

        // Show results modal
        const message = `AI Enhancement Complete\n\nSuccessful: ${results.successful}\nFailed: ${results.failed}\nSkipped: ${results.skipped}${
          errors.length > 0 ? '\n\nErrors:\n' + errors.join('\n') : ''
        }`;
        
        console.log('20. Showing modal with message:', message);
        alert(message);

        // Reload collections if any were successful
        if (results.successful > 0) {
          console.log('21. Reloading collections...');
          await loadCollections();
        }
        
      } catch (error) {
        console.error('22. AI enhance error:', error);
        setIsProcessing(false);
        setToast(error.message || 'Enhancement failed');
      } finally {
        console.log('=== AI_ENHANCE DEBUG END ===');
      }
    };

    
    const handleClose = () => {
      setShowAIEnhanceModal(false);
      setAIEnhanceProgress({
        processing: false,
        current: 0,
        total: 0,
        currentItem: '',
        results: null
      });
      if (aiEnhanceProgress.results && aiEnhanceProgress.results.successful > 0) {
        loadCollections();
      }
    };
    
    // Първи модал - за потвърждение
    if (!aiEnhanceProgress.processing && !aiEnhanceProgress.results) {
      return (
        <Modal
          open={showAIEnhanceModal}
          title="AI Enhanced add-ons for AI Search"
          onClose={handleClose}
          primaryAction={{
            content: 'Start AI Enhancement',
            onAction: handleStartEnhancement,
          }}
          secondaryActions={[
            {
              content: 'Cancel',
              onAction: handleClose,
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text variant="bodyMd">
                AI enhancement will improve bullets and FAQ for {selectedWithSEO.length} collections.
              </Text>
              <Text variant="bodySm" tone="subdued">
                Note: AI enhancement is only available for Growth Extra and Enterprise plans.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      );
    }
    
    // Втори модал - прогрес
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
    
    // Трети модал - резултати
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
              
              {/* Показваме съобщението само ако има skip заради план */}
              {aiEnhanceProgress.results.skippedDueToPlan > 0 && (
                <Box paddingBlockStart="300">
                  <Text variant="bodySm" tone="subdued">
                    AI enhancement is only available for Growth Extra and Enterprise plans.
                  </Text>
                </Box>
              )}
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
          console.log('Applying SEO for collection:', collectionId);
          console.log('Result data:', result.data);
          console.log('Results array:', result.data?.results);
          
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
      await api('/seo/collections/delete-seo', {
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
            await api('/seo/collections/delete-seo', {
              method: 'DELETE',
              shop,
              body: { shop, collectionId: collection.id, language },
            });
          } catch (err) {
            console.error(`Failed to delete ${language} for ${collection.title}:`, err);
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
    
    // Debug: log optimizedLanguages for each collection
    console.log(`[COLLECTIONS] Rendering collection "${collection.title}":`, {
      optimizedLanguages,
      availableLanguages,
      hasSeoData: collection.hasSeoData
    });
    
    const media = (
      <Box width="40px" height="40px" background="surface-neutral" borderRadius="200" />
    );
    
    return (
      <ResourceItem
        id={collection.id}
        url=""
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
            {collection.hasSeoData ? (
              <InlineStack gap="100">
                {availableLanguages.map(lang => (
                  <Badge
                    key={lang}
                    tone={optimizedLanguages.includes(lang) ? 'success' : 'subdued'}
                    size="small"
                  >
                    {lang.toUpperCase()}
                  </Badge>
                ))}
              </InlineStack>
            ) : (
              <Badge tone="subdued">No AI Search Optimisation</Badge>
            )}
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
        disabled: selectedLanguages.length === 0,
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
                setSelectedLanguages(
                  selectedLanguages.length === availableLanguages.length
                    ? []
                    : [...availableLanguages]
                );
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
      <Card>
        <Box padding="400">
          <InlineStack gap="400" align="space-between" blockAlign="start" wrap={false}>
            {/* Search field on the left */}
            <Box minWidth="400px" maxWidth="600px">
              <BlockStack gap="200">
                <TextField
                  label=""
                  placeholder="Search by collection name..."
                  value={searchValue}
                  onChange={setSearchValue}
                  prefix={<SearchIcon />}
                  clearButton
                  onClearButtonClick={() => setSearchValue('')}
                />
              </BlockStack>
            </Box>
            
            {/* Buttons stacked vertically on the right */}
            <BlockStack gap="200">
              <Button
                primary
                onClick={openLanguageModal}
                disabled={selectedItems.length === 0 && !selectAllPages}
              >
                Generate Optimization for AI Search
              </Button>
              
              {/* AI Enhanced Search Optimisation Button */}
              {(() => {
                if (selectedItems.length === 0 && !selectAllPages) return null;
                
                const selectedCollections = collections.filter(c => selectedItems.includes(c.id));
                const hasOptimizedCollections = selectedCollections.some(c => 
                  c.optimizedLanguages?.length > 0
                );
                
                if (!hasOptimizedCollections) return null;
                
                return (
                  <Button
                    onClick={() => setShowAIEnhanceModal(true)}
                    disabled={selectedItems.length === 0 && !selectAllPages}
                  >
                    AI Enhanced add-ons for AI Search
                  </Button>
                );
              })()}
              
              <Button
                outline
                destructive
                onClick={() => setShowBulkDeleteModal(true)}
                disabled={selectedItems.length === 0 || !selectedHaveSEO}
              >
                Delete Optimization for AI Search
              </Button>
            </BlockStack>
          </InlineStack>
          
          {/* Select all checkbox below */}
          {totalCount > 0 && (
            <Box paddingBlockStart="300">
              <Checkbox
                label={`Select all ${totalCount} collections`}
                checked={selectAllPages}
                onChange={handleSelectAllPages}
              />
            </Box>
          )}
        </Box>
      </Card>

      <Box paddingBlockStart="400">
        <Card>
          {/* Filter buttons */}
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
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
            </InlineStack>
            
            {/* Applied filters */}
            {optimizedFilter !== 'all' && (
              <Box paddingBlockStart="200">
                <InlineStack gap="100" wrap>
                  <Badge onRemove={() => setOptimizedFilter('all')}>
                    {optimizedFilter === 'true' ? 'Has AI Search Optimisation' : 'No AI Search Optimisation'}
                  </Badge>
                </InlineStack>
              </Box>
            )}
          </Box>

          <ResourceList
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
      
      {/* AI Enhancement confirmation modal */}
      <Modal
        open={showAIEnhanceModal}
        onClose={() => setShowAIEnhanceModal(false)}
        title="AI Enhanced add-ons for AI Search"
        primaryAction={{
          content: 'Start AI Enhancement',
          onAction: handleStartEnhancement,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowAIEnhanceModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodyMd">
              AI enhancement will improve bullets and FAQ for {collections.filter(c => selectedItems.includes(c.id) && c.optimizedLanguages?.length > 0).length} collections.
            </Text>
            <Text variant="bodySm" tone="subdued">
              Note: AI enhancement is only available for Growth Extra and Enterprise plans.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        featureName="AI Enhancement"
        currentPlan={currentPlan}
      />
      
      {toast && (
        <Toast content={toast} onDismiss={() => setToast('')} />
      )}
    </>
  );
};