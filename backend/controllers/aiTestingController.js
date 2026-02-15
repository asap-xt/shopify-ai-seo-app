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

// ============================================
// AI BOT CONFIGURATION (OpenRouter models)
// Price multipliers relative to base token price (Gemini 2.5 Flash Lite = 1.0)
// Base: $0.10/M input, $0.40/M output
// This ensures we charge appropriately for more expensive models
// Order: ChatGPT → Gemini → Claude → Meta → Perplexity
// ============================================
const AI_BOTS = {
  'chatgpt': {
    id: 'chatgpt',
    name: 'ChatGPT 5.2',
    model: 'openai/gpt-5.2-chat',
    description: 'OpenAI GPT-5.2',
    minPlanIndex: 0, // Starter+
    tokensPerTest: 2000,
    priceMultiplier: 28.0 // $1.75/$14 vs base $0.10/$0.40
  },
  'gemini': {
    id: 'gemini',
    name: 'Gemini 3 Pro',
    model: 'google/gemini-3-pro-preview',
    description: 'Google Gemini 3 Pro',
    minPlanIndex: 0, // Starter+
    tokensPerTest: 2000,
    priceMultiplier: 24.0 // $2/$12 vs base $0.10/$0.40
  },
  'claude': {
    id: 'claude',
    name: 'Claude Opus 4.6',
    model: 'anthropic/claude-opus-4.6',
    description: 'Anthropic Claude Opus 4.6',
    minPlanIndex: 1, // Professional+
    tokensPerTest: 2000,
    priceMultiplier: 50.0 // $5/$25 vs base $0.10/$0.40
  },
  'meta': {
    id: 'meta',
    name: 'Llama 4 Maverick',
    model: 'meta-llama/llama-4-maverick',
    description: 'Meta Llama 4 Maverick',
    minPlanIndex: 2, // Growth+
    tokensPerTest: 2000,
    priceMultiplier: 1.5 // $0.15/$0.60 vs base $0.10/$0.40
  },
  'perplexity': {
    id: 'perplexity',
    name: 'Perplexity Sonar Pro',
    model: 'perplexity/sonar-pro',
    description: 'Perplexity Sonar Pro (with search)',
    minPlanIndex: 3, // Growth Extra+
    tokensPerTest: 3000,
    priceMultiplier: 30.0 // $3/$15 + per-request costs vs base $0.10/$0.40
  }
};

// Plan index mapping (matches frontend PLAN_HIERARCHY)
const PLAN_INDEX = {
  'starter': 0,
  'professional': 1,
  'professional_plus': 1,
  'growth': 2,
  'growth_plus': 2,
  'growth_extra': 3,
  'enterprise': 4
};

const getPlanIndex = (plan) => {
  const normalized = normalizePlan(plan);
  return PLAN_INDEX[normalized] ?? 0;
};

// ============================================
// GET /api/ai-testing/available-bots
// Returns available AI bots based on user's plan
// ============================================
router.get('/ai-testing/available-bots', validateRequest(), async (req, res) => {
  const shop = req.shopDomain || req.query.shop;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter required' });
  }
  
  try {
    const subscription = await Subscription.findOne({ shop });
    const userPlanIndex = getPlanIndex(subscription?.plan);
    
    // Filter bots based on user's plan
    const availableBots = Object.values(AI_BOTS).map(bot => ({
      ...bot,
      available: userPlanIndex >= bot.minPlanIndex,
      requiredPlan: bot.minPlanIndex === 0 ? 'Starter' :
                    bot.minPlanIndex === 1 ? 'Professional' :
                    bot.minPlanIndex === 2 ? 'Growth' :
                    bot.minPlanIndex === 3 ? 'Growth Extra' : 'Enterprise'
    }));
    
    res.json({
      bots: availableBots,
      currentPlan: subscription?.plan || 'Starter',
      currentPlanIndex: userPlanIndex
    });
  } catch (error) {
    console.error('[AI-TESTING] Error getting available bots:', error);
    res.status(500).json({ error: 'Failed to get available bots' });
  }
});

// ============================================
// GET /api/ai-testing/store-insights
// Returns store data for dynamic prompt generation
// ============================================
router.get('/ai-testing/store-insights', validateRequest(), async (req, res) => {
  const shop = req.shopDomain || req.query.shop;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter required' });
  }
  
  try {
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    // Get active products filter
    const activeStatusFilter = {
      $or: [
        { status: 'ACTIVE' },
        { status: { $exists: false } },
        { status: null }
      ]
    };
    
    // Get product stats
    const totalProducts = await Product.countDocuments({ shop, ...activeStatusFilter });
    const optimizedProducts = await Product.countDocuments({ 
      shop, 
      ...activeStatusFilter,
      'seoStatus.optimized': true 
    });
    
    // Get sample products (for price range and categories)
    const sampleProducts = await Product.find({ shop, ...activeStatusFilter })
      .select('title productType vendor priceRange tags')
      .limit(100)
      .lean();
    
    // Calculate price range
    let minPrice = Infinity;
    let maxPrice = 0;
    const productTypes = new Set();
    const vendors = new Set();
    const allTags = new Set();
    
    sampleProducts.forEach(p => {
      if (p.priceRange?.minVariantPrice?.amount) {
        const price = parseFloat(p.priceRange.minVariantPrice.amount);
        if (price < minPrice) minPrice = price;
        if (price > maxPrice) maxPrice = price;
      }
      if (p.productType) productTypes.add(p.productType);
      if (p.vendor) vendors.add(p.vendor);
      if (p.tags && Array.isArray(p.tags)) {
        p.tags.forEach(tag => allTags.add(tag));
      }
    });
    
    // Get collections
    const collections = await Collection.find({ shop })
      .select('title handle productsCount')
      .limit(20)
      .lean();
    
    // Get store metadata (if set)
    const storeMetadata = shopRecord.storeMetadata || {};
    
    // Get public domain
    let publicDomain = shop;
    try {
      const domainQuery = `{ shop { primaryDomain { url host } name } }`;
      const domainResponse = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: domainQuery })
      });
      
      if (domainResponse.ok) {
        const domainData = await domainResponse.json();
        publicDomain = domainData?.data?.shop?.primaryDomain?.host || 
                       domainData?.data?.shop?.primaryDomain?.url?.replace(/^https?:\/\//, '') || 
                       shop;
      }
    } catch (domainErr) {
      console.error('[AI-TESTING] Error fetching public domain:', domainErr);
    }
    
    // Build dynamic prompts based on store data
    const prompts = generateDynamicPrompts({
      storeName: storeMetadata.storeName || shopRecord.name || shop.split('.')[0],
      publicDomain,
      collections: collections.map(c => c.title),
      productTypes: Array.from(productTypes).slice(0, 10),
      priceRange: { min: minPrice === Infinity ? 0 : minPrice, max: maxPrice },
      tags: Array.from(allTags).slice(0, 20),
      totalProducts,
      optimizedProducts,
      storeMetadata
    });
    
    res.json({
      shop,
      publicDomain,
      storeName: storeMetadata.storeName || shopRecord.name || shop.split('.')[0],
      stats: {
        totalProducts,
        optimizedProducts,
        totalCollections: collections.length
      },
      categories: {
        productTypes: Array.from(productTypes).slice(0, 10),
        collections: collections.map(c => ({ title: c.title, productsCount: c.productsCount })),
        tags: Array.from(allTags).slice(0, 20)
      },
      priceRange: {
        min: minPrice === Infinity ? 0 : minPrice,
        max: maxPrice,
        currency: sampleProducts[0]?.priceRange?.minVariantPrice?.currencyCode || 'USD'
      },
      prompts
    });
  } catch (error) {
    console.error('[AI-TESTING] Error getting store insights:', error);
    res.status(500).json({ error: 'Failed to get store insights' });
  }
});

