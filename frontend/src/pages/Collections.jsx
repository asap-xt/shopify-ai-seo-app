// frontend/src/pages/Collections.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Box, Text, Button, InlineStack, BlockStack,
  IndexTable, Badge, Toast, Banner, TextField,
  Select, Divider, Modal, Spinner
} from '@shopify/polaris';

const Collections = ({ shop }) => {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [seoResults, setSeoResults] = useState({});
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  
  // Language states - динамични от магазина
  const [language, setLanguage] = useState('all');
  const [shopLanguages, setShopLanguages] = useState([]);
  const [primaryLanguage, setPrimaryLanguage] = useState('en');
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);

  // Load models from plan
  useEffect(() => {
    if (!shop) return;
    fetch(`/plans/me?shop=${encodeURIComponent(shop)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.modelsSuggested) {
          setModels(data.modelsSuggested.map(m => ({ label: m, value: m })));
          setModel(data.modelsSuggested[0] || '');
        }
      })
      .catch(e => console.error('Failed to load models:', e));
  }, [shop]);

  // Load shop languages
  useEffect(() => {
    if (!shop) return;
    
    fetch(`/api/languages/shop/${encodeURIComponent(shop)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.shopLanguages && data.shopLanguages.length > 0) {
          setShopLanguages(data.shopLanguages);
          setPrimaryLanguage(data.primaryLanguage || data.shopLanguages[0] || 'en');
          setShowLanguageSelector(data.shopLanguages.length > 1);
          
          // Set default language
          if (data.shopLanguages.length === 1) {
            setLanguage(data.shopLanguages[0]);
          } else {
            setLanguage('all');
          }
        }
      })
      .catch(e => console.error('Failed to load languages:', e));
  }, [shop]);

  // Load collections - поправен URL
  const loadCollections = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`/collections/list?shop=${encodeURIComponent(shop)}`, {
        credentials: 'include'
      });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Failed to load collections');
      
      setCollections(data.collections || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  const handleGenerateSEO = async () => {
    if (!selectedCollections.length || !model) {
      setToast('Please select collections and model');
      return;
    }

    setGenerating(true);
    setError('');
    const results = {};

    // Determine languages to generate for
    const languagesToGenerate = language === 'all' ? shopLanguages : [language];

    for (const collectionId of selectedCollections) {
      try {
        if (language === 'all' && shopLanguages.length > 1) {
          // Multi-language generation
          const response = await fetch('/seo/generate-collection-multi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              shop,
              collectionId,
              model,
              languages: shopLanguages
            })
          });

          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Generation failed');
          
          results[collectionId] = data;
        } else {
          // Single language generation
          const response = await fetch('/seo/generate-collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              shop,
              collectionId,
              model,
              language: language === 'all' ? primaryLanguage : language
            })
          });

          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Generation failed');
          
          results[collectionId] = data;
        }
      } catch (e) {
        results[collectionId] = { error: e.message };
      }
    }

    setSeoResults(results);
    setGenerating(false);
    setToast(`Generated SEO for ${Object.keys(results).length} collections`);
  };

  const handleApplySEO = async (collectionId) => {
    const seoData = seoResults[collectionId];
    if (!seoData || seoData.error) return;

    try {
      let response;
      
      if (seoData.results && Array.isArray(seoData.results)) {
        // Multi-language apply
        response = await fetch('/seo/apply-collection-multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            shop,
            collectionId,
            results: seoData.results,
            primaryLanguage,
            options: {
              updateTitle: true,
              updateDescription: true,
              updateSeo: true,
              updateMetafields: true
            }
          })
        });
      } else {
        // Single language apply
        response = await fetch('/seo/apply-collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            shop,
            collectionId,
            seo: seoData.seo,
            language: seoData.language || primaryLanguage,
            options: {
              updateTitle: true,
              updateDescription: true,
              updateSeo: true,
              updateMetafields: true
            }
          })
        });
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Apply failed');
      
      setToast('SEO applied successfully');
      // Remove from results after successful apply
      setSeoResults(prev => {
        const next = { ...prev };
        delete next[collectionId];
        return next;
      });
    } catch (e) {
      setToast(`Failed to apply: ${e.message}`);
    }
  };

  const handlePreview = (collectionId) => {
    const data = seoResults[collectionId];
    if (data && !data.error) {
      setPreviewData(data);
      setShowPreview(true);
    }
  };

  // Build language options
  const languageOptions = showLanguageSelector
    ? [
        { label: 'All languages', value: 'all' },
        ...shopLanguages.map(l => ({ 
          label: l.toUpperCase(), 
          value: l 
        }))
      ]
    : [];

  const rowMarkup = collections.map((collection, index) => {
    const hasResult = !!seoResults[collection.id];
    const hasError = seoResults[collection.id]?.error;
    
    return (
      <IndexTable.Row
        id={collection.id}
        key={collection.id}
        position={index}
        selected={selectedCollections.includes(collection.id)}
        onSelectionChange={(selected) => {
          if (selected) {
            setSelectedCollections([...selectedCollections, collection.id]);
          } else {
            setSelectedCollections(selectedCollections.filter(id => id !== collection.id));
          }
        }}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold">{collection.title}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {collection.productsCount} products
        </IndexTable.Cell>
        <IndexTable.Cell>
          {collection.hasSeoData ? (
            <Badge status="success">Has AI Search Optimisation</Badge>
          ) : (
            <Badge status="attention">No AI Search Optimisation</Badge>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {hasResult && !hasError ? (
            <InlineStack gap="200">
              <Button size="slim" onClick={() => handlePreview(collection.id)}>
                Preview
              </Button>
              <Button size="slim" primary onClick={() => handleApplySEO(collection.id)}>
                Apply
              </Button>
            </InlineStack>
          ) : hasError ? (
            <Badge status="critical">Error</Badge>
          ) : null}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <BlockStack gap="400">
      {error && (
        <Banner status="critical" onDismiss={() => setError('')}>
          <p>{error}</p>
        </Banner>
      )}

      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Collection SEO Generator</Text>
            
            <InlineStack gap="300" align="end">
              {/* Временно скриваме AI Model селектора
              <Select
                label="AI Model"
                options={models}
                value={model}
                onChange={setModel}
              />
              */}
              
              {showLanguageSelector && (
                <Select
                  label="Language"
                  options={languageOptions}
                  value={language}
                  onChange={setLanguage}
                />
              )}
              
              <Button
                primary
                onClick={handleGenerateSEO}
                loading={generating}
                disabled={!selectedCollections.length} // махаме проверката за model
              >
                Generate SEO ({selectedCollections.length})
              </Button>
              
              <Button onClick={loadCollections} loading={loading}>
                Refresh
              </Button>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>

      <Card>
        {loading ? (
          <Box padding="400">
            <InlineStack align="center">
              <Spinner size="large" />
            </InlineStack>
          </Box>
        ) : collections.length === 0 ? (
          <Box padding="400">
            <Text tone="subdued">No collections found</Text>
          </Box>
        ) : (
          <IndexTable
            resourceName={{ singular: 'collection', plural: 'collections' }}
            itemCount={collections.length}
            selectedItemsCount={selectedCollections.length}
            onSelectionChange={(selectionType, isSelecting, selection) => {
              if (selectionType === 'all') {
                setSelectedCollections(isSelecting ? collections.map(c => c.id) : []);
              }
            }}
            headings={[
              { title: 'Collection' },
              { title: 'Products' },
              { title: 'SEO Status' },
              { title: 'Actions' }
            ]}
          >
            {rowMarkup}
          </IndexTable>
        )}
      </Card>

      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="SEO Preview"
        primaryAction={{
          content: 'Close',
          onAction: () => setShowPreview(false)
        }}
      >
        <Modal.Section>
          {previewData && (
            <BlockStack gap="300">
              <Box>
                <Text variant="headingSm">Title</Text>
                <Text>{previewData.seo?.title}</Text>
              </Box>
              <Box>
                <Text variant="headingSm">Meta Description</Text>
                <Text>{previewData.seo?.metaDescription}</Text>
              </Box>
              {previewData.seo?.jsonLd && (
                <Box>
                  <Text variant="headingSm">Structured Data</Text>
                  <pre style={{ fontSize: '12px', overflow: 'auto' }}>
                    {JSON.stringify(previewData.seo.jsonLd, null, 2)}
                  </pre>
                </Box>
              )}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </BlockStack>
  );
};

export default Collections;