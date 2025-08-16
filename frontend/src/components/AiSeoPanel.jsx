// frontend/src/components/AiSeoPanel.jsx
import React, { useEffect, useState } from 'react';
import { Card, BlockStack, Box, Button, ButtonGroup, InlineStack, Text, TextField, Select, Tabs } from '@shopify/polaris';

const jsonPretty = (v) => JSON.stringify(v, null, 2);
const LANGS = ['en','de','es','fr'];

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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState(null);
  const [tabIndex, setTabIndex] = useState(0); // 0: Preview, 1: JSON

  const canGenerate = !!shop && !!productId;
  const canApply = !!(result && result.productId && result.seo);

  useEffect(() => {
    (async () => {
      try {
        const q = shop ? `?shop=${encodeURIComponent(shop)}` : '';
        const r = await fetch(`/plans/me${q}`);
        const j = await r.json();
        setPlan(j);
        if (j?.modelsSuggested?.length) setModel(j.modelsSuggested[0]);
      } catch (e) {
        setMsg(`Failed to load plan: ${e.message}`);
      }
    })();
  }, []); // once

  async function onGenerate() {
    setBusy(true); setMsg(''); setResult(null);
    try {
      const body = { shop, productId: toGID(productId), model, language };
      const rsp = await fetch('/seo/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await rsp.json();
      if (!rsp.ok) throw new Error(j?.error || 'Generate failed');
      setResult(j);
      setTabIndex(0);
      setMsg('Generated ✓');
    } catch (e) {
      setMsg(`Generate error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function onApply() {
    if (!canApply) return;
    setBusy(true); setMsg('');
    try {
      const rsp = await fetch('/seo/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop,
          productId: result.productId,
          seo: result.seo,
          options: {
            updateTitle: true, updateBody: true, updateSeo: true,
            updateBullets: true, updateFaq: true, updateAlt: false, dryRun: false,
          },
        }),
      });
      const j = await rsp.json();
      if (!rsp.ok || j?.ok === false) {
        const err = j?.errors?.join('; ') || j?.error || 'Apply failed';
        throw new Error(err);
      }
      setMsg('Applied ✓');
    } catch (e) {
      setMsg(`Apply error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

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
              <Select
                label="Language"
                options={LANGS.map(l => ({label:l.toUpperCase(), value:l}))}
                value={language}
                onChange={setLanguage}
              />
            </BlockStack>

            <BlockStack gap="200" inlineAlign="end">
              <ButtonGroup>
                <Button onClick={onGenerate} disabled={!canGenerate || busy} variant="primary">Generate</Button>
                <Button onClick={onApply} disabled={!canApply || busy}>Apply to product</Button>
              </ButtonGroup>
              {!!msg && (
                <Text as="p" tone={msg.toLowerCase().includes('error') ? 'critical' : 'success'}>
                  {msg}
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
