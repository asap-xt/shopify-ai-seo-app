// backend/controllers/aiEnhanceController.js
import express from 'express';
import { requireShop, shopGraphQL } from './seoController.js';
import { validateRequest } from '../middleware/shopifyAuth.js';
import { verifyRequest } from '../middleware/verifyRequest.js';
import Subscription from '../db/Subscription.js';
import TokenBalance from '../db/TokenBalance.js';
import { validateAIResponse, createFactualPrompt } from '../utils/aiValidator.js';
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
  console.log('[AI-ENHANCE/HANDLER]', req.method, req.originalUrl, {
    queryShop: req.query?.shop,
    bodyShop: req.body?.shop,
    sessionShop: res.locals?.shopify?.session?.shop,
  });

  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[AI-ENHANCE/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  // Тук логни и от къде четеш Admin API токена:
  const tokenSource = 'db|kv|session'; // актуализирай според твоя сторидж
  console.log('[AI-ENHANCE/HANDLER] Resolving Admin token', { shop, tokenSource });

  try {
    const shop = req.shopDomain;
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    console.log('🔍 [CHECK-ELIGIBILITY] Shop:', shop, 'Plan:', planKey);
    
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

async function openrouterChat(model, messages, response_format_json = true) {
  console.log('🤖 [AI-ENHANCE] Starting OpenRouter request');
  console.log('🤖 [AI-ENHANCE] Model:', model);
  console.log('🤖 [AI-ENHANCE] Messages:', JSON.stringify(messages, null, 2));
  
  if (!OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key missing');
  }
  
  const rsp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
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
  
  console.log('🤖 [AI-ENHANCE] Response received');
  console.log('🤖 [AI-ENHANCE] Content:', content);
  console.log('🤖 [AI-ENHANCE] Usage:', j?.usage);
  
  return { content, usage: j?.usage || {} };
}

async function generateEnhancedBulletsFAQ(data) {
  const { shop, productId, model, language, product, existingSeo } = data;
  
  // Create factual prompt to prevent hallucinations
  const factualPrompt = createFactualPrompt(
    {
      title: product.title,
      description: existingSeo?.metaDescription || '',
      tags: [], // Will be populated from product data if needed
      existingSeo: existingSeo
    },
    ['bullets', 'faq']
  );
  
  const messages = [
    {
      role: 'system',
      content: `Language: ${language}. Generate ONLY factual bullets and FAQ based on provided product data. Return ONLY JSON with bullets array and faq array. Nothing else.`
    },
    {
      role: 'user',
      content: factualPrompt
    }
  ];
  
  const { content, usage } = await openrouterChat(model, messages, true);
  
  let enhanced;
  try {
    enhanced = JSON.parse(content);
  } catch (parseError) {
    console.error(`[AI-ENHANCE] JSON parse error for ${language}:`, parseError);
    throw new Error('Invalid JSON from AI');
  }
  
  // Validate AI response to prevent hallucinations
  const validated = validateAIResponse(enhanced, {
    title: product.title,
    description: existingSeo?.metaDescription || '',
    tags: [],
    existingSeo: existingSeo
  }, ['bullets', 'faq']);
  
  return {
    bullets: validated.bullets || [],
    faq: validated.faq || [],
    usage
  };
}

// POST /ai-enhance/product
router.post('/product', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { productId, languages = [] } = req.body;
    
    console.log(`[AI-ENHANCE] Starting for product ${productId}, ${languages.length} language(s)`);
    
    // Get subscription
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    // === PLAN CHECK: Professional+ required for Products AI enhancement ===
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    const productsAllowedPlans = ['professional', 'growth', 'growth_extra', 'enterprise'];
    
    if (!productsAllowedPlans.includes(normalizedPlan) && planKey !== 'growth extra') {
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
    
    // Check if feature requires tokens
    if (requiresTokens(feature)) {
      // Estimate required tokens with 10% safety margin
      const tokenEstimate = estimateTokensWithMargin(feature, { languages: languages.length });
      
      // Check token balance
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      console.log(`[AI-ENHANCE] Token estimate:`, tokenEstimate);
      console.log(`[AI-ENHANCE] Current balance: ${tokenBalance.balance}`);
      
      // Check if sufficient tokens are available (with margin)
      if (!tokenBalance.hasBalance(tokenEstimate.withMargin)) {
        // Determine if upgrade is needed (for Starter/Professional/Growth plans)
        const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
        const needsUpgrade = !['growth_extra', 'enterprise'].includes(normalizedPlan) && planKey !== 'growth extra';
        
        const responseData = {
          error: 'Insufficient token balance',
          requiresPurchase: true,
          needsUpgrade: needsUpgrade,
          minimumPlanForFeature: needsUpgrade ? 'Growth Extra' : null,
          currentPlan: planKey,
          tokensRequired: tokenEstimate.estimated,
          tokensWithMargin: tokenEstimate.withMargin,
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
      
      console.log(`[AI-ENHANCE] Reserved ${tokenEstimate.withMargin} tokens (${tokenEstimate.margin} margin), reservation: ${reservationId}`);
      console.log(`[AI-ENHANCE] Remaining balance after reservation: ${tokenBalance.balance}`);
    }
    // === END TOKEN CHECKING ===
    
    const results = [];
    const model = 'google/gemini-2.5-flash-lite';
    
    for (const language of languages) {
      try {
        // Get current SEO
        const metafieldKey = `seo__${language.toLowerCase()}`;
        const query = `
          query GetProductSEO($productId: ID!) {
            product(id: $productId) {
              title
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
          console.log(`Skipping ${language} - no base SEO found`);
          results.push({ 
            language, 
            error: 'No basic SEO found' 
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
        
        // Обновяваме САМО bullets и FAQ в съществуващия SEO обект
        const updatedSeo = {
          ...existingSeo,  // Запазва title, metaDescription, bodyHtml, jsonLd и всичко друго
          bullets: enhancedResult.bullets || existingSeo.bullets,
          faq: enhancedResult.faq || existingSeo.faq,
          updatedAt: new Date().toISOString()
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
        
        const result = {
          language,
          bullets: enhancedResult.bullets || [],
          faq: enhancedResult.faq || [],
          usage: enhancedResult.usage,
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
          
          console.log(`[AI-ENHANCE] ${result.language}: ${actual.totalTokens} tokens (prompt: ${actual.promptTokens}, completion: ${actual.completionTokens})`);
        }
      }
      
      console.log(`[AI-ENHANCE] Total actual tokens used: ${totalActualTokens}`);
      
      // Finalize the reservation with actual usage
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      await tokenBalance.finalizeReservation(reservationId, totalActualTokens);
      
      console.log(`[AI-ENHANCE] Finalized reservation ${reservationId}`);
      console.log(`[AI-ENHANCE] New balance: ${tokenBalance.balance}`);
    }
    // === END TOKEN FINALIZATION ===
    
    res.json({ 
      success: true,
      productId,
      model,
      results 
    });
    
  } catch (error) {
    console.error('[AI-ENHANCE] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /ai-enhance/collection
router.post('/collection', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { collectionId, languages = [] } = req.body;
    
    console.log(`[AI-ENHANCE] Starting for collection ${collectionId}, ${languages.length} language(s)`);
    
    // Get subscription
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    // === PLAN CHECK: Growth+ required for Collections AI enhancement ===
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    const collectionsAllowedPlans = ['growth', 'growth_extra', 'enterprise'];
    
    if (!collectionsAllowedPlans.includes(normalizedPlan) && planKey !== 'growth extra') {
      return res.status(403).json({
        error: 'AI-enhanced add-ons for Collections require Growth plan or higher',
        currentPlan: planKey,
        minimumPlanRequired: 'Growth',
        message: 'Upgrade to Growth plan to access AI-enhanced optimization for Collections'
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
    
    // Check if feature requires tokens
    if (requiresTokens(feature)) {
      // Estimate required tokens with 10% safety margin
      const tokenEstimate = estimateTokensWithMargin(feature, { languages: languages.length });
      
      // Check token balance
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      console.log(`[AI-ENHANCE] Token estimate:`, tokenEstimate);
      console.log(`[AI-ENHANCE] Current balance: ${tokenBalance.balance}`);
      
      // Check if sufficient tokens are available (with margin)
      if (!tokenBalance.hasBalance(tokenEstimate.withMargin)) {
        // Determine if upgrade is needed (for Starter/Professional/Growth plans)
        const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
        const needsUpgrade = !['growth_extra', 'enterprise'].includes(normalizedPlan) && planKey !== 'growth extra';
        
        return res.status(402).json({
          error: 'Insufficient token balance',
          requiresPurchase: true,
          needsUpgrade: needsUpgrade,
          minimumPlanForFeature: needsUpgrade ? 'Growth Extra' : null,
          currentPlan: planKey,
          tokensRequired: tokenEstimate.estimated,
          tokensWithMargin: tokenEstimate.withMargin,
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
      
      console.log(`[AI-ENHANCE] Reserved ${tokenEstimate.withMargin} tokens (${tokenEstimate.margin} margin), reservation: ${reservationId}`);
      console.log(`[AI-ENHANCE] Remaining balance after reservation: ${tokenBalance.balance}`);
    }
    // === END TOKEN CHECKING ===
    
    const results = [];
    const model = 'google/gemini-2.5-flash-lite';
    
    for (const language of languages) {
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
          enhanced = JSON.parse(content);
        } catch {
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
          
          console.log(`[AI-ENHANCE] ${result.language}: ${actual.totalTokens} tokens (prompt: ${actual.promptTokens}, completion: ${actual.completionTokens})`);
        }
      }
      
      console.log(`[AI-ENHANCE] Total actual tokens used: ${totalActualTokens}`);
      
      // Finalize the reservation with actual usage
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      await tokenBalance.finalizeReservation(reservationId, totalActualTokens);
      
      console.log(`[AI-ENHANCE] Finalized reservation ${reservationId}`);
      console.log(`[AI-ENHANCE] New balance: ${tokenBalance.balance}`);
    }
    // === END TOKEN FINALIZATION ===
    
    res.json({ 
      success: true,
      collectionId,
      model,
      results 
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /ai-enhance/collection/:collectionId
router.post('/collection/:collectionId', validateRequest(), async (req, res) => {
  console.log('[AI-ENHANCE-COLLECTION] Request details:', {
    shopDomain: req.shopDomain,
    bodyShop: req.body?.shop,
    queryShop: req.query?.shop,
    params: req.params
  });
  
  try {
    const shop = req.shopDomain || req.body?.shop || req.query?.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Shop not provided' });
    }
    
    const { collectionId } = req.params;
    const { languages = [] } = req.body;
    
    console.log(`[AI-ENHANCE] Starting for collection ${collectionId}, ${languages.length} language(s)`);
    
    // Get subscription
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    // === PLAN CHECK: Growth+ required for Collections AI enhancement ===
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    const collectionsAllowedPlans = ['growth', 'growth_extra', 'enterprise'];
    
    if (!collectionsAllowedPlans.includes(normalizedPlan) && planKey !== 'growth extra') {
      return res.status(403).json({
        error: 'AI-enhanced add-ons for Collections require Growth plan or higher',
        currentPlan: planKey,
        minimumPlanRequired: 'Growth',
        message: 'Upgrade to Growth plan to access AI-enhanced optimization for Collections'
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
    
    // Check if feature requires tokens
    if (requiresTokens(feature)) {
      // Estimate required tokens with 10% safety margin
      const tokenEstimate = estimateTokensWithMargin(feature, { languages: languages.length });
      
      // Check token balance
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      console.log(`[AI-ENHANCE] Token estimate:`, tokenEstimate);
      console.log(`[AI-ENHANCE] Current balance: ${tokenBalance.balance}`);
      
      // Check if sufficient tokens are available (with margin)
      if (!tokenBalance.hasBalance(tokenEstimate.withMargin)) {
        // Determine if upgrade is needed (for Starter/Professional/Growth plans)
        const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
        const needsUpgrade = !['growth_extra', 'enterprise'].includes(normalizedPlan) && planKey !== 'growth extra';
        
        return res.status(402).json({
          error: 'Insufficient token balance',
          requiresPurchase: true,
          needsUpgrade: needsUpgrade,
          minimumPlanForFeature: needsUpgrade ? 'Growth Extra' : null,
          currentPlan: planKey,
          tokensRequired: tokenEstimate.estimated,
          tokensWithMargin: tokenEstimate.withMargin,
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
      
      console.log(`[AI-ENHANCE] Reserved ${tokenEstimate.withMargin} tokens (${tokenEstimate.margin} margin), reservation: ${reservationId}`);
      console.log(`[AI-ENHANCE] Remaining balance after reservation: ${tokenBalance.balance}`);
    }
    // === END TOKEN CHECKING ===
    
    const results = { enhanced: 0, failed: 0, errors: [] };
    const model = 'google/gemini-2.5-flash-lite';
    
    for (const language of languages) {
      try {
        // 1. Load existing SEO
        const metafieldKey = `seo__${language}`;
        console.log(`[AI-ENHANCE] Loading existing SEO for ${language}`);
        
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
        console.log(`[AI-ENHANCE] GraphQL response:`, data?.collection?.metafield ? 'Found' : 'Not found');
        
        if (!data?.collection?.metafield?.value) {
          results.errors.push(`${language}: No basic SEO found`);
          results.failed++;
          continue;
        }
        
        const existingSeo = JSON.parse(data.collection.metafield.value);
        console.log(`[AI-ENHANCE] Existing SEO title: ${existingSeo.title}`);
        
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
        
        console.log(`[AI-ENHANCE] Calling OpenRouter for ${language}`);
        const { content, usage } = await openrouterChat(model, messages, true);
        
        // Track usage for finalization
        if (usage) {
          usageDetails.push({ language, usage });
        }
        
        let enhanced;
        try {
          enhanced = JSON.parse(content);
          console.log(`[AI-ENHANCE] AI returned ${enhanced.bullets?.length || 0} bullets and ${enhanced.faq?.length || 0} FAQ items`);
        } catch (parseErr) {
          console.error(`[AI-ENHANCE] Failed to parse AI response:`, content);
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
        
        console.log(`[AI-ENHANCE] Successfully enhanced ${language}`);
        results.enhanced++;
        
      } catch (error) {
        console.error(`[AI-ENHANCE] Error for ${language}:`, error);
        results.errors.push(`${language}: ${error.message}`);
        results.failed++;
      }
    }
    
    // === FINALIZE TOKEN USAGE ===
    // Calculate actual tokens used from all AI requests
    if (reservationId && requiresTokens(feature) && usageDetails.length > 0) {
      let totalActualTokens = 0;
      
      // Sum up actual tokens from all successful results
      for (const detail of usageDetails) {
        const actual = calculateActualTokens(detail.usage);
        totalActualTokens += actual.totalTokens;
        
        console.log(`[AI-ENHANCE] ${detail.language}: ${actual.totalTokens} tokens (prompt: ${actual.promptTokens}, completion: ${actual.completionTokens})`);
      }
      
      console.log(`[AI-ENHANCE] Total actual tokens used: ${totalActualTokens}`);
      
      // Finalize the reservation with actual usage
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      await tokenBalance.finalizeReservation(reservationId, totalActualTokens);
      
      console.log(`[AI-ENHANCE] Finalized reservation ${reservationId}`);
      console.log(`[AI-ENHANCE] New balance: ${tokenBalance.balance}`);
    }
    // === END TOKEN FINALIZATION ===
    
    console.log('[AI-ENHANCE] Final results:', results);
    
    res.json({ 
      ok: results.enhanced > 0,
      enhanced: results.enhanced,
      failed: results.failed,
      errors: results.errors
    });
    
  } catch (error) {
    console.error('[AI-ENHANCE] Fatal error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;