import React, { useEffect, useMemo, useState } from 'react';

/**
 * Minimal, resilient UI:
 * - Loads plan from /plans/me (suggested models)
 * - Generate -> shows Preview/JSON
 * - Apply -> POST /seo/apply with the JSON from generate
 * - No App Bridge token required (works even if ?host is missing)
 * - All errors are surfaced onscreen (no silent crashes)
 */

const jsonPretty = (v) => JSON.stringify(v, null, 2);

function getQS(name, def = '') {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get(name) || def;
  } catch {
    return def;
  }
}

function toGID(idOrGid) {
  const s = String(idOrGid || '').trim();
  if (!s) return '';
  if (s.startsWith('gid://')) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return s;
}

export default function App() {
  // State
  const [shop, setShop] = useState(() => getQS('shop', ''));
  const [productId, setProductId] = useState('');
  const [model, setModel] = useState('anthropic/claude-3.5-sonnet');
  const [language, setLanguage] = useState('en');

  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('preview'); // 'preview' | 'json'

  const canGenerate = !!shop && !!productId;
  const canApply = !!(result && result.productId && result.seo);

  // Load plan (modelsSuggested)
  useEffect(() => {
    (async () => {
      try {
        const q = shop ? `?shop=${encodeURIComponent(shop)}` : '';
        const r = await fetch(`/plans/me${q}`);
        const j = await r.json();
        setPlan(j);
        if (j?.modelsSuggested?.length) {
          setModel(j.modelsSuggested[0]);
        }
      } catch (e) {
        setMsg(`Failed to load plan: ${e.message}`);
      }
    })();
  }, []); // once

  async function onGenerate() {
    setBusy(true);
    setMsg('');
    setResult(null);
    try {
      const body = {
        shop,
        productId: toGID(productId),
        model,
        language,
      };
      const rsp = await fetch('/seo/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await rsp.json();
      if (!rsp.ok) {
        const err = j?.error || 'Generate failed';
        throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
      }
      setResult(j);
      setTab('preview');
      setMsg('Generate ✓');
    } catch (e) {
      setMsg(`Generate error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function onApply() {
    if (!canApply) return;
    setBusy(true);
    setMsg('');
    try {
      const rsp = await fetch('/seo/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop,
          productId: result.productId,
          seo: result.seo,
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

  // Simple, robust layout (no external UI libs — prevents blank screen on missing deps)
  return (
    <div style={styles.app}>
      {/* Lightweight "nav/header" so page never looks empty */}
      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ margin: 0 }}>AI SEO (v2)</h1>
          <small style={{ color: '#666' }}>
            {plan ? `${plan.plan} • ${shop || '(no shop)'}` : 'Loading plan…'}
          </small>
        </div>
        <nav style={styles.nav}>
          <a href="/dashboard">Dashboard</a>
          <a href="/ai-seo" aria-current="page">AI SEO</a>
          <a href="/billing">Billing</a>
          <a href="/settings">Settings</a>
        </nav>
      </header>

      {/* Controls */}
      <section style={styles.grid}>
        <label>Shop</label>
        <input
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          placeholder="asapxt-teststore.myshopify.com"
        />

        <label>Product ID</label>
        <input
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          placeholder="14963354272076 or gid://shopify/Product/..."
        />

        <label>Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {(plan?.modelsSuggested || [model]).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <label>Language</label>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {['en', 'de', 'es', 'fr', 'bg'].map((l) => (
            <option key={l} value={l}>{l.toUpperCase()}</option>
          ))}
        </select>
      </section>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <button onClick={onGenerate} disabled={!canGenerate || busy}>Generate</button>
        <button onClick={onApply} disabled={!canApply || busy}>Apply to product</button>
        {busy && <span>Working…</span>}
        {!!msg && (
          <span style={{ color: msg.toLowerCase().includes('error') ? '#a40000' : '#0a7a0a' }}>
            {msg}
          </span>
        )}
      </div>

      {/* Output */}
      {result && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onClick={() => setTab('preview')} disabled={tab === 'preview'}>Preview</button>
            <button onClick={() => setTab('json')} disabled={tab === 'json'}>JSON</button>
          </div>

          {tab === 'preview' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16 }}>
              <div style={styles.card}>
                <h2 style={{ marginTop: 0 }}>{result.seo.title}</h2>
                <p><em>{result.seo.metaDescription}</em></p>
                <div dangerouslySetInnerHTML={{ __html: result.seo.bodyHtml }} />
                {!!result.seo.bullets?.length && (
                  <>
                    <h3>Bullets</h3>
                    <ul>
                      {result.seo.bullets.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  </>
                )}
                {!!result.seo.faq?.length && (
                  <>
                    <h3>FAQ</h3>
                    <dl>
                      {result.seo.faq.map((f, i) => (
                        <div key={i} style={{ marginBottom: 8 }}>
                          <dt><strong>{f.q}</strong></dt>
                          <dd>{f.a}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
              </div>

              <pre style={styles.cardPre}>
                {jsonPretty({
                  productId: result.productId,
                  slug: result.seo.slug,
                  imageAlt: result.seo.imageAlt || [],
                  quality: result.quality || {},
                })}
              </pre>
            </div>
          ) : (
            <pre style={styles.cardPre}>{jsonPretty(result)}</pre>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  app: {
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    padding: 16,
    color: '#111',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'end',
    marginBottom: 12,
  },
  nav: {
    display: 'flex',
    gap: 12,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '180px 1fr',
    gap: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  card: {
    border: '1px solid #eee',
    borderRadius: 8,
    padding: 12,
    background: '#fff',
  },
  cardPre: {
    border: '1px solid #eee',
    borderRadius: 8,
    padding: 12,
    background: '#fff',
    overflow: 'auto',
  },
};
