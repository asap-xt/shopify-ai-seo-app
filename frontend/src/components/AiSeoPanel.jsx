// frontend/src/components/AiSeoPanel.jsx
import React, { useEffect, useState } from 'react';
import { Card, BlockStack, Box, Button, ButtonGroup, InlineStack, Text, TextField, Select, Tabs } from '@shopify/polaris';

const jsonPretty = (v) => JSON.stringify(v, null, 2);

function getQS(name, def = '') {
  try { return new URL(window.location.href).searchParams.get(name) || def; }
  catch { return def; }
}
function toGID(idOrGid) {
  const s = String(idOrGid || '').trim();
  if (!s) return '';
  if (s.startsWith('gid://')) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return s;
}

export default function AiSeoPanel() {
  const [shop, setShop] = useState(() => getQS('shop', ''));
  const [productId, setProductId] = useState('');
  const [model, setModel] = useState('anthropic/claude-3.5-sonnet');
  const [language, setLanguage] = useState('en');

  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [tabIndex, setTabIndex] = useState(0); // 0: Preview, 1: JSON

  // New state for dynamic languages
  const [shopLanguages, setShopLanguages] = useState([]);
  const [productLanguages, setProductLanguages] = useState([]);
  const [primaryLanguage, setPrimaryLanguage] = useState('en');
  const [shouldShowLanguageSelector, setShouldShowLanguageSelector] = useState(false);
  const [allLanguagesOption, setAllLanguagesOption] = useState(null);

  const canGenerate = !!shop && !!productId;
  const canApply = !!(result && result.productId && result.seo);

  // Fetch languages when productId changes
  useEffect(() => {
    if (!shop || !productId) {
      setShopLanguages([]);
      setProductLanguages([]);
      setPrimaryLanguage('en');
      setShouldShowLanguageSelector(false);
      setAllLanguagesOption(null);
      return;
    }

    (async () => {
      try {
        // Fetch product languages using new API endpoint
        const response = await fetch(`/api/languages/product/${encodeURIComponent(shop)}/${encodeURIComponent(productId)}`);
        if (!response.ok) throw new Error('Failed to fetch languages');
        
        const data = await response.json();
        setShopLanguages(data.shopLanguages || []);
        setProductLanguages(data.productLanguages || []);
        setPrimaryLanguage(data.primaryLanguage || 'en');
        setShouldShowLanguageSelector(data.shouldShowSelector || false);
        setAllLanguagesOption(data.allLanguagesOption || null);
        
        // Set default language to primary language if no language is selected
        if (!language || !data.productLanguages.includes(language)) {
          setLanguage(data.primaryLanguage || 'en');
        }
      } catch (error) {
        console.error('Failed to fetch languages:', error);
        // Fallback to default behavior
        setShopLanguages(['en']);
        setProductLanguages(['en']);
        setPrimaryLanguage('en');
        setShouldShowLanguageSelector(false);
        setAllLanguagesOption(null);
      }
    })();
  }, [shop, productId]);

  useEffect(() => {
    (async () => {
      try {
        const q = shop ? `?shop=${encodeURIComponent(shop)}` : '';
        const r = await fetch(`/plans/me${q}`);
        const j = await r.json();
        setPlan(j);
        if (j?.modelsSuggested?.length) setModel(j.modelsSuggested[0]);
      } catch (e) {
        setError(`Failed to load plan: ${e.message}`);
      }
    })();
  }, [shop]); // Add shop dependency

  const onGenerate = async () => {
    if (!shop || !productId || !model || !language) {
      setError('Missing required fields');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      let response;
      
      if (language === 'all' && allLanguagesOption) {
        // Use multi-language API for "All Languages"
        response = await fetch('/api/seo/generate-multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop,
            productId: toGID(productId),
            model,
            languages: productLanguages
          })
        });
      } else {
        // Use single language API
        response = await fetch(`/seo/generate?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop,
            productId: toGID(productId),
            model,
            language
          })
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate SEO');
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  async function onApply() {
    if (!shop || !productId || !result) {
      setError('Missing required fields');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let response;
      
      if (result.language === 'all' && result.results) {
        // Use multi-language API for "All Languages"
        response = await fetch('/api/seo/apply-multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop,
            productId: toGID(productId),
            results: result.results,
            options: {
              updateTitle: true,
              updateBody: true,
              updateSeo: true,
              updateBullets: true,
              updateFaq: true,
              updateAlt: false,
              dryRun: false
            }
          })
        });
      } else {
        // Use single language API
        response = await fetch(`/seo/apply?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop,
            productId: toGID(productId),
            seo: result,
            options: {
              updateTitle: true,
              updateBody: true,
              updateSeo: true,
              updateBullets: true,
              updateFaq: true,
              updateAlt: false,
              dryRun: false
            }
          })
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to apply SEO');
      }

      const data = await response.json();
      if (data.ok) {
        setError('SEO applied successfully!');
      } else {
        setError(`Apply failed: ${data.errors?.join(', ') || 'Unknown error'}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Build language options for selector
  const getLanguageOptions = () => {
    const options = [];
    
    // Add product languages
    productLanguages.forEach(lang => {
      options.push({
        label: lang.toUpperCase(),
        value: lang
      });
    });
    
    // Add "all languages" option if available
    if (allLanguagesOption) {
      options.push({
        label: 'All Languages',
        value: 'all'
      });
    }
    
    return options;
  };

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="300" wrap={false} align="space-between">
            <BlockStack gap="200" inlineAlign="start" style={{minWidth: 320}}>
              <TextField label="Shop" value={shop} onChange={setShop} autoComplete="off" />
              <TextField label="Product ID" value={productId} onChange={setProductId} autoComplete="off" />
            </BlockStack>

            <BlockStack gap="200" inlineAlign="start" style={{minWidth: 320}}>
              <Select
                label="Model"
                options={(plan?.modelsSuggested || [model]).map(m => ({label:m,value:m}))}
                value={model}
                onChange={setModel}
              />
              {shouldShowLanguageSelector ? (
                <Select
                  label="Language"
                  options={getLanguageOptions()}
                  value={language}
                  onChange={setLanguage}
                />
              ) : (
                <TextField
                  label="Language"
                  value={primaryLanguage.toUpperCase()}
                  disabled
                  helpText="Single language store"
                />
              )}
            </BlockStack>

            <BlockStack gap="200" inlineAlign="end">
              <ButtonGroup>
                <Button onClick={onGenerate} disabled={!canGenerate || loading} variant="primary">Generate</Button>
                <Button onClick={onApply} disabled={!canApply || loading}>Apply to product</Button>
              </ButtonGroup>
              {!!error && (
                <Text as="p" tone="critical">
                  {error}
                </Text>
              )}
            </BlockStack>
          </InlineStack>
        </BlockStack>
      </Card>

      {result && (
        <Card>
          <Tabs
            tabs={[{id:'preview',content:'Preview'},{id:'json',content:'JSON'}]}
            selected={tabIndex}
            onSelect={setTabIndex}
          />
          <Box padding="400">
            {tabIndex === 0 ? (
              <BlockStack gap="300">
                {result.language === 'all' && result.results ? (
                  // Show results for all languages
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">Multi-Language SEO Results</Text>
                    {result.results.map((langResult, index) => (
                      <Card key={index}>
                        <BlockStack gap="300">
                          <InlineStack gap="200" align="space-between">
                            <Text as="h3" variant="headingSm">
                              {langResult.language?.toUpperCase() || 'Unknown'} 
                              {langResult.error && <Text tone="critical"> - Error: {langResult.error}</Text>}
                            </Text>
                            {langResult.quality && (
                              <Text tone="subdued" variant="bodySm">
                                Tokens: {langResult.quality.tokens}, Cost: ${langResult.quality.costUsd?.toFixed(4) || '0'}
                              </Text>
                            )}
                          </InlineStack>
                          
                          {langResult.seo && !langResult.error ? (
                            <BlockStack gap="200">
                              <Text as="h4" variant="headingSm">{langResult.seo.title}</Text>
                              <Text as="p" tone="subdued">{langResult.seo.metaDescription}</Text>
                              <div dangerouslySetInnerHTML={{ __html: langResult.seo.bodyHtml }} />
                              {!!langResult.seo.bullets?.length && (
                                <BlockStack gap="100">
                                  <Text as="h4" variant="headingSm">Bullets</Text>
                                  <ul>{langResult.seo.bullets.map((b,i)=><li key={i}>{b}</li>)}</ul>
                                </BlockStack>
                              )}
                              {!!langResult.seo.faq?.length && (
                                <BlockStack gap="100">
                                  <Text as="h4" variant="headingSm">FAQ</Text>
                                  <dl>
                                    {langResult.seo.faq.map((f,i)=>(
                                      <div key={i} style={{marginBottom:8}}>
                                        <dt><strong>{f.q}</strong></dt>
                                        <dd>{f.a}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                </BlockStack>
                              )}
                            </BlockStack>
                          ) : (
                            <Text tone="critical">Failed to generate SEO for this language</Text>
                          )}
                        </BlockStack>
                      </Card>
                    ))}
                  </BlockStack>
                ) : (
                  // Show single language result (existing logic)
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">{result.seo.title}</Text>
                    <Text as="p" tone="subdued">{result.seo.metaDescription}</Text>
                    <div dangerouslySetInnerHTML={{ __html: result.seo.bodyHtml }} />
                    {!!result.seo.bullets?.length && (
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">Bullets</Text>
                        <ul>{result.seo.bullets.map((b,i)=><li key={i}>{b}</li>)}</ul>
                      </BlockStack>
                    )}
                    {!!result.seo.faq?.length && (
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">FAQ</Text>
                        <dl>
                          {result.seo.faq.map((f,i)=>(
                            <div key={i} style={{marginBottom:8}}>
                              <dt><strong>{f.q}</strong></dt>
                              <dd>{f.a}</dd>
                            </div>
                          ))}
                        </dl>
                      </BlockStack>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            ) : (
              <pre style={{whiteSpace:'pre-wrap', wordBreak:'break-word', margin:0}}>
                {jsonPretty(result)}
              </pre>
            )}
          </Box>
        </Card>
      )}
    </BlockStack>
  );
}
