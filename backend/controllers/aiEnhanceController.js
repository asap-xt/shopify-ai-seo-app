// backend/controllers/aiEnhanceController.js
import express from 'express';
import { requireShop, shopGraphQL } from './seoController.js';
import { validateRequest } from '../middleware/shopifyAuth.js';
import { verifyRequest } from '../middleware/verifyRequest.js';
import Subscription from '../db/Subscription.js';
import TokenBalance from '../db/TokenBalance.js';
import Product from '../db/Product.js';
import { validateAIResponse, createFactualPrompt } from '../utils/aiValidator.js';
import { getCachedStoreContext } from '../utils/storeContextBuilder.js';
import { 
  calculateFeatureCost, 
  requiresTokens, 
  isBlockedInTrial,
  estimateTokensWithMargin,
  calculateActualTokens
} from '../billing/tokenConfig.js';
import { getPlanConfig } from '../plans.js';

const router = express.Router();

// POST /ai-enhance/check-eligibility
router.post('/check-eligibility', validateRequest(), async (req, res) => {
  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[AI-ENHANCE/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  try {
    const shop = req.shopDomain;
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    // CHANGED: Always return eligible=true
    // Token checking will happen in actual enhancement endpoints
    // This endpoint now only returns plan info for display purposes
    res.json({ 
      eligible: true, 
      plan: planKey,
      message: 'AI enhancement available with tokens'
    });
  } catch (error) {
    console.error('🔍 [CHECK-ELIGIBILITY] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Copy ONLY the OpenRouter connection from seoController
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
import aiQueue from '../services/aiQueue.js'; // PHASE 1 OPTIMIZATION

/**
 * OpenRouter Chat wrapper - NOW WITH RATE LIMITING
 * Priority: NORMAL (product enhancement, not time-critical)
 */
async function openrouterChat(model, messages, response_format_json = true) {
  
  if (!OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key missing');
  }
  
  // Wrap in NORMAL PRIORITY queue (product enhancement)
  return aiQueue.add(async () => {
    const rsp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || process.env.APP_URL || 'https://indexaize.com',
        'X-Title': 'indexAIze - Unlock AI Search',
      },
      body: JSON.stringify({
        model,
        response_format: response_format_json ? { type: 'json_object' } : undefined,
        messages,
        temperature: 0.4,
      }),
    });
    
    if (!rsp.ok) {
      const text = await rsp.text().catch(() => '');
      console.error('🤖 [AI-ENHANCE] OpenRouter error:', rsp.status, text);
      throw new Error(`OpenRouter ${rsp.status}: ${text || rsp.statusText}`);
    }
    
    const j = await rsp.json();
    const content = j?.choices?.[0]?.message?.content || '';
    
    return { content, usage: j?.usage || {} };
  }, { model, messageCount: messages.length });
}

/**
 * Generate AI alt text for featured image
 * Only called if Shopify image has no alt text
 * Returns: { altText: string, usage: object }
 */
async function generateImageAltText(data) {
  const { product, language, model } = data;
  
  const productTitle = product.title || '';
  const productType = product.productType || 'product';
  const vendor = product.vendor || '';
  const description = product.description || '';
  
  const messages = [
    {
      role: 'system',
      content: `You are an AI assistant that generates SEO-optimized alt text for e-commerce product images.
Language: ${language}
Guidelines:
- Create a concise, descriptive alt text (max 125 characters)
- Describe what the product looks like based on the product information
- Include relevant keywords naturally
- Do NOT start with "image of" or "photo of"
- Keep the same language as specified
- Return ONLY a JSON object with key "altText" containing the alt text string`
    },
    {
      role: 'user',
      content: JSON.stringify({
        productTitle,
        productType,
        vendor,
        description: description.slice(0, 500)  // Limit description length
      })
    }
  ];
  
  try {
    const { content, usage } = await openrouterChat(model, messages, true);
    
    let parsed;
    try {
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```(?:json)?\s*\n?/, '');
        cleanContent = cleanContent.replace(/\n?```\s*$/, '');
      }
      parsed = JSON.parse(cleanContent);
    } catch {
      console.error('[AI-ENHANCE] Failed to parse alt text response:', content.substring(0, 100));
      return { altText: null, usage };
    }
    
    // Validate and truncate alt text
    let altText = parsed.altText || null;
    if (altText && altText.length > 125) {
      altText = altText.slice(0, 122) + '...';
    }
    
    return { altText, usage };
  } catch (error) {
    console.error('[AI-ENHANCE] Error generating alt text:', error.message);
    return { altText: null, usage: null };
  }
}