// Generate dynamic prompts based on store data
function generateDynamicPrompts(data) {
  const { storeName, publicDomain, collections, productTypes, priceRange, tags, storeMetadata, totalProducts } = data;
  
  const prompts = [];
  const currency = priceRange?.currency || 'USD';
  const currencySymbol = currency === 'BGN' ? 'лв' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency;
  
  // ============================================
  // 1. AI DATA QUALITY ANALYSIS
  // ============================================
  prompts.push({
    id: 'data-quality-robots',
    category: 'AI Data Quality',
    question: `Analyze the robots.txt and data structure of ${publicDomain}. What AI-accessible endpoints do you find?`,
    description: 'Check AI crawler access configuration'
  });
  
  prompts.push({
    id: 'data-quality-structured',
    category: 'AI Data Quality',
    question: `What structured data (JSON feeds, sitemaps, schema.org) does ${publicDomain} provide for AI crawlers?`,
    description: 'Evaluate structured data availability'
  });
  
  prompts.push({
    id: 'data-quality-rating',
    category: 'AI Data Quality',
    question: `Rate the AI-readiness of ${publicDomain}'s product catalog from 1-10 and explain why.`,
    description: 'Get AI-readiness score'
  });

  // ============================================
  // 2. PRODUCT DISCOVERY
  // ============================================
  
  // Browse catalog
  prompts.push({
    id: 'discovery-browse',
    category: 'Product Discovery',
    question: `What are the best products at ${publicDomain}? Give me your top recommendations.`,
    description: 'Top product recommendations'
  });
  
  // Price-based search (if price data available)
  if (priceRange && priceRange.max > 0) {
    const midPrice = Math.round((priceRange.min + priceRange.max) / 2);
    prompts.push({
      id: 'discovery-price',
      category: 'Product Discovery',
      question: `What great products can I find under ${midPrice} ${currencySymbol} at ${publicDomain}? Show me the best value options.`,
      description: `Best value under ${midPrice} ${currencySymbol}`
    });
  }
  
  // Product type search (if types available)
  if (productTypes && productTypes.length > 0) {
    const randomType = productTypes[Math.floor(Math.random() * productTypes.length)];
    prompts.push({
      id: 'discovery-type',
      category: 'Product Discovery',
      question: `I'm looking for ${randomType.toLowerCase()} at ${publicDomain}. What are the standout options and why?`,
      description: `Best ${randomType} products`
    });
  }
  
  // Gift recommendation
  prompts.push({
    id: 'discovery-gift',
    category: 'Product Discovery',
    question: `I need a gift idea from ${publicDomain}. What unique products would make a memorable present?`,
    description: 'Gift ideas'
  });
  
  // New arrivals / Popular
  prompts.push({
    id: 'discovery-popular',
    category: 'Product Discovery',
    question: `What are the most popular or best-selling products at ${publicDomain}?`,
    description: 'Popular products'
  });
  
  // Quality / Premium
  prompts.push({
    id: 'discovery-premium',
    category: 'Product Discovery',
    question: `What premium or high-quality products does ${publicDomain} offer? What makes them special?`,
    description: 'Premium products'
  });

  // ============================================
  // 3. BUSINESS INTELLIGENCE
  // ============================================
  prompts.push({
    id: 'business-positioning',
    category: 'Business Intelligence',
    question: `What is ${publicDomain}'s brand positioning based on their product descriptions and store data?`,
    description: 'Analyze brand positioning'
  });
  
  prompts.push({
    id: 'business-markets',
    category: 'Business Intelligence',
    question: `What languages and markets does ${publicDomain} target? Who is their ideal customer?`,
    description: 'Identify target markets and audience'
  });
  
  prompts.push({
    id: 'business-policies',
    category: 'Business Intelligence',
    question: `Summarize ${publicDomain}'s return policy, shipping options, and customer service contact.`,
    description: 'Review policies and contact info'
  });

  return prompts;
}

