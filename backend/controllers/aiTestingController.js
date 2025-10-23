// backend/controllers/aiTestingController.js
import express from 'express';
import { validateRequest } from '../middleware/shopifyAuth.js';
import fetch from 'node-fetch';
import { getGeminiResponse } from '../ai/gemini.js';
import TokenBalance from '../db/TokenBalance.js';
import Product from '../db/Product.js';
import Collection from '../db/Collection.js';
import Subscription from '../db/Subscription.js';

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
  
  // Get stats from database (same as Dashboard)
  const totalProducts = await Product.countDocuments({ shop });
  const optimizedProducts = await Product.countDocuments({ 
    shop, 
    'seoStatus.optimized': true 
  });
  const totalCollections = await Collection.countDocuments({ shop });
  const optimizedCollections = await Collection.countDocuments({ 
    shop, 
    'seoStatus.optimized': true 
  });
  
  console.log('[AI-TESTING] Stats:', {
    products: `${optimizedProducts}/${totalProducts}`,
    collections: `${optimizedCollections}/${totalCollections}`
  });
  
  // Get user's plan
  const subscription = await Subscription.findOne({ shop });
  const userPlan = subscription?.plan?.toLowerCase().replace(' ', '_') || 'starter';
  console.log('[AI-TESTING] User plan:', userPlan);
  
  // Endpoints ordered by plan: Starter → Professional → Growth → Growth Extra → Enterprise
  const endpoints = [
    // Starter plan features
    { 
      key: 'productsJson', 
      name: 'Products JSON Feed', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/products.json?shop=${shop}`
    },
    { 
      key: 'basicSitemap', 
      name: 'Basic Sitemap', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/sitemap_products.xml?shop=${shop}`
    },
    { 
      key: 'robotsTxt', 
      name: 'robots.txt.liquid', 
      url: `https://${shop}/robots.txt`,
      themeFile: true
    },
    { 
      key: 'schemaData', 
      name: 'Schema Data (theme.liquid)', 
      url: `https://${shop}`,
      themeFile: true
    },
    // Growth plan features
    { 
      key: 'welcomePage', 
      name: 'AI Welcome Page (Growth+)', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/welcome?shop=${shop}`,
      requiresPlan: ['growth', 'growth_extra', 'enterprise']
    },
    { 
      key: 'collectionsJson', 
      name: 'Collections JSON Feed (Growth+)', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/collections-feed.json?shop=${shop}`,
      requiresPlan: ['growth', 'growth_extra', 'enterprise']
    },
    // Growth Extra plan features
    { 
      key: 'storeMetadata', 
      name: 'Store Metadata (Growth Extra+)', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/store-metadata.json?shop=${shop}`,
      requiresPlan: ['growth_extra', 'enterprise']
    },
    { 
      key: 'aiSitemap', 
      name: 'AI-Optimized Sitemap (Growth Extra+)', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/sitemap_products.xml?shop=${shop}`,
      requiresPlan: ['growth_extra', 'enterprise']
    },
    // Enterprise plan features
    { 
      key: 'advancedSchemaApi', 
      name: 'Advanced Schema Data (Enterprise)', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/schema-data.json?shop=${shop}`,
      requiresPlan: ['enterprise']
    }
  ];
  
  const results = {};
  
  for (const endpoint of endpoints) {
    try {
      console.log('[AI-TESTING] Testing endpoint:', endpoint.key, endpoint.url);
      
      // Check plan requirements
      if (endpoint.requiresPlan && !endpoint.requiresPlan.includes(userPlan)) {
        results[endpoint.key] = {
          status: 'locked',
          message: `Requires ${endpoint.requiresPlan.map(p => p.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())).join(' or ')} plan`,
          name: endpoint.name
        };
        console.log('[AI-TESTING] Locked:', endpoint.key);
        continue;
      }
      
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
          
          // Smart validation: check if data is meaningful
          let validationStatus = 'success';
          let validationMessage = 'Endpoint is working correctly';
          
          // Products JSON Feed validation
          if (endpoint.key === 'productsJson') {
            if (optimizedProducts === 0) {
              validationStatus = 'warning';
              validationMessage = `0/${totalProducts} products optimized`;
            } else {
              validationMessage = `${optimizedProducts}/${totalProducts} products optimized`;
            }
          }
          
          // Collections JSON Feed validation
          if (endpoint.key === 'collectionsJson') {
            if (optimizedCollections === 0) {
              validationStatus = 'warning';
              validationMessage = `0/${totalCollections} collections optimized`;
            } else {
              validationMessage = `${optimizedCollections}/${totalCollections} collections optimized`;
            }
          }
          
          // Store Metadata validation
          if (endpoint.key === 'storeMetadata' && data) {
            if (!data.organization && !data.seo_metadata) {
              validationStatus = 'warning';
              validationMessage = 'Endpoint OK, but no organization or SEO data configured';
            }
          }
          
          // Basic Sitemap validation
          if (endpoint.key === 'basicSitemap' && data) {
            if (typeof data === 'string') {
              const hasProducts = data.includes('<loc>') && data.includes('/products/');
              if (!hasProducts) {
                validationStatus = 'warning';
                validationMessage = 'Sitemap generated but no products found';
              } else {
                validationMessage = 'Sitemap is working correctly';
              }
            }
          }
          
          // AI-Enhanced Sitemap validation (checks for AI metadata)
          if (endpoint.key === 'aiSitemap' && data) {
            if (typeof data === 'string') {
              const hasAIMetadata = data.includes('xmlns:ai=') && data.includes('<ai:product>');
              if (!hasAIMetadata) {
                validationStatus = 'warning';
                validationMessage = 'Sitemap OK, but no AI enhancements detected';
              } else {
                validationMessage = 'AI-enhanced sitemap is working correctly';
              }
            }
          }
          
          // robots.txt.liquid validation
          if (endpoint.key === 'robotsTxt' && data) {
            if (typeof data === 'string') {
              const hasCustomContent = data.includes('sitemap_products.xml') || data.includes('User-agent:');
              if (!hasCustomContent) {
                validationStatus = 'warning';
                validationMessage = 'robots.txt found, but may need custom configuration';
              } else {
                validationMessage = 'robots.txt.liquid is configured correctly';
              }
            }
          }
          
          // Schema Data (theme.liquid) validation
          if (endpoint.key === 'schemaData' && data) {
            if (typeof data === 'string') {
              // Look for multiple indicators of schema.org structured data
              const hasLdJson = data.includes('application/ld+json');
              const hasSchemaOrg = data.includes('schema.org');
              const hasOrganization = data.includes('"@type":"Organization') || data.includes('"@type": "Organization');
              const hasWebSite = data.includes('"@type":"WebSite') || data.includes('"@type": "WebSite');
              
              if (!hasLdJson && !hasSchemaOrg) {
                validationStatus = 'warning';
                validationMessage = 'Page loaded, but schema data not detected in theme';
              } else if (hasLdJson && (hasOrganization || hasWebSite)) {
                validationMessage = 'Schema data is installed and working correctly in theme';
              } else {
                validationStatus = 'warning';
                validationMessage = 'Schema data found but may be incomplete or not rendering';
              }
            }
          }
          
          // Advanced Schema API validation
          if (endpoint.key === 'advancedSchemaApi' && data) {
            const schemasCount = data.schemas?.length || 0;
            if (schemasCount === 0) {
              validationStatus = 'warning';
              validationMessage = 'API OK, but no advanced schemas generated yet';
            } else {
              validationMessage = `${schemasCount} advanced schema${schemasCount > 1 ? 's' : ''} available`;
            }
          }
          
          results[endpoint.key] = {
            status: validationStatus,
            message: validationMessage,
            name: endpoint.name,
            dataSize: dataSize,
            contentType: contentType
          };
          
          console.log('[AI-TESTING]', validationStatus === 'warning' ? 'Warning:' : 'Success:', endpoint.key, 'Size:', dataSize);
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
        // Special messages for sitemaps
        let notFoundMessage = 'Endpoint not found';
        let actionLink = null;
        
        if (endpoint.key === 'basicSitemap') {
          notFoundMessage = 'Sitemap not generated yet. Please generate it first in Search Optimization for AI → Sitemap';
          actionLink = '/ai-seo/sitemap';
        } else if (endpoint.key === 'aiSitemap') {
          notFoundMessage = 'Endpoint not found, please generate it first in Settings';
          actionLink = '/ai-seo/settings';
        }
        
        results[endpoint.key] = {
          status: 'error',
          message: notFoundMessage,
          name: endpoint.name,
          actionLink
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
    
    // Process successful and warning endpoints (skip locked and failed)
    const successfulEndpoints = Object.entries(endpointResults).filter(
      ([key, result]) => result.status === 'success' || result.status === 'warning'
    );
    
    console.log('[AI-VALIDATION] Processing', successfulEndpoints.length, 'endpoints');
    
    for (const [key, result] of successfulEndpoints) {
      try {
        console.log('[AI-VALIDATION] Validating:', key);
        
        // Map endpoint keys to correct URLs (from run-tests endpoint definitions)
        const endpointUrls = {
          productsJson: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/products.json?shop=${shop}`,
          basicSitemap: `${process.env.APP_URL || `https://${req.get('host')}`}/sitemap_products.xml?shop=${shop}`,
          robotsTxt: `https://${shop}/robots.txt`,
          schemaData: `https://${shop}`,
          storeMetadata: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/store-metadata.json?shop=${shop}`,
          welcomePage: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/welcome?shop=${shop}`,
          collectionsJson: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/collections-feed.json?shop=${shop}`,
          aiSitemap: `${process.env.APP_URL || `https://${req.get('host')}`}/sitemap_products.xml?shop=${shop}`,
          advancedSchemaApi: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/schema-data.json?shop=${shop}`
        };
        
        // Fetch the actual data
        const dataResponse = await fetch(endpointUrls[key] || result.url);
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
        
        // Create AI prompt (adjust for HTML vs JSON content)
        const isHtmlContent = data.includes('<!DOCTYPE') || data.includes('<html');
        const contentDescription = isHtmlContent ? 
          `This is an HTML page. Analyze: meta tags, schema.org structured data, content quality, SEO elements, and overall page structure.` :
          `Analyze the data structure, completeness, and SEO optimization.`;
        
        const prompt = `You are an AI SEO expert analyzing endpoint data for e-commerce stores.

Analyze this ${result.name} data and provide:
1. Rating: excellent/good/fair/poor
2. Feedback: 1-2 sentences about data quality
3. Suggestions: Specific improvement recommendations (if any)

${contentDescription}

Data sample:
${data}

IMPORTANT: Respond with ONLY valid JSON, no markdown, no code blocks, no extra text.

Format:
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
        
        // Parse AI response (handle markdown code blocks and various formats)
        try {
          // Remove markdown code blocks if present (```json ... ``` or ``` ... ```)
          let cleanResponse = aiResponse.trim();
          
          // Method 1: Remove markdown code blocks
          if (cleanResponse.startsWith('```')) {
            cleanResponse = cleanResponse.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/i, '').trim();
          }
          
          // Method 2: Extract JSON from text (find first { to last })
          const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            cleanResponse = jsonMatch[0];
          }
          
          console.log('[AI-VALIDATION] Cleaned response for', key, ':', cleanResponse);
          
          const parsed = JSON.parse(cleanResponse);
          results[key] = {
            rating: parsed.rating || 'good',
            feedback: parsed.feedback || 'Data appears well-structured.',
            suggestions: parsed.suggestions || null
          };
          totalTokensUsed += 10; // Estimate 10 tokens per endpoint
        } catch (parseError) {
          console.error('[AI-VALIDATION] Parse error for', key, ':', parseError.message);
          console.error('[AI-VALIDATION] Raw response:', aiResponse);
          console.error('[AI-VALIDATION] Response length:', aiResponse.length);
          console.error('[AI-VALIDATION] Response type:', typeof aiResponse);
          
          // Try to extract feedback from plain text response
          const feedbackMatch = aiResponse.match(/feedback["\s:]+([^"}\n]+)/i);
          const ratingMatch = aiResponse.match(/rating["\s:]+([a-z]+)/i);
          
          results[key] = {
            rating: ratingMatch ? ratingMatch[1] : 'good',
            feedback: feedbackMatch ? feedbackMatch[1].trim() : aiResponse.substring(0, 100),
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

