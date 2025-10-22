// backend/controllers/aiTestingController.js
import express from 'express';
import { validateRequest } from '../middleware/shopifyAuth.js';
import fetch from 'node-fetch';
import { getGeminiResponse } from '../ai/gemini.js';
import TokenBalance from '../db/TokenBalance.js';

const router = express.Router();

/**
 * POST /api/ai-testing/run-tests
 * Run automated tests for AI Discovery endpoints
 */
router.post('/ai-testing/run-tests', validateRequest(), async (req, res) => {
  const shop = req.shopDomain || req.query.shop || req.body.shop;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter required' });
  }
  
  console.log('[AI-TESTING] Running tests for shop:', shop);
  
  const endpoints = [
    { 
      key: 'productsJson', 
      name: 'Products JSON Feed', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/products.json?shop=${shop}`
    },
    { 
      key: 'storeMetadata', 
      name: 'Store Metadata', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/store-metadata.json?shop=${shop}`
    },
    { 
      key: 'welcomePage', 
      name: 'AI Welcome Page', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/welcome?shop=${shop}`
    },
    { 
      key: 'collectionsJson', 
      name: 'Collections JSON Feed', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/collections-feed.json?shop=${shop}`
    },
    { 
      key: 'aiSitemap', 
      name: 'AI-Enhanced Sitemap', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/sitemap.xml?shop=${shop}`
    },
    { 
      key: 'schemaData', 
      name: 'Advanced Schema Data', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/schema-data.json?shop=${shop}`
    }
  ];
  
  const results = {};
  
  for (const endpoint of endpoints) {
    try {
      console.log('[AI-TESTING] Testing endpoint:', endpoint.key, endpoint.url);
      
      const response = await fetch(endpoint.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'AI-SEO-Testing-Bot/1.0'
        },
        timeout: 10000 // 10 second timeout
      });
      
      console.log('[AI-TESTING] Response status:', response.status);
      
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        let data = null;
        let dataSize = 0;
        
        try {
          if (contentType && contentType.includes('application/json')) {
            const text = await response.text();
            data = JSON.parse(text);
            dataSize = text.length;
          } else if (contentType && contentType.includes('text/html')) {
            data = await response.text();
            dataSize = data.length;
          } else if (contentType && (contentType.includes('xml') || contentType.includes('text/plain'))) {
            data = await response.text();
            dataSize = data.length;
          } else {
            data = await response.text();
            dataSize = data.length;
          }
          
          results[endpoint.key] = {
            status: 'success',
            message: 'Endpoint is working correctly',
            name: endpoint.name,
            dataSize: dataSize,
            contentType: contentType
          };
          
          console.log('[AI-TESTING] Success:', endpoint.key, 'Size:', dataSize);
        } catch (parseError) {
          console.error('[AI-TESTING] Parse error:', parseError);
          results[endpoint.key] = {
            status: 'error',
            message: `Failed to parse response: ${parseError.message}`,
            name: endpoint.name
          };
        }
      } else if (response.status === 403) {
        results[endpoint.key] = {
          status: 'locked',
          message: 'Feature not enabled or plan upgrade required',
          name: endpoint.name
        };
      } else if (response.status === 402) {
        results[endpoint.key] = {
          status: 'locked',
          message: 'Plan upgrade required',
          name: endpoint.name
        };
      } else if (response.status === 404) {
        results[endpoint.key] = {
          status: 'error',
          message: 'Endpoint not found',
          name: endpoint.name
        };
      } else {
        const errorText = await response.text();
        results[endpoint.key] = {
          status: 'error',
          message: `HTTP ${response.status}: ${response.statusText}`,
          name: endpoint.name,
          details: errorText.substring(0, 200)
        };
      }
    } catch (error) {
      console.error('[AI-TESTING] Error testing endpoint:', endpoint.key, error);
      results[endpoint.key] = {
        status: 'error',
        message: error.message || 'Failed to fetch endpoint',
        name: endpoint.name
      };
    }
  }
  
  console.log('[AI-TESTING] Test results:', JSON.stringify(results, null, 2));
  
  res.json({
    shop,
    timestamp: new Date().toISOString(),
    results
  });
});

/**
 * POST /api/ai-testing/ai-validate
 * AI-powered validation of endpoint data using Gemini 2.5 Flash Lite
 */
