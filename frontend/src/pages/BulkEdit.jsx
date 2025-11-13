// frontend/src/pages/BulkEdit.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
} from '@shopify/polaris';
import { SearchIcon } from '@shopify/polaris-icons';
import UpgradeModal from '../components/UpgradeModal.jsx';
import InsufficientTokensModal from '../components/InsufficientTokensModal.jsx';
import TrialActivationModal from '../components/TrialActivationModal.jsx';
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
  
  // Selection state
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectAllPages, setSelectAllPages] = useState(false);
  
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
  const [results, setResults] = useState({});
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedDeleteLanguages, setSelectedDeleteLanguages] = useState([]);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  
  // Toast
  const [toast, setToast] = useState('');
  
  // AI Enhancement Modal state
  const [showAIEnhanceModal, setShowAIEnhanceModal] = useState(false);
  const [aiEnhanceProgress, setAIEnhanceProgress] = useState({
    processing: false,
    current: 0,
    total: 0,
    currentItem: '',
    results: null  // Уверете се че е NULL, не {} или {successful:0, failed:0, skipped:0}
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
  const [tokenError, setTokenError] = useState(null);
  const [currentPlan, setCurrentPlan] = useState('starter');
  
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
  
  // Auto-close upgrade modal if selection is now within limit
  useEffect(() => {
    if (showPlanUpgradeModal && plan) {
      const currentSelection = selectAllPages ? totalCount : selectedItems.length;
      
      if (currentSelection <= productLimit) {
        setShowPlanUpgradeModal(false);
        setTokenError(null);
      }
    }
  }, [selectedItems.length, selectAllPages, totalCount, showPlanUpgradeModal, plan]);
  
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
        setProductLimit(data?.product_limit || 70);
        setLanguageLimit(data?.language_limit || 1);
      })
      .catch((e) => console.error('[BULK-EDIT] GraphQL plansMe failed:', e));
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
        limit: 50,
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
      
      // Log първия продукт за проверка
      if (data.products?.length > 0) {
        //   id: data.products[0].id,
        //   _id: data.products[0]._id,
        //   title: data.products[0].title,
        //   optimizationSummary: data.products[0].optimizationSummary,
        //   allKeys: Object.keys(data.products[0])
        // });
      }
      
      
      // DEBUG: Log product IDs before setting state
      if (data.products?.length > 0) {
        data.products.forEach((p, idx) => {
        });
      }
      
      if (append) {
        setProducts(prev => [...prev, ...data.products]);
      } else {
        setProducts(data.products || []);
      }
      
      setPage(pageNum);
      setHasMore(data.pagination?.hasNext || false);
      setTotalCount(data.pagination?.total || 0);
    } catch (err) {
      setProducts(append ? products : []);
      setHasMore(false);
      setToast(`Error loading products: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [shop, optimizedFilter, searchValue, languageFilter, selectedTags, sortBy, sortOrder]);
  

  
  // Initial load and filter changes
  useEffect(() => {
    if (shop) {
      loadProducts(1, false, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop, optimizedFilter, languageFilter, selectedTags, sortBy, sortOrder]);
  
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
    }
  }, []); // Remove products dependency - not needed for this callback
  
  const handleSelectAllPages = useCallback((checked) => {
    setSelectAllPages(checked);
    if (checked) {
      setSelectedItems(products.map(p => p.id));
    } else {
      setSelectedItems([]);
    }
  }, [products]);

  // Calculate maximum NEW languages that can be added
  // Takes into account already optimized languages across selected products
  // Check if the selected languages would exceed the plan limit for any selected product
  const checkLanguageLimitExceeded = useMemo(() => {
    if (selectAllPages) {
      // For "select all", just check if we're selecting more than the plan allows
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
  }, [products, selectedItems, selectAllPages, languageLimit, selectedLanguages]);

  // Open language selection modal
  const openLanguageModal = () => {
    if (selectedItems.length === 0 && !selectAllPages) {
      setToast('Please select products first');
      return;
    }
    setShowLanguageModal(true);
  };
  
  // Open delete language selection modal
  const openDeleteModal = () => {
    if (selectedItems.length === 0 && !selectAllPages) {
      setToast('Please select products first');
      return;
    }
    setSelectedDeleteLanguages([]);
    setShowDeleteModal(true);
  };

  // AI Enhancement handler
  const handleStartEnhancement = async () => {
    const selectedProducts = products.filter(p => selectedItems.includes(p.id));
    const selectedWithSEO = selectedProducts.filter(p =>
      p.optimizationSummary?.optimizedLanguages?.length > 0
    );
    const selectedWithoutSEO = selectedProducts.filter(p =>
      !p.optimizationSummary?.optimizedLanguages?.length
    );


    // Check product limit before processing
    const selectedCount = selectedWithSEO.length;
    
    if (selectedCount > productLimit) {
      // Show upgrade modal instead of processing
      const nextPlan = getNextPlanForLimit(selectedCount);
      setTokenError({
        error: `Product limit exceeded`,
        message: `Your ${plan} plan supports up to ${productLimit} products for AI Enhancement. You have selected ${selectedCount} products with Basic SEO.`,
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

    // Show progress modal
    setShowAIEnhanceModal(true);
    setAIEnhanceProgress({
      processing: true,
      current: 0,
      total: selectedWithSEO.length,
      currentItem: '',
      results: null
    });
      
      const results = { 
        successful: 0, 
        failed: 0, 
        skipped: selectedWithoutSEO.length,
        skipReasons: selectedWithoutSEO.length > 0 ? [`${selectedWithoutSEO.length} product(s): No Basic Optimization`] : []
      };
      
      for (let i = 0; i < selectedWithSEO.length; i++) {
        const product = selectedWithSEO[i];
        
        setAIEnhanceProgress(prev => ({
          ...prev,
          current: i,
          currentItem: product.title
        }));
        
        try {
          const productGid = product.gid || toProductGID(product.id);
          
          if (!productGid) {
            console.error('[AI-ENHANCE] Missing product GID, skipping:', product);
            results.failed++;
            continue;
          }
          
          const enhanceData = await api('/ai-enhance/product', {
            method: 'POST',
            shop,
            body: {
              shop,
              productId: productGid,
              languages: product.optimizationSummary.optimizedLanguages,
            },
          });
          
          
          // Apply the enhanced SEO
          if (enhanceData.results && enhanceData.results.length > 0) {
            const applyData = {
              shop,
              productId: product.gid || toProductGID(product.id),
              results: enhanceData.results.filter(r => r.bullets && r.faq).map(r => {
                
                const seoResult = {
                  language: r.language,
                  seo: {
                    ...r.updatedSeo,  // Използвайте пълния SEO обект от AI enhance!
                    bullets: r.bullets || [],  // AI-generated bullets (ensure array)
                    faq: r.faq || []           // AI-generated FAQ (ensure array)
                  }
                };
                
                
                return seoResult;
              }),
              options: { updateBullets: true, updateFaq: true }
            };
            
            
            const applyResult = await api('/api/seo/apply-multi', {
              method: 'POST',
              shop,
              body: applyData
            });
            
            results.successful++;
          } else {
            results.failed++;
          }
        } catch (error) {
          // Check if it's a 403 error (plan restriction - Products require Professional+)
          if (error.status === 403) {
            // Stop processing
            setAIEnhanceProgress({
              processing: false,
              current: 0,
              total: 0,
              currentItem: '',
              results: null
            });
            
            setTokenError({
              ...error,
              message: error.message || 'AI-enhanced add-ons for Products require Professional plan or higher'
            });
            setCurrentPlan(error.currentPlan || currentPlan);
            
            // Check if Plus plan with insufficient tokens (needsUpgrade=false)
            // OR base plan needing upgrade (needsUpgrade=true)
            if (error.needsUpgrade === false && error.requiresPurchase) {
              // Plus plan user - just needs tokens
              setShowInsufficientTokensModal(true);
            } else {
              // Base plan user - needs upgrade
              setShowPlanUpgradeModal(true);
            }
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
            setCurrentPlan(error.currentPlan || plan || 'starter');
            
            // Show appropriate modal based on error type
            if (error.trialRestriction && error.requiresActivation) {
              // Growth Extra/Enterprise in trial → Show "Activate Plan" modal
              setShowTrialActivationModal(true);
            } else if (error.trialRestriction) {
              // Old trial restriction logic (fallback)
              setShowPlanUpgradeModal(true);
            } else {
              // Insufficient tokens (with or without upgrade suggestion)
              // InsufficientTokensModal handles both cases via needsUpgrade prop
              setShowInsufficientTokensModal(true);
            }
            return; // Stop processing other products
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
      
      setToast(`AI enhancement complete! ${results.successful} products enhanced.`);
    };

  // Close AI Enhancement modal
  const handleCloseAIEnhancement = () => {
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
    
    // Refresh product list if any products were successfully enhanced
    if (results && results.successful > 0) {
      // Backend already invalidated Redis cache (invalidateShop)
      // Use setTimeout to avoid async race condition with modal close
      setTimeout(() => {
        setProducts([]); // Clear current products to force re-render
        loadProducts(1, false, Date.now()); // Cache already invalidated by backend
      }, 1500); // 1.5s delay for MongoDB write + Redis invalidation propagation
    }
  };

  // AI Enhancement Modal - използва Polaris компоненти като другите модали
  const AIEnhanceModal = () => {
    // Progress modal
    if (aiEnhanceProgress.processing) {
      return (
        <Modal
          open={showAIEnhanceModal}
          title="Processing AI Enhancement"
          onClose={handleCloseAIEnhancement}
          noScroll
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text variant="bodyMd">
                Processing: {aiEnhanceProgress.currentItem}
              </Text>
              <ProgressBar progress={(aiEnhanceProgress.current / aiEnhanceProgress.total) * 100} />
              <Text variant="bodySm" tone="subdued">
                {aiEnhanceProgress.current} of {aiEnhanceProgress.total} products 
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
          onClose={handleCloseAIEnhancement}
          primaryAction={{
            content: 'Done',
            onAction: handleCloseAIEnhancement,
          }}
        >
          <Modal.Section>
            <BlockStack gap="400">
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
              
              {aiEnhanceProgress.results.skipReasons && aiEnhanceProgress.results.skipReasons.length > 0 && (
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Skipped products:</Text>
                  {aiEnhanceProgress.results.skipReasons.map((reason, index) => (
                    <Text key={index} variant="bodySm" tone="subdued">• {reason}</Text>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      );
    }
    
    return null;
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
    
    setIsProcessing(true);
    setProgress({ current: 0, total: 0, percent: 0 });
    setErrors([]);
    setResults({});
    
    try {
      let productsToProcess = [];
      
      if (selectAllPages) {
        // тук URL вече има shop → не подаваме {shop}
        const data = await api(`/api/products/list?shop=${encodeURIComponent(shop)}&limit=1000&fields=id`);
        productsToProcess = data.products || [];
      } else {
        productsToProcess = products.filter(p => selectedItems.includes(p.id));
      }
      
      // Check if selection exceeds plan limit BEFORE processing
      const selectedCount = productsToProcess.length;
      
      if (selectedCount > productLimit) {
        setIsProcessing(false);
        setProgress({ current: 0, total: 0, percent: 0 });
        setShowLanguageModal(false); // Close language modal
        
        // Show upgrade modal with product limit specific message
        const nextPlan = getNextPlanForLimit(selectedCount);
        setTokenError({
          error: `Product limit exceeded`,
          message: `Your ${currentPlan} plan supports up to ${productLimit} products for SEO optimization. You have selected ${selectedCount} products.`,
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
      
      // Close language modal only after passing limit check
      setShowLanguageModal(false);
      
      const total = selectedCount;
      const skippedDueToPlan = 0;
      
      setProgress({ current: 0, total, percent: 0 });
      
      const batchSize = 5;
      const results = {};
      
      for (let i = 0; i < productsToProcess.length; i += batchSize) {
        const batch = productsToProcess.slice(i, Math.min(i + batchSize, productsToProcess.length));
        
        const batchPromises = batch.map(async (product) => {
          setCurrentProduct(product.title || product.handle || 'Product');
          
          try {
            const productGid = product.gid || toProductGID(product.productId || product.id);
            
            const existingLanguages = product.optimizationSummary?.optimizedLanguages || [];
            const languagesToGenerate = selectedLanguages.filter(lang => !existingLanguages.includes(lang));
            
            if (languagesToGenerate.length === 0) {
              results[product.id] = {
                success: true,
                skipped: true,
                message: 'All selected languages already have AI Search Optimisation'
              };
              return;
            }
            
            
            const data = await api('/api/seo/generate-multi', {
              method: 'POST',
              shop,
              body: {
                shop,
                productId: productGid,
                model: finalModel,
                languages: languagesToGenerate,
              }
            });
            
            results[product.id] = {
              success: true,
              data,
              languages: languagesToGenerate,
            };
          } catch (err) {
            results[product.id] = {
              success: false,
              error: err.message,
            };
            setErrors(prev => [...prev, { product: product.title, error: err.message }]);
          }
        });
        
        await Promise.all(batchPromises);
        
        const current = Math.min(i + batchSize, productsToProcess.length);
        const percent = Math.round((current / total) * 100);
        setProgress({ current, total, percent });
      }
      
      setResults(results);
      setShowResultsModal(true);
      
      const successCount = Object.keys(results).filter(k => results[k].success && !results[k].skipped).length;
      const skippedCount = Object.keys(results).filter(k => results[k].skipped).length;
      
      let toastMessage = `Generated Optimization for AI Search for ${successCount} products`;
      if (skippedCount > 0) {
        toastMessage += ` (${skippedCount} already optimised)`;
      }
      if (skippedDueToPlan > 0) {
        toastMessage += ` (${skippedDueToPlan} skipped due to plan limit)`;
      }
      
      setToast(toastMessage);
      
    } catch (err) {
      setToast(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setCurrentProduct('');
    }
  };
  
  // Apply SEO results
  const applySEO = async () => {
    setIsProcessing(true);
    setProgress({ current: 0, total: 0, percent: 0 });
    
    try {
      const successfulResults = Object.entries(results).filter(([_, r]) => r.success && !r.skipped);
      const total = successfulResults.length;
      setProgress({ current: 0, total, percent: 0 });
      
      for (let i = 0; i < successfulResults.length; i++) {
        const [productId, result] = successfulResults[i];
        const product = products.find(p => p.id === productId);
        
        if (!product) continue;
        
        setCurrentProduct(product.title || 'Product');
        
        try {
          const productGid = product.gid || toProductGID(product.productId || product.id);
          
          const data = await api('/api/seo/apply-multi', {
            method: 'POST',
            shop,
            body: {
              shop,
              productId: productGid,
              results: result.data.results.filter(r => r?.seo).map(r => ({
                language: r.language,
                seo: r.seo,
              })),
              options: {
                updateTitle: true,
                updateBody: true,
                updateSeo: true,
                updateBullets: true,
                updateFaq: true,
                updateAlt: false,
                dryRun: false,
              }
            }
          });
          
          // Optimistic update - веднага обновяваме локалното състояние
          if (data.appliedLanguages && data.appliedLanguages.length > 0) {
            setProducts(prevProducts => 
              prevProducts.map(prod => {
                if (prod.id === productId) {
                  const currentOptimized = prod.optimizationSummary?.optimizedLanguages || [];
                  const newOptimized = [...new Set([...currentOptimized, ...data.appliedLanguages])];
                  
                  return {
                    ...prod,
                    optimizationSummary: {
                      ...prod.optimizationSummary,
                      optimizedLanguages: newOptimized,
                      optimized: true,
                      lastOptimized: new Date().toISOString()
                    }
                  };
                }
                return prod;
              })
            );
          }
          
        } catch (err) {
          setErrors(prev => [...prev, { product: product.title, error: `Apply failed: ${err.message}` }]);
        }
        
        const current = i + 1;
        const percent = Math.round((current / total) * 100);
        setProgress({ current, total, percent });
      }
      
      setToast('AI Search Optimisation applied successfully!');
      setShowResultsModal(false);
      
      // Clear selected items
      setSelectedItems([]);
      setSelectAllPages(false);
      
      // Add delay to ensure MongoDB writes are propagated
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Force a complete refresh of the products list
      setProducts([]); // Clear current products to force re-render
      
      // Load products with cache bypass
      const params = new URLSearchParams({
        shop,
        page: 1,
        limit: 50,
        ...(optimizedFilter !== 'all' && { optimized: optimizedFilter }),
        ...(searchValue && { search: searchValue }),
        ...(languageFilter && { languageFilter }),
        ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
        sortBy,
        sortOrder,
        _t: Date.now() // Cache buster
      });
      
      const data = await api(`/api/products/list?${params}`, { 
        shop,
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      
      
      setProducts(data.products || []);
      setPage(1);
      setHasMore(data.pagination?.hasNext || false);
      setTotalCount(data.pagination?.total || 0);
      
    } catch (err) {
      setToast(`Error applying AI Search Optimisation: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setCurrentProduct('');
    }
  };
  
  // Delete SEO for selected products
  const deleteSEO = async () => {
    if (!selectedDeleteLanguages.length) {
      setToast('Please select at least one language to delete');
      return;
    }
    
    setShowDeleteModal(false);
    setShowDeleteConfirmModal(false);
    setIsProcessing(true);
    setProgress({ current: 0, total: 0, percent: 0 });
    setErrors([]);
    
    try {
      let productsToProcess = [];
      
      if (selectAllPages) {
        // тук URL вече има shop → не подаваме {shop}
        const data = await api(`/api/products/list?shop=${encodeURIComponent(shop)}&limit=1000&fields=id`);
        productsToProcess = data.products || [];
      } else {
        productsToProcess = products.filter(p => selectedItems.includes(p.id));
      }
      
      const total = productsToProcess.length;
      setProgress({ current: 0, total, percent: 0 });
      
      let successCount = 0;
      let skippedCount = 0;
      
      for (let i = 0; i < productsToProcess.length; i++) {
        const product = productsToProcess[i];
        setCurrentProduct(product.title || product.handle || 'Product');
        
        try {
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
          
          const data = await api('/api/seo/delete-multi', {
            method: 'POST',
            shop,
            body: {
              shop,
              productId: productGid,
              languages: languagesToDelete,
            }
          });
          
          // Optimistic update - immediately update local state
          if (data.deletedLanguages && data.deletedLanguages.length > 0) {
            
            setProducts(prevProducts => 
              prevProducts.map(prod => {
                if (prod.id === product.id) {
                  const currentOptimized = prod.optimizationSummary?.optimizedLanguages || [];
                  const newOptimized = currentOptimized.filter(lang => 
                    !data.deletedLanguages.includes(lang)
                  );
                  
                  
                  return {
                    ...prod,
                    optimizationSummary: {
                      ...prod.optimizationSummary,
                      optimizedLanguages: newOptimized,
                      optimized: newOptimized.length > 0,
                      aiEnhanced: newOptimized.length > 0 ? prod.optimizationSummary.aiEnhanced : false, // Reset AI badge if all languages deleted
                      lastOptimized: newOptimized.length > 0 
                        ? prod.optimizationSummary.lastOptimized 
                        : null
                    }
                  };
                }
                return prod;
              })
            );
            
            // Debug log after optimistic update
          }
          
          successCount++;
          
          if (data.deletedLanguages && data.deletedLanguages.length > 0) {
            // Verify deletion in backend
            await api('/api/products/verify-after-delete', {
              method: 'POST',
              shop,
              body: {
                shop,
                productIds: [productGid],
                deletedLanguages: data.deletedLanguages
              }
            });
          }
        } catch (err) {
          setErrors(prev => [...prev, { product: product.title, error: err.message }]);
        }
        
        const current = i + 1;
        const percent = Math.round((current / total) * 100);
        setProgress({ current, total, percent });
      }
      
      // Clear selections
      setSelectedItems([]);
      setSelectAllPages(false);
      
      // Show result toast
      if (skippedCount > 0) {
        setToast(`Deleted Optimization for AI Search from ${successCount} products (${skippedCount} had no optimisation to delete)`);
      } else {
        setToast(`Deleted Optimization for AI Search from ${successCount} products`);
      }
      
      // Apply the same fix pattern as apply function
      
      // Force refetch with delay and cache busting
      setTimeout(() => {
        const timestamp = Date.now();
        loadProducts(1, false, timestamp); // Pass timestamp to bypass cache
      }, 500); // Small delay to ensure backend has completed
      
    } catch (err) {
      setToast(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setCurrentProduct('');
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
          <Text variant="bodyMd">Select languages to generate AI Search Optimisation for {selectAllPages ? 'all' : selectedItems.length} selected products:</Text>
          
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
  
  // Results modal
  const resultsModal = (
    <Modal
      open={showResultsModal && !isProcessing}
      title="AI Search Optimisation Results"
      primaryAction={{
        content: 'Apply Optimisation',
        onAction: applySEO,
        disabled: !Object.values(results).some(r => r.success && !r.skipped),
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
                {Object.values(results).filter(r => !r.success).length}
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
                    {err.product}: {err.error}
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
            Select languages to delete AI Search Optimisation from {selectAllPages ? 'all' : selectedItems.length} selected products:
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
            This will delete optimisation from {selectAllPages ? 'ALL' : selectedItems.length} selected products.
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
  
  // const bulkActions = [
  //   {
  //     content: 'Generate AI Search Optimisation',
  //     onAction: openLanguageModal,
  //   },
  //   {
  //     content: 'Delete AI Search Optimisation',
  //     onAction: openDeleteModal,
  //     destructive: true,
  //   }
  // ];
  
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
                  {(selectedItems.length > 0 || selectAllPages) && (
                    <Text>
                      Selected: {selectAllPages ? Math.min(totalCount, productLimit) : selectedItems.length}/{productLimit}
                    </Text>
                  )}
                </InlineStack>
              </Banner>
            )}
            
            {/* Plan Limit Warning Banner */}
            {plan && (selectedItems.length > productLimit || (selectAllPages && totalCount > productLimit)) && (
              <Banner tone="critical">
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">
                    Product limit exceeded
                  </Text>
                  <Text>
                    Your <strong>{plan}</strong> plan supports up to <strong>{productLimit}</strong> products. 
                    You have selected <strong>{selectAllPages ? totalCount : selectedItems.length}</strong> products.
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
                          message: `Your ${plan} plan supports up to ${productLimit} products. Upgrade to ${getNextPlanForLimit(selectAllPages ? totalCount : selectedItems.length)} to optimize more products.`,
                          minimumPlanRequired: getNextPlanForLimit(selectAllPages ? totalCount : selectedItems.length)
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
                  disabled={selectedItems.length === 0 && !selectAllPages}
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
                    if (selectedItems.length === 0 && !selectAllPages) return null;
                    
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
                        disabled={selectedItems.length === 0 && !selectAllPages}
                        size="medium"
                        fullWidth
                      >
                        AI Enhanced add-ons
                      </Button>
                    );
                  })()}
                  
                  <Button
                    onClick={openDeleteModal}
                    disabled={(selectedItems.length === 0 && !selectAllPages) || (() => {
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
          
          {totalCount > 0 && (
            <Box paddingBlockStart="300">
              <Checkbox
                label={`Select all ${totalCount} products in your store`}
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
              <InlineStack gap="200" align="start">
                <Checkbox
                  checked={selectedItems.length === products.length && products.length > 0}
                  onChange={handleSelectAllPages}
                  label=""
                />
                <Text variant="bodyMd" fontWeight="semibold">
                  Select all
                  {selectedItems.length > 0 && ` (${selectedItems.length} selected products)`}
                </Text>
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
          
          {hasMore && !loading && (
            <Box padding="400" textAlign="center">
              <Button onClick={() => loadProducts(page + 1, true, null)}>
                Load more
              </Button>
            </Box>
          )}
        </Card>
      </Box>

      {progressModal}
      {languageModal}
      {resultsModal}
      {deleteModal}
      {deleteConfirmModal}
      {AIEnhanceModal()}
      
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
                console.log('[BULK-EDIT] 🔓 Activating plan directly...');
                
                const response = await api('/api/billing/activate', {
                  method: 'POST',
                  body: {
                    shop,
                    endTrial: true,
                    returnTo: '/ai-seo' // Return to Products (BulkEdit) after approval
                  }
                });
                
                console.log('[BULK-EDIT] ✅ Activation response:', response);
                
                // Check if Shopify approval is required
                if (response.requiresApproval && response.confirmationUrl) {
                  console.log('[BULK-EDIT] 🔐 Redirecting to Shopify approval...');
                  // Direct redirect to Shopify approval page
                  window.top.location.href = response.confirmationUrl;
                  return;
                }
                
                // Already activated (shouldn't happen, but handle gracefully)
                console.log('[BULK-EDIT] ✅ Plan activated, reloading page...');
                window.location.reload();
                
              } catch (error) {
                console.error('[BULK-EDIT] ❌ Activation failed:', error);
                
                // Fallback: Navigate to billing page
                const params = new URLSearchParams(window.location.search);
                const host = params.get('host');
                const embedded = params.get('embedded');
                
                console.log('[BULK-EDIT] 🔄 Fallback - redirecting to Billing page...');
                window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host)}`;
              }
            }}
            onPurchaseTokens={() => {
              // Navigate to billing page to purchase tokens (with returnTo)
              const params = new URLSearchParams(window.location.search);
              const host = params.get('host');
              const embedded = params.get('embedded');
              window.location.href = `/billing?shop=${encodeURIComponent(shop)}&embedded=${embedded}&host=${encodeURIComponent(host)}&returnTo=${encodeURIComponent('/ai-seo')}`;
            }}
          />
        </>
      )}
      
      {toast && (
        <Toast content={toast} onDismiss={() => setToast('')} />
      )}
    </>
  );
}