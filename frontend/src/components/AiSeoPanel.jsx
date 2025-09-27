// frontend/src/components/AiSeoPanel.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Card, Text, TextField, InlineStack, Select, Button, Divider, Toast, Tabs,
} from '@shopify/polaris';
import { useShopApi } from '../hooks/useShopApi.js';
import BulkEdit from '../pages/BulkEdit.jsx';

const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; }
};
const toGID = (v) => {
  if (!v) return v;
  const s = String(v).trim();
  return /^\d+$/.test(s) ? `gid://shopify/Product/${s}` : s;
};
const pretty = (x) => JSON.stringify(x, null, 2);

export default function AiSeoPanel() {
  const { api, shop } = useShopApi(); // Това заменя много редове!
  const [selectedTab, setSelectedTab] = useState(0);
  
  const tabs = [
    {
      id: 'single-product',
      content: 'Single Product',
      panelID: 'single-product-panel',
    },
    {
      id: 'bulk-edit',
      content: 'Bulk Edit',
      panelID: 'bulk-edit-panel',
    },
  ];

  // All existing state and logic for single product
  const [productId, setProductId] = useState('');
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState([{ label: 'Loading…', value: '' }]);
  const [shopLanguages, setShopLanguages] = useState([]);
  const [productLanguages, setProductLanguages] = useState([]);
  const [primaryLanguage, setPrimaryLanguage] = useState('en');
  const [shouldShowLanguageSelector, setShouldShowLanguageSelector] = useState(false);
  const [allLanguagesOption, setAllLanguagesOption] = useState(null);
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!shop) return;
    (async () => {
      try {
        const Q = `
          query PlansMe($shop:String!) {
            plansMe(shop:$shop) {
              modelsSuggested
            }
          }
        `;
        const res = await api('/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: Q, variables: { shop } }),
        });
        if (res?.errors?.length) throw new Error(res.errors[0]?.message || 'GraphQL error');
        const j = res?.data?.plansMe;
        const suggested = j?.modelsSuggested || [];
        const opts = suggested.length ? suggested : ['anthropic/claude-3.5-sonnet'];
        setModelOptions(opts.map(m => ({ label: m, value: m })));
        setModel(prev => (opts.includes(prev) ? prev : opts[0]));
      } catch (e) {
        setToast(`Failed to load plan: ${e.message}`);
      }
    })();
  }, [shop, api]);

  useEffect(() => {
    const pid = (productId || '').trim();
    if (!shop || !pid) {
      setShopLanguages([]); setProductLanguages([]); setPrimaryLanguage('en');
      setShouldShowLanguageSelector(false); setAllLanguagesOption(null); setLanguage('en');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await api(`/api/languages/product/${encodeURIComponent(shop)}/${encodeURIComponent(pid)}`, { shop });
        if (cancelled) return;

        const shopLangs = (data.shopLanguages || []).map(x => x.toLowerCase());
        const prodLangs = (data.productLanguages || []).map(x => x.toLowerCase());
        const primary = (data.primaryLanguage || shopLangs[0] || 'en').toLowerCase();
        const showSel = Boolean(data.shouldShowSelector);

        setShopLanguages(shopLangs);
        setProductLanguages(prodLangs);
        setPrimaryLanguage(primary);
        setShouldShowLanguageSelector(showSel);
        setAllLanguagesOption(data.allLanguagesOption || (showSel ? { label: 'All languages', value: 'all' } : null));

        setLanguage(prev => {
          const effective = (prodLangs.length ? prodLangs : shopLangs);
          if (prev === 'all' && showSel) return 'all';
          if (prev && effective.includes(prev)) return prev;
          return showSel ? (effective[0] || primary) : primary;
        });
      } catch (e) {
        setShopLanguages(['en']); setProductLanguages(['en']); setPrimaryLanguage('en');
        setShouldShowLanguageSelector(false); setAllLanguagesOption(null); setLanguage('en');
        setToast(`Languages fallback: ${e.message}`);
      }
    })();

    return () => { cancelled = true; };
  }, [shop, productId, api]);

  async function onGenerate() {
    setBusy(true); setToast(''); setResult(null);
    try {
      const pid = toGID(productId);
      if (language === 'all' && shouldShowLanguageSelector) {
        const langs = productLanguages.length ? productLanguages : shopLanguages;
        if (!langs.length) throw new Error('No languages available for this product/shop');
        const j = await api(`/api/seo/generate-multi`, {
          method: 'POST',
          body: { shop, productId: pid, model, languages: langs },
          shop,
        });
        setResult(j);
      } else {
        const j = await api(`/seo/generate`, {
          method: 'POST',
          body: { shop, productId: pid, model, language },
          shop,
        });
        setResult(j);
      }
      setToast('Generated ✓');
    } catch (e) {
      setResult({ error: e.message });
      setToast(`Generate error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function onApply() {
    if (!result) return;
    setBusy(true); setToast('');
    try {
      if (Array.isArray(result?.results)) {
        const pid = toGID(productId || result.productId || '');
        const results = result.results.filter(r => r && r.seo).map(r => ({ language: r.language, seo: r.seo }));
        if (!results.length) throw new Error('Nothing to apply (no successful SEO results)');
        const j = await api(`/api/seo/apply-multi`, {
          method: 'POST',
          body: {
            shop,
            productId: pid,
            results,
            options: {
              updateTitle: true, updateBody: true, updateSeo: true,
              updateBullets: true, updateFaq: true, updateAlt: false, dryRun: false,
            },
          },
          shop,
        });
        if (j?.ok === false) {
          const err = (j?.errors || []).join('; ') || j?.error || 'Apply failed';
          throw new Error(err);
        }
      } else {
        const pid = toGID(result?.productId || productId);
        const j = await api(`/seo/apply`, {
          method: 'POST',
          body: {
            shop,
            productId: pid,
            seo: result?.seo,
            options: {
              updateTitle: true, updateBody: true, updateSeo: true,
              updateBullets: true, updateFaq: true, updateAlt: false, dryRun: false,
            },
          },
          shop,
        });
        if (j?.ok === false) {
          const err = (j?.errors || []).join('; ') || j?.error || 'Apply failed';
          throw new Error(err);
        }
      }
      setToast('Applied ✓');
    } catch (e) {
      setToast(`Apply error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const hasMultiple = (productLanguages.length ? productLanguages : shopLanguages).length > 1;
  const languageOptions = hasMultiple
    ? [{ label: (allLanguagesOption?.label || 'All languages'), value: (allLanguagesOption?.value || 'all') },
       ...((productLanguages.length ? productLanguages : shopLanguages).map(l => ({ label: l.toUpperCase(), value: l })))]
    : [];

  const canApply =
    !!result &&
    (Array.isArray(result?.results) ? result.results.some(r => r && r.seo) : !!(result?.productId && result?.seo));

  // Single Product Panel (original content)
  const singleProductPanel = (
    <>
      <Card>
        <Box padding="400">
          <Text as="h3" variant="headingMd">Generate SEO</Text>
          <Box paddingBlockStart="300">
            <div className="Polaris-Layout">
              <div className="Polaris-Layout__Section Polaris-Layout__Section--oneHalf">
                <TextField
                  label="Shop"
                  value={shop}
                  onChange={setShop}
                  placeholder="your-shop.myshopify.com"
                  autoComplete="off"
                />
              </div>
              <div className="Polaris-Layout__Section Polaris-Layout__Section--oneHalf">
                <TextField
                  label="Product ID (numeric or GID)"
                  value={productId}
                  onChange={setProductId}
                  placeholder="1496335… or gid://shopify/Product/1496335…"
                  autoComplete="off"
                />
              </div>
              <div className="Polaris-Layout__Section Polaris-Layout__Section--oneHalf">
                <TextField label="Model" value={model} onChange={setModel} autoComplete="off" />
              </div>

              {shouldShowLanguageSelector && hasMultiple && (
                <div className="Polaris-Layout__Section Polaris-Layout__Section--oneHalf">
                  <Select
                    label="Language (output)"
                    options={languageOptions}
                    value={language}
                    onChange={setLanguage}
                  />
                </div>
              )}

              <div className="Polaris-Layout__Section">
                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    loading={busy}
                    onClick={onGenerate}
                    disabled={!shop || !productId || !model}
                  >
                    Generate
                  </Button>
                  <Button onClick={onApply} disabled={!canApply || busy}>
                    Apply to product
                  </Button>
                </InlineStack>
              </div>
            </div>
          </Box>
        </Box>
      </Card>

      <Box paddingBlockStart="300">
        <Card>
          <Box padding="400">
            <Text as="h3" variant="headingMd">Result</Text>
            <Divider />
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, marginTop: 12 }}>
              {`${result ? pretty(result) : '—'}`}
            </pre>
          </Box>
        </Card>
      </Box>

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </>
  );

  return (
    <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
      {selectedTab === 0 ? (
        singleProductPanel
      ) : (
        <BulkEdit shop={shop} />
      )}
    </Tabs>
  );
}