async function generateEnhancedBulletsFAQ(data) {
  const { shop, productId, model, language, product, existingSeo } = data;
  
  // Get store context (cached for performance)
  const storeContext = await getCachedStoreContext(shop, { includeProductAnalysis: false });
  
  // Extract additional product enrichment data
  const productType = product.productType || 'product';
  const vendor = product.vendor || '';
  const tags = product.tags || [];
  const price = product.priceRangeV2?.minVariantPrice?.amount || '';
  const currency = product.priceRangeV2?.minVariantPrice?.currencyCode || '';
  const rawDescription = product.description || '';
  
  // Create factual prompt to prevent hallucinations
  const factualPrompt = createFactualPrompt(
    {
      title: product.title,
      description: existingSeo?.metaDescription || rawDescription || '',
      tags: tags,
      productType: productType,
      vendor: vendor,
      price: price,
      currency: currency,
      existingSeo: existingSeo
    },
    ['bullets', 'faq']
  );
  
  const messages = [
    {
      role: 'system',
      content: `${storeContext}

You are an AI assistant that enhances e-commerce product SEO content.
Your task is to improve ONLY the bullets and FAQ sections.
Language: ${language}
Guidelines:
- Make bullets more compelling and benefit-focused
- Create helpful FAQ questions and answers based on product data
- Keep the same language as input
- Use ONLY factual information from product data AND store context above
- For products with minimal descriptions, use product type, vendor, tags, and price to create relevant generic FAQs
- Examples for minimal data: "What is this ${productType} suitable for?", "How do I care for my ${productType}?", "What makes this ${vendor} product special?"
- Return ONLY a JSON object with exactly 2 keys: "bullets" and "faq"
- bullets: array of EXACTLY 5 strings (NO MORE, NO LESS) - this is mandatory!
- faq: array of 3-5 objects with "q" and "a" keys

**CRITICAL:** You MUST return exactly 5 bullets. If you can't generate 5 unique bullets, repeat/rephrase similar points.`
    },
    {
      role: 'user',
      content: factualPrompt
    }
  ];
  
  const { content, usage } = await openrouterChat(model, messages, true);
  
  let enhanced;
  try {
    // Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```')) {
      // Remove opening ```json or ```
      cleanContent = cleanContent.replace(/^```(?:json)?\s*\n?/, '');
      // Remove closing ```
      cleanContent = cleanContent.replace(/\n?```\s*$/, '');
    }
    
    enhanced = JSON.parse(cleanContent);
  } catch (parseError) {
    console.error(`[AI-ENHANCE] JSON parse error for ${language}:`, parseError);
    console.error(`[AI-ENHANCE] Raw content:`, content.substring(0, 200));
    throw new Error('Invalid JSON from AI');
  }
  
  // Validate AI response to prevent hallucinations
  const validated = validateAIResponse(enhanced, {
    title: product.title,
    description: existingSeo?.metaDescription || rawDescription || '',
    tags: tags,
    productType: productType,
    vendor: vendor,
    existingSeo: existingSeo
  }, ['bullets', 'faq']);
  
  // STRICT VALIDATION: Ensure EXACTLY 5 bullets
  let bullets = validated.bullets || [];
  if (bullets.length < 5) {
    // Pad with generic bullets if needed
    const genericBullets = [
      `High-quality ${productType || 'product'} from ${vendor || 'trusted brand'}`,
      `Perfect for ${productType || 'everyday use'}`,
      `Great value at competitive pricing`,
      `Available in multiple options`,
      `Satisfaction guaranteed`
    ];
    while (bullets.length < 5) {
      bullets.push(genericBullets[bullets.length] || `Feature ${bullets.length + 1}`);
    }
  } else if (bullets.length > 5) {
    // Trim to exactly 5
    bullets = bullets.slice(0, 5);
  }
  
  return {
    bullets: bullets,
    faq: validated.faq || [],
    usage
  };
}

// POST /ai-enhance/product
router.post('/product', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { productId, languages = [] } = req.body;
    
    // Validate required parameters
    if (!productId) {
      return res.status(400).json({ 
        error: 'Missing required parameter: productId',
        message: 'Product ID is required for AI enhancement'
      });
    }
    
    if (!languages || languages.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required parameter: languages',
        message: 'At least one language is required for AI enhancement'
      });
    }
    
    // Get subscription
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    // === PLAN CHECK: Professional+ required for Products AI enhancement ===
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    const productsAllowedPlans = ['professional', 'professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'];
    
    if (!productsAllowedPlans.includes(normalizedPlan) && planKey !== 'growth extra' && planKey !== 'professional plus' && planKey !== 'growth plus') {
      return res.status(403).json({
        error: 'AI-enhanced add-ons for Products require Professional plan or higher',
        currentPlan: planKey,
        minimumPlanRequired: 'Professional',
        message: 'Upgrade to Professional plan to access AI-enhanced optimization for Products'
      });
    }
    
    // === LANGUAGE LIMIT CHECK ===
    const planConfig = getPlanConfig(planKey);
    const languageLimit = planConfig?.languageLimit || 1;
    
    if (languages.length > languageLimit) {
      return res.status(403).json({
        error: `Your plan supports up to ${languageLimit} language(s)`,
        currentPlan: planKey,
        languageLimit: languageLimit,
        requestedLanguages: languages.length,
        message: `Upgrade your plan to optimize ${languages.length} languages. Your ${planConfig.name} plan supports ${languageLimit} language(s).`
      });
    }
    
    // === TOKEN CHECKING WITH DYNAMIC TRACKING (т.1 и т.2) ===
    // NOTE: We allow any plan IF they have tokens purchased
    // Growth Extra+ plans get included tokens, others must purchase
    const feature = 'ai-seo-product-enhanced';
    let reservationId = null;
    
    // CRITICAL: Check trial period BEFORE token check
    const now = new Date();
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
    
    // Get token balance EARLY (needed for re-enhancement check later in loop)
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    
    // Check if feature requires tokens
    if (requiresTokens(feature)) {
      // Estimate required tokens with 10% safety margin
      const tokenEstimate = estimateTokensWithMargin(feature, { languages: languages.length });
      
      // Check if plan has included tokens (Growth Extra, Enterprise)
      const planKey = (subscription?.plan || 'starter').toLowerCase().replace(/\s+/g, '_');
      const includedTokensPlans = ['growth_extra', 'enterprise'];
      const hasIncludedTokens = includedTokensPlans.includes(planKey);
      const isActivated = !!subscription?.activatedAt;
      
      // Check if user has purchased tokens (not just included tokens)
      const hasPurchasedTokens = tokenBalance.totalPurchased > 0;
      
      // TRIAL RESTRICTION: Different logic for included vs purchased tokens
      // Only block if: has included tokens plan + in trial + not activated + no purchased tokens
      if (hasIncludedTokens && inTrial && !isActivated && !hasPurchasedTokens && isBlockedInTrial(feature)) {
        // Growth Extra/Enterprise with included tokens → Show "Activate Plan" modal
        return res.status(402).json({
          error: 'AI-enhanced product optimization is locked during trial period',
          trialRestriction: true,
          requiresActivation: true,
          trialEndsAt: subscription.trialEndsAt,
          currentPlan: subscription.plan,
          feature,
          tokensRequired: tokenEstimate.withMargin, // Use withMargin for consistency
          tokensEstimated: tokenEstimate.estimated,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: Math.max(0, tokenEstimate.withMargin - tokenBalance.balance),
          message: 'Activate your plan to unlock AI-enhanced optimization with included tokens'
        });
      }
      
      // Check if sufficient tokens are available (with margin)
      if (!tokenBalance.hasBalance(tokenEstimate.withMargin)) {
        // Determine if upgrade is needed (for Starter/Professional/Growth base plans)
        // Plus plans (professional_plus, growth_plus) do NOT need upgrade, just tokens
        const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
        const needsUpgrade = !['professional_plus', 'growth_plus', 'growth_extra', 'enterprise'].includes(normalizedPlan) 
          && planKey !== 'growth extra' 
          && planKey !== 'professional plus' 
          && planKey !== 'growth plus';
        
        const responseData = {
          error: 'Insufficient token balance',
          requiresPurchase: true,
          needsUpgrade: needsUpgrade,
          minimumPlanForFeature: needsUpgrade ? 'Growth Extra' : null,
          currentPlan: planKey,
          tokensRequired: tokenEstimate.withMargin, // Use withMargin for consistency
          tokensEstimated: tokenEstimate.estimated,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: tokenEstimate.withMargin - tokenBalance.balance,
          feature,
          message: needsUpgrade 
            ? 'Purchase more tokens or upgrade to Growth Extra plan for AI-enhanced product features'
            : 'You need more tokens to use this feature'
        };
        
        return res.status(402).json(responseData);
      }
      
      // Reserve tokens (with 10% safety margin) - will be adjusted to actual usage later
      const reservation = tokenBalance.reserveTokens(tokenEstimate.withMargin, feature, { productId });
      reservationId = reservation.reservationId;
      await reservation.save();
    }
    // === END TOKEN CHECKING ===
    
    const results = [];
    const skippedDueToTokens = [];
    const model = 'google/gemini-2.5-flash-lite';
    let tokensExhausted = false;
    
    for (const language of languages) {
      // === GRACEFUL STOP: Check if we still have enough tokens ===
      if (reservationId && requiresTokens(feature) && !tokensExhausted) {
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        const estimatePerLanguage = estimateTokensWithMargin(feature, { languages: 1 });
        
        if (!tokenBalance.hasBalance(estimatePerLanguage.withMargin)) {
          tokensExhausted = true;
          
          // Mark all remaining languages as skipped
          const remainingLanguages = languages.slice(languages.indexOf(language));
          for (const lang of remainingLanguages) {
            skippedDueToTokens.push(lang);
          }
          break; // Stop processing
        }
      }
      
      try {
        // Get current SEO + product enrichment data
        const metafieldKey = `seo__${language.toLowerCase()}`;
        const query = `
          query GetProductSEO($productId: ID!) {
            product(id: $productId) {
              title
              description
              productType
              vendor
              tags
              featuredImage {
                url
                altText
              }
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
              metafield(namespace: "seo_ai", key: "${metafieldKey}") {
                value
              }
            }
          }
        `;
        
        const data = await shopGraphQL(req, shop, query, { productId });
        
        // Вземаме съществуващото SEO
        const metafield = data?.product?.metafield;
        const existingSeo = metafield?.value ? JSON.parse(metafield.value) : null;

        // Ако няма базово SEO, пропускаме
        if (!existingSeo || !existingSeo.title) {
          results.push({ 
            language, 
            error: 'No basic SEO found',
            skipped: true
          });
          continue;
        }
        
        // Ако вече има AI Enhanced съдържание, пропускаме САМО за Growth Extra и Enterprise
        // За Starter/Professional/Growth (pay-per-use tokens) винаги re-enhance
        // ВАЖНО: Единственият критерий е enhancedAt timestamp (bullets/faq винаги ще има от Basic SEO)
        // EXCEPTION: If user has purchased tokens during trial, allow re-enhancement (they're paying!)
        const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
        const shouldSkipEnhanced = ['growth_extra', 'enterprise'].includes(normalizedPlan);
        const hasAIEnhanced = existingSeo.enhancedAt; // Само enhancedAt, не updatedAt (това е за apply)
        const hasPurchasedTokens = tokenBalance.totalPurchased > 0;
        
        // Skip only if: plan has skip enabled AND already enhanced AND NOT using purchased tokens
        if (shouldSkipEnhanced && hasAIEnhanced && !hasPurchasedTokens) {
          results.push({ 
            language, 
            bullets: existingSeo.bullets,
            faq: existingSeo.faq,
            skipped: true,
            reason: 'Already enhanced',
            message: 'This language already has AI Enhanced content'
          });
          continue;
        }
        
        // Генерираме САМО bullets и FAQ
        const enhancedResult = await generateEnhancedBulletsFAQ({
          shop,
          productId: productId,
          model,
          language,
          product: data.product,
          existingSeo  // Подаваме цялото съществуващо SEO
        });
        
        // Generate AI alt text if missing (only for featured image)
        let imageAltResult = { altText: existingSeo.imageAlt, usage: null };
        const needsAltText = !existingSeo.imageAlt && data.product.featuredImage?.url;
        
        if (needsAltText) {
          console.log(`[AI-ENHANCE] Generating alt text for ${language} (featured image has no alt)`);
          imageAltResult = await generateImageAltText({
            product: data.product,
            language,
            model
          });
        }
        
        // Обновяваме bullets, FAQ, и imageAlt в съществуващия SEO обект
        const updatedSeo = {
          ...existingSeo,  // Запазва title, metaDescription, bodyHtml, jsonLd и всичко друго
          bullets: enhancedResult.bullets || existingSeo.bullets,
          faq: enhancedResult.faq || existingSeo.faq,
          imageAlt: imageAltResult.altText || existingSeo.imageAlt || null,  // AI-generated or existing
          enhancedAt: new Date().toISOString() // Маркираме че това е AI Enhanced, не само Basic SEO
        };

        // Записваме обратно в СЪЩИЯ metafield
        const metafieldInput = {
          ownerId: productId,
          namespace: 'seo_ai',
          key: metafieldKey,  // същият ключ като базовото SEO
          type: 'json',
          value: JSON.stringify(updatedSeo)
        };

        const mutation = `
          mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { field message }
              metafields { id }
            }
          }
        `;

        // Използваме съществуващата логика за запис
        const mutationResult = await shopGraphQL(req, shop, mutation, {
          metafields: [metafieldInput]
        });

        const userErrors = mutationResult?.metafieldsSet?.userErrors || [];
        if (userErrors.length > 0) {
          throw new Error(userErrors.map(e => e.message).join(', '));
        }
        
        // Combine usage from bullets/FAQ and imageAlt generation
        const combinedUsage = {
          prompt_tokens: (enhancedResult.usage?.prompt_tokens || 0) + (imageAltResult.usage?.prompt_tokens || 0),
          completion_tokens: (enhancedResult.usage?.completion_tokens || 0) + (imageAltResult.usage?.completion_tokens || 0),
          total_tokens: (enhancedResult.usage?.total_tokens || 0) + (imageAltResult.usage?.total_tokens || 0)
        };
        
        const result = {
          language,
          bullets: enhancedResult.bullets || [],
          faq: enhancedResult.faq || [],
          imageAlt: updatedSeo.imageAlt,
          imageAltGenerated: needsAltText && imageAltResult.altText !== null,
          usage: combinedUsage,
          updatedSeo
        };
        
        results.push(result);
        
      } catch (error) {
        console.error(`[AI-ENHANCE] Error for ${language}:`, error.message);
        results.push({ language, error: error.message });
      }
    }
    
    // === FINALIZE TOKEN USAGE (т.2) ===
    // Calculate actual tokens used from all AI requests
    if (reservationId && requiresTokens(feature)) {
      let totalActualTokens = 0;
      
      // Sum up actual tokens from all successful results
      for (const result of results) {
        if (result.usage) {
          const actual = calculateActualTokens(result.usage);
          totalActualTokens += actual.totalTokens;
        }
      }
      
      // Finalize the reservation with actual usage
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      await tokenBalance.finalizeReservation(reservationId, totalActualTokens);
      
      // Invalidate cache so new token balance is immediately visible
      try {
        const cacheService = await import('../services/cacheService.js');
        await cacheService.default.invalidateShop(shop);
      } catch (cacheErr) {
        console.error('[AI-ENHANCE] Failed to invalidate cache:', cacheErr);
      }
    }
    // === END TOKEN FINALIZATION ===
    
    // Prepare response summary
    const successfulLanguages = results.filter(r => !r.error && !r.skipped).length;
    
    // === MARK PRODUCT AS AI-ENHANCED ===
    // If any language was successfully enhanced, mark product as aiEnhanced
    // Also update lastShopifyUpdate to prevent webhook from detecting false-positive changes
    if (successfulLanguages > 0) {
      try {
        // Extract numeric ID from GID if needed
        const numericProductId = productId.includes('gid://') 
          ? productId.split('/').pop() 
          : productId;
        
        // Fetch current product data from Shopify for lastShopifyUpdate reference
        const productQuery = `
          query GetProduct($id: ID!) {
            product(id: $id) {
              id
              title
              descriptionHtml
            }
          }
        `;
        
        let currentProduct = null;
        try {
          const productData = await shopGraphQL(req, shop, productQuery, { id: productId });
          currentProduct = productData?.product;
        } catch (fetchError) {
          console.error('[AI-ENHANCE] Error fetching product for lastShopifyUpdate:', fetchError.message);
        }
        
        const updateData = {
          $set: { 'seoStatus.aiEnhanced': true }
        };
        
        // CRITICAL: Update lastShopifyUpdate to prevent webhook from detecting false-positive changes
        if (currentProduct) {
          updateData.$set.lastShopifyUpdate = {
            title: currentProduct.title,
            description: currentProduct.descriptionHtml || '',
            updatedAt: new Date()
          };
        }
        
        // CRITICAL: Use upsert: true to create product record if it doesn't exist (e.g., after uninstall/reinstall)
        const result = await Product.findOneAndUpdate(
          { shop, productId: numericProductId },
          {
            ...updateData,
            $setOnInsert: {
              shop,
              productId: numericProductId,
              shopifyProductId: numericProductId,
              gid: productId,
              title: currentProduct?.title || '',
              description: currentProduct?.descriptionHtml || '',
              'seoStatus.optimized': false,
              'seoStatus.languages': []
            }
          },
          { upsert: true, new: true }
        );
        
        // Product marked as AI-enhanced in MongoDB
      } catch (e) {
        console.error('[AI-ENHANCE] Failed to mark product as AI-enhanced:', e);
      }
    }
    // === END MARK AI-ENHANCED ===
    const failedLanguages = results.filter(r => r.error && !r.skipped).length;
    const alreadyEnhanced = results.filter(r => r.skipped && r.reason === 'Already enhanced').length;
    const noBasicSeo = results.filter(r => r.skipped && !r.reason).length;
    
    res.json({ 
      success: successfulLanguages > 0 || alreadyEnhanced > 0,
      productId,
      model,
      results,
      summary: {
        total: languages.length,
        successful: successfulLanguages,
        failed: failedLanguages,
        alreadyEnhanced: alreadyEnhanced,
        noBasicSeo: noBasicSeo,
        skippedDueToTokens: skippedDueToTokens.length,
        tokensExhausted: tokensExhausted
      },
      ...(alreadyEnhanced > 0 && {
        info: `${alreadyEnhanced} language(s) already had AI Enhanced content and were skipped to save tokens.`
      }),
      ...(skippedDueToTokens.length > 0 && {
        warning: `Operation stopped: Insufficient tokens. ${successfulLanguages} language(s) enhanced, ${skippedDueToTokens.length} skipped.`,
        skippedLanguages: skippedDueToTokens
      })
    });
    
  } catch (error) {
    console.error('[AI-ENHANCE] Error:', error.message);
    
    // CRITICAL: If we reserved tokens but enhancement failed, refund them!
    if (reservationId) {
      try {
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        
        // Refund the full reserved amount (0 actual usage)
        await tokenBalance.finalizeReservation(reservationId, 0);
        
        console.log(`[AI-ENHANCE] Refunded reserved tokens due to error (reservation: ${reservationId})`);
        
        // Invalidate cache
        try {
          const cacheService = await import('../services/cacheService.js');
          await cacheService.default.invalidateShop(shop);
        } catch (cacheErr) {
          console.error('[AI-ENHANCE] Failed to invalidate cache:', cacheErr);
        }
      } catch (tokenErr) {
        console.error('[AI-ENHANCE] Error refunding tokens after failure:', tokenErr);
      }
    }
    
    res.status(500).json({ error: error.message });
  }
});

// POST /ai-enhance/collection
router.post('/collection', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { collectionId, languages = [] } = req.body;
    
    // Get subscription
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    // === PLAN CHECK 1: Check if plan allows Collections at all ===
    const planConfig = getPlanConfig(planKey);
    if (!planConfig || planConfig.collectionLimit === 0) {
      return res.status(403).json({
        error: 'Collections SEO requires Professional plan or higher',
        currentPlan: planKey,
        collectionLimit: 0,
        message: 'Upgrade to Professional plan to optimize collections for AI search'
      });
    }
    
    // === PLAN CHECK 2: AI-enhanced add-ons require Professional+ ===
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    const collectionsAllowedPlans = ['professional', 'professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'];
    
    if (!collectionsAllowedPlans.includes(normalizedPlan) && planKey !== 'growth extra' && planKey !== 'professional plus' && planKey !== 'growth plus') {
      return res.status(403).json({
        error: 'AI-enhanced add-ons for Collections require Professional plan or higher',
        currentPlan: planKey,
        minimumPlanRequired: 'Professional',
        message: 'Upgrade to Professional plan to access AI-enhanced optimization for Collections'
      });
    }
    
    // === LANGUAGE LIMIT CHECK ===
    // planConfig already defined above in PLAN CHECK 1
    const languageLimit = planConfig?.languageLimit || 1;
    
    if (languages.length > languageLimit) {
      return res.status(403).json({
        error: `Your plan supports up to ${languageLimit} language(s)`,
        currentPlan: planKey,
        languageLimit: languageLimit,
        requestedLanguages: languages.length,
        message: `Upgrade your plan to optimize ${languages.length} languages. Your ${planConfig.name} plan supports ${languageLimit} language(s).`
      });
    }
    
    // === TOKEN CHECKING WITH DYNAMIC TRACKING ===
    // NOTE: After plan check passes, AI Enhancement requires tokens
    // Growth Extra+ plans get included tokens, Professional/Growth must purchase
    const feature = 'ai-seo-collection';
    let reservationId = null;
    
    // CRITICAL: Check trial period BEFORE token check
    const now = new Date();
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
    
    // Check if feature requires tokens
    if (requiresTokens(feature)) {
      // Estimate required tokens with 10% safety margin
      const tokenEstimate = estimateTokensWithMargin(feature, { languages: languages.length });
      
      // Check token balance
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      // Check if plan has included tokens (Growth Extra, Enterprise)
      const planKey = (subscription?.plan || 'starter').toLowerCase().replace(/\s+/g, '_');
      const includedTokensPlans = ['growth_extra', 'enterprise'];
      const hasIncludedTokens = includedTokensPlans.includes(planKey);
      const isActivated = !!subscription?.activatedAt;
      
      // Check if user has purchased tokens (not just included tokens)
      const hasPurchasedTokens = tokenBalance.totalPurchased > 0;
      
      // TRIAL RESTRICTION: Different logic for included vs purchased tokens
      // Only block if: has included tokens plan + in trial + not activated + no purchased tokens
      if (hasIncludedTokens && inTrial && !isActivated && !hasPurchasedTokens && isBlockedInTrial(feature)) {
        // Growth Extra/Enterprise with included tokens → Show "Activate Plan" modal
        return res.status(402).json({
          error: 'AI-enhanced collection optimization is locked during trial period',
          trialRestriction: true,
          requiresActivation: true,
          trialEndsAt: subscription.trialEndsAt,
          currentPlan: subscription.plan,
          feature,
          tokensRequired: tokenEstimate.withMargin, // Use withMargin for consistency
          tokensEstimated: tokenEstimate.estimated,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: Math.max(0, tokenEstimate.withMargin - tokenBalance.balance),
          message: 'Activate your plan to unlock AI-enhanced optimization with included tokens'
        });
      }
      
      // Check if sufficient tokens are available (with margin)
      if (!tokenBalance.hasBalance(tokenEstimate.withMargin)) {
        // Determine if upgrade is needed (for Starter/Professional/Growth base plans)
        // Plus plans (professional_plus, growth_plus) do NOT need upgrade, just tokens
        const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
        const needsUpgrade = !['professional_plus', 'growth_plus', 'growth_extra', 'enterprise'].includes(normalizedPlan) 
          && planKey !== 'growth extra' 
          && planKey !== 'professional plus' 
          && planKey !== 'growth plus';
        
        return res.status(402).json({
          error: 'Insufficient token balance',
          requiresPurchase: true,
          needsUpgrade: needsUpgrade,
          minimumPlanForFeature: needsUpgrade ? 'Growth Extra' : null,
          currentPlan: planKey,
          tokensRequired: tokenEstimate.withMargin, // Use withMargin for consistency
          tokensEstimated: tokenEstimate.estimated,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: tokenEstimate.withMargin - tokenBalance.balance,
          feature,
          message: needsUpgrade 
            ? 'Purchase more tokens or upgrade to Growth Extra plan for AI-enhanced collection features'
            : 'You need more tokens to use this feature'
        });
      }
      
      // Reserve tokens (with 10% safety margin) - will be adjusted to actual usage later
      const reservation = tokenBalance.reserveTokens(tokenEstimate.withMargin, feature, { collectionId });
      reservationId = reservation.reservationId;
      await reservation.save();
    }
    // === END TOKEN CHECKING ===
    
    const results = [];
    const skippedDueToTokens = [];
    const model = 'google/gemini-2.5-flash-lite';
    let tokensExhausted = false;
    
    for (const language of languages) {
      // === GRACEFUL STOP: Check if we still have enough tokens ===
      if (reservationId && requiresTokens(feature) && !tokensExhausted) {
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        const estimatePerLanguage = estimateTokensWithMargin(feature, { languages: 1 });
        
        if (!tokenBalance.hasBalance(estimatePerLanguage.withMargin)) {
          tokensExhausted = true;
          
          const remainingLanguages = languages.slice(languages.indexOf(language));
          for (const lang of remainingLanguages) {
            skippedDueToTokens.push(lang);
          }
          break;
        }
      }
      
      try {
        const metafieldKey = `seo__${language.toLowerCase()}`;
        const query = `
          query GetCollectionSEO($collectionId: ID!) {
            collection(id: $collectionId) {
              title
              metafield(namespace: "seo_ai", key: "${metafieldKey}") {
                value
              }
            }
          }
        `;
        
        const data = await shopGraphQL(req, shop, query, { collectionId });
        
        if (!data?.collection?.metafield?.value) {
          results.push({ language, error: 'No basic SEO found' });
          continue;
        }
        
        const currentSeo = JSON.parse(data.collection.metafield.value);
        
        // Ако вече има AI Enhanced съдържание, пропускаме САМО за Growth Extra и Enterprise
        // За Starter/Professional/Growth (pay-per-use tokens) винаги re-enhance
        // ВАЖНО: Единственият критерий е enhancedAt timestamp (bullets/faq винаги ще има от Basic SEO)
        const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
        const shouldSkipEnhanced = ['growth_extra', 'enterprise'].includes(normalizedPlan);
        const hasAIEnhanced = currentSeo.enhancedAt; // Само enhancedAt, не updatedAt
        
        if (shouldSkipEnhanced && hasAIEnhanced) {
          results.push({ 
            language, 
            bullets: currentSeo.bullets,
            faq: currentSeo.faq,
            skipped: true,
            reason: 'Already enhanced',
            message: 'This language already has AI Enhanced content'
          });
          continue;
        }
        
        const messages = [
          {
            role: 'system',
            content: `Generate enhanced bullets and FAQ for a collection in ${language}.
Output JSON with:
{
  "bullets": ["benefit1", "benefit2", "benefit3", "benefit4"],
  "faq": [
    {"q": "question1", "a": "answer1"},
    {"q": "question2", "a": "answer2"}
  ]
}`
          },
          {
            role: 'user',
            content: `Collection: ${currentSeo.title}\nDescription: ${currentSeo.metaDescription}`
          }
        ];
        
        const { content, usage } = await openrouterChat(model, messages, true);
        
        let enhanced;
        try {
          // Strip markdown code blocks if present
          let cleanContent = content.trim();
          if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.replace(/^```(?:json)?\s*\n?/, '');
            cleanContent = cleanContent.replace(/\n?```\s*$/, '');
          }
          
          enhanced = JSON.parse(cleanContent);
        } catch (parseErr) {
          console.error(`[AI-ENHANCE] Collection JSON parse error:`, parseErr.message);
          console.error(`[AI-ENHANCE] Raw content:`, content.substring(0, 200));
          throw new Error('Invalid JSON from AI');
        }
        
        results.push({
          language,
          bullets: enhanced.bullets || [],
          faq: enhanced.faq || [],
          usage
        });
        
      } catch (error) {
        console.error(`[AI-ENHANCE] Collection error for ${language}:`, error.message);
        results.push({ language, error: error.message });
      }
    }
    
    // === FINALIZE TOKEN USAGE ===
    // Calculate actual tokens used from all AI requests
    if (reservationId && requiresTokens(feature)) {
      let totalActualTokens = 0;
      
      // Sum up actual tokens from all successful results
      for (const result of results) {
        if (result.usage) {
          const actual = calculateActualTokens(result.usage);
          totalActualTokens += actual.totalTokens;
        }
      }
      
      // Finalize the reservation with actual usage
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      await tokenBalance.finalizeReservation(reservationId, totalActualTokens);
      
      // Invalidate cache so new token balance is immediately visible
      try {
        const cacheService = await import('../services/cacheService.js');
        await cacheService.default.invalidateShop(shop);
      } catch (cacheErr) {
        console.error('[AI-ENHANCE] Failed to invalidate cache:', cacheErr);
      }
    }
    // === END TOKEN FINALIZATION ===
    
    // Prepare response summary
    const successfulLanguages = results.filter(r => !r.error && !r.skipped).length;
    const failedLanguages = results.filter(r => r.error).length;
    const alreadyEnhanced = results.filter(r => r.skipped && r.reason === 'Already enhanced').length;
    
    res.json({ 
      success: successfulLanguages > 0 || alreadyEnhanced > 0,
      collectionId,
      model,
      results,
      summary: {
        total: languages.length,
        successful: successfulLanguages,
        failed: failedLanguages,
        alreadyEnhanced: alreadyEnhanced,
        skippedDueToTokens: skippedDueToTokens.length,
        tokensExhausted: tokensExhausted
      },
      ...(alreadyEnhanced > 0 && {
        info: `${alreadyEnhanced} language(s) already had AI Enhanced content and were skipped to save tokens.`
      }),
      ...(skippedDueToTokens.length > 0 && {
        warning: `Operation stopped: Insufficient tokens. ${successfulLanguages} language(s) enhanced, ${skippedDueToTokens.length} skipped.`,
        skippedLanguages: skippedDueToTokens
      })
    });
    
  } catch (error) {
    // CRITICAL: If we reserved tokens but enhancement failed, refund them!
    if (reservationId) {
      try {
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        
        // Refund the full reserved amount (0 actual usage)
        await tokenBalance.finalizeReservation(reservationId, 0);
        
        console.log(`[AI-ENHANCE] Refunded reserved tokens due to error (reservation: ${reservationId})`);
        
        // Invalidate cache
        try {
          const cacheService = await import('../services/cacheService.js');
          await cacheService.default.invalidateShop(shop);
        } catch (cacheErr) {
          console.error('[AI-ENHANCE] Failed to invalidate cache:', cacheErr);
        }
      } catch (tokenErr) {
        console.error('[AI-ENHANCE] Error refunding tokens after failure:', tokenErr);
      }
    }
    
    res.status(500).json({ error: error.message });
  }
});

// POST /ai-enhance/collection/:collectionId
router.post('/collection/:collectionId', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain || req.body?.shop || req.query?.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Shop not provided' });
    }
    
    const { collectionId } = req.params;
    const { languages = [] } = req.body;
    
    // Get subscription
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    // === PLAN CHECK: Growth+ required for Collections AI enhancement ===
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    const collectionsAllowedPlans = ['professional', 'professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'];
    
    if (!collectionsAllowedPlans.includes(normalizedPlan) && planKey !== 'growth extra' && planKey !== 'professional plus' && planKey !== 'growth plus') {
      return res.status(403).json({
        error: 'AI-enhanced add-ons for Collections require Professional plan or higher',
        currentPlan: planKey,
        minimumPlanRequired: 'Professional',
        message: 'Upgrade to Professional plan to access AI-enhanced optimization for Collections'
      });
    }
    
    // === LANGUAGE LIMIT CHECK ===
    const planConfig = getPlanConfig(planKey);
    const languageLimit = planConfig?.languageLimit || 1;
    
    if (languages.length > languageLimit) {
      return res.status(403).json({
        error: `Your plan supports up to ${languageLimit} language(s)`,
        currentPlan: planKey,
        languageLimit: languageLimit,
        requestedLanguages: languages.length,
        message: `Upgrade your plan to optimize ${languages.length} languages. Your ${planConfig.name} plan supports ${languageLimit} language(s).`
      });
    }
    
    // === TOKEN CHECKING WITH DYNAMIC TRACKING ===
    // NOTE: After plan check passes, AI Enhancement requires tokens
    // Growth Extra+ plans get included tokens, Professional/Growth must purchase
    const feature = 'ai-seo-collection';
    let reservationId = null;
    const usageDetails = []; // Track usage for each language
    
    // CRITICAL: Check trial period BEFORE token check
    const now = new Date();
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
    
    // Check if feature requires tokens
    if (requiresTokens(feature)) {
      // Estimate required tokens with 10% safety margin
      const tokenEstimate = estimateTokensWithMargin(feature, { languages: languages.length });
      
      // Check token balance
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      // Check if plan has included tokens (Growth Extra, Enterprise)
      const normalizedPlanKey = (subscription?.plan || 'starter').toLowerCase().replace(/\s+/g, '_');
      const includedTokensPlans = ['growth_extra', 'enterprise'];
      const hasIncludedTokens = includedTokensPlans.includes(normalizedPlanKey);
      const isActivated = !!subscription?.activatedAt;
      
      // Check if user has purchased tokens (not just included tokens)
      const hasPurchasedTokens = tokenBalance.totalPurchased > 0;
      
      // TRIAL RESTRICTION: Different logic for included vs purchased tokens
      // Only block if: has included tokens plan + in trial + not activated + no purchased tokens
      if (hasIncludedTokens && inTrial && !isActivated && !hasPurchasedTokens && isBlockedInTrial(feature)) {
        // Growth Extra/Enterprise with included tokens → Show "Activate Plan" modal
        return res.status(402).json({
          error: 'AI-enhanced collection optimization is locked during trial period',
          trialRestriction: true,
          requiresActivation: true,
          trialEndsAt: subscription.trialEndsAt,
          currentPlan: subscription.plan,
          feature,
          tokensRequired: tokenEstimate.withMargin, // Use withMargin for consistency
          tokensEstimated: tokenEstimate.estimated,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: Math.max(0, tokenEstimate.withMargin - tokenBalance.balance),
          message: 'Activate your plan to unlock AI-enhanced optimization with included tokens'
        });
      }
      
      // Check if sufficient tokens are available (with margin)
      if (!tokenBalance.hasBalance(tokenEstimate.withMargin)) {
        // Determine if upgrade is needed (for Starter/Professional/Growth base plans)
        // Plus plans (professional_plus, growth_plus) do NOT need upgrade, just tokens
        const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
        const needsUpgrade = !['professional_plus', 'growth_plus', 'growth_extra', 'enterprise'].includes(normalizedPlan) 
          && planKey !== 'growth extra' 
          && planKey !== 'professional plus' 
          && planKey !== 'growth plus';
        
        return res.status(402).json({
          error: 'Insufficient token balance',
          requiresPurchase: true,
          needsUpgrade: needsUpgrade,
          minimumPlanForFeature: needsUpgrade ? 'Growth Extra' : null,
          currentPlan: planKey,
          tokensRequired: tokenEstimate.withMargin, // Use withMargin for consistency
          tokensEstimated: tokenEstimate.estimated,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: tokenEstimate.withMargin - tokenBalance.balance,
          feature,
          message: needsUpgrade 
            ? 'Purchase more tokens or upgrade to Growth Extra plan for AI-enhanced collection features'
            : 'You need more tokens to use this feature'
        });
      }
      
      // Reserve tokens (with 10% safety margin) - will be adjusted to actual usage later
      const reservation = tokenBalance.reserveTokens(tokenEstimate.withMargin, feature, { collectionId });
      reservationId = reservation.reservationId;
      await reservation.save();
      
    }
    // === END TOKEN CHECKING ===
    
    const results = { enhanced: 0, failed: 0, errors: [], skippedDueToTokens: 0 };
    const skippedLanguages = [];
    const model = 'google/gemini-2.5-flash-lite';
    let tokensExhausted = false;
    
    for (const language of languages) {
      // === GRACEFUL STOP: Check if we still have enough tokens ===
      if (reservationId && requiresTokens(feature) && !tokensExhausted) {
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        const estimatePerLanguage = estimateTokensWithMargin(feature, { languages: 1 });
        
        if (!tokenBalance.hasBalance(estimatePerLanguage.withMargin)) {
          tokensExhausted = true;
          
          const remainingLanguages = languages.slice(languages.indexOf(language));
          results.skippedDueToTokens = remainingLanguages.length;
          skippedLanguages.push(...remainingLanguages);
          break;
        }
      }
      
      try {
        // 1. Load existing SEO
        const metafieldKey = `seo__${language}`;
        
        const query = `
          query GetCollectionMetafield($id: ID!) {
            collection(id: $id) {
              metafield(namespace: "seo_ai", key: "${metafieldKey}") {
                value
              }
            }
          }
        `;
        
        const data = await shopGraphQL(req, shop, query, { id: collectionId });
        
        if (!data?.collection?.metafield?.value) {
          results.errors.push(`${language}: No basic SEO found`);
          results.failed++;
          continue;
        }
        
        const existingSeo = JSON.parse(data.collection.metafield.value);
        
        // Ако вече има AI Enhanced съдържание, пропускаме САМО за Growth Extra и Enterprise
        // За Starter/Professional/Growth (pay-per-use tokens) винаги re-enhance
        // ВАЖНО: Единственият критерий е enhancedAt timestamp (bullets/faq винаги ще има от Basic SEO)
        const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
        const shouldSkipEnhanced = ['growth_extra', 'enterprise'].includes(normalizedPlan);
        const hasAIEnhanced = existingSeo.enhancedAt; // Само enhancedAt, не updatedAt
        
        if (shouldSkipEnhanced && hasAIEnhanced) {
          results.enhanced++; // Броим като enhanced защото вече е enhanced
          continue;
        }
        
        // 2. Call AI for enhancement
        const messages = [
          {
            role: 'system',
            content: `You are an AI assistant that enhances e-commerce collection SEO content.
Your task is to improve ONLY the bullets and FAQ sections.
Language: ${language}
Guidelines:
- Make bullets more compelling and benefit-focused
- Create helpful FAQ questions and answers
- Keep the same language as input
- Return ONLY a JSON object with exactly 2 keys: "bullets" and "faq"
- bullets: array of 5 strings
- faq: array of 3-5 objects with "q" and "a" keys`
          },
          {
            role: 'user',
            content: JSON.stringify({
              title: existingSeo.title,
              description: existingSeo.metaDescription,
              currentBullets: existingSeo.bullets || [],
              currentFaq: existingSeo.faq || []
            })
          }
        ];
        
        const { content, usage } = await openrouterChat(model, messages, true);
        
        // Track usage for finalization
        if (usage) {
          usageDetails.push({ language, usage });
        }
        
        let enhanced;
        try {
          // Strip markdown code blocks if present
          let cleanContent = content.trim();
          if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.replace(/^```(?:json)?\s*\n?/, '');
            cleanContent = cleanContent.replace(/\n?```\s*$/, '');
          }
          
          enhanced = JSON.parse(cleanContent);
        } catch (parseErr) {
          console.error(`[AI-ENHANCE] Failed to parse AI response:`, parseErr.message);
          console.error(`[AI-ENHANCE] Raw content:`, content.substring(0, 200));
          throw new Error('Invalid JSON from AI');
        }
        
        // 3. Save enhanced data
        const updatedSeo = {
          ...existingSeo,
          bullets: enhanced.bullets || existingSeo.bullets,
          faq: enhanced.faq || existingSeo.faq,
          enhancedAt: new Date().toISOString()
        };
        
        const mutation = `
          mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { field message }
              metafields { id }
            }
          }
        `;
        
        const mutationResult = await shopGraphQL(req, shop, mutation, {
          metafields: [{
            ownerId: collectionId,
            namespace: 'seo_ai',
            key: metafieldKey,
            type: 'json',
            value: JSON.stringify(updatedSeo)
          }]
        });
        
        const userErrors = mutationResult?.metafieldsSet?.userErrors || [];
        if (userErrors.length > 0) {
          throw new Error(userErrors.map(e => e.message).join(', '));
        }
        
        results.enhanced++;
        
      } catch (error) {
        console.error(`[AI-ENHANCE] Error for ${language}:`, error);
        results.errors.push(`${language}: ${error.message}`);
        results.failed++;
      }
    }
    
    // === MARK COLLECTION AS AI-ENHANCED ===
    // If any language was successfully enhanced, mark collection as aiEnhanced
    // Also update lastShopifyUpdate to prevent webhook from detecting false-positive changes
    if (results.enhanced > 0) {
      try {
        const Collection = (await import('../db/Collection.js')).default;
        const numericCollectionId = collectionId.includes('gid://') 
          ? collectionId.split('/').pop() 
          : collectionId;
        
        // Fetch current collection data from Shopify for lastShopifyUpdate reference
        const collectionQuery = `
          query GetCollection($id: ID!) {
            collection(id: $id) {
              id
              title
              descriptionHtml
            }
          }
        `;
        
        let currentCollection = null;
        try {
          const collectionData = await shopGraphQL(req, shop, collectionQuery, { id: collectionId });
          currentCollection = collectionData?.collection;
        } catch (fetchError) {
          console.error('[AI-ENHANCE] Error fetching collection for lastShopifyUpdate:', fetchError.message);
        }
        
        const updateData = {
          $set: { 'seoStatus.aiEnhanced': true }
        };
        
        // CRITICAL: Update lastShopifyUpdate to prevent webhook from detecting false-positive changes
        if (currentCollection) {
          updateData.$set.lastShopifyUpdate = {
            title: currentCollection.title,
            description: currentCollection.descriptionHtml || '',
            updatedAt: new Date()
          };
        }
        
        const result = await Collection.findOneAndUpdate(
          { shop, collectionId: numericCollectionId },
          { 
            ...updateData,
            $setOnInsert: { 
              shop, 
              collectionId: numericCollectionId,
              'seoStatus.optimized': false,
              'seoStatus.languages': []
            }
          },
          { upsert: true, new: true }
        );
        
        if (result) {
          // Collection marked as AI-enhanced in MongoDB
        }
      } catch (e) {
        console.error('[AI-ENHANCE] Failed to mark collection as AI-enhanced:', e);
      }
    }
    // === END MARK AI-ENHANCED ===
    
    // === FINALIZE TOKEN USAGE ===
    // Calculate actual tokens used from all AI requests
    if (reservationId && requiresTokens(feature) && usageDetails.length > 0) {
      let totalActualTokens = 0;
      
      // Sum up actual tokens from all successful results
      for (const detail of usageDetails) {
        const actual = calculateActualTokens(detail.usage);
        totalActualTokens += actual.totalTokens;
      }
      
      // Finalize the reservation with actual usage
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      await tokenBalance.finalizeReservation(reservationId, totalActualTokens);
      
      // Invalidate cache so new token balance is immediately visible
      try {
        const cacheService = await import('../services/cacheService.js');
        await cacheService.default.invalidateShop(shop);
      } catch (cacheErr) {
        console.error('[AI-ENHANCE] Failed to invalidate cache:', cacheErr);
      }
    }
    // === END TOKEN FINALIZATION ===
    
    res.json({ 
      ok: results.enhanced > 0,
      enhanced: results.enhanced,
      failed: results.failed,
      skippedDueToTokens: results.skippedDueToTokens,
      errors: results.errors,
      tokensExhausted: tokensExhausted,
      ...(skippedLanguages.length > 0 && {
        warning: `Operation stopped: Insufficient tokens. ${results.enhanced} language(s) enhanced, ${results.skippedDueToTokens} skipped.`,
        skippedLanguages: skippedLanguages
      })
    });
    
  } catch (error) {
    console.error('[AI-ENHANCE] Fatal error:', error);
    
    // CRITICAL: If we reserved tokens but enhancement failed, refund them!
    if (reservationId) {
      try {
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        
        // Refund the full reserved amount (0 actual usage)
        await tokenBalance.finalizeReservation(reservationId, 0);
        
        console.log(`[AI-ENHANCE] Refunded reserved tokens due to error (reservation: ${reservationId})`);
        
        // Invalidate cache
        try {
          const cacheService = await import('../services/cacheService.js');
          await cacheService.default.invalidateShop(shop);
        } catch (cacheErr) {
          console.error('[AI-ENHANCE] Failed to invalidate cache:', cacheErr);
        }
      } catch (tokenErr) {
        console.error('[AI-ENHANCE] Error refunding tokens after failure:', tokenErr);
      }
    }
    
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// BATCH ENDPOINT FOR BACKGROUND PROCESSING
// ============================================================

import aiEnhanceQueue from '../services/aiEnhanceQueue.js';

/**
 * POST /ai-enhance/batch
 * Add AI Enhancement job to background queue
 * Body: { products: [{ productId, languages, title }] }
 */
router.post('/batch', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { products = [] } = req.body;
    
    if (!products || products.length === 0) {
      return res.status(400).json({ error: 'No products provided' });
    }
    
    // Get subscription for plan checks
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    // === PLAN CHECK: Professional+ required for Products AI enhancement ===
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    const productsAllowedPlans = ['professional', 'professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'];
    
    if (!productsAllowedPlans.includes(normalizedPlan) && planKey !== 'growth extra' && planKey !== 'professional plus' && planKey !== 'growth plus') {
      return res.status(403).json({
        error: 'AI-enhanced add-ons for Products require Professional plan or higher',
        currentPlan: planKey,
        minimumPlanRequired: 'Professional',
        message: 'Upgrade to Professional plan to access AI-enhanced optimization for Products'
      });
    }
    
    // === PRODUCT LIMIT CHECK ===
    const planConfig = getPlanConfig(planKey);
    const productLimit = planConfig?.productLimit || 10;
    
    if (products.length > productLimit) {
      return res.status(403).json({
        error: `Product limit exceeded`,
        message: `Your ${planKey} plan supports up to ${productLimit} products for AI Enhancement. You have selected ${products.length} products.`,
        currentPlan: planKey,
        productLimit
      });
    }
    
    // === TOKEN CHECK (estimate for all products) ===
    const feature = 'ai-seo-product-enhanced';
    const now = new Date();
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    
    // Estimate tokens for all products
    const totalLanguages = products.reduce((sum, p) => sum + (p.languages?.length || 0), 0);
    const tokenEstimate = estimateTokensWithMargin(feature, { languages: totalLanguages });
    
    // Check if plan has included tokens
    const includedTokensPlans = ['growth_extra', 'enterprise'];
    const hasIncludedTokens = includedTokensPlans.includes(normalizedPlan);
    const isActivated = !!subscription?.activatedAt;
    const hasPurchasedTokens = tokenBalance.totalPurchased > 0;
    
    // TRIAL RESTRICTION
    if (hasIncludedTokens && inTrial && !isActivated && !hasPurchasedTokens && isBlockedInTrial(feature)) {
      return res.status(402).json({
        error: 'AI-enhanced product optimization is locked during trial period',
        trialRestriction: true,
        requiresActivation: true,
        trialEndsAt: subscription.trialEndsAt,
        currentPlan: subscription.plan,
        feature,
        tokensRequired: tokenEstimate.withMargin, // Use withMargin for consistency
        tokensEstimated: tokenEstimate.estimated,
        tokensAvailable: tokenBalance.balance,
        message: 'Activate your plan to unlock AI-enhanced optimization with included tokens'
      });
    }
    
    // Check token balance
    if (!tokenBalance.hasBalance(tokenEstimate.withMargin)) {
      const needsUpgrade = !['professional_plus', 'growth_plus', 'growth_extra', 'enterprise'].includes(normalizedPlan);
      
      return res.status(402).json({
        error: 'Insufficient token balance',
        requiresPurchase: true,
        needsUpgrade,
        currentPlan: planKey,
        tokensRequired: tokenEstimate.withMargin, // Use withMargin for consistency
        tokensEstimated: tokenEstimate.estimated,
        tokensAvailable: tokenBalance.balance,
        tokensNeeded: tokenEstimate.withMargin - tokenBalance.balance,
        feature,
        message: needsUpgrade 
          ? 'Purchase more tokens or upgrade to Growth Extra plan'
          : 'You need more tokens to use this feature'
      });
    }
    
    // Create enhance function that will be called for each product
    const enhanceProduct = async (productData) => {
      const { productId, languages, title } = productData;
      
      try {
        // Call the existing /product endpoint logic internally
        // We'll make an internal API call to reuse all the existing logic
        const response = await fetch(`${process.env.APP_URL || 'http://localhost:3000'}/ai-enhance/product`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Forward auth headers
            'Authorization': req.headers.authorization || '',
            'x-shopify-shop-domain': shop
          },
          body: JSON.stringify({
            shop,
            productId,
            languages
          })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
          // Check for token/plan errors
          if (response.status === 402 || response.status === 403) {
            const error = new Error(result.error || 'Token or plan restriction');
            error.status = response.status;
            error.trialRestriction = result.trialRestriction;
            throw error;
          }
          return { success: false, error: result.error };
        }
        
        // Check if all languages were skipped
        if (result.summary?.successful === 0 && result.summary?.alreadyEnhanced > 0) {
          return { 
            skipped: true, 
            reason: 'Already enhanced',
            data: result 
          };
        }
        
        if (result.summary?.successful === 0 && result.summary?.noBasicSeo > 0) {
          return { 
            skipped: true, 
            reason: 'No Basic SEO',
            data: result 
          };
        }
        
        return { success: true, data: result };
        
      } catch (error) {
        // Re-throw token/plan errors to stop processing
        if (error.status === 402 || error.status === 403) {
          throw error;
        }
        return { success: false, error: error.message };
      }
    };
    
    // Add job to queue
    const jobInfo = await aiEnhanceQueue.addJob(shop, products, enhanceProduct);
    
    return res.json({
      success: true,
      message: jobInfo.queued ? 'AI Enhancement job queued' : jobInfo.message,
      ...jobInfo
    });
    
  } catch (error) {
    console.error('[AI-ENHANCE/BATCH] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /ai-enhance/job-status
 * Get status of background AI Enhancement job
 */
router.get('/job-status', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop not provided' });
    }
    
    const status = await aiEnhanceQueue.getJobStatus(shop);
    return res.json(status);
    
  } catch (error) {
    console.error('[AI-ENHANCE/JOB-STATUS] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
// COLLECTION AI ENHANCEMENT BATCH ENDPOINTS
// ============================================================

import collectionJobQueue from '../services/collectionJobQueue.js';

/**
 * POST /ai-enhance/collection-batch
 * Add Collection AI Enhancement job to background queue
 * Body: { collections: [{ collectionId, languages, title }] }
 */
router.post('/collection-batch', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { collections = [] } = req.body;
    
    if (!collections || collections.length === 0) {
      return res.status(400).json({ error: 'No collections provided' });
    }
    
    // Get subscription for plan checks
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    // === PLAN CHECK: Professional+ required for Collections AI enhancement ===
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    const collectionsAllowedPlans = ['professional', 'professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'];
    
    if (!collectionsAllowedPlans.includes(normalizedPlan) && planKey !== 'growth extra' && planKey !== 'professional plus' && planKey !== 'growth plus') {
      return res.status(403).json({
        error: 'AI-enhanced add-ons for Collections require Professional plan or higher',
        currentPlan: planKey,
        minimumPlanRequired: 'Professional',
        message: 'Upgrade to Professional plan to access AI-enhanced optimization for Collections'
      });
    }
    
    // === TOKEN CHECK (estimate for all collections) ===
    const feature = 'ai-seo-collection';
    const now = new Date();
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    
    // Estimate tokens for all collections
    const totalLanguages = collections.reduce((sum, c) => sum + (c.languages?.length || 0), 0);
    const tokenEstimate = estimateTokensWithMargin(feature, { languages: totalLanguages });
    
    // Check if plan has included tokens
    const includedTokensPlans = ['growth_extra', 'enterprise'];
    const hasIncludedTokens = includedTokensPlans.includes(normalizedPlan);
    const isActivated = !!subscription?.activatedAt;
    const hasPurchasedTokens = tokenBalance.totalPurchased > 0;
    
    // TRIAL RESTRICTION
    if (hasIncludedTokens && inTrial && !isActivated && !hasPurchasedTokens && isBlockedInTrial(feature)) {
      return res.status(402).json({
        error: 'AI-enhanced collection optimization is locked during trial period',
        trialRestriction: true,
        requiresActivation: true,
        trialEndsAt: subscription.trialEndsAt,
        currentPlan: subscription.plan,
        feature,
        tokensRequired: tokenEstimate.withMargin, // Use withMargin for consistency
        tokensEstimated: tokenEstimate.estimated,
        tokensAvailable: tokenBalance.balance,
        message: 'Activate your plan to unlock AI-enhanced optimization with included tokens'
      });
    }
    
    // Check token balance
    if (!tokenBalance.hasBalance(tokenEstimate.withMargin)) {
      const needsUpgrade = !['professional_plus', 'growth_plus', 'growth_extra', 'enterprise'].includes(normalizedPlan);
      
      return res.status(402).json({
        error: 'Insufficient token balance',
        requiresPurchase: true,
        needsUpgrade,
        currentPlan: planKey,
        tokensRequired: tokenEstimate.withMargin, // Use withMargin for consistency
        tokensEstimated: tokenEstimate.estimated,
        tokensAvailable: tokenBalance.balance,
        tokensNeeded: tokenEstimate.withMargin - tokenBalance.balance,
        feature,
        message: needsUpgrade 
          ? 'Purchase more tokens or upgrade to Growth Extra plan'
          : 'You need more tokens to use this feature'
      });
    }
    
    // Create enhance function for each collection
    const enhanceCollection = async (collectionData) => {
      const { collectionId, languages, title } = collectionData;
      
      try {
        // Call the existing collection enhancement endpoint
        const response = await fetch(`${process.env.APP_URL || 'http://localhost:3000'}/ai-enhance/collection/${encodeURIComponent(collectionId)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': req.headers.authorization || '',
            'x-shopify-shop-domain': shop
          },
          body: JSON.stringify({
            shop,
            languages
          })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
          if (response.status === 402 || response.status === 403) {
            const error = new Error(result.error || 'Token or plan restriction');
            error.status = response.status;
            error.trialRestriction = result.trialRestriction;
            throw error;
          }
          return { success: false, error: result.error };
        }
        
        if (!result.ok) {
          return { success: false, error: result.error || 'Enhancement failed' };
        }
        
        return { success: true, data: result };
        
      } catch (error) {
        if (error.status === 402 || error.status === 403) throw error;
        return { success: false, error: error.message };
      }
    };
    
    // Add job to queue
    const jobInfo = await collectionJobQueue.addJob(shop, collections, 'aiEnhance', enhanceCollection);
    
    return res.json({
      success: true,
      message: jobInfo.queued ? 'Collection AI Enhancement job queued' : jobInfo.message,
      ...jobInfo
    });
    
  } catch (error) {
    console.error('[AI-ENHANCE/COLLECTION-BATCH] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /ai-enhance/collection-job-status
 * Get status of background Collection AI Enhancement job
 */
router.get('/collection-job-status', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop not provided' });
    }
    
    const status = await collectionJobQueue.getJobStatus(shop, 'aiEnhance');
    return res.json(status);
    
  } catch (error) {
    console.error('[AI-ENHANCE/COLLECTION-JOB-STATUS] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;