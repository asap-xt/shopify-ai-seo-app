// frontend/src/pages/BulkEdit.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
} from '@shopify/polaris';
import { SearchIcon } from '@shopify/polaris-icons';

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

export default function BulkEdit({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  
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
  
  // Load models on mount
  useEffect(() => {
    if (!shop) return;
    fetch(`/plans/me?shop=${encodeURIComponent(shop)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const models = data?.modelsSuggested || ['anthropic/claude-3.5-sonnet'];
        setModelOptions(models.map(m => ({ label: m, value: m })));
        setModel(models[0]);
      })
      .catch(err => setToast(`Error loading models: ${err.message}`));
  }, [shop]);
  
  // Load shop languages
  useEffect(() => {
    if (!shop) return;
    fetch(`/api/languages/shop/${shop}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        console.log('[BULK-EDIT] Languages API response:', data);
        const langs = data?.shopLanguages || ['en'];
        console.log('[BULK-EDIT] Setting availableLanguages to:', langs);
        setAvailableLanguages(langs);
        setSelectedLanguages([]);
      })
      .catch(() => {
        setAvailableLanguages(['en']);
      });
  }, [shop]);

  // Load available tags
  useEffect(() => {
    if (!shop) return;
    fetch(`/api/products/tags/list?shop=${encodeURIComponent(shop)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setAvailableTags(data?.tags || []);
      })
      .catch(err => console.error('Failed to load tags:', err));
  }, [shop]);
  
  // Load products
  const loadProducts = useCallback(async (pageNum = 1, append = false) => {
    console.log(`[BULK-EDIT] loadProducts called with pageNum: ${pageNum}, append: ${append}`);
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
      });
      
      const response = await fetch(`/api/products/list?${params}&_t=${Date.now()}`, { 
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const data = await response.json();
      console.log(`[BULK-EDIT] Loaded products: ${data.products?.length || 0} products`);
      if (data.products?.length > 0) {
        console.log(`[BULK-EDIT] First product optimizationSummary:`, data.products[0].optimizationSummary);
      }
      
      if (!response.ok) throw new Error(data?.error || 'Failed to load products');
      
      if (append) {
        setProducts(prev => [...prev, ...data.products]);
      } else {
        setProducts(data.products || []);
      }
      
      setPage(pageNum);
      setHasMore(data.pagination?.hasNext || false);
      setTotalCount(data.pagination?.total || 0);
    } catch (err) {
      setToast(`Error loading products: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [shop, optimizedFilter, searchValue, languageFilter, selectedTags, sortBy, sortOrder]);
  

  
  // Initial load
  useEffect(() => {
    if (shop) loadProducts(1);
  }, [shop, loadProducts, optimizedFilter, languageFilter, selectedTags, sortBy, sortOrder]);
  
  // Unified search function
  const handleSearch = useCallback((value) => {
    setSearchValue(value);
  }, []);
  
  // Search debounce effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (shop) {
        loadProducts(1);
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
  }, []);
  
  const handleSelectAllPages = useCallback((checked) => {
    setSelectAllPages(checked);
    if (checked) {
      setSelectedItems(products.map(p => p._id));
    } else {
      setSelectedItems([]);
    }
  }, [products]);

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
  
  // Generate SEO for selected products
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
      let productsToProcess = [];
      
      if (selectAllPages) {
        const response = await fetch(`/api/products/list?shop=${encodeURIComponent(shop)}&limit=1000&fields=id`, {
          credentials: 'include'
        });
        const data = await response.json();
        productsToProcess = data.products || [];
      } else {
        productsToProcess = products.filter(p => selectedItems.includes(p._id));
      }
      
      const total = productsToProcess.length;
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
              results[product._id] = {
                success: true,
                skipped: true,
                message: 'All selected languages already have AI Search Optimisation'
              };
              return;
            }
            
            const response = await fetch('/api/seo/generate-multi', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                shop,
                productId: productGid,
                model,
                languages: languagesToGenerate,
              }),
            });
            
            const data = await response.json();
            
            if (!response.ok) throw new Error(data?.error || 'Generation failed');
            
            results[product._id] = {
              success: true,
              data,
              languages: languagesToGenerate,
            };
          } catch (err) {
            results[product._id] = {
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
      
      if (skippedCount > 0) {
        setToast(`Generated AI Search Optimisation for ${successCount} products (${skippedCount} already optimised)`);
      } else {
        setToast(`Generated AI Search Optimisation for ${successCount} products`);
      }
      
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
        const product = products.find(p => p._id === productId);
        
        if (!product) continue;
        
        setCurrentProduct(product.title || 'Product');
        
        try {
          const productGid = product.gid || toProductGID(product.productId || product.id);
          
          const response = await fetch('/api/seo/apply-multi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
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
              },
            }),
          });
          
          const data = await response.json();
          if (!response.ok) throw new Error(data?.error || 'Apply failed');
          
          // Optimistic update - веднага обновяваме локалното състояние
          if (data.appliedLanguages && data.appliedLanguages.length > 0) {
            console.log(`[BULK-EDIT] Optimistic update for product ${productId}, languages:`, data.appliedLanguages);
            setProducts(prevProducts => 
              prevProducts.map(prod => {
                if (prod._id === productId) {
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
      console.log('[BULK-EDIT] Waiting for database propagation...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Force a complete refresh of the products list
      console.log('[BULK-EDIT] Clearing products state before reload...');
      setProducts([]); // Clear current products to force re-render
      
      // Load products with cache bypass
      console.log('[BULK-EDIT] Reloading products with cache bypass...');
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
      
      const response = await fetch(`/api/products/list?${params}`, { 
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data?.error || 'Failed to load products');
      
      console.log('[BULK-EDIT] Products reloaded, first product:', data.products[0]?.title);
      console.log('[BULK-EDIT] First product optimization summary:', data.products[0]?.optimizationSummary);
      
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
        const response = await fetch(`/api/products/list?shop=${encodeURIComponent(shop)}&limit=1000&fields=id`, {
          credentials: 'include'
        });
        const data = await response.json();
        productsToProcess = data.products || [];
      } else {
        productsToProcess = products.filter(p => selectedItems.includes(p._id));
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
            optimizedLanguages.includes(lang)
          );
          
          if (languagesToDelete.length === 0) {
            skippedCount++;
            continue;
          }
          
          const response = await fetch('/api/seo/delete-multi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              shop,
              productId: productGid,
              languages: languagesToDelete,
            }),
          });
          
          const data = await response.json();
          
          if (!response.ok) throw new Error(data?.error || 'Delete failed');
          
          // Optimistic update - immediately update local state
          if (data.deletedLanguages && data.deletedLanguages.length > 0) {
            setProducts(prevProducts => 
              prevProducts.map(prod => {
                if (prod._id === product._id) {
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
                      lastOptimized: newOptimized.length > 0 
                        ? prod.optimizationSummary.lastOptimized 
                        : null
                    }
                  };
                }
                return prod;
              })
            );
          }
          
          successCount++;
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
        setToast(`Deleted AI Search Optimisation from ${successCount} products (${skippedCount} had no optimisation to delete)`);
      } else {
        setToast(`Deleted AI Search Optimisation from ${successCount} products`);
      }
      
      // Reload products after delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      await loadProducts(1);
      
    } catch (err) {
      setToast(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setCurrentProduct('');
    }
  };
  
  // Resource list items
  const renderItem = (item) => {
    const product = item;
    const numericId = extractNumericId(product.productId || product.id);
    const optimizedLanguages = product.optimizationSummary?.optimizedLanguages || [];
    
    console.log(`[BULK-EDIT] Rendering product: "${product.title}"`);
    console.log(`[BULK-EDIT] optimizationSummary:`, product.optimizationSummary);
    console.log(`[BULK-EDIT] optimizedLanguages:`, optimizedLanguages);
    console.log(`[BULK-EDIT] availableLanguages:`, availableLanguages);
    

    
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
        id={product._id}
        url=""
        media={media}
        accessibilityLabel={`View details for ${product.title}`}
      >
        <InlineStack gap="400" align="center" blockAlign="center" wrap={false}>
          <Box style={{ flex: '1 1 40%', minWidth: '250px' }}>
            <Text variant="bodyMd" fontWeight="semibold">{product.title}</Text>
            <Text variant="bodySm" tone="subdued">ID: {numericId}</Text>
          </Box>
          
          <Box style={{ flex: '0 0 25%', minWidth: '160px' }}>
            <InlineStack gap="100">
              {(() => {
                console.log(`[BULK-EDIT] Rendering badges for "${product.title}"`);
                console.log(`[BULK-EDIT] availableLanguages.length:`, availableLanguages.length);
                console.log(`[BULK-EDIT] availableLanguages:`, availableLanguages);
                console.log(`[BULK-EDIT] optimizedLanguages:`, optimizedLanguages);
                
                if (availableLanguages.length > 0) {
                  console.log(`[BULK-EDIT] Using availableLanguages.map`);
                  return availableLanguages.map(lang => {
                    const isOptimized = optimizedLanguages.includes(lang);
                    console.log(`[BULK-EDIT] Language ${lang}: optimized=${isOptimized}`);
                    return (
                      <Badge
                        key={lang}
                        tone={isOptimized ? 'success' : 'subdued'}
                        size="small"
                      >
                        {lang.toUpperCase()}
                      </Badge>
                    );
                  });
                } else {
                  console.log(`[BULK-EDIT] Using fallback optimizedLanguages.map`);
                  return optimizedLanguages.map(lang => (
                    <Badge
                      key={lang}
                      tone="success"
                      size="small"
                    >
                      {lang.toUpperCase()}
                    </Badge>
                  ));
                }
              })()}
            </InlineStack>
          </Box>
          
          <Box style={{ flex: '0 0 20%', minWidth: '100px', textAlign: 'center' }}>
            <Badge tone="success">Active</Badge>
          </Box>
        </InlineStack>
      </ResourceItem>
    );
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
      primaryAction={{
        content: 'Generate AI Search Optimisation',
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
          <Text variant="bodyMd">Select languages to generate AI Search Optimisation for {selectAllPages ? 'all' : selectedItems.length} selected products:</Text>
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
      title="Delete AI Search Optimisation"
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
          onAction: () => setShowDeleteModal(false),
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
  
  const emptyState = (
    <EmptyState
      heading="No products found"
      action={{ content: 'Clear filters', onAction: () => {
        setSearchValue('');
        setOptimizedFilter('all');
        setLanguageFilter('');
        setSelectedTags([]);
        loadProducts(1);
      }}}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Try adjusting your filters or search terms</p>
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
      <Card>
        <Box padding="400">
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
            
            <Box>
              <InlineStack gap="300" align="center">
                <Select
                  label=""
                  options={sortOptions}
                  value={sortOrder === 'desc' ? 'newest' : 'oldest'}
                  onChange={(value) => {
                    setSortOrder(value === 'newest' ? 'desc' : 'asc');
                  }}
                />
                
                <BlockStack gap="200">
                  <Button
                    primary
                    onClick={openLanguageModal}
                    disabled={selectedItems.length === 0 && !selectAllPages}
                  >
                    Generate AI Search Optimisation
                  </Button>
                  
                  <Button
                    onClick={openDeleteModal}
                    disabled={(() => {
                      if (selectedItems.length === 0 && !selectAllPages) return true;
                      
                      // Check if any selected product has optimization
                      const selectedProducts = products.filter(p => selectedItems.includes(p._id));
                      const hasOptimizedProducts = selectedProducts.some(p => 
                        p.optimizationSummary?.optimizedLanguages?.length > 0
                      );
                      
                      return !hasOptimizedProducts;
                    })()}
                    destructive
                  >
                    Delete AI Search Optimisation
                  </Button>
                </BlockStack>
              </InlineStack>
            </Box>
          </InlineStack>
          
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

          <ResourceList
            resourceName={{ singular: 'product', plural: 'products' }}
            items={products}
            renderItem={renderItem}
            selectedItems={selectedItems}
            onSelectionChange={handleSelectionChange}
            selectable={true}
            // bulkActions={bulkActions}
            loading={loading}
            totalItemsCount={totalCount}
            emptyState={emptyState}
            showHeader={false}
          />
          
          {hasMore && !loading && (
            <Box padding="400" textAlign="center">
              <Button onClick={() => loadProducts(page + 1, true)}>
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
      
      {toast && (
        <Toast content={toast} onDismiss={() => setToast('')} />
      )}
    </>
  );
}