// ============================================
// POST /api/ai-testing/run-bot-test
// Execute a test with selected AI bot via OpenRouter
// ============================================
router.post('/ai-testing/run-bot-test', validateRequest(), async (req, res) => {
  const shop = req.shopDomain || req.query.shop || req.body.shop;
  const { botId, prompt, customPrompt } = req.body;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter required' });
  }
  
  if (!botId || !AI_BOTS[botId]) {
    return res.status(400).json({ error: 'Valid bot ID required' });
  }
  
  const bot = AI_BOTS[botId];
  const questionToAsk = customPrompt || prompt;
  
  if (!questionToAsk) {
    return res.status(400).json({ error: 'Prompt or customPrompt required' });
  }
  
  try {
    // Check plan access
    const subscription = await Subscription.findOne({ shop });
    const userPlanIndex = getPlanIndex(subscription?.plan);
    
    if (userPlanIndex < bot.minPlanIndex) {
      return res.status(403).json({
        error: 'Plan upgrade required',
        requiredPlan: bot.minPlanIndex === 1 ? 'Professional' :
                      bot.minPlanIndex === 2 ? 'Growth Plus' :
                      bot.minPlanIndex === 3 ? 'Growth Extra' : 'Enterprise',
        currentPlan: subscription?.plan || 'Starter'
      });
    }
    
    // Check and deduct tokens (apply price multiplier for expensive models)
    const baseTokens = bot.tokensPerTest;
    const priceMultiplier = bot.priceMultiplier || 1.0;
    const estimatedTokens = Math.ceil(baseTokens * priceMultiplier);
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    
    // Check trial restrictions
    const now = new Date();
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
    const isActivated = !!subscription?.activatedAt;
    const includedTokensPlans = ['growth_extra', 'enterprise'];
    const hasIncludedTokens = includedTokensPlans.includes(normalizePlan(subscription?.plan));
    const hasPurchasedTokens = tokenBalance.totalPurchased > 0;
    
    // Trial restriction check
    if (hasIncludedTokens && inTrial && !isActivated && !hasPurchasedTokens) {
      return res.status(402).json({
        error: 'AI Bot Testing is locked during trial period',
        trialRestriction: true,
        requiresActivation: true,
        trialEndsAt: subscription.trialEndsAt,
        currentPlan: subscription.plan,
        tokensRequired: estimatedTokens,
        tokensAvailable: tokenBalance.balance
      });
    }
    
    // Check sufficient tokens
    if (!tokenBalance.hasBalance(estimatedTokens)) {
      return res.status(402).json({
        error: 'Insufficient tokens',
        requiresPurchase: true,
        tokensRequired: estimatedTokens,
        tokensAvailable: tokenBalance.balance,
        tokensNeeded: estimatedTokens - tokenBalance.balance
      });
    }
    
    // Reserve tokens
    const reservation = await tokenBalance.reserveTokens(estimatedTokens, `ai-bot-test-${botId}`);
    const reservationId = reservation.reservationId;
    await reservation.save();
    
    // Get store context for the AI
    const shopRecord = await Shop.findOne({ shop });
    const storeContext = await buildStoreContext(shop, shopRecord);
    
    // Get public domain for fetching public data
    let publicDomain = shop;
    try {
      const domainQuery = `{ shop { primaryDomain { url host } } }`;
      const domainResponse = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': shopRecord.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: domainQuery })
      });
      
      if (domainResponse.ok) {
        const domainData = await domainResponse.json();
        publicDomain = domainData?.data?.shop?.primaryDomain?.host || shop;
      }
    } catch (domainErr) {
      console.error('[AI-TESTING] Error fetching domain:', domainErr);
    }
    
    // Fetch public store data for AI Data Quality prompts
    let publicDataContext = '';
    const isDataQualityPrompt = questionToAsk.toLowerCase().includes('robots.txt') || 
                                 questionToAsk.toLowerCase().includes('sitemap') ||
                                 questionToAsk.toLowerCase().includes('structured data') ||
                                 questionToAsk.toLowerCase().includes('ai-readiness') ||
                                 questionToAsk.toLowerCase().includes('ai crawler') ||
                                 questionToAsk.toLowerCase().includes('json feed');
    
    if (isDataQualityPrompt) {
      console.log('[AI-TESTING] Fetching public store data for AI Data Quality prompt...');
      const publicData = await fetchPublicStoreData(publicDomain, shop);
      
      // Get actual product counts from our database
      const Product = (await import('../db/Product.js')).default;
      const activeProductCount = await Product.countDocuments({ 
        shop, 
        $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }, { status: null }]
      });
      const optimizedProductCount = await Product.countDocuments({ 
        shop, 
        $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }, { status: null }],
        'seoStatus.optimized': true 
      });
      
      publicDataContext = `\n\n=== ACTUAL STORE DATA (fetched in real-time) ===\n`;
      publicDataContext += `\nSTORE DOMAIN: ${publicDomain}\n`;
      publicDataContext += `\nIMPORTANT: This store has ${activeProductCount} ACTIVE products (${optimizedProductCount} are AI-optimized).\n`;
      publicDataContext += `Note: Shopify's public products.json may show more products including drafts and archived items.\n`;
      
      // robots.txt from store
      if (publicData.robotsTxt) {
        publicDataContext += `\n--- ROBOTS.TXT (from ${publicData.endpoints.robotsTxt}) ---\n`;
        publicDataContext += `\`\`\`\n${publicData.robotsTxt}\n\`\`\`\n`;
      } else {
        publicDataContext += `\nROBOTS.TXT: Not available\n`;
      }
      
      // Shopify's sitemap
      if (publicData.sitemap) {
        publicDataContext += `\n--- SHOPIFY SITEMAP (${publicData.endpoints.shopifySitemap}) ---\n`;
        publicDataContext += `\`\`\`xml\n${publicData.sitemap}\n\`\`\`\n`;
      } else {
        publicDataContext += `\nSHOPIFY SITEMAP: ${publicData.shopifySitemapStatus || 'Not available'}\n`;
      }
      
      // IndexAIze AI Products Feed
      if (publicData.aiProductsJson?.available) {
        publicDataContext += `\n--- INDEXAIZE AI PRODUCTS FEED ---\n`;
        publicDataContext += `URL: ${publicData.endpoints.aiProductsFeed}\n`;
        publicDataContext += `Status: Available with ${publicData.aiProductsJson.productCount} products\n`;
        if (publicData.aiProductsJson.sampleProduct) {
          publicDataContext += `Sample: "${publicData.aiProductsJson.sampleProduct.title}" (has metafields: ${publicData.aiProductsJson.sampleProduct.hasMetafields})\n`;
        }
      } else {
        publicDataContext += `\nINDEXAIZE AI PRODUCTS FEED: Not available (${publicData.aiProductsJson?.status || publicData.aiProductsJson?.error || 'unknown'})\n`;
      }
      
      // IndexAIze AI Sitemap
      if (publicData.aiSitemap?.available) {
        publicDataContext += `\n--- INDEXAIZE AI-ENHANCED SITEMAP ---\n`;
        publicDataContext += `URL: ${publicData.aiSitemap.url}\n`;
        publicDataContext += `App Proxy URL: ${publicData.aiSitemap.appProxyUrl}\n`;
        publicDataContext += `Has AI Metadata (<ai:product> tags): ${publicData.aiSitemap.hasAIMetadata ? 'YES' : 'NO'}\n`;
        if (publicData.aiSitemap.sample) {
          publicDataContext += `Sample:\n\`\`\`xml\n${publicData.aiSitemap.sample}\n\`\`\`\n`;
        }
      } else {
        publicDataContext += `\nINDEXAIZE AI SITEMAP: Not generated yet\n`;
      }
      
      // Available endpoints summary
      publicDataContext += `\n--- AVAILABLE AI ENDPOINTS ---\n`;
      publicDataContext += `- AI Products Feed: ${publicData.endpoints.aiProductsFeed}\n`;
      publicDataContext += `- AI Sitemap: ${publicData.endpoints.aiSitemap}\n`;
      publicDataContext += `- AI Welcome Page: ${publicData.endpoints.aiWelcomePage}\n`;
      publicDataContext += `- App Proxy Base: ${publicData.endpoints.appProxyBase}\n`;
      
      publicDataContext += `\n=== END OF ACTUAL STORE DATA ===\n`;
    }
    
    // Call OpenRouter API
    const startTime = Date.now();
    
    const systemPrompt = `You are an AI assistant evaluating an e-commerce store's AI-readiness.
Analyze the store data provided and give a CONCISE assessment.

STORE DATA:
${storeContext}
${publicDataContext}

RESPONSE FORMAT:
1. Start with a brief 1-2 sentence summary
2. Give a rating if asked (e.g., "AI-Readiness: 8/10")
3. List only the KEY FINDINGS (3-5 bullet points max)
4. End with 1-2 actionable recommendations if needed

IMPORTANT RULES:
- Keep responses SHORT and FOCUSED (max 150-200 words)
- NO lengthy explanations or detailed analysis
- Use bullet points for clarity
- Focus on what MATTERS most for AI optimization
- Be direct and actionable
- Skip obvious/standard information`;

    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'https://indexaize.com',
        'X-Title': 'indexAIze - AI Bot Testing'
      },
      body: JSON.stringify({
        model: bot.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: questionToAsk }
        ],
        max_tokens: 2000, // Increased for "thinking" models like Gemini Pro
        temperature: 0.5
      })
    });
    
    if (!openRouterResponse.ok) {
      const errorText = await openRouterResponse.text();
      console.error('[AI-TESTING] OpenRouter error:', errorText);
      
      // Refund tokens on error
      await tokenBalance.refundReservation(reservationId);
      
      return res.status(500).json({
        error: 'AI service temporarily unavailable',
        details: 'Please try again in a moment'
      });
    }
    
    const aiResult = await openRouterResponse.json();
    const responseTime = Date.now() - startTime;
    
    // Calculate actual tokens used (raw from API)
    const rawTokensUsed = aiResult.usage?.total_tokens || baseTokens;
    
    // Apply price multiplier - more expensive models cost more tokens
    // priceMultiplier already defined above when calculating estimatedTokens
    const adjustedTokensUsed = Math.ceil(rawTokensUsed * priceMultiplier);
    
    // Finalize token usage with adjusted amount
    await tokenBalance.finalizeReservation(reservationId, adjustedTokensUsed);
    
    // Invalidate cache
    try {
      const cacheService = await import('../services/cacheService.js');
      await cacheService.default.invalidateShop(shop);
    } catch (cacheErr) {
      console.error('[AI-TESTING] Cache invalidation error:', cacheErr);
    }
    
    // Get updated balance
    const updatedBalance = await TokenBalance.findOne({ shop });
    
    res.json({
      success: true,
      bot: {
        id: bot.id,
        name: bot.name,
        icon: bot.icon,
        model: bot.model,
        priceMultiplier
      },
      prompt: questionToAsk,
      response: aiResult.choices?.[0]?.message?.content || 'No response generated',
      usage: {
        tokensUsed: adjustedTokensUsed, // Adjusted for model pricing
        rawTokens: rawTokensUsed,       // Actual API tokens
        tokensRemaining: updatedBalance?.balance || 0,
        responseTimeMs: responseTime
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[AI-TESTING] Bot test error:', error);
    res.status(500).json({ error: 'Failed to run AI bot test' });
  }
});

