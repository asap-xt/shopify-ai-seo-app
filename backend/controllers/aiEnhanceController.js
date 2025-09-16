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

// POST /ai-enhance/collection/:collectionId - Batch enhance all products in collection
router.post('/collection/:collectionId', validateRequest(), async (req, res) => {
  console.log('🔍 [AI-ENHANCE-BATCH] Endpoint hit!', {
    collectionId: req.params.collectionId,
    shop: req.shopDomain,
    body: req.body
  });
  
  try {
    const shop = req.shopDomain;
    const { collectionId } = req.params;
    const { languages = ['en'] } = req.body;
    
    console.log('🔍 [AI-ENHANCE-BATCH] Starting for collection:', collectionId);
    
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
    
    // Get all products in collection
    const query = `
      query GetCollectionProducts($id: ID!) {
        collection(id: $id) {
          title
          products(first: 250) {
            edges {
              node {
                id
                title
                metafields(namespace: "seo_ai", first: 20) {
                  edges {
                    node {
                      key
                      value
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    
    const data = await shopGraphQL(req, shop, query, { id: collectionId });
    
    if (!data?.collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    const products = data.collection.products.edges.map(e => e.node);
    console.log('🔍 [AI-ENHANCE-BATCH] Found products:', products.length);
    
    const results = {
      successful: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
    
    // Process each product
    for (const product of products) {
      try {
        // Check if already has SEO for any language
        const hasSeo = product.metafields.edges.some(e => 
          e.node.key.startsWith('seo__')
        );
        
        if (!hasSeo) {
          console.log('🔍 [AI-ENHANCE-BATCH] Skipping product without SEO:', product.title);
          results.skipped++;
          continue;
        }
        
        // Process each language
        for (const language of languages) {
          const metafieldKey = `seo__${language.toLowerCase()}`;
          const seoMetafield = product.metafields.edges.find(e => 
            e.node.key === metafieldKey
          );
          
          if (!seoMetafield) {
            console.log(`🔍 [AI-ENHANCE-BATCH] No ${language} SEO for:`, product.title);
            continue;
          }
          
          const currentSeo = JSON.parse(seoMetafield.node.value);
          
          // Generate enhancement
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
              content: `Product: ${currentSeo.title}\nDescription: ${currentSeo.metaDescription}`
            }
          ];
          
          const { content } = await openrouterChat('google/gemini-2.5-flash-lite', messages, true);
          const enhanced = JSON.parse(content);
          
          // Save enhanced data back to metafield
          const updatedSeo = {
            ...currentSeo,
            bullets: enhanced.bullets || currentSeo.bullets,
            faq: enhanced.faq || currentSeo.faq
          };
          
          // Update metafield mutation
          const updateMutation = `
            mutation UpdateProductMetafield($input: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $input) {
                metafields {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          
          await shopGraphQL(req, shop, updateMutation, {
            input: [{
              ownerId: product.id,
              namespace: "seo_ai",
              key: metafieldKey,
              value: JSON.stringify(updatedSeo),
              type: "json"
            }]
          });
        }
        
        results.successful++;
      } catch (error) {
        console.error('🔍 [AI-ENHANCE-BATCH] Error for product:', product.title, error);
        results.failed++;
        results.errors.push({
          product: product.title,
          error: error.message
        });
      }
    }
    
    console.log('🔍 [AI-ENHANCE-BATCH] Complete:', results);
    
    res.json({
      ok: true,
      data: {
        collectionTitle: data.collection.title,
        results
      }
    });
    
  } catch (error) {
    console.error('🔍 [AI-ENHANCE-BATCH] Fatal error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;