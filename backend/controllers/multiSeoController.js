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
import mongoose from 'mongoose';
import { validateRequest } from '../middleware/shopifyAuth.js';

const router = Router();

const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

// Normalize either numeric id -> GID, or pass-through a GID
function toGID(productId) {
  if (/^\d+$/.test(productId)) return `gid://shopify/Product/${productId}`;
  return productId;
}

// POST /api/seo/generate-multi
// Body: { shop, productId, model, languages: ['en','it','el', ...] }
router.post('/generate-multi', validateRequest(), async (req, res) => {
  console.log('[MULTI-SEO/HANDLER]', req.method, req.originalUrl, {
    queryShop: req.query?.shop,
    bodyShop: req.body?.shop,
    sessionShop: res.locals?.shopify?.session?.shop,
  });

  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[MULTI-SEO/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  // Тук логни и от къде четеш Admin API токена:
  const tokenSource = 'db|kv|session'; // актуализирай според твоя сторидж
  console.log('[MULTI-SEO/HANDLER] Resolving Admin token', { shop, tokenSource });

  try {
    console.log('[MULTI-SEO/DEBUG] ===== REQUEST DEBUG START =====');
    console.log('[MULTI-SEO/DEBUG] req.body:', JSON.stringify(req.body, null, 2));
    console.log('[MULTI-SEO/DEBUG] req.query:', JSON.stringify(req.query, null, 2));
    console.log('[MULTI-SEO/DEBUG] req.shopDomain:', req.shopDomain);
    console.log('[MULTI-SEO/DEBUG] res.locals.shopify:', res.locals?.shopify);
    
    const shopDomain = req.shopDomain;
    const { productId: pid, model, languages } = req.body || {};
    
    console.log('[MULTI-SEO/DEBUG] Extracted values:');
    console.log('[MULTI-SEO/DEBUG] - shopDomain:', shopDomain);
    console.log('[MULTI-SEO/DEBUG] - productId (pid):', pid);
    console.log('[MULTI-SEO/DEBUG] - model:', model);
    console.log('[MULTI-SEO/DEBUG] - languages:', languages);
    console.log('[MULTI-SEO/DEBUG] - languages is array:', Array.isArray(languages));
    console.log('[MULTI-SEO/DEBUG] - languages length:', languages?.length);
    
    if (!pid || !model || !Array.isArray(languages) || languages.length === 0) {
      console.log('[MULTI-SEO/DEBUG] ===== VALIDATION FAILED =====');
      console.log('[MULTI-SEO/DEBUG] Missing values check:');
      console.log('[MULTI-SEO/DEBUG] - pid exists:', !!pid);
      console.log('[MULTI-SEO/DEBUG] - model exists:', !!model);
      console.log('[MULTI-SEO/DEBUG] - languages is array:', Array.isArray(languages));
      console.log('[MULTI-SEO/DEBUG] - languages has length:', languages?.length > 0);
      return res.status(400).json({ error: 'Missing productId, model or languages[]' });
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
router.post('/apply-multi', validateRequest(), async (req, res) => {
  console.log('[MULTI-SEO/HANDLER]', req.method, req.originalUrl, {
    queryShop: req.query?.shop,
    bodyShop: req.body?.shop,
    sessionShop: res.locals?.shopify?.session?.shop,
  });
  console.log('[MULTI-SEO/APPLY] Full req.body:', JSON.stringify(req.body, null, 2));

  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[MULTI-SEO/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  // Тук логни и от къде четеш Admin API токена:
  const tokenSource = 'db|kv|session'; // актуализирай според твоя сторидж
  console.log('[MULTI-SEO/HANDLER] Resolving Admin token', { shop, tokenSource });

  try {
    const shop = req.shopDomain;
    console.log('[MULTI-SEO/APPLY] req.shopDomain:', shop);
    console.log('[MULTI-SEO/APPLY] req.body:', req.body);
    
    const { productId: pid, results, options = {} } = req.body || {};
    console.log('[MULTI-SEO/APPLY] Extracted:', { pid, results: results?.length, options });
    
    if (!pid || !Array.isArray(results) || results.length === 0) {
      console.log('[MULTI-SEO/APPLY] Validation failed:', { pid: !!pid, results: Array.isArray(results), length: results?.length });
      return res.status(400).json({ error: 'Missing productId or results[]' });
    }
    const productId = toGID(String(pid));

    const errors = [];
    const appliedLanguages = [];
    
    // Изпълняваме всички /seo/apply заявки последователно с await
    // за да се уверим че всички MongoDB updates са завършени
    for (const r of results) {
      if (!r || !r.seo) {
        errors.push(`Missing seo for language ${r?.language || '?'}`);
        continue;
      }
      try {
        console.log(`🔍 [APPLY-MULTI] Processing language ${r.language} with SEO data:`, JSON.stringify(r.seo, null, 2));
        console.log(`🔍 [APPLY-MULTI] Raw r.seo.title for ${r.language}:`, r.seo.title);
        console.log(`🔍 [APPLY-MULTI] Raw r.seo.metaDescription for ${r.language}:`, r.seo.metaDescription);
        console.log(`🔍 [APPLY-MULTI] Raw r.seo.bodyHtml for ${r.language}:`, r.seo.bodyHtml);
        
        // Create a complete SEO object with all required fields
        const completeSeo = {
          title: r.seo.title || 'Product',
          metaDescription: r.seo.metaDescription || '',
          slug: r.seo.slug || 'product',
          bodyHtml: r.seo.bodyHtml || '<p>Product</p>',
          bullets: r.seo.bullets || [],  // Keep the AI-generated bullets
          faq: r.seo.faq || [],          // Keep the AI-generated FAQ
          imageAlt: r.seo.imageAlt || [],
          jsonLd: r.seo.jsonLd || {}
        };
        
        console.log(`🔍 [APPLY-MULTI] Complete SEO object for ${r.language}:`, JSON.stringify(completeSeo, null, 2));
        
        // Import the apply function directly instead of making HTTP request
        const { applySEOForLanguage } = await import('./seoController.js');
        const result = await applySEOForLanguage(req, shop, productId, completeSeo, r.language, options);
        console.log(`[MULTI-SEO] Apply result for ${r.language}:`, result?.ok ? 'SUCCESS' : 'FAILED', result);
        if (!result?.ok) {
          const err = result?.errors?.join('; ') || result?.error || 'Apply failed';
          errors.push(`[${r.language}] ${err}`);
        } else {
          // Добавяме успешно приложените езици
          appliedLanguages.push(r.language);
        }
      } catch (e) {
        errors.push(`[${r.language}] ${e.message || 'Apply exception'}`);
      }
    }
    
    // Add a small delay to ensure all MongoDB operations are completed
    await new Promise(resolve => setTimeout(resolve, 100));

    return res.json({
      ok: errors.length === 0,
      errors,
      appliedLanguages,
      productId
    });
  } catch (err) {
    console.error('POST /api/seo/apply-multi error:', err);
    return res.status(500).json({ error: 'Failed to apply SEO for multiple languages' });
  }
});

// POST /api/seo/delete-multi
router.post('/delete-multi', async (req, res) => {
  try {
    const { shop, productId: pid, languages } = req.body || {};
    if (!shop || !pid || !Array.isArray(languages) || languages.length === 0) {
      return res.status(400).json({ error: 'Missing shop, productId or languages[]' });
    }
    const productId = toGID(String(pid));

    const errors = [];
    const deleted = [];

    for (const lang of languages) {
      try {
        // Извикваме съществуващия DELETE endpoint
        const url = `${APP_URL}/seo/delete?shop=${encodeURIComponent(shop)}`;
        const rsp = await fetch(url, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Cookie: req.headers.cookie || '', // Важно за автентикация!
          },
          body: JSON.stringify({ shop, productId, language: lang }),
        });
        
        const text = await rsp.text();
        const json = JSON.parse(text);
        
        if (!rsp.ok || !json.ok) {
          errors.push(`[${lang}] ${json.error || `Delete failed (${rsp.status})`}`);
        } else {
          deleted.push(lang);
          console.log('[DELETE-MULTI] Languages actually deleted:', deleted);
          console.log('[DELETE-MULTI] Delete response from backend:', json);
        }
      } catch (e) {
        errors.push(`[${lang}] ${e.message}`);
      }
    }
    
    return res.json({
      ok: errors.length === 0,
      deleted,
      errors,
    });
  } catch (err) {
    console.error('[DELETE-MULTI] Error:', err);
    return res.status(500).json({ error: 'Failed to delete SEO' });
  }
});

export default router;