// ============================================
// FETCH PUBLIC STORE DATA (robots.txt, sitemap, etc.)
// ============================================
async function fetchPublicStoreData(publicDomain, shop) {
  const data = {
    robotsTxt: null,
    sitemap: null,
    productsJson: null,
    aiProductsJson: null,
    aiSitemap: null,
    errors: []
  };
  
  const cleanDomain = publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const storeUrl = `https://${cleanDomain}`;
  const appUrl = process.env.APP_URL || 'https://indexaize.com';
  const appProxySubpath = process.env.APP_PROXY_SUBPATH || 'indexaize';
  
  // Fetch robots.txt from store (Shopify's or custom)
  try {
    const robotsResponse = await fetch(`${storeUrl}/robots.txt`, {
      headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
      timeout: 5000
    });
    if (robotsResponse.ok) {
      data.robotsTxt = await robotsResponse.text();
    } else {
      data.errors.push(`robots.txt: HTTP ${robotsResponse.status}`);
    }
  } catch (err) {
    data.errors.push(`robots.txt: ${err.message}`);
  }
  
  // Fetch Shopify's default sitemap.xml
  try {
    const sitemapResponse = await fetch(`${storeUrl}/sitemap.xml`, {
      headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
      timeout: 5000
    });
    if (sitemapResponse.ok) {
      const sitemapContent = await sitemapResponse.text();
      data.sitemap = sitemapContent.length > 2000 
        ? sitemapContent.substring(0, 2000) + '\n... (truncated)'
        : sitemapContent;
    } else {
      data.shopifySitemapStatus = `HTTP ${sitemapResponse.status}`;
    }
  } catch (err) {
    data.shopifySitemapStatus = err.message;
  }
  
  // Fetch products.json (public Shopify endpoint)
  try {
    const productsResponse = await fetch(`${storeUrl}/products.json?limit=5`, {
      headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
      timeout: 5000
    });
    if (productsResponse.ok) {
      const productsData = await productsResponse.json();
      data.productsJson = productsData.products?.slice(0, 3).map(p => ({
        title: p.title,
        handle: p.handle,
        product_type: p.product_type,
        price: p.variants?.[0]?.price,
        url: `${storeUrl}/products/${p.handle}`
      }));
    }
  } catch (err) {
    // Ignore - not critical
  }
  
  // ============================================
  // FETCH OUR AI ENDPOINTS (indexAIze data)
  // ============================================
  
  // AI Products JSON Feed (from our app)
  try {
    const aiProductsResponse = await fetch(`${appUrl}/ai/products.json?shop=${shop}`, {
      headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
      timeout: 30000 // 30 seconds for pagination of large catalogs
    });
    if (aiProductsResponse.ok) {
      const aiProductsData = await aiProductsResponse.json();
      data.aiProductsJson = {
        available: true,
        productCount: aiProductsData.products?.length || 0,
        sampleProduct: aiProductsData.products?.[0] ? {
          title: aiProductsData.products[0].title,
          hasMetafields: !!aiProductsData.products[0].metafields
        } : null
      };
    } else {
      data.aiProductsJson = { available: false, status: aiProductsResponse.status };
    }
  } catch (err) {
    data.aiProductsJson = { available: false, error: err.message };
  }
  
  // AI-Enhanced Sitemap (from our app)
  try {
    const aiSitemapResponse = await fetch(`${appUrl}/sitemap_products.xml?shop=${shop}`, {
      headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
      timeout: 5000
    });
    if (aiSitemapResponse.ok) {
      const aiSitemapContent = await aiSitemapResponse.text();
      const hasAIMetadata = aiSitemapContent.includes('xmlns:ai=') || aiSitemapContent.includes('<ai:product>');
      data.aiSitemap = {
        available: true,
        hasAIMetadata,
        url: `${appUrl}/sitemap_products.xml?shop=${shop}`,
        appProxyUrl: `${storeUrl}/apps/${appProxySubpath}/ai/sitemap-feed.xml?shop=${shop}`,
        sample: hasAIMetadata ? aiSitemapContent.substring(0, 1500) : null
      };
    } else {
      data.aiSitemap = { available: false, status: aiSitemapResponse.status };
    }
  } catch (err) {
    data.aiSitemap = { available: false, error: err.message };
  }
  
  // Store the correct URLs for AI context
  data.endpoints = {
    robotsTxt: `${storeUrl}/robots.txt`,
    shopifySitemap: `${storeUrl}/sitemap.xml`,
    shopifyProducts: `${storeUrl}/products.json`,
    aiProductsFeed: `${appUrl}/ai/products.json?shop=${shop}`,
    aiSitemap: `${appUrl}/sitemap_products.xml?shop=${shop}`,
    aiWelcomePage: `${appUrl}/ai/welcome?shop=${shop}`,
    appProxyBase: `${storeUrl}/apps/${appProxySubpath}`
  };
  
  return data;
}

