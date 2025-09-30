// backend/controllers/aiSimulationController.js
import express from 'express';
import { verifyRequest } from '../middleware/verifyRequest.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GraphQLClient } from 'graphql-request';

const router = express.Router();

// POST /api/ai/simulate-response - Real AI simulation with Gemini
router.post('/simulate-response', verifyRequest, async (req, res) => {
  const shop = req.shopDomain;
  const accessToken = req.shopAccessToken;
  
  if (!shop || !accessToken) {
    return res.status(401).json({ error: 'No shop session. Reinstall app.' });
  }
  
  try {
    const { questionType, context } = req.body;
    
    console.log('[AI-SIMULATION] Starting simulation for:', questionType);
    console.log('[AI-SIMULATION] Shop:', shop);
    console.log('[AI-SIMULATION] Context:', context);
    
    // Check if Gemini API key is available
    if (!process.env.GEMINI_API_KEY) {
      console.error('[AI-SIMULATION] GEMINI_API_KEY is not set.');
      return res.status(500).json({ 
        success: false, 
        error: 'AI simulation service not configured.',
        fallback: 'AI simulation temporarily unavailable'
      });
    }
    
    // Initialize GraphQL client
    const adminGraphql = new GraphQLClient(`https://${shop}/admin/api/2024-01/graphql.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });
    
    // Fetch additional data based on question type
    let additionalData = {};
    
    if (questionType === 'products') {
      const productsQuery = `
        query {
          products(first: 10, query: "metafields.seo_ai.bullets:*") {
            edges {
              node {
                id
                title
                description
                metafields(first: 10, namespace: "seo_ai") {
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
      `;
      
      const productsResp = await adminGraphql.request(productsQuery);
      additionalData.products = productsResp?.data?.products?.edges || [];
    }
    
    if (questionType === 'categories') {
      const collectionsQuery = `
        query {
          collections(first: 10) {
            edges {
              node {
                id
                title
                description
              }
            }
          }
        }
      `;
      
      const collectionsResp = await adminGraphql.request(collectionsQuery);
      additionalData.collections = collectionsResp?.data?.collections?.edges || [];
    }
    
    // Prepare context for AI
    const aiContext = {
      shop,
      questionType,
      organization: context.organization,
      website: context.website,
      ...additionalData
    };
    
    // Generate AI response using Gemini
    const prompt = generatePrompt(questionType, aiContext);
    console.log('[AI-SIMULATION] Prompt:', prompt);
    
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: { 
        parts: [{ 
          text: `You are an AI assistant providing information about an online Shopify store. Your responses should be concise, helpful, and based *only* on the provided structured data. If information is not available in the structured data, state that clearly.` 
        }] 
      }
    });
    
    const aiResponse = result.response.text();
    console.log('[AI-SIMULATION] AI Response:', aiResponse);
    
    res.json({
      success: true,
      aiResponse: aiResponse,
      questionType,
      shop
    });
    
  } catch (error) {
    console.error('[AI-SIMULATION] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      fallback: 'AI simulation temporarily unavailable'
    });
  }
});

function generatePrompt(questionType, context) {
  const basePrompt = `You are an AI assistant helping customers understand a Shopify store. Based on the provided structured data, answer the following question about the store "${context.shop}":`;
  
  let specificPrompt = '';
  
  switch (questionType) {
    case 'products':
      specificPrompt = `What products does this store sell?`;
      if (context.products && context.products.length > 0) {
        specificPrompt += ` Here are the products with AI optimization: ${context.products.map(p => p.node.title).join(', ')}.`;
      }
      break;
      
    case 'business':
      specificPrompt = `Tell me about this business.`;
      if (context.organization) {
        specificPrompt += ` Organization info: ${JSON.stringify(context.organization)}.`;
      }
      break;
      
    case 'categories':
      specificPrompt = `What categories does this store have?`;
      if (context.collections && context.collections.length > 0) {
        specificPrompt += ` Here are the collections: ${context.collections.map(c => c.node.title).join(', ')}.`;
      }
      break;
      
    case 'contact':
      specificPrompt = `What is this store's contact information?`;
      if (context.organization && context.organization.contactPoint) {
        specificPrompt += ` Contact info: ${JSON.stringify(context.organization.contactPoint)}.`;
      }
      break;
      
    default:
      specificPrompt = `Provide general information about this store.`;
  }
  
  specificPrompt += ` Keep your response concise, helpful, and natural. Write as if you're an AI assistant answering a customer's question.`;
  
  return `${basePrompt}\n\n${specificPrompt}`;
}

export default router;