router.post('/ai-testing/ai-validate', validateRequest(), async (req, res) => {
  const shop = req.shopDomain || req.query.shop || req.body.shop;
  const { endpointResults } = req.body;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter required' });
  }
  
  if (!endpointResults || Object.keys(endpointResults).length === 0) {
    return res.status(400).json({ error: 'No endpoint results provided. Run basic tests first.' });
  }
  
  console.log('[AI-VALIDATION] Starting AI validation for shop:', shop);
  
  try {
    // Get token balance
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    console.log('[AI-VALIDATION] Token balance:', tokenBalance.balance);
    
    // Check if enough tokens (estimate ~50 tokens total)
    const estimatedTokens = 50;
    if (!tokenBalance.hasBalance(estimatedTokens)) {
      return res.status(402).json({
        error: 'Insufficient tokens',
        requiresPurchase: true,
        message: `You need at least ${estimatedTokens} tokens to run AI validation`,
        tokenCost: estimatedTokens,
        currentBalance: tokenBalance.balance
      });
    }
    
    // Reserve tokens
    await tokenBalance.reserveTokens(estimatedTokens, 'ai-validation');
    
    const results = {};
    let totalTokensUsed = 0;
    
    // Process only successful endpoints
    const successfulEndpoints = Object.entries(endpointResults).filter(
      ([key, result]) => result.status === 'success'
    );
    
    console.log('[AI-VALIDATION] Processing', successfulEndpoints.length, 'endpoints');
    
    for (const [key, result] of successfulEndpoints) {
      try {
        console.log('[AI-VALIDATION] Validating:', key);
        
        // Fetch the actual data
        const dataResponse = await fetch(result.url || `${process.env.APP_URL}/ai/${key}.json?shop=${shop}`);
        let data = '';
        
        if (dataResponse.ok) {
          const contentType = dataResponse.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            data = JSON.stringify(await dataResponse.json(), null, 2);
          } else {
            data = await dataResponse.text();
          }
          
          // Limit data size for AI (max 4000 chars)
          if (data.length > 4000) {
            data = data.substring(0, 4000) + '\n... (truncated)';
          }
        }
        
        // Create AI prompt
        const prompt = `You are an AI SEO expert analyzing endpoint data for e-commerce stores.

Analyze this ${result.name} data and provide:
1. Rating: excellent/good/fair/poor
2. Feedback: 1-2 sentences about data quality
3. Suggestions: Specific improvement recommendations (if any)

Data sample:
${data}

Respond in JSON format:
{
  "rating": "excellent|good|fair|poor",
  "feedback": "Your feedback here",
  "suggestions": "Your suggestions here (or null if none)"
}`;
        
        const aiResponse = await getGeminiResponse(prompt, {
          maxTokens: 150,
          temperature: 0.3
        });
        
        console.log('[AI-VALIDATION] AI response for', key, ':', aiResponse);
        
        // Parse AI response
        try {
          const parsed = JSON.parse(aiResponse);
          results[key] = {
            rating: parsed.rating || 'good',
            feedback: parsed.feedback || 'Data appears well-structured.',
            suggestions: parsed.suggestions || null
          };
          totalTokensUsed += 10; // Estimate 10 tokens per endpoint
        } catch (parseError) {
          console.error('[AI-VALIDATION] Parse error:', parseError);
          results[key] = {
            rating: 'good',
            feedback: 'AI analysis completed but response format was unexpected.',
            suggestions: null
          };
        }
      } catch (error) {
        console.error('[AI-VALIDATION] Error validating', key, ':', error);
        results[key] = {
          rating: 'fair',
          feedback: 'Could not complete AI analysis for this endpoint.',
          suggestions: null
        };
      }
    }
    
    // Finalize token usage
    await tokenBalance.finalizeReservation(totalTokensUsed, 'ai-validation', {
      endpointsAnalyzed: successfulEndpoints.length
    });
    
    console.log('[AI-VALIDATION] Validation completed. Tokens used:', totalTokensUsed);
    
    res.json({
      shop,
      timestamp: new Date().toISOString(),
      results,
      tokensUsed: totalTokensUsed,
      tokenBalance: tokenBalance.balance
    });
    
  } catch (error) {
    console.error('[AI-VALIDATION] Error:', error);
    res.status(500).json({ error: 'Failed to complete AI validation' });
  }
});

export default router;

