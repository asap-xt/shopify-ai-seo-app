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
  Filters,
  ChoiceList,
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
  const [productIdSearch, setProductIdSearch] = useState('');
  const [optimizedFilter, setOptimizedFilter] = useState('all');
  
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
    fetch(`/api/shop/languages?shop=${encodeURIComponent(shop)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const langs = data?.languages || ['en'];
        setAvailableLanguages(langs);
        setSelectedLanguages([]); // User must select
      })
      .catch(() => {
        // Fallback
        setAvailableLanguages(['en']);
      });
  }, [shop]);
  
  // Load products
  const loadProducts = useCallback(async (pageNum = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        shop,
        page: pageNum,
        limit: 50,
        ...(optimizedFilter !== 'all' && { optimized: optimizedFilter }),
        ...(searchValue && { search: searchValue }),
      });
      
      const response = await fetch(`/api/products/list?${params}`, { credentials: 'include' });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data?.error || 'Failed to load products');
      
      setProducts(pageNum === 1 ? data.products : [...products, ...data.products]);
      setPage(pageNum);
      setHasMore(data.hasMore);
      setTotalCount(data.total || 0);
    } catch (err) {
      setToast(`Error loading products: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [shop, optimizedFilter, searchValue, products]);
  
  // Initial load
  useEffect(() => {
    if (shop) loadProducts(1);
  }, [shop, optimizedFilter]);
  
  // Search specific product by ID
  const searchProductById = async () => {
    if (!productIdSearch.trim()) return;
    
    setLoading(true);
    try {
      const gid = toProductGID(productIdSearch);
      const numericId = extractNumericId(gid);
      
      const response = await fetch(`/api/products/bulk-select?shop=${encodeURIComponent(shop)}&ids=${numericId}`, {
        credentials: 'include'
      });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data?.error || 'Product not found');
      
      setProducts(data.products || []);
      setTotalCount(data.products?.length || 0);
      setHasMore(false);
    } catch (err) {
      setToast(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // Handle selection
  const handleSelectionChange = useCallback((items) => {
    setSelectedItems(items);
    setSelectAllPages(false);
  }, []);
  
  const handleSelectAllPages = useCallback((checked) => {
    setSelectAllPages(checked);
    if (checked) {
      setSelectedItems(products.map(p => p._id));
    }
  }, [products]);
  
  // Generate SEO for selected products
  const generateSEO = async () => {
    if (!selectedLanguages.length) {
      setToast('Please select at least one language');
      return;
    }
    
    const productIds = selectAllPages ? 'ALL' : selectedItems;
    if (!selectAllPages && (!productIds.length)) {
      setToast('Please select products');
      return;
    }
    
    setIsProcessing(true);
    setProgress({ current: 0, total: 0, percent: 0 });
    setErrors([]);
    setResults({});
    
    try {
      // Get actual product list to process
      let productsToProcess = [];
      
      if (selectAllPages) {
        // Fetch all product IDs
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
      
      // Process in batches
      const batchSize = 5;
      const results = {};
      
      for (let i = 0; i < productsToProcess.length; i += batchSize) {
        const batch = productsToProcess.slice(i, Math.min(i + batchSize, productsToProcess.length));
        
        // Process batch in parallel
        const batchPromises = batch.map(async (product) => {
          setCurrentProduct(product.title || product.handle || 'Product');
          
          try {
            const response = await fetch('/api/seo/generate-multi', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                shop,
                productId: product.id,
                model,
                languages: selectedLanguages,
              }),
            });
            
            const data = await response.json();
            
            if (!response.ok) throw new Error(data?.error || 'Generation failed');
            
            results[product._id] = {
              success: true,
              data,
              languages: selectedLanguages,
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
      setToast(`Generated SEO for ${Object.keys(results).filter(k => results[k].success).length} products`);
      
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
      const successfulResults = Object.entries(results).filter(([_, r]) => r.success);
      const total = successfulResults.length;
      setProgress({ current: 0, total, percent: 0 });
      
      for (let i = 0; i < successfulResults.length; i++) {
        const [productId, result] = successfulResults[i];
        const product = products.find(p => p._id === productId);
        
        if (!product) continue;
        
        setCurrentProduct(product.title || 'Product');
        
        try {
          const response = await fetch('/api/seo/apply-multi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              shop,
              productId: product.id,
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
          
        } catch (err) {
          setErrors(prev => [...prev, { product: product.title, error: `Apply failed: ${err.message}` }]);
        }
        
        const current = i + 1;
        const percent = Math.round((current / total) * 100);
        setProgress({ current, total, percent });
      }
      
      setToast('SEO applied successfully!');
      setShowResultsModal(false);
      
      // Reload products to show updated status
      loadProducts(1);
      
    } catch (err) {
      setToast(`Error applying SEO: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setCurrentProduct('');
    }
  };
  
  // Resource list items
  const resourceItems = products.map((product) => {
    const numericId = extractNumericId(product.id);
    const optimizedLanguages = product.languages?.optimized || [];
    
    return (
      <ResourceItem
        id={product._id}
        key={product._id}
        onClick={() => {}}
        accessibilityLabel={`View details for ${product.title}`}
      >
        <InlineStack gap="300" align="center" blockAlign="center">
          <Thumbnail
            source={product.image || ''}
            alt={product.title}
            size="small"
          />
          <Box minWidth="200px">
            <Text variant="bodyMd" fontWeight="semibold">{product.title}</Text>
            <Text variant="bodySm" tone="subdued">ID: {numericId}</Text>
          </Box>
          <Box minWidth="150px">
            <InlineStack gap="100">
              {availableLanguages.map(lang => (
                <Badge
                  key={lang}
                  tone={optimizedLanguages.includes(lang) ? 'success' : 'warning'}
                  size="small"
                >
                  {lang.toUpperCase()}
                </Badge>
              ))}
            </InlineStack>
          </Box>
          <Box minWidth="150px">
            <Text variant="bodySm" tone="subdued">
              {product.updatedAt ? new Date(product.updatedAt).toLocaleDateString() : '—'}
            </Text>
          </Box>
        </InlineStack>
      </ResourceItem>
    );
  });
  
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
  
  // Results modal
  const resultsModal = (
    <Modal
      open={showResultsModal && !isProcessing}
      title="SEO Generation Results"
      primaryAction={{
        content: 'Apply SEO',
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
                {Object.values(results).filter(r => r.success).length}
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
  
  const emptyState = (
    <EmptyState
      heading="No products found"
      action={{ content: 'Clear filters', onAction: () => {
        setSearchValue('');
        setProductIdSearch('');
        setOptimizedFilter('all');
        loadProducts(1);
      }}}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Try adjusting your filters or search terms</p>
    </EmptyState>
  );
  
  const bulkActions = [
    {
      content: `Generate SEO (${selectAllPages ? 'All' : selectedItems.length} selected)`,
      onAction: generateSEO,
      disabled: !selectedItems.length && !selectAllPages,
    },
  ];
  
  const filters = [
    {
      key: 'optimized',
      label: 'SEO Status',
      filter: (
        <ChoiceList
          title="SEO Status"
          titleHidden
          choices={[
            { label: 'All products', value: 'all' },
            { label: 'Optimized', value: 'true' },
            { label: 'Not optimized', value: 'false' },
          ]}
          selected={[optimizedFilter]}
          onChange={(value) => setOptimizedFilter(value[0])}
        />
      ),
    },
  ];
  
  return (
    <Page title="Bulk Edit SEO">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {/* Search by Product ID */}
              <InlineStack gap="300">
                <TextField
                  label="Search by Product ID"
                  labelHidden
                  placeholder="Enter product ID or GID..."
                  value={productIdSearch}
                  onChange={setProductIdSearch}
                  prefix={<SearchIcon />}
                  connectedRight={
                    <Button onClick={searchProductById} disabled={!productIdSearch.trim()}>
                      Search
                    </Button>
                  }
                />
              </InlineStack>
              
              {/* Bulk Settings */}
              <InlineStack gap="400" wrap={false}>
                <Box minWidth="200px">
                  <Select
                    label="AI Model"
                    labelHidden
                    options={modelOptions}
                    value={model}
                    onChange={setModel}
                  />
                </Box>
                
                <Box>
                  <Text variant="bodyMd" fontWeight="semibold">Languages:</Text>
                  <InlineStack gap="200">
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
                  </InlineStack>
                </Box>
              </InlineStack>
              
              {/* Select all products checkbox */}
              {totalCount > 0 && (
                <Box paddingBlockStart="200">
                  <Checkbox
                    label={`Select all ${totalCount} products in your store`}
                    checked={selectAllPages}
                    onChange={handleSelectAllPages}
                  />
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        
        <Layout.Section>
          <Card>
            <ResourceList
              resourceName={{ singular: 'product', plural: 'products' }}
              items={products}
              renderItem={(item) => resourceItems.find(ri => ri.key === item._id)}
              selectedItems={selectedItems}
              onSelectionChange={handleSelectionChange}
              bulkActions={bulkActions}
              loading={loading}
              totalItemsCount={totalCount}
              emptyState={emptyState}
              filterControl={
                <Filters
                  queryValue={searchValue}
                  filters={filters}
                  onQueryChange={setSearchValue}
                  onQueryClear={() => setSearchValue('')}
                  onClearAll={() => {
                    setSearchValue('');
                    setOptimizedFilter('all');
                  }}
                />
              }
            />
            
            {hasMore && !loading && (
              <Box padding="400" textAlign="center">
                <Button onClick={() => loadProducts(page + 1)}>
                  Load more products
                </Button>
              </Box>
            )}
          </Card>
        </Layout.Section>
      </Layout>
      
      {progressModal}
      {resultsModal}
      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </Page>
  );
}