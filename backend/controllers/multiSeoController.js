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
import { verifyRequest } from '../middleware/verifyRequest.js';

const router = Router();

const APP_URL = (process.env.SHOPIFY_APP_URL || '').replace(/\/+$/, '');

// Normalize either numeric id -> GID, or pass-through a GID
function toGID(productId) {
  if (/^\d+$/.test(productId)) return `gid://shopify/Product/${productId}`;
  return productId;
}

// POST /api/seo/generate-multi
// Body: { shop, productId, model, languages: ['en','it','el', ...] }
router.post('/generate-multi', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { productId: pid, model, languages } = req.body || {};
    if (!pid || !model || !Array.isArray(languages) || languages.length === 0) {
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
router.post('/apply-multi', verifyRequest, async (req, res) => {
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
// Body: { shop, productId, languages: ['en','bg',...] }
router.post('/delete-multi', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { productId: pid, languages } = req.body || {};
    console.log('[DELETE-MULTI] Request:', { shop, productId: pid, languages });
    
    if (!shop || !pid || !Array.isArray(languages) || languages.length === 0) {
      return res.status(400).json({ error: 'Missing shop, productId or languages[]' });
    }
    const productId = toGID(String(pid));

    const errors = [];
    const deletedLanguages = [];
    
    for (const lang of languages) {
      try {
        // Delegate to single delete endpoint
        const url = `${APP_URL}/seo/delete`;
        const rsp = await fetch(url, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Cookie: req.headers.cookie || '',
          },
          body: JSON.stringify({ shop, productId, language: lang }),
        });
        
        const text = await rsp.text();
        let json;
        try { 
          json = JSON.parse(text); 
        } catch { 
          throw new Error(text || 'Non-JSON response'); 
        }
        
        if (!rsp.ok || json?.ok === false) {
          const err = json?.errors?.join('; ') || json?.error || `Delete failed (${rsp.status})`;
          errors.push(`[${lang}] ${err}`);
        } else {
          deletedLanguages.push(lang);
        }
      } catch (e) {
        errors.push(`[${lang}] ${e.message || 'Delete exception'}`);
      }
    }

    // Update MongoDB to reflect the deletions
    if (deletedLanguages.length > 0) {
      console.log('[DELETE-MULTI] Successfully deleted languages:', deletedLanguages);
      
      try {
        // Import Product model
        const Product = (await import('../db/Product.js')).default;
        
        // Extract numeric ID
        const numericId = parseInt(productId.replace('gid://shopify/Product/', ''));
        
        console.log('[DELETE-MULTI] Updating MongoDB for product:', numericId);
        
        if (!isNaN(numericId)) {
          // Get current product
          const product = await Product.findOne({ shop, productId: numericId });
          
          if (product) {
            // Update languages - remove deleted ones
            const remainingLanguages = (product.seoStatus?.languages || [])
              .filter(lang => !deletedLanguages.includes(lang.code));
            
            // Update product
            const updateResult = await Product.updateOne(
              { shop, productId: numericId },
              {
                $set: {
                  'seoStatus.optimized': remainingLanguages.length > 0,
                  'seoStatus.languages': remainingLanguages
                }
              }
            );
            
            console.log('[DELETE-MULTI] MongoDB update result:', updateResult);
            
            // Check remaining languages
            const updatedProduct = await Product.findOne({ shop, productId: numericId });
            const remainingOptimized = updatedProduct?.seoStatus?.languages?.filter(l => l.optimized) || [];
            
            console.log('[DELETE-MULTI] Remaining optimized languages:', remainingOptimized.map(l => l.code));
            
            console.log(`[DELETE-MULTI] Updated Product collection for ${numericId}`);
          }
        }
      } catch (dbErr) {
        console.error('[DELETE-MULTI] Product update error:', dbErr);
        errors.push(`Database update failed: ${dbErr.message}`);
      }
    }

    return res.json({
      ok: errors.length === 0,
      errors,
      deletedLanguages,
    });
  } catch (err) {
    console.error('POST /api/seo/delete-multi error:', err);
    return res.status(500).json({ error: 'Failed to delete SEO for multiple languages' });
  }
});

export default router;
