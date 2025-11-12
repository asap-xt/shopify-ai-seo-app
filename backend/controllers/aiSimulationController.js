// backend/controllers/aiSimulationController.js
import express from 'express';
import { verifyRequest } from '../middleware/verifyRequest.js';
import { GraphQLClient } from 'graphql-request';
import Subscription from '../db/Subscription.js';
import TokenBalance from '../db/TokenBalance.js';
import { 
  calculateFeatureCost, 
  requiresTokens, 
  isBlockedInTrial,
  estimateTokensWithMargin,
  calculateActualTokens
} from '../billing/tokenConfig.js';

// Copy ONLY the OpenRouter connection from aiEnhanceController
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

async function openrouterChat(model, messages, response_format_json = true) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key missing');
  }
  
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
  const usage = j?.usage || {};
  
  return {
    content,
    usage: {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
      total_cost: usage.total_cost || null
    }
  };
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
    
    // === TOKEN CHECKING WITH DYNAMIC TRACKING ===
    // AI Testing/Simulation requires tokens for all plans
    const feature = 'ai-testing-simulation';
    let reservationId = null;
    
    if (requiresTokens(feature)) {
      // Get subscription and check trial status
      const subscription = await Subscription.findOne({ shop });
      const planKey = subscription?.plan || 'starter';
      const now = new Date();
      const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
      
      // Estimate required tokens with 10% safety margin
      const tokenEstimate = estimateTokensWithMargin(feature);
      
      // Check token balance
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      // Check if plan has included tokens (Growth Extra, Enterprise)
      const normalizedPlanKey = planKey.toLowerCase().replace(/\s+/g, '_');
      const includedTokensPlans = ['growth_extra', 'enterprise'];
      const hasIncludedTokens = includedTokensPlans.includes(normalizedPlanKey);
      
      // TRIAL RESTRICTION: Different logic for included vs purchased tokens
      if (hasIncludedTokens && inTrial && isBlockedInTrial(feature)) {
        // Growth Extra/Enterprise with included tokens → Show "Activate Plan" modal
        return res.status(402).json({
          error: 'AI Testing is locked during trial period',
          trialRestriction: true,
          requiresActivation: true,
          trialEndsAt: subscription.trialEndsAt,
          currentPlan: subscription.plan,
          feature,
          tokensRequired: tokenEstimate.estimated,
          tokensWithMargin: tokenEstimate.withMargin,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: Math.max(0, tokenEstimate.withMargin - tokenBalance.balance),
          message: 'Activate your plan to unlock AI Testing with included tokens'
        });
      }
      
      // If insufficient tokens → Request token purchase
      if (!tokenBalance.hasBalance(tokenEstimate.withMargin)) {
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
            ? 'Purchase more tokens or upgrade to Growth Extra plan for AI Testing'
            : 'You need more tokens to use AI Testing'
        });
      }
      
      // Reserve tokens (with 10% safety margin) - will be adjusted to actual usage later
      const reservation = tokenBalance.reserveTokens(tokenEstimate.withMargin, feature, { questionType });
      reservationId = reservation.reservationId;
      await reservation.save();
    }
    // === END TOKEN CHECKING ===
    
    // Check if OpenRouter API key is available
    if (!process.env.OPENROUTER_API_KEY) {
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
        additionalData.products = productsResp?.products?.edges || [];
      } catch (error) {
        console.error('[AI-SIMULATION] Products query error:', error);
        additionalData.products = [];
      }
    }
    
    if (questionType === 'categories') {
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
        additionalData.collections = collectionsResp?.collections?.edges || [];
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
    
    // === FINALIZE TOKEN USAGE ===
    // Calculate actual tokens used from AI request
    if (reservationId && requiresTokens(feature) && result.usage) {
      const actual = calculateActualTokens(result.usage);
      
      // Finalize the reservation with actual usage
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      await tokenBalance.finalizeReservation(reservationId, actual.totalTokens);
      
      // Invalidate cache so new token balance is immediately visible
      try {
        const cacheService = await import('../services/cacheService.js');
        await cacheService.default.invalidateShop(shop);
      } catch (cacheErr) {
        console.error('[AI-SIMULATION] Failed to invalidate cache:', cacheErr);
      }
    }
    // === END TOKEN FINALIZATION ===
    
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
