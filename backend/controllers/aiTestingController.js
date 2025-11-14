// backend/controllers/aiTestingController.js
import express from 'express';
import { validateRequest } from '../middleware/shopifyAuth.js';
import fetch from 'node-fetch';
import { getGeminiResponse } from '../ai/gemini.js';
import TokenBalance from '../db/TokenBalance.js';
import Product from '../db/Product.js';
import Collection from '../db/Collection.js';
import Subscription from '../db/Subscription.js';
import Shop from '../db/Shop.js';

const router = express.Router();

// Helper function to normalize plan names
const normalizePlan = (plan) => {
  return (plan || 'starter').toLowerCase().replace(/\s+/g, '_');
};

/**
 * POST /api/ai-testing/run-tests
 * Run automated tests for AI Discovery endpoints
 */
router.post('/ai-testing/run-tests', validateRequest(), async (req, res) => {
  const shop = req.shopDomain || req.query.shop || req.body.shop;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter required' });
  }
  
  // Get shop record for access token
  const shopRecord = await Shop.findOne({ shop });
  if (!shopRecord) {
    return res.status(404).json({ error: 'Shop not found' });
  }
  
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
  
  // Get user's plan
  const subscription = await Subscription.findOne({ shop });
  const userPlan = normalizePlan(subscription?.plan);
  
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
    // Growth plan features (+ Plus plans with tokens)
    { 
      key: 'welcomePage', 
      name: 'AI Welcome Page', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/welcome?shop=${shop}`,
      requiresPlan: ['professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise']
    },
    { 
      key: 'collectionsJson', 
      name: 'Collections JSON Feed', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/collections-feed.json?shop=${shop}`,
      requiresPlan: ['professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise']
    },
    // Growth Extra plan features (+ Plus plans with tokens)
    { 
      key: 'storeMetadata', 
      name: 'Store Metadata', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/store-metadata.json?shop=${shop}`,
      requiresPlan: ['professional_plus', 'growth_plus', 'growth_extra', 'enterprise']
    },
    { 
      key: 'aiSitemap', 
      name: 'AI-Enhanced Sitemap', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/sitemap_products.xml?shop=${shop}`,
      requiresPlan: ['professional_plus', 'growth_plus', 'growth_extra', 'enterprise']
    },
    // Enterprise plan features (+ Plus plans with tokens)
    { 
      key: 'advancedSchemaApi', 
      name: 'Advanced Schema Data', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/schema-data.json?shop=${shop}`,
      requiresPlan: ['professional_plus', 'growth_plus', 'growth_extra', 'enterprise']
    }
  ];
  
  const results = {};
  
  for (const endpoint of endpoints) {
    try {
      // Check plan requirements
      if (endpoint.requiresPlan && !endpoint.requiresPlan.includes(userPlan)) {
        results[endpoint.key] = {
          status: 'locked',
          message: 'Plan upgrade required',
          name: endpoint.name
        };
        continue;
      }
      
      const response = await fetch(endpoint.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'AI-SEO-Testing-Bot/1.0'
        },
        timeout: 10000 // 10 second timeout
      });
      
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
            // Use DB counts (Products model is source of truth for optimization status)
            if (optimizedProducts === 0) {
              validationStatus = 'warning';
              validationMessage = `0/${totalProducts} products optimized`;
            } else {
              validationMessage = `${optimizedProducts}/${totalProducts} products optimized`;
            }
          }
          
          // Collections JSON Feed validation
          if (endpoint.key === 'collectionsJson') {
            // Count collections from actual endpoint data
            let actualOptimized = 0;
            let actualTotal = 0;
            
            if (data && data.collections) {
              actualTotal = data.collections_total || data.collections.length;
              actualOptimized = data.collections.length; // Collections with metafields
            }
            
            if (actualOptimized === 0) {
              validationStatus = 'warning';
              validationMessage = `0/${actualTotal} collections optimized`;
            } else {
              validationMessage = `${actualOptimized}/${actualTotal} collections optimized`;
            }
          }
          
          // Store Metadata validation
          if (endpoint.key === 'storeMetadata' && data) {
            // Check for actual data (correct field names from endpoint)
            const hasSeoData = data.seo && Object.keys(data.seo).length > 0;
            const hasOrgSchema = data.organization_schema && Object.keys(data.organization_schema).length > 0;
            const hasAiContext = data.ai_context && Object.keys(data.ai_context).length > 0;
            const hasLocalBusiness = data.local_business_schema && Object.keys(data.local_business_schema).length > 0;
            
            if (!hasSeoData && !hasOrgSchema && !hasAiContext && !hasLocalBusiness) {
              validationStatus = 'warning';
              validationMessage = 'Endpoint OK, but no organization or SEO data configured';
            } else {
              const dataTypes = [];
              if (hasSeoData) dataTypes.push('SEO metadata');
              if (hasOrgSchema) dataTypes.push('Organization schema');
              if (hasAiContext) dataTypes.push('AI context');
              if (hasLocalBusiness) dataTypes.push('Local business');
              validationMessage = `Store metadata configured: ${dataTypes.join(', ')}`;
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
          
          // Basic Sitemap validation
          if (endpoint.key === 'basicSitemap' && data) {
            if (typeof data === 'string') {
              validationMessage = 'Sitemap is working correctly';
            }
          }
          
          // AI-Enhanced Sitemap validation (checks for AI metadata)
          if (endpoint.key === 'aiSitemap' && data) {
            if (typeof data === 'string') {
              const hasAIMetadata = data.includes('xmlns:ai=') && data.includes('<ai:product>');
              
              if (hasAIMetadata) {
                validationMessage = 'AI-enhanced sitemap is working correctly';
              } else {
                validationStatus = 'warning';
                validationMessage = 'Sitemap exists, but AI enhancements not enabled. Enable in Settings → AI Discovery.';
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
          // For theme files, we need to read from Shopify API, not public URL
          if (endpoint.key === 'schemaData') {
            try {
              // Get published theme ID
              const themesQuery = `{ themes(first: 1, roles: MAIN) { edges { node { id name } } } }`;
              const themesResponse = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
                method: 'POST',
                headers: {
                  'X-Shopify-Access-Token': shopRecord.accessToken,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query: themesQuery })
              });
              
              if (!themesResponse.ok) {
                validationStatus = 'warning';
                validationMessage = 'Could not access theme API to check schema data';
                continue;
              }
              
              const themesData = await themesResponse.json();
              const themeId = themesData?.data?.themes?.edges?.[0]?.node?.id?.split('/')?.pop();
              
              if (!themeId) {
                validationStatus = 'warning';
                validationMessage = 'Could not find published theme';
                continue;
              }
              
              // Get theme.liquid asset
              const assetUrl = `https://${shop}/admin/api/2025-07/themes/${themeId}/assets.json?asset[key]=layout/theme.liquid`;
              const assetResponse = await fetch(assetUrl, {
                method: 'GET',
                headers: {
                  'X-Shopify-Access-Token': shopRecord.accessToken
                }
              });
              
              if (!assetResponse.ok) {
                validationStatus = 'warning';
                validationMessage = 'Could not read theme.liquid file';
                continue;
              }
              
              const assetData = await assetResponse.json();
              const themeContent = assetData?.asset?.value || '';
              
              // Look for schema.org structured data
              const hasLdJson = themeContent.includes('application/ld+json') || themeContent.includes('application\\/ld+json');
              const hasSchemaOrg = themeContent.includes('schema.org') || themeContent.includes('schema\\.org');
              const hasOrganization = /@type["\s:]*"?\s*Organization/i.test(themeContent) || 
                                      themeContent.includes('"@type":"Organization"');
              const hasWebSite = /@type["\s:]*"?\s*WebSite/i.test(themeContent) || 
                                 themeContent.includes('"@type":"WebSite"');
              const hasAiSeoComment = themeContent.includes('AI SEO App') || 
                                       themeContent.includes('Organization & WebSite Schema');
              
              if (!hasLdJson && !hasSchemaOrg) {
                validationStatus = 'warning';
                validationMessage = 'Schema data not found in theme.liquid file';
              } else if (hasLdJson && (hasOrganization || hasWebSite || hasAiSeoComment)) {
                validationMessage = 'Schema data is installed and working correctly in theme';
              } else if (hasLdJson) {
                validationMessage = 'Schema data detected (application/ld+json found)';
              } else if (hasSchemaOrg) {
                validationMessage = 'Schema.org reference found (likely installed correctly)';
              } else {
                validationStatus = 'warning';
                validationMessage = 'Schema data found but may be incomplete';
              }
              
              dataSize = themeContent.length;
              
            } catch (themeError) {
              console.error('[SCHEMA-DATA-VALIDATION] Error reading theme:', themeError);
              validationStatus = 'warning';
              validationMessage = `Could not verify schema data: ${themeError.message}`;
            }
          }
          
          // Advanced Schema API validation
          if (endpoint.key === 'advancedSchemaApi' && data) {
            const schemasCount = data.schemas?.length || 0;
            if (schemasCount === 0) {
              validationStatus = 'warning';
              validationMessage = 'API OK, but no advanced schemas generated yet. Generate schemas in Advanced Schema Data section.';
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
          notFoundMessage = 'AI-Enhanced Sitemap not generated yet. Enable in Settings → AI Discovery and generate sitemap.';
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
  
  try {
    // === TOKEN CHECKING WITH TRIAL RESTRICTION ===
    const feature = 'ai-testing-validation';
    
    // Estimate tokens based on endpoint count
    // Real usage: ~1,300 tokens per endpoint (average from logs)
    // Reserve 20% more for safety margin
    const successfulEndpoints = Object.entries(endpointResults).filter(
      ([key, result]) => (result.status === 'success' || result.status === 'warning') 
        && key !== 'robotsTxt' && key !== 'schemaData'
    );
    const estimatedTokens = successfulEndpoints.length * 1500; // Conservative estimate
    
    // Get subscription and check trial status
    const subscription = await Subscription.findOne({ shop });
    const planKey = normalizePlan(subscription?.plan);
    const now = new Date();
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
    
    // Check if plan has included tokens (Growth Extra, Enterprise)
    const includedTokensPlans = ['growth_extra', 'enterprise'];
    const hasIncludedTokens = includedTokensPlans.includes(planKey);
    const isActivated = !!subscription?.activatedAt;
    
    // Get token balance (needed for all paths)
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    
    // Check if feature requires tokens
    const { requiresTokens, isBlockedInTrial } = await import('../billing/tokenConfig.js');
    
    if (requiresTokens(feature)) {
      
      // TRIAL RESTRICTION: Different logic for included vs purchased tokens
      if (hasIncludedTokens && inTrial && !isActivated && isBlockedInTrial(feature)) {
        // Growth Extra/Enterprise in trial → Show "Activate Plan" modal
        return res.status(402).json({
          error: 'AI-Powered Validation is locked during trial period',
          trialRestriction: true,
          requiresActivation: true,
          trialEndsAt: subscription.trialEndsAt,
          currentPlan: subscription.plan,
          feature,
          tokensRequired: estimatedTokens,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: Math.max(0, estimatedTokens - tokenBalance.balance),
          message: 'Activate your plan to unlock AI-Powered Validation with included tokens'
        });
      }
      
      // Check if sufficient tokens are available
      if (!tokenBalance.hasBalance(estimatedTokens)) {
        // For Professional/Growth/Plus → Show "Insufficient Tokens" modal
        return res.status(402).json({
          error: 'Insufficient tokens',
          requiresPurchase: true,
          message: `You need at least ${estimatedTokens} tokens to run AI validation`,
          tokensRequired: estimatedTokens,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: estimatedTokens - tokenBalance.balance,
          feature
        });
      }
      
    }
    
    const results = {};
    let totalTokensUsed = 0;
    let reservationId = null; // Will be set if tokens were reserved
    
    // Reserve tokens if feature requires them
    if (requiresTokens(feature)) {
      const reservation = await tokenBalance.reserveTokens(estimatedTokens, 'ai-validation');
      reservationId = reservation.reservationId; // Extract ID from object
      await reservation.save(); // Save the reservation
    }
    
    // Process successful and warning endpoints (skip locked and failed)
    // Note: successfulEndpoints already filtered on line 436 (excludes robotsTxt & schemaData)
    for (const [key, result] of successfulEndpoints) {
      try {
        // Map endpoint keys to correct URLs (from run-tests endpoint definitions)
        const endpointUrls = {
          productsJson: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/products.json?shop=${shop}`,
          basicSitemap: `${process.env.APP_URL || `https://${req.get('host')}`}/sitemap_products.xml?shop=${shop}`,
          aiSitemap: `${process.env.APP_URL || `https://${req.get('host')}`}/sitemap_products.xml?shop=${shop}`,
          storeMetadata: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/store-metadata.json?shop=${shop}`,
          welcomePage: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/welcome?shop=${shop}`,
          collectionsJson: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/collections-feed.json?shop=${shop}`,
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
        
        // Special prompts for specific endpoints
        let prompt = '';
        
        if (key === 'storeMetadata') {
          prompt = `You are an AI SEO expert analyzing Store Metadata for an e-commerce store.

Data sample:
${data}

Analyze this data focusing on QUALITY, not just presence:

SEO Metadata:
- Are titles, descriptions descriptive and SEO-friendly (not just store name)?
- Are keywords relevant and specific (not generic)?
- Is the description compelling and informative?

AI Context:
- Is businessType specific (not generic placeholder)?
- Are uniqueSellingPoints unique and compelling (not generic text)?
- Is brandVoice clear and professional?
- Are targetAudience, primaryCategories specific?

Organization Schema:
- Are contact details complete (email, phone, logo)?
- Are social media links present?

Rating Guidelines:
- excellent: ALL fields filled with QUALITY, specific content
- good: Most fields filled with good content, minor improvements possible
- fair: Some fields missing OR content is generic/placeholder-like
- poor: Many fields missing OR mostly generic content

IMPORTANT: Respond with ONLY valid JSON, no markdown, no code blocks.

Format:
{
  "rating": "excellent|good|fair|poor",
  "feedback": "Your feedback here",
  "suggestions": "Your suggestions here (or null if everything is good)"
}`;
        } else if (key === 'productsJson') {
          prompt = `You are an AI SEO expert analyzing Products JSON Feed for an e-commerce store.

NOTE: The metafields section may be truncated in this preview due to size limits. This is NORMAL and not a problem.

Data sample:
${data}

Analyze this data and provide:
1. Rating: excellent/good/fair/poor (based on visible product data quality, NOT truncation)
2. Feedback: Brief assessment of product titles, descriptions, pricing, and URL structure
3. Suggestions: Recommendations for improving SEO value (ignore truncation note)

IMPORTANT: Respond with ONLY valid JSON, no markdown, no code blocks.

Format:
{
  "rating": "excellent|good|fair|poor",
  "feedback": "Your feedback here",
  "suggestions": "Your suggestions here (or null if everything is good)"
}`;
        } else if (key === 'collectionsJson') {
          prompt = `You are an AI SEO expert analyzing Collections JSON Feed for an e-commerce store.

Data sample:
${data}

Analyze this data focusing on:

Collection Quality:
- Are titles descriptive and SEO-friendly?
- Are descriptions present and informative (not empty/generic)?
- Do collections have clear product categorization?
- Are URLs and handles SEO-optimized?

Completeness:
- Are meta_title and meta_description fields populated?
- Are image_url and product_url fields present?
- Is collection hierarchy logical?

Rating Guidelines:
- excellent: Rich descriptions, complete metadata, good SEO structure
- good: Decent data, minor improvements possible (missing some fields)
- fair: Basic structure, but missing descriptions or metadata
- poor: Minimal data, missing critical fields or very generic content

IMPORTANT: Respond with ONLY valid JSON, no markdown, no code blocks.

Format:
{
  "rating": "excellent|good|fair|poor",
  "feedback": "Your feedback here",
  "suggestions": "Your suggestions here (or null if everything is good)"
}`;
        } else if (key === 'aiSitemap') {
          prompt = `You are an AI SEO expert analyzing AI-Enhanced Sitemap for an e-commerce store.

Data sample (XML):
${data}

Analyze the AI enhancements focusing on:

AI Product Tags:
- Are <ai:product> tags present with rich metadata?
- Are product titles unique and descriptive (not generic/truncated)?
- Are descriptions fully populated (not truncated or cut off)?
- Are key features and benefits clearly stated?

Data Quality:
- Is pricing information complete?
- Are availability status tags present?
- Is the data well-structured and parseable?

Rating Guidelines:
- excellent: Rich AI metadata, unique descriptions, complete product data
- good: AI tags present, but some descriptions could be more detailed
- fair: AI tags present but generic titles or truncated descriptions
- poor: Missing AI tags OR mostly placeholder/generic content

IMPORTANT: Respond with ONLY valid JSON, no markdown, no code blocks.

Format:
{
  "rating": "excellent|good|fair|poor",
  "feedback": "Your feedback here",
  "suggestions": "Your suggestions here (or null if everything is good)"
}`;
        } else if (key === 'basicSitemap') {
          prompt = `You are an SEO expert analyzing XML Sitemap for an e-commerce store.

Data sample (XML):
${data}

Analyze this sitemap focusing on:

Structure & Completeness:
- Are all required XML elements present (<url>, <loc>, <lastmod>)?
- Is the structure valid and well-formed?
- Are URLs properly formatted?
- Is lastmod date present and recent?

Best Practices:
- Is priority set appropriately?
- Is changefreq specified?
- Are there any errors or warnings in structure?

Rating Guidelines:
- excellent: Perfect XML structure, all best practices followed
- good: Valid sitemap with minor improvements possible
- fair: Valid but missing some optional fields or best practices
- poor: Structural issues or missing critical elements

IMPORTANT: Respond with ONLY valid JSON, no markdown, no code blocks.

Format:
{
  "rating": "excellent|good|fair|poor",
  "feedback": "Your feedback here",
  "suggestions": "Your suggestions here (or null if everything is good)"
}`;
        } else if (key === 'welcomePage') {
          prompt = `You are an AI expert analyzing AI Welcome Page for an e-commerce store.

Data sample (HTML):
${data}

Analyze this welcome page focusing on:

Content Quality:
- Is there clear brand messaging and value proposition?
- Is navigation helpful for AI bots?
- Are product categories clearly outlined?
- Is contact information easily accessible?

Technical SEO:
- Are meta tags present and descriptive?
- Is structured data (Schema.org) properly implemented?
- Is the HTML semantic and well-structured?
- Are headings (H1, H2) used correctly?

AI Readability:
- Is content organized logically for crawlers?
- Are there clear calls-to-action?
- Is important information easily parseable?

Rating Guidelines:
- excellent: Clear messaging, rich structured data, perfect HTML
- good: Good content and structure, minor SEO improvements possible
- fair: Basic content present but missing key elements or poor structure
- poor: Minimal content, poor structure, or missing critical elements

IMPORTANT: Respond with ONLY valid JSON, no markdown, no code blocks.

Format:
{
  "rating": "excellent|good|fair|poor",
  "feedback": "Your feedback here",
  "suggestions": "Your suggestions here (or null if everything is good)"
}`;
        } else if (key === 'advancedSchemaApi') {
          prompt = `You are a structured data expert analyzing Advanced Schema Data for an e-commerce store.

Data sample (JSON-LD):
${data}

Analyze this structured data focusing on:

Schema Completeness:
- Are required properties present for each schema type?
- Are relationships between entities properly defined?
- Is the data rich and detailed (not minimal)?

Schema Types Coverage:
- Product schemas with offers, reviews, ratings?
- FAQ schemas properly structured?
- HowTo schemas with clear steps?
- Organization/LocalBusiness data complete?

Validity & Best Practices:
- Is JSON-LD syntax valid?
- Are Schema.org types used correctly?
- Are values appropriate for their properties?
- Is rich snippet eligibility maximized?

Rating Guidelines:
- excellent: Complete schemas, all recommended properties, rich data
- good: Valid schemas with good coverage, minor improvements possible
- fair: Basic schemas present but missing recommended properties
- poor: Minimal schemas OR invalid structure OR missing key types

IMPORTANT: Respond with ONLY valid JSON, no markdown, no code blocks.

Format:
{
  "rating": "excellent|good|fair|poor",
  "feedback": "Your feedback here",
  "suggestions": "Your suggestions here (or null if everything is good)"
}`;
        } else {
          // Generic prompt for other endpoints
          prompt = `You are an AI SEO expert analyzing endpoint data for e-commerce stores.

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
        }
        
        const aiResponse = await getGeminiResponse(prompt, {
          maxTokens: 150,
          temperature: 0.3
        });
        
        // Parse AI response (handle markdown code blocks and various formats)
        try {
          // Extract content from response object if needed
          let responseText = typeof aiResponse === 'object' && aiResponse.content 
            ? aiResponse.content 
            : aiResponse;
          
          // Remove markdown code blocks if present (```json ... ``` or ``` ... ```)
          let cleanResponse = responseText.trim();
          
          // Method 1: Remove markdown code blocks
          if (cleanResponse.startsWith('```')) {
            cleanResponse = cleanResponse.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/i, '').trim();
          }
          
          // Method 2: Extract JSON from text (find first { to last })
          const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            cleanResponse = jsonMatch[0];
          }
          
          const parsed = JSON.parse(cleanResponse);
          results[key] = {
            rating: parsed.rating || 'good',
            feedback: parsed.feedback || 'Data appears well-structured.',
            suggestions: parsed.suggestions || null
          };
          
          // Use actual token usage from AI response
          const tokensUsed = aiResponse?.usage?.total_tokens || 150;
          totalTokensUsed += tokensUsed;
        } catch (parseError) {
          console.error('[AI-VALIDATION] Parse error for', key, ':', parseError.message);
          console.error('[AI-VALIDATION] Raw response:', aiResponse);
          console.error('[AI-VALIDATION] Response type:', typeof aiResponse);
          
          // Extract content from response object if needed
          let responseText = typeof aiResponse === 'object' && aiResponse.content 
            ? aiResponse.content 
            : (typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse));
          
          // Try to extract feedback from plain text response
          const feedbackMatch = responseText.match(/feedback["\s:]+([^"}\n]+)/i);
          const ratingMatch = responseText.match(/rating["\s:]+([a-z]+)/i);
          
          results[key] = {
            rating: ratingMatch ? ratingMatch[1] : 'good',
            feedback: feedbackMatch ? feedbackMatch[1].trim() : responseText.substring(0, 100),
            suggestions: null
          };
          
          // Use actual token usage from AI response (even if parsing failed)
          const tokensUsed = aiResponse?.usage?.total_tokens || 150;
          totalTokensUsed += tokensUsed;
        }
      } catch (error) {
        console.error('[AI-VALIDATION] Error validating', key, ':', error);
        results[key] = {
          rating: 'fair',
          feedback: 'Could not complete AI analysis for this endpoint.',
          suggestions: null
        };
        // Estimate tokens if request failed entirely
        totalTokensUsed += 150;
      }
    }
    
    // Finalize token usage (only if tokens were reserved)
    if (reservationId) {
      await tokenBalance.finalizeReservation(reservationId, totalTokensUsed);
    }
    
    // Add "Cannot validate" message for failed/error/locked endpoints
    // (these were not processed in the AI validation loop)
    for (const [key, result] of Object.entries(endpointResults)) {
      // Skip robotsTxt and schemaData (theme files, not API endpoints)
      if (key === 'robotsTxt' || key === 'schemaData') {
        continue;
      }
      
      // If endpoint was not validated (failed/error/locked), add appropriate message
      if (!results[key]) {
        if (result.status === 'locked') {
          results[key] = {
            rating: 'locked',
            feedback: 'Plan upgrade required',
            suggestions: null
          };
        } else if (result.status === 'error' || result.status === 'failed') {
          results[key] = {
            rating: 'unavailable',
            feedback: 'Cannot validate - endpoint not available',
            suggestions: 'Fix the endpoint issue first, then run AI validation.'
          };
        }
      }
    }
    
    // Invalidate cache so new token balance is immediately visible
    try {
      const cacheService = await import('../services/cacheService.js');
      await cacheService.default.invalidateShop(shop);
    } catch (cacheErr) {
      console.error('[AI-TESTING] Failed to invalidate cache:', cacheErr);
    }
    
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

