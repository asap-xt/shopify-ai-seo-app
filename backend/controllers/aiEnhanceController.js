// backend/controllers/aiEnhanceController.js
import express from 'express';
import { requireShop, shopGraphQL } from './seoController.js';
import Subscription from '../db/Subscription.js';

const router = express.Router();

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
router.post('/product', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { productId, languages = [] } = req.body;
    
    console.log('🔍 [DEBUG] Starting AI enhance for product:', productId);
    console.log('🔍 [DEBUG] Languages:', languages);
    
    // Check plan
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    console.log('🔍 [DEBUG] Shop plan:', planKey);
    
    if (!['growth_extra', 'enterprise'].includes(planKey)) {
      return res.status(403).json({ 
        error: 'AI enhancement requires Growth Extra or Enterprise plan',
        currentPlan: planKey 
      });
    }
    
    const results = [];
    const model = 'google/gemini-2.5-flash'; // Правилният модел!
    
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
        
        const data = await shopGraphQL(shop, query, { productId });
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
        
        let enhanced;
        try {
          enhanced = JSON.parse(content);
          console.log(`🔍 [DEBUG] AI generated bullets:`, enhanced.bullets?.length);
          console.log(`🔍 [DEBUG] AI generated FAQ:`, enhanced.faq?.length);
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
router.post('/collection', async (req, res) => {
  try {
    const shop = requireShop(req);
    const { collectionId, languages = [] } = req.body;
    
    console.log('🔍 [DEBUG] Starting AI enhance for collection:', collectionId);
    
    // Check plan
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan || '';
    
    if (!['growth_extra', 'enterprise'].includes(planKey)) {
      return res.status(403).json({ 
        error: 'AI enhancement requires Growth Extra or Enterprise plan',
        currentPlan: planKey 
      });
    }
    
    const results = [];
    const model = 'google/gemini-2.5-flash';
    
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
        
        const data = await shopGraphQL(shop, query, { collectionId });
        
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

export default router;