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
import Shop from '../db/Shop.js';

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

    // Get subscription and language limit
    const Subscription = (await import('../db/Subscription.js')).default;
    const { getPlanConfig } = await import('../plans.js');
    
    const subscription = await Subscription.findOne({ shop: shopDomain });
    const planKey = subscription?.plan || 'starter';
    const planConfig = getPlanConfig(planKey);
    const languageLimit = planConfig?.languageLimit || 1;

    // Prepare products for queue
    const productsToProcess = products.map(p => ({
      productId: toGID(String(p.productId)),
      title: p.title || null,
      languages: p.languages || [],
      existingLanguages: p.existingLanguages || [],
      model
    }));

    // OPTIMIZED: Generate function - uses DIRECT function call instead of HTTP fetch
    const generateFn = async (productData) => {
      // Case-insensitive comparison for language codes
      const existingLangsLower = (productData.existingLanguages || []).map(l => l.toLowerCase());
      let languagesToGenerate = productData.languages.filter(
        lang => !existingLangsLower.includes(lang.toLowerCase())
      );

      // DOUBLE-CHECK: Query Shopify for existing SEO metafields to avoid false "failed" status
      // This handles cases where frontend cache is stale
      if (languagesToGenerate.length > 0) {
        try {
          const { shopGraphQL } = await import('./seoController.js');
          const metafieldsQuery = `
            query GetProductMetafields($id: ID!) {
              product(id: $id) {
                metafields(first: 20, namespace: "seo_ai") {
                  edges {
                    node {
                      key
                      value
                    }
                  }
                }
              }
            }
          `;
          const mockReqForCheck = { shopDomain, headers: {}, query: { shop: shopDomain } };
          const metafieldsResult = await shopGraphQL(mockReqForCheck, shopDomain, metafieldsQuery, { id: productData.productId });
          
          // Extract languages that already have SEO metafields
          const existingMetafieldLangs = [];
          const allKeys = [];
          if (metafieldsResult?.product?.metafields?.edges) {
            for (const edge of metafieldsResult.product.metafields.edges) {
              const key = edge.node.key;
              allKeys.push(key);
              // Check for seo__ prefix (language-specific SEO data)
              if (key?.startsWith('seo__')) {
                const lang = key.replace('seo__', '').toLowerCase();
                if (lang && !existingMetafieldLangs.includes(lang)) {
                  existingMetafieldLangs.push(lang);
                }
              }
            }
          }
          
          // Debug: log all metafield keys found
          if (allKeys.length > 0) {
            console.log(`[SEO-GENERATE] Product ${productData.productId}: all metafield keys: [${allKeys.join(', ')}]`);
          }
          
          console.log(`[SEO-GENERATE] Product ${productData.productId}: found ${existingMetafieldLangs.length} existing langs: [${existingMetafieldLangs.join(', ')}], requested: [${languagesToGenerate.join(', ')}]`);
          
          // Re-filter: only generate for languages that don't have metafields
          const originalCount = languagesToGenerate.length;
          languagesToGenerate = languagesToGenerate.filter(
            lang => !existingMetafieldLangs.includes(lang.toLowerCase())
          );
          
          if (originalCount !== languagesToGenerate.length) {
            console.log(`[SEO-GENERATE] Product ${productData.productId}: filtered from ${originalCount} to ${languagesToGenerate.length} languages`);
          }
        } catch (checkErr) {
          // If check fails, continue with original list (will fail properly if already exists)
          console.error('[SEO-GENERATE] Metafield check failed:', checkErr.message);
        }
      }

      if (languagesToGenerate.length === 0) {
        return { success: true, skipped: true, reason: 'Already optimized for selected languages' };
      }
      
      // CHECK LANGUAGE LIMIT: existing + new languages must not exceed plan limit
      const totalLanguagesAfterOptimization = productData.existingLanguages.length + languagesToGenerate.length;
      if (totalLanguagesAfterOptimization > languageLimit) {
        return { 
          success: false, 
          error: `Language limit exceeded: ${totalLanguagesAfterOptimization} languages would exceed your plan limit of ${languageLimit}. Please upgrade your plan or remove existing languages first.`
        };
      }

      // Import generateSEOForLanguage directly
      const { generateSEOForLanguage } = await import('./seoController.js');
      
      // Create a mock req object for the function
      const mockReq = {
        shopDomain: shopDomain,
        headers: {},
        query: { shop: shopDomain }
      };

      const results = [];
      for (const lang of languagesToGenerate) {
        try {
          // Direct function call - no HTTP overhead!
          const result = await generateSEOForLanguage(
            mockReq,
            shopDomain,
            productData.productId,
            productData.model,
            lang
          );
          
          if (result?.seo) {
            results.push({ language: lang, seo: result.seo, quality: result.quality });
          } else {
            results.push({ language: lang, error: 'Generate returned no SEO data' });
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
    
    // Also get progress from DB for accurate time estimates
    const shopDoc = await Shop.findOne({ shop }).select('seoJobStatus.progress').lean();
    if (shopDoc?.seoJobStatus?.progress) {
      status.progress = shopDoc.seoJobStatus.progress;
      
      // Enhanced message with progress
      if (status.inProgress && status.progress?.current && status.progress?.total) {
        const remainingMin = Math.ceil((status.progress.remainingSeconds || 0) / 60);
        status.message = `Processing ${status.progress.current}/${status.progress.total} products`;
        if (remainingMin > 0) {
          status.message += ` • ~${remainingMin} min remaining`;
        }
      }
    }
    
    return res.json(status);
  } catch (err) {
    console.error('GET /api/seo/job-status error:', err);
    return res.status(500).json({ error: 'Failed to get job status' });
  }
});

// POST /api/seo/job-cancel
// Cancel a running SEO job
router.post('/job-cancel', validateRequest(), async (req, res) => {
  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    return res.status(400).json({ error: 'Shop not provided' });
  }

  try {
    // Set cancelled flag and stop the job
    await Shop.findOneAndUpdate(
      { shop },
      { 
        $set: { 
          'seoJobStatus.cancelled': true,
          'seoJobStatus.inProgress': false,
          'seoJobStatus.status': 'cancelled',
          'seoJobStatus.message': 'Cancelled by user',
          'seoJobStatus.cancelledAt': new Date(),
          'seoJobStatus.updatedAt': new Date()
        } 
      }
    );
    
    return res.json({ success: true, message: 'Job cancelled' });
  } catch (err) {
    console.error('POST /api/seo/job-cancel error:', err);
    return res.status(500).json({ error: 'Failed to cancel job' });
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