// Build store context for AI
async function buildStoreContext(shop, shopRecord) {
  const activeStatusFilter = {
    $or: [
      { status: 'ACTIVE' },
      { status: { $exists: false } },
      { status: null }
    ]
  };
  
  // Get products (sample)
  const products = await Product.find({ shop, ...activeStatusFilter })
    .select('title descriptionHtml productType vendor priceRange tags handle')
    .limit(50)
    .lean();
  
  // Get collections
  const collections = await Collection.find({ shop })
    .select('title description handle productsCount')
    .limit(20)
    .lean();
  
  // Get store metadata
  const storeMetadata = shopRecord?.storeMetadata || {};
  
  let context = '';
  
  // Store info
  context += `STORE NAME: ${storeMetadata.storeName || shopRecord?.name || shop}\n`;
  if (storeMetadata.tagline) context += `TAGLINE: ${storeMetadata.tagline}\n`;
  if (storeMetadata.description) context += `DESCRIPTION: ${storeMetadata.description}\n`;
  if (storeMetadata.targetAudience) context += `TARGET AUDIENCE: ${storeMetadata.targetAudience}\n`;
  if (storeMetadata.uniqueSellingPoints) context += `UNIQUE SELLING POINTS: ${storeMetadata.uniqueSellingPoints}\n`;
  
  // Contact info
  if (storeMetadata.organizationSchema) {
    const org = storeMetadata.organizationSchema;
    if (org.email) context += `EMAIL: ${org.email}\n`;
    if (org.phone) context += `PHONE: ${org.phone}\n`;
    if (org.address) context += `ADDRESS: ${org.address}\n`;
  }
  
  // Collections
  if (collections.length > 0) {
    context += `\nCOLLECTIONS:\n`;
    collections.forEach(c => {
      context += `- ${c.title}${c.productsCount ? ` (${c.productsCount} products)` : ''}\n`;
      if (c.description) context += `  Description: ${c.description.substring(0, 100)}...\n`;
    });
  }
  
  // Products
  if (products.length > 0) {
    context += `\nPRODUCTS (${products.length} shown):\n`;
    products.forEach(p => {
      const price = p.priceRange?.minVariantPrice?.amount 
        ? `${p.priceRange.minVariantPrice.currencyCode || ''} ${p.priceRange.minVariantPrice.amount}`
        : '';
      context += `- ${p.title}${price ? ` - ${price}` : ''}${p.productType ? ` [${p.productType}]` : ''}\n`;
    });
  }
  
  return context;
}

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
  
  // Get stats from database (same as Dashboard) - only count ACTIVE products
  // Include products with status: ACTIVE OR status not set (for backwards compatibility)
  const activeStatusFilter = {
    $or: [
      { status: 'ACTIVE' },
      { status: { $exists: false } },
      { status: null }
    ]
  };
  const totalProducts = await Product.countDocuments({ shop, ...activeStatusFilter });
  const optimizedProducts = await Product.countDocuments({ 
    shop, 
    ...activeStatusFilter,
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
    },
    // AI Discovery files (available for all plans)
    {
      key: 'llmsTxt',
      name: 'LLMs.txt',
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/llms.txt?shop=${shop}`
    },
    // MCP Server (available for all plans)
    {
      key: 'mcpServer',
      name: 'MCP Server',
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/mcp?shop=${shop}`,
      customTest: true // handled separately (requires JSON-RPC initialize)
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
      
      // MCP Server custom test (requires JSON-RPC POST, not GET)
      if (endpoint.customTest && endpoint.key === 'mcpServer') {
        try {
          const mcpResponse = await fetch(endpoint.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/event-stream',
              'User-Agent': 'IndexAIze-Bot/1.0'
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'indexAIze-test', version: '1.0' }
              }
            }),
            timeout: 10000
          });
          
          if (mcpResponse.ok) {
            const mcpBody = await mcpResponse.text();
            const hasServerInfo = mcpBody.includes('indexAIze') && mcpBody.includes('protocolVersion');
            const hasToolsCap = mcpBody.includes('"tools"');
            const hasResourcesCap = mcpBody.includes('"resources"');
            
            if (hasServerInfo && hasToolsCap && hasResourcesCap) {
              results[endpoint.key] = {
                status: 'success',
                message: 'MCP Server is active and responding. AI agents can connect via Model Context Protocol.',
                name: endpoint.name,
                dataSize: mcpBody.length,
                contentType: mcpResponse.headers.get('content-type')
              };
            } else if (hasServerInfo) {
              results[endpoint.key] = {
                status: 'fair',
                message: 'MCP Server responds but capabilities may be limited',
                name: endpoint.name,
                dataSize: mcpBody.length
              };
            } else {
              results[endpoint.key] = {
                status: 'warning',
                message: 'MCP endpoint reachable but returned unexpected response',
                name: endpoint.name
              };
            }
          } else {
            results[endpoint.key] = {
              status: 'error',
              message: `MCP Server returned HTTP ${mcpResponse.status}`,
              name: endpoint.name
            };
          }
        } catch (mcpErr) {
          results[endpoint.key] = {
            status: 'error',
            message: `MCP Server not reachable: ${mcpErr.message}`,
            name: endpoint.name
          };
        }
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
            const optimizationPercent = totalProducts > 0 ? Math.round((optimizedProducts / totalProducts) * 100) : 0;
            
            if (optimizationPercent <= 20) {
              validationStatus = 'warning';
              validationMessage = `${optimizedProducts}/${totalProducts} products optimized (${optimizationPercent}%)`;
            } else if (optimizationPercent <= 49) {
              validationStatus = 'poor';
              validationMessage = `${optimizedProducts}/${totalProducts} products optimized (${optimizationPercent}%)`;
            } else if (optimizationPercent <= 70) {
              validationStatus = 'fair';
              validationMessage = `${optimizedProducts}/${totalProducts} products optimized (${optimizationPercent}%)`;
            } else {
              validationStatus = 'success';
              validationMessage = `${optimizedProducts}/${totalProducts} products optimized (${optimizationPercent}%)`;
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
            
            const collectionPercent = actualTotal > 0 ? Math.round((actualOptimized / actualTotal) * 100) : 0;
            
            if (collectionPercent <= 20) {
              validationStatus = 'warning';
              validationMessage = `${actualOptimized}/${actualTotal} collections optimized (${collectionPercent}%)`;
            } else if (collectionPercent <= 49) {
              validationStatus = 'poor';
              validationMessage = `${actualOptimized}/${actualTotal} collections optimized (${collectionPercent}%)`;
            } else if (collectionPercent <= 70) {
              validationStatus = 'fair';
              validationMessage = `${actualOptimized}/${actualTotal} collections optimized (${collectionPercent}%)`;
            } else {
              validationStatus = 'success';
              validationMessage = `${actualOptimized}/${actualTotal} collections optimized (${collectionPercent}%)`;
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
              
              // Check for ai-schema snippet render tag (recommended installation method)
              const hasAiSchemaRenderTag = themeContent.includes("render 'ai-schema'") || 
                                            themeContent.includes('render "ai-schema"');
              
              // Look for schema.org structured data (inline method)
              const hasLdJson = themeContent.includes('application/ld+json') || themeContent.includes('application\\/ld+json');
              const hasSchemaOrg = themeContent.includes('schema.org') || themeContent.includes('schema\\.org');
              const hasOrganization = /@type["\s:]*"?\s*Organization/i.test(themeContent) || 
                                      themeContent.includes('"@type":"Organization"');
              const hasWebSite = /@type["\s:]*"?\s*WebSite/i.test(themeContent) || 
                                 themeContent.includes('"@type":"WebSite"');
              const hasAiSeoComment = themeContent.includes('AI SEO App') || 
                                       themeContent.includes('Organization & WebSite Schema');
              
              if (hasAiSchemaRenderTag) {
                // Best case - using the snippet render method
                validationMessage = 'Schema snippet installed correctly ({% render \'ai-schema\' %} found)';
              } else if (!hasLdJson && !hasSchemaOrg) {
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
          
          // llms.txt validation
          if (endpoint.key === 'llmsTxt' && data) {
            if (typeof data === 'string' && data.trim().length > 0) {
              const hasTitle = data.includes('#');
              const hasLinks = data.includes('http');
              const hasProductCatalog = data.toLowerCase().includes('product') || data.toLowerCase().includes('catalog');
              
              if (hasTitle && hasLinks && hasProductCatalog) {
                validationMessage = 'LLMs.txt is configured correctly with store information and endpoint links';
              } else if (hasTitle && hasLinks) {
                validationStatus = 'fair';
                validationMessage = 'LLMs.txt exists but may be missing product catalog links';
              } else {
                validationStatus = 'warning';
                validationMessage = 'LLMs.txt exists but content appears incomplete';
              }
            } else {
              validationStatus = 'warning';
              validationMessage = 'LLMs.txt returned empty content';
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
    
    // Check if user has purchased tokens (not just included tokens)
    const hasPurchasedTokens = tokenBalance.totalPurchased > 0;
    
    // Check if feature requires tokens
    const { requiresTokens, isBlockedInTrial } = await import('../billing/tokenConfig.js');
    
    if (requiresTokens(feature)) {
      
      // TRIAL RESTRICTION: Different logic for included vs purchased tokens
      // Only block if: has included tokens plan + in trial + not activated + no purchased tokens
      if (hasIncludedTokens && inTrial && !isActivated && !hasPurchasedTokens && isBlockedInTrial(feature)) {
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
    
    // Calculate GEO Score (Generative Engine Optimization)
    let geoScore = null;
    try {
      const { calculateGEOScore } = await import('../utils/geoScoreCalculator.js');
      
      // Get stats for score calculation - only count ACTIVE products
      // Include products with status: ACTIVE OR status not set (for backwards compatibility)
      const totalProducts = await Product.countDocuments({ 
        shop, 
        $or: [
          { status: 'ACTIVE' },
          { status: { $exists: false } },
          { status: null }
        ]
      });
      const optimizedProducts = await Product.countDocuments({ 
        shop, 
        $or: [
          { status: 'ACTIVE' },
          { status: { $exists: false } },
          { status: null }
        ],
        'seoStatus.optimized': true 
      });
      const totalCollections = await Collection.countDocuments({ shop });
      const optimizedCollections = await Collection.countDocuments({ 
        shop, 
        'seoStatus.optimized': true 
      });
      
      geoScore = calculateGEOScore(
        endpointResults, // Basic test results
        results,         // AI validation results
        {
          totalProducts,
          optimizedProducts,
          totalCollections,
          optimizedCollections
        }
      );
    } catch (scoreError) {
      console.error('[AI-TESTING] Failed to calculate GEO score:', scoreError);
      console.error('[AI-TESTING] Score error stack:', scoreError.stack);
      // Don't fail the request if score calculation fails
    }
    
    const responseData = {
      shop,
      timestamp: new Date().toISOString(),
      results,
      tokensUsed: totalTokensUsed,
      tokenBalance: tokenBalance.balance,
      geoScore // Add score to response
    };
    
    res.json(responseData);
    
  } catch (error) {
    console.error('[AI-VALIDATION] Error:', error);
    res.status(500).json({ error: 'Failed to complete AI validation' });
  }
});

// ============================================
// POST /api/ai-testing/competitive-analysis
// Compare store AI-readiness with competitors
// Available for Growth Plus and higher plans
// ============================================
router.post('/ai-testing/competitive-analysis', validateRequest(), async (req, res) => {
  const shop = req.shopDomain || req.query.shop || req.body?.shop;
  const { competitors = [] } = req.body || {};
  
  console.log('[COMPETITIVE] Request received:', { 
    shopDomain: req.shopDomain, 
    queryShop: req.query.shop, 
    bodyShop: req.body?.shop,
    competitors: competitors?.length,
    body: req.body
  });
  
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }
  
  // Validate competitors array
  if (!Array.isArray(competitors) || competitors.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one competitor URL' });
  }
  
  if (competitors.length > 3) {
    return res.status(400).json({ error: 'Maximum 3 competitors allowed' });
  }
  
  try {
    // Check plan - Growth Plus and higher only
    const subscription = await Subscription.findOne({ shop });
    const planKey = normalizePlan(subscription?.plan);
    const allowedPlans = ['growth_plus', 'growth_extra', 'enterprise'];
    
    if (!allowedPlans.includes(planKey) && subscription?.plan !== 'growth plus') {
      return res.status(403).json({
        error: 'Competitive Analysis requires Growth Plus plan or higher',
        currentPlan: subscription?.plan || 'starter',
        requiredPlan: 'Growth Plus',
        feature: 'competitive-analysis'
      });
    }
    
    // Get shop record for public domain
    const shopRecord = await Shop.findOne({ shop });
    let myDomain = shopRecord?.primaryDomain;
    
    // If no primaryDomain in DB, fetch from Shopify API
    if (!myDomain && shopRecord?.accessToken) {
      try {
        const domainQuery = `
          query {
            shop {
              primaryDomain {
                url
              }
            }
          }
        `;
        const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopRecord.accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: domainQuery })
        });
        const data = await response.json();
        myDomain = data?.data?.shop?.primaryDomain?.url;
        
        // Save to DB for future use
        if (myDomain) {
          await Shop.findOneAndUpdate({ shop }, { primaryDomain: myDomain });
          console.log(`[COMPETITIVE] Saved primaryDomain for ${shop}: ${myDomain}`);
        }
      } catch (err) {
        console.error('[COMPETITIVE] Error fetching primaryDomain:', err.message);
      }
    }
    
    // Fallback if still no domain
    if (!myDomain) {
      myDomain = `https://${shop.replace('.myshopify.com', '.com')}`;
    }
    
    console.log(`[COMPETITIVE] Analyzing store: ${myDomain}`);
    
    // Analyze my store (technical analysis)
    const myAnalysis = await analyzeStoreAIReadiness(myDomain, shop, true);
    
    // Note: We use technical score for Competitive Analysis (external HTTP checks)
    // GEO Score (from AI Testing page) is more comprehensive but requires full test results
    // The technical score here is consistent and comparable across all stores
    
    // Analyze competitors
    const competitorResults = await Promise.all(
      competitors.map(async (url) => {
        try {
          const cleanUrl = url.trim().replace(/\/$/, '');
          const domain = cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`;
          return await analyzeStoreAIReadiness(domain, null, false);
        } catch (err) {
          return {
            domain: url,
            error: err.message,
            score: 0,
            criteria: {}
          };
        }
      })
    );
    
    res.json({
      success: true,
      myStore: myAnalysis,
      competitors: competitorResults,
      summary: generateCompetitiveSummary(myAnalysis, competitorResults)
    });
    
  } catch (error) {
    console.error('[COMPETITIVE-ANALYSIS] Error:', error);
    res.status(500).json({ error: 'Failed to complete competitive analysis' });
  }
});

// Helper function to analyze store AI-readiness
async function analyzeStoreAIReadiness(domain, shop = null, isMyStore = false) {
  const result = {
    domain,
    isMyStore,
    score: 0,
    criteria: {
      robotsTxt: { status: 'unknown', score: 0, details: '' },
      sitemap: { status: 'unknown', score: 0, details: '' },
      productsJson: { status: 'unknown', score: 0, details: '' },
      structuredData: { status: 'unknown', score: 0, details: '' },
      aiEndpoints: { status: 'unknown', score: 0, details: '' }
    }
  };
  
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const storeUrl = `https://${cleanDomain}`;
  
  // 1. Check robots.txt
  try {
    const robotsResponse = await fetch(`${storeUrl}/robots.txt`, {
      headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
      timeout: 10000
    });
    if (robotsResponse.ok) {
      const robotsTxt = await robotsResponse.text();
      const hasAIDirectives = robotsTxt.includes('GPTBot') || 
                              robotsTxt.includes('ChatGPT') || 
                              robotsTxt.includes('anthropic') ||
                              robotsTxt.includes('ClaudeBot') ||
                              robotsTxt.includes('Google-Extended');
      const hasSitemap = robotsTxt.toLowerCase().includes('sitemap:');
      
      // robots.txt: max 15 points (controls AI bot access)
      result.criteria.robotsTxt = {
        status: hasAIDirectives ? 'excellent' : hasSitemap ? 'good' : 'basic',
        score: hasAIDirectives ? 15 : hasSitemap ? 10 : 5,
        details: hasAIDirectives ? 'AI bot directives configured' : hasSitemap ? 'Standard with sitemap' : 'Basic robots.txt'
      };
    } else {
      result.criteria.robotsTxt = { status: 'missing', score: 0, details: 'No robots.txt found' };
    }
  } catch (err) {
    result.criteria.robotsTxt = { status: 'error', score: 0, details: 'Could not access' };
  }
  
  // 2. Check sitemap (both Shopify default AND our AI-Enhanced sitemap)
  try {
    let hasAINamespace = false;
    let urlCount = 0;
    
    // First check Shopify's default sitemap
    const sitemapResponse = await fetch(`${storeUrl}/sitemap.xml`, {
      headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
      timeout: 10000
    });
    if (sitemapResponse.ok) {
      const sitemapContent = await sitemapResponse.text();
      hasAINamespace = sitemapContent.includes('xmlns:ai=') || sitemapContent.includes('<ai:');
      urlCount = (sitemapContent.match(/<url>/g) || []).length;
    }
    
    // For our store, also check our AI-Enhanced sitemap endpoint
    if (isMyStore && shop && !hasAINamespace) {
      try {
        const appUrl = process.env.APP_URL || 'https://shopify-ai-seo-app-production.up.railway.app';
        const aiSitemapResponse = await fetch(`${appUrl}/sitemap_products.xml?shop=${shop}`, {
          headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
          timeout: 10000
        });
        if (aiSitemapResponse.ok) {
          const aiSitemapContent = await aiSitemapResponse.text();
          if (aiSitemapContent.includes('xmlns:ai=') || aiSitemapContent.includes('<ai:')) {
            hasAINamespace = true;
          }
        }
      } catch (e) {
        // Ignore - will use default sitemap check
      }
    }
    
    // Sitemap: max 20 points (helps AI discover content)
    result.criteria.sitemap = {
      status: hasAINamespace ? 'excellent' : urlCount > 50 ? 'good' : 'basic',
      score: hasAINamespace ? 20 : urlCount > 50 ? 12 : 6,
      details: hasAINamespace ? 'AI-Enhanced sitemap detected' : `Standard sitemap (${urlCount} URLs)`
    };
  } catch (err) {
    result.criteria.sitemap = { status: 'error', score: 0, details: 'Could not access' };
  }
  
  // 3. Check products.json (Shopify stores)
  try {
    const productsResponse = await fetch(`${storeUrl}/products.json?limit=1`, {
      headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
      timeout: 10000
    });
    if (productsResponse.ok) {
      const productsData = await productsResponse.json();
      const hasProducts = productsData.products?.length > 0;
      
      // Products JSON: max 6 points (standard Shopify endpoint, not AI-specific)
      result.criteria.productsJson = {
        status: hasProducts ? 'good' : 'none',
        score: hasProducts ? 6 : 0,
        details: hasProducts ? 'Products JSON accessible' : 'Not accessible or empty'
      };
    } else {
      result.criteria.productsJson = { status: 'none', score: 0, details: 'Not a Shopify store or disabled' };
    }
  } catch (err) {
    result.criteria.productsJson = { status: 'none', score: 0, details: 'Not accessible' };
  }
  
  // 4. Check for structured data (homepage + our Advanced Schema API)
  try {
    let hasJsonLd = false;
    let hasOrgSchema = false;
    let hasProductSchema = false;
    let hasAdvancedSchema = false;
    
    // Check homepage for basic schema
    const homepageResponse = await fetch(storeUrl, {
      headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
      timeout: 10000
    });
    if (homepageResponse.ok) {
      const html = await homepageResponse.text();
      hasJsonLd = html.includes('application/ld+json');
      hasOrgSchema = html.includes('"@type":"Organization"') || html.includes('"@type": "Organization"');
      hasProductSchema = html.includes('"@type":"Product"') || html.includes('"@type": "Product"');
    }
    
    // For our store, also check our Advanced Schema API endpoint
    if (isMyStore && shop) {
      try {
        // Use direct API URL instead of app proxy (more reliable)
        const appUrl = process.env.APP_URL || 'https://shopify-ai-seo-app-production.up.railway.app';
        const schemaApiUrl = `${appUrl}/ai/schema-data.json?shop=${shop}`;
        const schemaResponse = await fetch(schemaApiUrl, {
          headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
          timeout: 10000
        });
        if (schemaResponse.ok) {
          const schemaData = await schemaResponse.json();
          // Check both snake_case and camelCase for compatibility
          if (schemaData.schemas?.length > 0 || schemaData.total_schemas > 0 || schemaData.totalSchemas > 0) {
            hasAdvancedSchema = true;
          }
        }
      } catch (e) {
        console.log('[COMPETITIVE] Schema API check failed:', e.message);
        // Ignore - will use homepage check
      }
      
      // Also check MongoDB directly for hasAdvancedSchema flag
      if (!hasAdvancedSchema) {
        try {
          const Product = (await import('../db/Product.js')).default;
          const productsWithSchema = await Product.countDocuments({
            shop,
            'seoStatus.hasAdvancedSchema': true
          });
          if (productsWithSchema > 0) {
            hasAdvancedSchema = true;
          }
        } catch (e) {
          // Ignore
        }
      }
    }
    
    let schemaScore = 0;
    let schemaStatus = 'none';
    let schemaDetails = 'No structured data found';
    
    // Structured Data: max 30 points (most important for AI understanding)
    if (hasAdvancedSchema) {
      schemaScore = 30;
      schemaStatus = 'excellent';
      schemaDetails = 'Advanced Schema API enabled';
    } else if (hasJsonLd) {
      schemaScore = 10;
      schemaStatus = 'basic';
      schemaDetails = 'Basic JSON-LD present';
      
      if (hasOrgSchema) {
        schemaScore = 15;
        schemaStatus = 'good';
        schemaDetails = 'Organization schema present';
      }
      
      if (hasProductSchema) {
        schemaScore = 20;
        schemaStatus = 'good';
        schemaDetails = 'Product schema detected';
      }
    }
    
    result.criteria.structuredData = { status: schemaStatus, score: schemaScore, details: schemaDetails };
  } catch (err) {
    result.criteria.structuredData = { status: 'error', score: 0, details: 'Could not analyze' };
  }
  
  // 5. Check AI-specific endpoints (only for stores with our app)
  if (isMyStore && shop) {
    try {
      const appUrl = process.env.APP_URL || 'https://shopify-ai-seo-app-production.up.railway.app';
      const aiProductsResponse = await fetch(`${appUrl}/ai/products.json?shop=${shop}`, {
        headers: { 'User-Agent': 'IndexAIze-Bot/1.0' },
        timeout: 10000
      });
      
      if (aiProductsResponse.ok) {
        const aiData = await aiProductsResponse.json();
        const productCount = aiData.products?.length || 0;
        
        // AI Endpoints: max 25 points (direct AI crawler feeds)
        result.criteria.aiEndpoints = {
          status: productCount > 0 ? 'excellent' : 'configured',
          score: productCount > 0 ? 25 : 10,
          details: productCount > 0 ? `AI Products Feed: ${productCount} products` : 'AI endpoints configured'
        };
      } else {
        result.criteria.aiEndpoints = { status: 'unavailable', score: 0, details: 'AI endpoints not configured' };
      }
    } catch (err) {
      result.criteria.aiEndpoints = { status: 'error', score: 0, details: 'Could not check' };
    }
  } else {
    // For competitors, we can't check their AI endpoints (they likely don't have our app)
    result.criteria.aiEndpoints = { status: 'n/a', score: 0, details: 'Not applicable (competitor)' };
  }
  
  // Calculate total score
  result.score = Object.values(result.criteria).reduce((sum, c) => sum + c.score, 0);
  
  return result;
}

// Generate competitive summary
function generateCompetitiveSummary(myStore, competitors) {
  const validCompetitors = competitors.filter(c => !c.error);
  const avgCompetitorScore = validCompetitors.length > 0 
    ? Math.round(validCompetitors.reduce((sum, c) => sum + c.score, 0) / validCompetitors.length)
    : 0;
  
  const myAdvantages = [];
  const myWeaknesses = [];
  
  // Compare each criterion
  const criteriaNames = ['robotsTxt', 'sitemap', 'productsJson', 'structuredData', 'aiEndpoints'];
  
  for (const criterion of criteriaNames) {
    const myScore = myStore.criteria[criterion]?.score || 0;
    const avgCompScore = validCompetitors.length > 0
      ? validCompetitors.reduce((sum, c) => sum + (c.criteria[criterion]?.score || 0), 0) / validCompetitors.length
      : 0;
    
    if (myScore > avgCompScore + 5) {
      myAdvantages.push(criterion);
    } else if (myScore < avgCompScore - 5) {
      myWeaknesses.push(criterion);
    }
  }
  
  return {
    myScore: myStore.score,
    avgCompetitorScore,
    scoreDifference: myStore.score - avgCompetitorScore,
    position: myStore.score > avgCompetitorScore ? 'ahead' : myStore.score < avgCompetitorScore ? 'behind' : 'equal',
    advantages: myAdvantages,
    weaknesses: myWeaknesses,
    recommendation: myStore.score > avgCompetitorScore 
      ? 'Great job! Your store is better optimized for AI than your competitors.'
      : myStore.score < avgCompetitorScore
        ? 'There\'s room for improvement. Enable more AI Discovery features to get ahead.'
        : 'You\'re on par with competitors. Enable advanced features to stand out.'
  };
}

export default router;

