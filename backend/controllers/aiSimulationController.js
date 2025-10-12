// backend/controllers/aiSimulationController.js
import express from 'express';
import { verifyRequest } from '../middleware/verifyRequest.js';
import { GraphQLClient } from 'graphql-request';
import Subscription from '../db/Subscription.js';
import TokenBalance from '../db/TokenBalance.js';
import { calculateFeatureCost, requiresTokens, isBlockedInTrial } from '../billing/tokenConfig.js';

// Copy ONLY the OpenRouter connection from aiEnhanceController
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

async function openrouterChat(model, messages, response_format_json = true) {
  console.log('🤖 [AI-SIMULATION] Starting OpenRouter request');
  console.log('🤖 [AI-SIMULATION] Model:', model);
  console.log('🤖 [AI-SIMULATION] Messages:', JSON.stringify(messages, null, 2));
  
  if (!OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key missing');
  }
  
  const rsp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      ...(process.env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': process.env.OPENROUTER_SITE_URL } : {}),
      ...(process.env.OPENROUTER_APP_NAME ? { 'X-Title': process.env.OPENROUTER_APP_NAME } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      ...(response_format_json ? { response_format: { type: 'json_object' } } : {}),
      messages,
    }),
  });
  
  if (!rsp.ok) {
    const text = await rsp.text().catch(() => '');
    console.error('🤖 [AI-SIMULATION] OpenRouter error:', rsp.status, text);
    throw new Error(`OpenRouter ${rsp.status}: ${text || rsp.statusText}`);
  }
  
  const j = await rsp.json();
  const content = j?.choices?.[0]?.message?.content || '';
  
  console.log('🤖 [AI-SIMULATION] Response received');
  console.log('🤖 [AI-SIMULATION] Content:', content);
  console.log('🤖 [AI-SIMULATION] Usage:', j?.usage);
  
  return { content, usage: j?.usage || {} };
}

const router = express.Router();

