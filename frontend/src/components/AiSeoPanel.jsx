// frontend/src/AiSeoPanel.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Card, Page, Layout, TextField, Button, Select, Text, Box, InlineStack, Divider, Toast,
} from '@shopify/polaris';

// ---------- small utils
const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; }
};
const toGID = (v) => {
  if (!v) return v;
  const s = String(v).trim();
  return /^\d+$/.test(s) ? `gid://shopify/Product/${s}` : s;
};
const pretty = (x) => JSON.stringify(x, null, 2);
async function readJson(response) {
  // Robust JSON reader (survives HTML error pages)
  const text = await response.text();
  try { return JSON.parse(text || 'null'); }
  catch { return { __raw: text, error: 'Unexpected non-JSON response' }; }
}

export default function AiSeoPanel() {
  // Core inputs
  const [shop, setShop] = useState(() => qs('shop', ''));
  const [productId, setProductId] = useState('');
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState([{ label: 'Loading…', value: '' }]);

  // Language state (dynamic from shop/product)
  const [shopLanguages, setShopLanguages] = useState([]);
  const [productLanguages, setProductLanguages] = useState([]);
  const [primaryLanguage, setPrimaryLanguage] = useState('en');
  const [shouldShowLanguageSelector, setShouldShowLanguageSelector] = useState(false);
  const [allLanguagesOption, setAllLanguagesOption] = useState(false);
  const [language, setLanguage] = useState('en'); // selected; may be 'all'

  // Result / UI state
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  // ---------- Load plan (modelsSuggested) for current shop
  useEffect(() => {
    const s = shop || qs('shop', '');
    if (!s) return;
    (async () => {
      try {
        const r = await fetch(`/plans/me?shop=${encodeURIComponent(s)}`, { credentials: 'include' });
        const j = await readJson(r);
        if (!r.ok) throw new Error(j?.error || 'Failed to load plan');
        const opts = (j.modelsSuggested || []).map(m => ({ label: m, value: m }));
        if (opts.length) {
          setModelOptions(opts);
          setModel(prev => (opts.find(o => o.value === prev)?.value || opts[0].value));
        } else {
          // Fallback list if backend doesn't return suggestions
          const fallback = ['anthropic/claude-3.5-sonnet'];
          setModelOptions(fallback.map(m => ({ label: m, value: m })));
          setModel(fallback[0]);
        }
      } catch (e) {
        setToast(`Failed to load plan: ${e.message}`);
      }
    })();
  }, [shop]);

  // ---------- Load languages for shop + product
  useEffect(() => {
    const s = shop || qs('shop', '');
    const pid = (productId || '').trim();
    if (!s || !pid) {
      // Reset to defaults when input is incomplete
      setShopLanguages([]); setProductLanguages([]);
      setPrimaryLanguage('en'); setLanguage('en');
      setShouldShowLanguageSelector(false); setAllLanguagesOption(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // Backend uses session; shop param is in path only for clarity
        const url = `/api/languages/product/${encodeURIComponent(s)}/${encodeURIComponent(pid)}`;
        const rsp = await fetch(url, { credentials: 'include' });
        const data = await readJson(rsp);
        if (!rsp.ok) throw new Error(data?.error || 'Failed to fetch languages');
        if (cancelled) return;

        const shopLangs = (data.shopLanguages || []).map(x => x.toLowerCase());
        const prodLangs = (data.productLanguages || []).map(x => x.toLowerCase());
        const primary = (data.primaryLanguage || shopLangs[0] || 'en').toLowerCase();
        const effective = (prodLangs.length ? prodLangs : shopLangs);
        const showSel = effective.length > 1;

        setShopLanguages(shopLangs);
        setProductLanguages(prodLangs);
        setPrimaryLanguage(primary);
        setShouldShowLanguageSelector(!!data.shouldShowSelector || showSel);
        setAllLanguagesOption(!!data.allLanguagesOption && showSel);

        // Default selected language: keep current if valid; else primary or first effective
        setLanguage(prev => {
          if (prev && (prev === 'all' || effective.includes(prev))) return prev;
          return showSel ? effective[0] : primary;
        });
      } catch (e) {
        if (!cancelled) {
          // Fallback to single EN
          setShopLanguages(['en']);
          setProductLanguages(['en']);
          setPrimaryLanguage('en');
          setShouldShowLanguageSelector(false);
          setAllLanguagesOption(false);
          setLanguage('en');
          setToast(`Languages fallback: ${e.message}`);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [shop, productId]);

  // ---------- Generate (single or multi)
  async function onGenerate() {
    setBusy(true); setToast(''); setResult(null);
    try {
      const pid = toGID(productId);
      let response, data;

      if (language === 'all' && (allLanguagesOption || (productLanguages.length + shopLanguages.length) > 1)) {
        // Multi-language path: use product languages if any, otherwise shop languages
        const langs = (productLanguages.length ? productLanguages : shopLanguages);
        if (!langs.length) throw new Error('No languages found for this product/shop');

        response = await fetch('/api/seo/generate-multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ shop, productId: pid, model, languages: langs }),
        });
        data = await readJson(response);
        if (!response.ok) throw new Error(data?.error || 'Generate failed');
        setResult(data);
      } else {
        // Single language path
        response = await fetch(`/seo/generate?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ shop, productId: pid, model, language }),
        });
        data = await readJson(response);
        if (!response.ok) throw new Error(data?.error || 'Generate failed');
        setResult(data);
      }
    } catch (e) {
      setResult({ error: e.message });
      if (String(e.message).toLowerCase().includes('not a valid model')) {
        setToast('Selected model is not enabled/valid. Pick another model from the list.');
      } else {
        setToast(`Generate error: ${e.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  // ---------- Apply (single or multi)
  async function onApply() {
    if (!canApply) return;
    setBusy(true); setToast('');
    try {
      // Multi: array of per-language results
      if (Array.isArray(result?.results)) {
        const pid = toGID(productId || result.productId || '');
        const results = result.results
          .filter(r => r && r.seo)
          .map(r => ({ language: r.language, seo: r.seo }));
        if (!results.length) throw new Error('Nothing to apply (no successful SEO results)');

        const rsp = await fetch('/api/seo/apply-multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            shop,
            productId: pid,
            results,
            options: {
              updateTitle: true, updateBody: true, updateSeo: true,
              updateBullets: true, updateFaq: true, updateAlt: false, dryRun: false,
            },
          }),
        });
        const j = await readJson(rsp);
        if (!rsp.ok || j?.ok === false) {
          const err = (j?.errors || []).join('; ') || j?.error || 'Apply failed';
          throw new Error(err);
        }
      } else {
        // Single
        const pid = toGID(result?.productId || productId);
        const rsp = await fetch(`/seo/apply?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            shop,
            productId: pid,
            seo: result?.seo, // IMPORTANT: send only the seo section
            options: {
              updateTitle: true, updateBody: true, updateSeo: true,
              updateBullets: true, updateFaq: true, updateAlt: false, dryRun: false,
            },
          }),
        });
        const j = await readJson(rsp);
        if (!rsp.ok || j?.ok === false) {
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

  // ---------- Derived UI state
  const languageOptions = useMemo(() => {
    const opts = [];
    if (shouldShowLanguageSelector && (allLanguagesOption || (productLanguages.length + shopLanguages.length) > 1)) {
      opts.push({ label: 'All languages', value: 'all' });
    }
    const effective = (productLanguages.length ? productLanguages : shopLanguages);
    effective.forEach(l => opts.push({ label: l.toUpperCase(), value: l }));
    return opts;
  }, [shouldShowLanguageSelector, allLanguagesOption, productLanguages, shopLanguages]);

  const canApply =
    !!result &&
    (Array.isArray(result?.results)
      ? result.results.some(r => r && r.seo) // multi
      : !!(result?.productId && result?.seo)); // single

  // ---------- Render
  return (
    <Page>
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text as="h3" variant="headingMd">AI SEO</Text>
              <Box paddingBlockStart="300">
                <Layout>
                  <Layout.Section oneHalf>
                    <TextField
                      label="Shop"
                      value={shop}
                      onChange={setShop}
                      autoComplete="off"
                      placeholder="your-shop.myshopify.com"
                    />
                  </Layout.Section>

                  <Layout.Section oneHalf>
                    <TextField
                      label="Product ID (numeric or GID)"
                      value={productId}
                      onChange={setProductId}
                      autoComplete="off"
                      placeholder="1496335… or gid://shopify/Product/1496335…"
                    />
                  </Layout.Section>

                  <Layout.Section oneHalf>
                    <Select
                      label="Model"
                      options={modelOptions}
                      value={model}
                      onChange={setModel}
                    />
                  </Layout.Section>

                  {shouldShowLanguageSelector && (
                    <Layout.Section oneHalf>
                      <Select
                        label="Language (output)"
                        options={languageOptions}
                        value={language}
                        onChange={setLanguage}
                      />
                    </Layout.Section>
                  )}

                  <Layout.Section>
                    <InlineStack gap="300">
                      <Button
                        variant="primary"
                        loading={busy}
                        onClick={onGenerate}
                        disabled={!shop || !productId || !model}
                      >
                        Generate
                      </Button>
                      <Button disabled={!canApply || busy} onClick={onApply}>
                        Apply to product
                      </Button>
                    </InlineStack>
                  </Layout.Section>
                </Layout>
              </Box>
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text as="h3" variant="headingMd">Result</Text>
              <Divider />
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, marginTop: 12 }}>
{`${result ? pretty(result) : '—'}`}
              </pre>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>

      {toast && <Toast content={toast} onDismiss={() => setToast('')} />}
    </Page>
  );
}
