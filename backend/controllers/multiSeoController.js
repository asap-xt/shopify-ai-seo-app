// backend/controllers/multiSeoController.js
// Router: mounted at /api/seo
// Route(s):
//   POST /api/seo/generate-multi
//   POST /api/seo/apply-multi
//
// Implements "multi-language" flow by delegating to existing single endpoints
//   /seo/generate  and  /seo/apply
// We forward client cookies to preserve the embedded admin session for any Admin GraphQL calls.

import { Router } from 'express';

const router = Router();

const APP_URL = (process.env.SHOPIFY_APP_URL || '').replace(/\/+$/, '');

// Normalize either numeric id -> GID, or pass-through a GID
function toGID(productId) {
  if (/^\d+$/.test(productId)) return `gid://shopify/Product/${productId}`;
  return productId;
}

// POST /api/seo/generate-multi
// Body: { shop, productId, model, languages: ['en','it','el', ...] }
router.post('/generate-multi', async (req, res) => {
  try {
    const { shop, productId: pid, model, languages } = req.body || {};
    if (!shop || !pid || !model || !Array.isArray(languages) || languages.length === 0) {
      return res.status(400).json({ error: 'Missing shop, productId, model or languages[]' });
    }
    const productId = toGID(String(pid));

    const results = [];
    for (const langRaw of languages) {
      const lang = String(langRaw || '').trim();
      if (!lang) {
        results.push({ language: langRaw, error: 'Invalid language' });
        continue;
      }
      try {
        // Delegate to existing single endpoint, forwarding cookies for session continuity
        const url = `${APP_URL}/seo/generate?shop=${encodeURIComponent(shop)}`;
        const rsp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: req.headers.cookie || '',
          },
          body: JSON.stringify({ shop, productId, model, language: lang }),
        });
        const text = await rsp.text();
        let json;
        try { json = JSON.parse(text); } catch { throw new Error(text || 'Non-JSON response'); }
        if (!rsp.ok) {
          results.push({ language: lang, error: json?.error || `Generate failed (${rsp.status})` });
        } else {
          results.push({ language: lang, seo: json.seo, quality: json.quality });
        }
      } catch (e) {
        results.push({ language: lang, error: e.message || 'Generate exception' });
      }
    }

    return res.json({
      language: 'all',
      productId,
      results,
    });
  } catch (err) {
    console.error('POST /api/seo/generate-multi error:', err);
    return res.status(500).json({ error: 'Failed to generate SEO for multiple languages' });
  }
});

// POST /api/seo/apply-multi
// Body: { shop, productId, results: [{ language, seo }...], options }
router.post('/apply-multi', async (req, res) => {
  try {
    const { shop, productId: pid, results, options = {} } = req.body || {};
    if (!shop || !pid || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'Missing shop, productId or results[]' });
    }
    const productId = toGID(String(pid));

    const errors = [];
    
    // Изпълняваме всички /seo/apply заявки последователно с await
    // за да се уверим че всички MongoDB updates са завършени
    for (const r of results) {
      if (!r || !r.seo) {
        errors.push(`Missing seo for language ${r?.language || '?'}`);
        continue;
      }
      try {
        const url = `${APP_URL}/seo/apply?shop=${encodeURIComponent(shop)}`;
        const rsp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: req.headers.cookie || '',
          },
          body: JSON.stringify({ 
            shop, 
            productId, 
            language: r.language,
            seo: r.seo, 
            options 
          })
        });
        const text = await rsp.text();
        let json;
        try { json = JSON.parse(text); } catch { throw new Error(text || 'Non-JSON response'); }
        console.log(`[MULTI-SEO] Apply result for ${r.language}:`, json?.ok ? 'SUCCESS' : 'FAILED', json);
        if (!rsp.ok || json?.ok === false) {
          const err = json?.errors?.join('; ') || json?.error || `Apply failed (${rsp.status})`;
          errors.push(`[${r.language}] ${err}`);
        }
      } catch (e) {
        errors.push(`[${r.language}] ${e.message || 'Apply exception'}`);
      }
    }

    return res.json({
      ok: errors.length === 0,
      errors,
    });
  } catch (err) {
    console.error('POST /api/seo/apply-multi error:', err);
    return res.status(500).json({ error: 'Failed to apply SEO for multiple languages' });
  }
});

export default router;
