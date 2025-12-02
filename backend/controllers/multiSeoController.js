// backend/controllers/multiSeoController.js
// Router: mounted at /api/seo
// Route(s):
//   POST /api/seo/generate-multi (single product, multiple languages)
//   POST /api/seo/apply-multi (single product, multiple languages)
//   POST /api/seo/generate-apply-batch (background Generate + Apply for multiple products)
//   GET /api/seo/job-status (get background job status)
//   POST /api/seo/delete-multi (delete SEO for multiple languages)
//
// Implements "multi-language" flow by delegating to existing single endpoints
//   /seo/generate  and  /seo/apply
// We forward client cookies to preserve the embedded admin session for any Admin GraphQL calls.

import { Router } from 'express';
import mongoose from 'mongoose';
import { validateRequest } from '../middleware/shopifyAuth.js';
import seoJobQueue from '../services/seoJobQueue.js';

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
  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[MULTI-SEO/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  try {
    const shopDomain = req.shopDomain;
    const { productId: pid, model, languages } = req.body || {};
    
    if (!pid || !model || !model.trim() || !Array.isArray(languages) || languages.length === 0) {
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
  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[MULTI-SEO/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  try {
    const shop = req.shopDomain;
    const { productId: pid, results, options = {} } = req.body || {};
    
    if (!pid || !Array.isArray(results) || results.length === 0) {
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
        // 🚨 IMPORTANT: Do NOT provide fallback values like 'Product' or '<p>Product</p>'
        // These fallback values would overwrite the real product title/description!
        // Only pass through the actual SEO data that was generated
        const completeSeo = {
          ...r.seo  // Pass through all SEO data as-is, NO fallbacks
        };
        
        // Import the apply function directly instead of making HTTP request
        const { applySEOForLanguage } = await import('./seoController.js');
        const result = await applySEOForLanguage(req, shop, productId, completeSeo, r.language, options);
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

// POST /api/seo/generate-apply-batch
// Background processing for combined Generate + Apply
// Body: { shop, products: [{ productId, languages, existingLanguages }], model }
router.post('/generate-apply-batch', validateRequest(), async (req, res) => {
  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    return res.status(400).json({ error: 'Shop not provided' });
  }

  try {
    const shopDomain = req.shopDomain || shop;
    const { products, model } = req.body || {};
    
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Missing products array' });
    }

    if (!model) {
      return res.status(400).json({ error: 'Missing model' });
    }

    // Prepare products for queue
    const productsToProcess = products.map(p => ({
      productId: toGID(String(p.productId)),
      languages: p.languages || [],
      existingLanguages: p.existingLanguages || [],
      model
    }));

    // Generate function - calls /seo/generate for each language
    const generateFn = async (productData) => {
      const languagesToGenerate = productData.languages.filter(
        lang => !productData.existingLanguages.includes(lang)
      );

      if (languagesToGenerate.length === 0) {
        return { success: true, skipped: true, message: 'All languages already optimized' };
      }

      const results = [];
      for (const lang of languagesToGenerate) {
        try {
          const url = `${APP_URL}/seo/generate?shop=${encodeURIComponent(shopDomain)}`;
          const rsp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              shop: shopDomain, 
              productId: productData.productId, 
              model: productData.model, 
              language: lang 
            }),
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

      const successfulResults = results.filter(r => r.seo);
      if (successfulResults.length === 0) {
        return { success: false, error: 'All languages failed to generate' };
      }

      return { success: true, data: { results: successfulResults } };
    };

    // Apply function - calls applySEOForLanguage for each result
    const applyFn = async (productData, generateData) => {
      const { applySEOForLanguage } = await import('./seoController.js');
      
      for (const r of generateData.results) {
        if (!r || !r.seo) continue;
        
        const result = await applySEOForLanguage(
          null,
          shopDomain,
          productData.productId,
          r.seo,
          r.language,
          { updateTitle: true, updateBody: true, updateSeo: true, updateBullets: true, updateFaq: true }
        );
        
        if (!result?.ok) {
          throw new Error(result?.errors?.join('; ') || 'Apply failed');
        }
      }
    };

    // Add job to queue
    const queueResult = await seoJobQueue.addJob(shopDomain, productsToProcess, generateFn, applyFn);

    return res.json({
      queued: queueResult.queued,
      message: queueResult.message || 'Job added to queue',
      jobId: queueResult.jobId,
      totalProducts: productsToProcess.length
    });

  } catch (err) {
    console.error('POST /api/seo/generate-apply-batch error:', err);
    return res.status(500).json({ error: 'Failed to queue SEO job' });
  }
});

// GET /api/seo/job-status
// Get status of background SEO job (Generate + Apply combined)
router.get('/job-status', validateRequest(), async (req, res) => {
  const shop =
    req.query?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    return res.status(400).json({ error: 'Shop not provided' });
  }

  try {
    const status = await seoJobQueue.getJobStatus(shop);
    return res.json(status);
  } catch (err) {
    console.error('GET /api/seo/job-status error:', err);
    return res.status(500).json({ error: 'Failed to get job status' });
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

