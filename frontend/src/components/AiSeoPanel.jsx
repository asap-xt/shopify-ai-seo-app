// frontend/src/AiSeoPanel.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Card, Text, TextField, InlineStack, Select, Button, Divider, Toast,
} from '@shopify/polaris';

// ---- helpers
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
  const text = await response.text();
  try { return JSON.parse(text || 'null'); }
  catch { return { __raw: text, error: 'Unexpected non-JSON response' }; }
}

export default function AiSeoPanel() {
  // Core inputs
  const [shop, setShop] = useState(() => qs('shop', ''));
  const [productId, setProductId] = useState('');
  const [model, setModel] = useState('anthropic/claude-3.5-sonnet');

  // Dynamic languages from shop/product
  const [shopLanguages, setShopLanguages] = useState([]);
  const [productLanguages, setProductLanguages] = useState([]);
  const [primaryLanguage, setPrimaryLanguage] = useState('en');
  const [shouldShowLanguageSelector, setShouldShowLanguageSelector] = useState(false);
  const [allLanguagesOption, setAllLanguagesOption] = useState(null);
  const [language, setLanguage] = useState('en'); // can be 'all'

  // Result / UI
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState('');

  // -------- Load models from plan (kept simple; uses /plans/me?shop=…)
  useEffect(() => {
    const s = shop || qs('shop', '');
    if (!s) return;
    (async () => {
      try {
        const r = await fetch(`/plans/me?shop=${encodeURIComponent(s)}`, { credentials: 'include' });
        const j = await readJson(r);
        if (!r.ok) throw new Error(j?.error || 'Failed to load plan');
        const suggested = j?.modelsSuggested || [];
        if (suggested.length && !suggested.includes(model)) {
          setModel(suggested[0]);
        }
      } catch (e) {
        // leave current model; show toast only if needed
      }
    })();
  }, [shop]);

  // -------- Load shop+product languages
  useEffect(() => {
    const s = shop || qs('shop', '');
    const pid = (productId || '').trim();
    if (!s || !pid) {
      setShopLanguages([]); setProductLanguages([]); setPrimaryLanguage('en');
      setShouldShowLanguageSelector(false); setAllLanguagesOption(null); setLanguage('en');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const url = `/api/languages/product/${encodeURIComponent(s)}/${encodeURIComponent(pid)}`;
        const rsp = await fetch(url, { credentials: 'include' });
        const data = await readJson(rsp);
        if (!rsp.ok) throw new Error(data?.error || 'Failed to fetch languages');
        if (cancelled) return;

        const shopLangs = (data.shopLanguages || []).map(x => x.toLowerCase());
        const prodLangs = (data.productLanguages || []).map(x => x.toLowerCase());
        const primary = (data.primaryLanguage || shopLangs[0] || 'en').toLowerCase();
        const showSel = Boolean(data.shouldShowSelector) || (prodLangs.length > 1 || shopLangs.length > 1);

        setShopLanguages(shopLangs);
        setProductLanguages(prodLangs);
        setPrimaryLanguage(primary);
        setShouldShowLanguageSelector(showSel);
        setAllLanguagesOption(data.allLanguagesOption || (showSel ? { label: 'All languages', value: 'all' } : null));

        // default selected language
        setLanguage(prev => {
          const effective = (prodLangs.length ? prodLangs : shopLangs);
          if (prev === 'all' && showSel) return 'all';
          if (prev && effective.includes(prev)) return prev;
          return showSel ? (effective[0] || primary) : primary;
        });
      } catch (e) {
        if (!cancelled) {
          setShopLanguages(['en']); setProductLanguages(['en']); setPrimaryLanguage('en');
          setShouldShowLanguageSelector(false); setAllLanguagesOption(null); setLanguage('eN'.toLowerCase());
          setToast(`Languages fallback: ${e.message}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [shop, productId]);

  // -------- Generate (single or multi)
  async function onGenerate() {
    setBusy(true); setToast(''); setResult(null);
    try {
      const pid = toGID(productId);

      if (language === 'all' && (shouldShowLanguageSelector || allLanguagesOption)) {
        const langs = productLanguages.length ? productLanguages : shopLanguages;
        if (!langs.length) throw new Error('No languages available for this product/shop');

        const rsp = await fetch('/api/seo/generate-multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ shop, productId: pid, model, languages: langs }),
        });
        const j = await readJson(rsp);
        if (!rsp.ok) throw new Error(j?.error || 'Generate failed');
        setResult(j);
      } else {
        const rsp = await fetch(`/seo/generate?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ shop, productId: pid, model, language }),
        });
        const j = await readJson(rsp);
        if (!rsp.ok) throw new Error(j?.error || 'Generate failed');
        setResult(j);
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

  // -------- Apply (single or multi)
  async function onApply() {
    if (!result) return;
    setBusy(true); setToast('');
    try {
      if (Array.isArray(result?.results)) {
        const pid = toGID(productId || result.productId || '');
        const results = result.results.filter(r => r && r.seo).map(r => ({ language: r.language, seo: r.seo }));
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
        const pid = toGID(result?.productId || productId);
        const rsp = await fetch(`/seo/apply?shop=${encodeURIComponent(shop)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            shop,
            productId: pid,
            seo: result?.seo, // IMPORTANT: only seo section
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

  // -------- Derived UI
  const languageOptions = useMemo(() => {
    const opts = [];
    const many = (productLanguages.length || shopLanguages.length) > 1;
    if (shouldShowLanguageSelector && (allLanguagesOption || many)) {
      opts.push({ label: (allLanguagesOption?.label || 'All languages'), value: (allLanguagesOption?.value || 'all') });
    }
    const effective = productLanguages.length ? productLanguages : shopLanguages;
    effective.forEach(l => opts.push({ label: l.toUpperCase(), value: l }));
    return opts;
  }, [shouldShowLanguageSelector, allLanguagesOption, productLanguages, shopLanguages]);

  const canApply =
    !!result &&
    (Array.isArray(result?.results) ? result.results.some(r => r && r.seo) : !!(result?.productId && result?.seo));

  // -------- Render
  return (
    <>
      <Card>
        <Box padding="400">
          <Text as="h3" variant="headingMd">AI SEO</Text>
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

              {shouldShowLanguageSelector && (
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
}
