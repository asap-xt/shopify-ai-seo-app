// backend/controllers/aiEnhanceController.js
import express from 'express';
import { requireShop, shopGraphQL } from './seoController.js';
import { validateRequest } from '../middleware/shopifyAuth.js';
import { verifyRequest } from '../middleware/verifyRequest.js';
import Subscription from '../db/Subscription.js';

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
    
    // Normalize plan names for comparison
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    const isEligible = ['growth_extra', 'enterprise'].includes(normalizedPlan) || 
                      planKey === 'growth extra';
    
    res.json({ 
      eligible: isEligible, 
      plan: planKey,
      normalizedPlan,
      message: isEligible ? 'AI enhancement available' : 'Upgrade to Growth Extra or Enterprise for AI enhancement'
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

// POST /ai-enhance/product
router.post('/product', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { productId, languages = [] } = req.body;
    
    console.log('🔍 [DEBUG] Starting AI enhance for product:', productId);
    console.log('🔍 [DEBUG] Languages:', languages);
    
    // Check plan
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    console.log('🔍 [DEBUG] Shop plan:', planKey);
    
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    if (!['growth_extra', 'enterprise'].includes(normalizedPlan) && planKey !== 'growth extra') {
      return res.status(403).json({ 
        error: 'AI enhancement requires Growth Extra or Enterprise plan',
        currentPlan: planKey 
      });
    }
    
    const results = [];
    const model = 'google/gemini-2.5-flash-lite';
    
    for (const language of languages) {
      console.log(`🔍 [DEBUG] Processing language: ${language}`);
      
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
        console.log(`🔍 [DEBUG] Current SEO found:`, !!data?.product?.metafield?.value);
        
        if (!data?.product?.metafield?.value) {
          results.push({ 
            language, 
            error: 'No basic SEO found' 
          });
          continue;
        }
        
        const currentSeo = JSON.parse(data.product.metafield.value);
        
        // Simple prompt
        const messages = [
          {
            role: 'system',
            content: `Generate enhanced bullets and FAQ for a product in ${language}.
Output JSON with:
{
  "bullets": ["benefit1", "benefit2", "benefit3", "benefit4"],
  "faq": [
    {"q": "question1", "a": "answer1"},
    {"q": "question2", "a": "answer2"}, 
    {"q": "question3", "a": "answer3"}
  ]
}`
          },
          {
            role: 'user',
            content: `Title: ${currentSeo.title}\nDescription: ${currentSeo.metaDescription}`
          }
        ];
        
        const { content, usage } = await openrouterChat(model, messages, true);
        
        console.log(`🔍 [DEBUG] AI raw response for ${language}:`, content);
        
        let enhanced;
        try {
          enhanced = JSON.parse(content);
          console.log(`🔍 [DEBUG] AI parsed JSON for ${language}:`, JSON.stringify(enhanced, null, 2));
          console.log(`🔍 [DEBUG] AI generated bullets:`, enhanced.bullets?.length);
          console.log(`🔍 [DEBUG] AI generated FAQ:`, enhanced.faq?.length);
        } catch (parseError) {
          console.error(`🔍 [DEBUG] JSON parse error for ${language}:`, parseError);
          console.error(`🔍 [DEBUG] Raw content that failed to parse:`, content);
          throw new Error('Invalid JSON from AI');
        }
        
        const result = {
          language,
          bullets: enhanced.bullets || [],
          faq: enhanced.faq || [],
          usage
        };
        
        console.log(`🔍 [AI-ENHANCE] Final result for ${language}:`, JSON.stringify(result, null, 2));
        
        results.push(result);
        
      } catch (error) {
        console.error(`🔍 [DEBUG] Error for ${language}:`, error.message);
        results.push({ language, error: error.message });
      }
    }
    
    console.log('🔍 [DEBUG] All results:', results);
    
    res.json({ 
      success: true,
      productId,
      model,
      results 
    });
    
  } catch (error) {
    console.error('🔍 [DEBUG] Fatal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /ai-enhance/collection
router.post('/collection', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { collectionId, languages = [] } = req.body;
    
    console.log('🔍 [DEBUG] Starting AI enhance for collection:', collectionId);
    
    // Check plan
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
    if (!['growth_extra', 'enterprise'].includes(normalizedPlan) && planKey !== 'growth extra') {
      return res.status(403).json({ 
        error: 'AI enhancement requires Growth Extra or Enterprise plan',
        currentPlan: planKey
      });
    }
    
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
        console.error(`🔍 [DEBUG] Collection error for ${language}:`, error.message);
        results.push({ language, error: error.message });
      }
    }
    
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

router.post('/collection/:collectionId', async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { collectionId } = req.params;
    const { languages = [] } = req.body;
    
    const results = { enhanced: 0, failed: 0, errors: [] };
    
    for (const language of languages) {
      try {
        // 1. Зареди съществуващото SEO
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
        const existingSeo = JSON.parse(data?.collection?.metafield?.value || '{}');
        
        // 2. AI prompt - САМО за bullets & FAQ
        const prompt = {
          title: existingSeo.title,
          description: existingSeo.metaDescription,
          currentBullets: existingSeo.bullets || [],
          currentFaq: existingSeo.faq || []
        };
        
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
- bullets: array of strings (5 items)
- faq: array of objects with "q" and "a" keys (3-5 items)`
          },
          {
            role: 'user',
            content: JSON.stringify(prompt)
          }
        ];
        
        // 3. Извикай AI
        const response = await openrouterChat(model, messages, true);
        const enhanced = JSON.parse(response.content);
        
        // 4. Замести САМО bullets & FAQ
        const updatedSeo = {
          ...existingSeo,
          bullets: enhanced.bullets || existingSeo.bullets,
          faq: enhanced.faq || existingSeo.faq,
          enhancedAt: new Date().toISOString()
        };
        
        // 5. Запиши обратно
        const mutation = `
          mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { field message }
              metafields { id }
            }
          }
        `;
        
        await shopGraphQL(req, shop, mutation, {
          metafields: [{
            ownerId: collectionId,
            namespace: 'seo_ai',
            key: metafieldKey,
            type: 'json',
            value: JSON.stringify(updatedSeo)
          }]
        });
        
        results.enhanced++;
        
      } catch (error) {
        results.errors.push(`${language}: ${error.message}`);
        results.failed++;
      }
    }
    
    res.json({ 
      ok: results.enhanced > 0,
      enhanced: results.enhanced,
      failed: results.failed,
      errors: results.errors
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;