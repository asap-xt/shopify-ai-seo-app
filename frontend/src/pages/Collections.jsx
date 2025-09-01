// frontend/src/pages/Collections.jsx
import React, { useState, useEffect, useCallback } from 'react';
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

const Collections = ({ shop }) => {
  // Collection list state
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  
  // Selection state
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectAllPages, setSelectAllPages] = useState(false);
  
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
  
  // Load models on mount
  useEffect(() => {
    if (!shop) return;
    fetch(`/plans/me?shop=${encodeURIComponent(shop)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const models = data?.modelsSuggested || ['google/gemini-1.5-flash'];
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
        const langs = data?.shopLanguages || ['en'];
        setAvailableLanguages(langs);
        setSelectedLanguages([]);
      })
      .catch(() => {
        setAvailableLanguages(['en']);
      });
  }, [shop]);
  
  // Load collections
  const loadCollections = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        shop,
        ...(searchValue && { search: searchValue }),
        ...(optimizedFilter !== 'all' && { optimized: optimizedFilter }),
      });
      
      const response = await fetch(`/collections/list?${params}`, { credentials: 'include' });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data?.error || 'Failed to load collections');
      
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
  }, [shop, searchValue, optimizedFilter]);
  
  // Debug function for collection metafields
  const debugMetafields = async (collectionId) => {
    try {
      const response = await fetch(`/collections/${collectionId.split('/').pop()}/seo-data?shop=${encodeURIComponent(shop)}`, {
        credentials: 'include'
      });
      const data = await response.json();
      console.log('Collection metafields:', data);
    } catch (err) {
      console.error('Debug error:', err);
    }
  };
  
  // Initial load and filter changes
  useEffect(() => {
    if (shop) loadCollections();
  }, [shop, optimizedFilter]);
  
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
    if (items.length === 0) {
      setSelectAllPages(false);
    }
  }, []);
  
  const handleSelectAllPages = useCallback((checked) => {
    setSelectAllPages(checked);
    if (checked) {
      setSelectedItems(collections.map(c => c.id));
    } else {
      setSelectedItems([]);
    }
  }, [collections]);

  // Load SEO data for preview
  const loadSeoDataForPreview = async (collectionId) => {
    setLoadingPreview(true);
    try {
      const response = await fetch(`/collections/${collectionId.split('/').pop()}/seo-data?shop=${encodeURIComponent(shop)}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setPreviewData(data);
        setShowPreviewModal(true);
      } else {
        setToast('No SEO data found for this collection');
      }
    } catch (err) {
      setToast('Failed to load SEO data');
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
          // Use multi-language endpoint like in BulkEdit
          const response = await fetch('/seo/generate-collection-multi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              shop,
              collectionId: collection.id,
              model,
              languages: selectedLanguages,
            }),
          });
          
          const data = await response.json();
          
          if (!response.ok) throw new Error(data?.error || 'Generation failed');
          
          results[collection.id] = {
            success: true,
            data,
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
      setToast(`Generated SEO for ${successCount} collections`);
      
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
          // Use multi endpoint like in BulkEdit
          const response = await fetch('/seo/apply-collection-multi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              shop,
              collectionId,
              results: result.data.results.filter(r => r?.seo).map(r => ({
                language: r.language,
                seo: r.seo,
              })),
              options: {
                updateTitle: true,
                updateDescription: true,
                updateSeo: true,
                updateMetafields: true,
              },
            }),
          });
          
          const data = await response.json();
          if (!response.ok) throw new Error(data?.error || 'Apply failed');
          
        } catch (err) {
          setErrors(prev => [...prev, { collection: collection.title, error: `Apply failed: ${err.message}` }]);
        }
        
        const current = i + 1;
        const percent = Math.round((current / total) * 100);
        setProgress({ current, total, percent });
      }
      
      // Запазваме успешните резултати за preview
      const successfulData = {};
      Object.entries(results).forEach(([collId, result]) => {
        if (result.success) {
          successfulData[collId] = result.data;
        }
      });
      setAppliedSeoData(prev => ({ ...prev, ...successfulData }));
      
      setToast('SEO applied successfully!');
      setShowResultsModal(false);
      setResults({});
      setSelectedItems([]);
      await loadCollections();
      
    } catch (err) {
      setToast(`Error applying SEO: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setCurrentCollection('');
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
            <Button size="slim" onClick={() => debugMetafields(collection.id)}>
              Debug
            </Button>
          </Box>
        </InlineStack>
      </ResourceItem>
    );
  };
  
  // Progress modal
  const progressModal = isProcessing && (
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
            
            <Box>
              <Button
                primary
                onClick={openLanguageModal}
                disabled={selectedItems.length === 0 && !selectAllPages}
              >
                Generate AI Search Optimisation
              </Button>
            </Box>
          </InlineStack>
          
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
      
      {toast && (
        <Toast content={toast} onDismiss={() => setToast('')} />
      )}
    </>
  );
};

export default Collections;