// POST /api/ai/simulate-response - Real AI simulation with OpenRouter
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
    console.log('[AI-SIMULATION] Access token available:', !!accessToken);
    
    // === TOKEN CHECKING ===
    // AI Testing/Simulation requires tokens for all plans
    const feature = 'ai-testing-simulation';
    
    if (requiresTokens(feature)) {
      // Get subscription and check trial status
      const subscription = await Subscription.findOne({ shop });
      const planKey = subscription?.plan || 'starter';
      const now = new Date();
      const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
      
      // Calculate required tokens
      const requiredTokens = calculateFeatureCost(feature);
      
      // Check token balance
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      // If in trial AND insufficient tokens → Block with trial activation modal
      if (inTrial && isBlockedInTrial(feature) && !tokenBalance.hasBalance(requiredTokens)) {
        return res.status(402).json({
          error: 'Feature not available during trial without tokens',
          trialRestriction: true,
          requiresActivation: true,
          trialEndsAt: subscription.trialEndsAt,
          currentPlan: planKey,
          feature,
          tokensRequired: requiredTokens,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: requiredTokens - tokenBalance.balance,
          message: 'AI Testing requires plan activation or token purchase'
        });
      }
      
      // If insufficient tokens → Request token purchase
      if (!tokenBalance.hasBalance(requiredTokens)) {
        const normalizedPlan = planKey.toLowerCase().replace(/\s+/g, '_');
        const needsUpgrade = !['growth_extra', 'enterprise'].includes(normalizedPlan) && planKey !== 'growth extra';
        
        return res.status(402).json({
          error: 'Insufficient token balance',
          requiresPurchase: true,
          needsUpgrade: needsUpgrade,
          minimumPlanForFeature: needsUpgrade ? 'Growth Extra' : null,
          currentPlan: planKey,
          tokensRequired: requiredTokens,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: requiredTokens - tokenBalance.balance,
          feature,
          message: needsUpgrade 
            ? 'Purchase more tokens or upgrade to Growth Extra plan for AI Testing'
            : 'You need more tokens to use AI Testing'
        });
      }
      
      // Deduct tokens immediately
      await tokenBalance.deductTokens(requiredTokens, feature, { questionType });
      console.log(`[AI-SIMULATION] Deducted ${requiredTokens} tokens for ${feature}, remaining: ${tokenBalance.balance}`);
    }
    // === END TOKEN CHECKING ===
    
    // Check if OpenRouter API key is available
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn('[AI-SIMULATION] OPENROUTER_API_KEY is not set. Falling back to basic simulation.');
      // Instead of returning error, fall back to basic simulation
      return res.json({
        success: true,
        aiResponse: 'AI simulation service not configured. Using basic simulation.',
        questionType,
        shop,
        fallback: true
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
      console.log('[AI-SIMULATION] Fetching products data...');
      const productsQuery = `
        query {
          products(first: 20) {
            edges {
              node {
                id
                title
                description
                productType
                vendor
                tags
              }
            }
          }
        }
      `;
      
      try {
        const productsResp = await adminGraphql.request(productsQuery);
        console.log('[AI-SIMULATION] Products response:', JSON.stringify(productsResp, null, 2));
        additionalData.products = productsResp?.products?.edges || [];
        console.log('[AI-SIMULATION] Products count:', additionalData.products.length);
      } catch (error) {
        console.error('[AI-SIMULATION] Products query error:', error);
        additionalData.products = [];
      }
    }
    
    if (questionType === 'categories') {
      console.log('[AI-SIMULATION] Fetching collections data...');
      const collectionsQuery = `
        query {
          collections(first: 20) {
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
      
      try {
        const collectionsResp = await adminGraphql.request(collectionsQuery);
        console.log('[AI-SIMULATION] Collections response:', JSON.stringify(collectionsResp, null, 2));
        additionalData.collections = collectionsResp?.collections?.edges || [];
        console.log('[AI-SIMULATION] Collections count:', additionalData.collections.length);
      } catch (error) {
        console.error('[AI-SIMULATION] Collections query error:', error);
        additionalData.collections = [];
      }
    }
    
    // Prepare context for AI
    const aiContext = {
      shop,
      questionType,
      organization: context.organization,
      website: context.website,
      ...additionalData
    };
    
    // Generate AI response using OpenRouter
    const prompt = generatePrompt(questionType, aiContext);
    console.log('[AI-SIMULATION] Prompt:', prompt);
    
    // Initialize OpenRouter
    console.log('[AI-SIMULATION] Initializing OpenRouter...');
    
    console.log('[AI-SIMULATION] Generating AI response...');
    const result = await openrouterChat('google/gemini-2.5-flash-lite', [
      {
        role: 'system',
        content: `You are an AI assistant providing information about an online Shopify store. Your responses should be concise, helpful, and based *only* on the provided structured data. If information is not available in the structured data, state that clearly.`
      },
      {
        role: 'user',
        content: prompt
      }
    ], false); // Don't use JSON format for simulation responses
    
    const aiResponse = result.content;
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
        const productsInfo = context.products.map(p => {
          const node = p.node;
          let info = `${node.title}`;
          if (node.description) info += ` - ${node.description.substring(0, 100)}`;
          if (node.productType) info += ` (${node.productType})`;
          if (node.vendor) info += ` by ${node.vendor}`;
          return info;
        }).join('\n- ');
        specificPrompt += `\n\nProducts available:\n- ${productsInfo}`;
      } else {
        specificPrompt += `\n\nNo product data available.`;
      }
      break;
      
    case 'business':
      specificPrompt = `Tell me about this business.`;
      if (context.organization) {
        specificPrompt += `\n\nOrganization info:\n${JSON.stringify(context.organization, null, 2)}`;
      }
      if (context.website) {
        specificPrompt += `\n\nWebsite info:\n${JSON.stringify(context.website, null, 2)}`;
      }
      break;
      
    case 'categories':
      specificPrompt = `What categories does this store have?`;
      if (context.collections && context.collections.length > 0) {
        const collectionsInfo = context.collections.map(c => {
          let info = `${c.node.title}`;
          if (c.node.description) info += ` - ${c.node.description.substring(0, 100)}`;
          return info;
        }).join('\n- ');
        specificPrompt += `\n\nCollections available:\n- ${collectionsInfo}`;
      } else {
        specificPrompt += `\n\nNo collection data available.`;
      }
      break;
      
    case 'contact':
      specificPrompt = `What is this store's contact information?`;
      if (context.organization && context.organization.contactPoint) {
        specificPrompt += `\n\nContact info:\n${JSON.stringify(context.organization.contactPoint, null, 2)}`;
      }
      break;
      
    default:
      specificPrompt = `Provide general information about this store.`;
  }
  
  specificPrompt += ` Keep your response concise, helpful, and natural. Write as if you're an AI assistant answering a customer's question.`;
  
  return `${basePrompt}\n\n${specificPrompt}`;
}

export default router;
