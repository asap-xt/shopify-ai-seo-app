// backend/controllers/aiDiscoveryController.js
import express from 'express';
import aiDiscoveryService from '../services/aiDiscoveryService.js';
import AIDiscoverySettings from '../db/AIDiscoverySettings.js';
import { shopGraphQL as originalShopGraphQL } from './seoController.js';
import { validateRequest } from '../middleware/shopifyAuth.js';
import { resolveShopToken } from '../utils/tokenResolver.js';

// Helper function to normalize plan names
const normalizePlan = (plan) => {
  return (plan || 'starter').toLowerCase().replace(' ', '_');
};

// Use originalShopGraphQL directly - token resolution is handled by /api middleware

const router = express.Router();

// Token resolution is now handled by the /api middleware

/**
 * GET /api/ai-discovery/settings
 */
router.get('/ai-discovery/settings', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // The token is already available in res.locals from the /api middleware
    const accessToken = res.locals.shopify?.session?.accessToken || req.shopAccessToken;
    
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const session = {
      shop: shop,
      accessToken: accessToken
    };
    
    // Get current plan
    const Q = `
      query PlansMe($shop:String!) {
        plansMe(shop:$shop) {
          plan
        }
      }
    `;
    const planResponse = await fetch(`${process.env.APP_URL}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: Q, variables: { shop } }),
    });
    const planRes = await planResponse.json();
    if (planRes?.errors?.length) throw new Error(planRes.errors[0]?.message || 'GraphQL error');
    const planData = planRes?.data?.plansMe;
    const rawPlan = planData.plan || 'starter';
    const normalizedPlan = rawPlan.toLowerCase().replace(/\s+/g, '_');
    
    // Get saved settings
    const savedSettings = await aiDiscoveryService.getSettings(shop, session);

    // Get default structure for the plan
    const defaultSettings = aiDiscoveryService.getDefaultSettings(normalizedPlan);

    // IMPORTANT: For new shops, all features should be false by default
    const defaultFeatures = {
      productsJson: false,
      aiSitemap: false,
      welcomePage: false,
      collectionsJson: false,
      autoRobotsTxt: false,
      storeMetadata: false,
      schemaData: false
    };

    // Check if this is a "fresh" shop
    // Since getSettings() always returns defaultSettings when no saved settings exist,
    // we need to check if this is the default state (all features false)
    const allFeaturesFalse = savedSettings.features && 
                             Object.values(savedSettings.features).every(val => val === false);

    // Also check if updatedAt is missing or very recent (indicating fresh default settings)
    const hasRecentDefaultTimestamp = !savedSettings.updatedAt || 
                                     (new Date(savedSettings.updatedAt) > new Date(Date.now() - 5 * 60 * 1000)); // 5 minutes ago

    const isFreshShop = allFeaturesFalse && hasRecentDefaultTimestamp;

    // Check if AI-Optimized Sitemap exists in database
    const { default: Sitemap } = await import('../db/Sitemap.js');
    const existingSitemap = await Sitemap.findOne({ shop }).select('isAiEnhanced updatedAt').lean();
    const hasAiSitemap = existingSitemap && existingSitemap.isAiEnhanced === true;

    const mergedSettings = {
      plan: rawPlan,
      availableBots: defaultSettings.availableBots,
      bots: savedSettings.bots || defaultSettings.bots,
      features: isFreshShop ? defaultFeatures : savedSettings.features,
      richAttributes: savedSettings.richAttributes || defaultSettings.richAttributes,
      advancedSchemaEnabled: savedSettings.advancedSchemaEnabled || false,
      updatedAt: savedSettings.updatedAt || new Date().toISOString(),
      hasAiSitemap: hasAiSitemap // NEW: indicate if AI sitemap exists
    };

    res.json(mergedSettings);
  } catch (error) {
    console.error('Failed to get AI Discovery settings:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ai-discovery/settings
 */
router.post('/ai-discovery/settings', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { bots, features, advancedSchemaEnabled, richAttributes } = req.body;
    
    if (!bots || !features) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // The token is already available in res.locals from the /api middleware
    const accessToken = res.locals.shopify?.session?.accessToken || req.shopAccessToken;
    
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const session = {
      shop: shop,
      accessToken: accessToken
    };
    
    // Save to MongoDB
    const hasEnabledBots = Object.values(bots || {}).some(bot => bot.enabled === true);
    const hasEnabledFeatures = Object.values(features || {}).some(f => f === true);
    const enabled = hasEnabledBots || hasEnabledFeatures; // Enable if either bots OR features are selected
    
    const settings = await AIDiscoverySettings.findOneAndUpdate(
      { shop },
      { 
        shop,
        bots: bots || {},
        features: features || {},
        richAttributes: richAttributes || {},
        enabled,
        advancedSchemaEnabled: advancedSchemaEnabled || false,
        updatedAt: Date.now()
      },
      { upsert: true, new: true }
    );
    
    // Update in Shopify metafields
    await aiDiscoveryService.updateSettings(shop, session, {
      bots,
      features,
      richAttributes,
      advancedSchemaEnabled
    });
    
    res.json({ success: true, settings });
  } catch (error) {
    console.error('[AI-DISCOVERY] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ai-discovery/simulate
 * AI-powered simulation endpoint for AI Testing page
 * Uses real store data + Gemini Flash Lite to generate realistic responses
 */
router.get('/ai-discovery/simulate', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { type, question } = req.query;
    
    if (!type) {
      return res.status(400).json({ error: 'Missing type parameter' });
    }
    
    if (type === 'custom' && !question) {
      return res.status(400).json({ error: 'Missing question parameter for custom type' });
    }
    
    // === TOKEN CHECKING ===
    // Import necessary modules for token checking
    const Subscription = (await import('../db/Subscription.js')).default;
    const TokenBalance = (await import('../db/TokenBalance.js')).default;
    
    // Get subscription and plan
    const subscription = await Subscription.findOne({ shop });
    const planKey = subscription?.plan?.toLowerCase().replace(/\s+/g, '_') || 'starter';
    
    // Starter plan: Block with upgrade modal
    if (planKey === 'starter') {
      return res.status(402).json({
        error: 'AI Testing requires plan upgrade',
        requiresUpgrade: true,
        minimumPlan: 'Professional',
        currentPlan: subscription?.plan || 'Starter',
        message: 'AI Testing is available starting from Professional plan'
      });
    }
    
    // Professional & Growth: Check tokens
    if (planKey === 'professional' || planKey === 'growth') {
      const tokenBalance = await TokenBalance.findOne({ shop });
      const estimatedTokens = 5000; // Estimate for simulation
      
      if (!tokenBalance || tokenBalance.balance < estimatedTokens) {
        return res.status(402).json({
          error: 'Insufficient tokens',
          requiresPurchase: true,
          currentPlan: subscription?.plan,
          tokensRequired: estimatedTokens,
          tokensAvailable: tokenBalance?.balance || 0,
          tokensNeeded: estimatedTokens - (tokenBalance?.balance || 0),
          message: 'Purchase tokens to use AI Testing'
        });
      }
      
      // Reserve tokens
      const reservation = tokenBalance.reserveTokens(estimatedTokens, 'ai-simulation', { type, question: question?.substring(0, 50) });
      await tokenBalance.save();
      
      // Store reservationId for later adjustment
      res.locals.tokenReservationId = reservation.reservationId;
      res.locals.tokenBalance = tokenBalance;
    }
    
    // Growth Extra & Enterprise: Has included tokens, just track usage
    // (token consumption will be tracked at the end)
    // === END TOKEN CHECKING ===
    
    // The token is already available in res.locals from the /api middleware
    const accessToken = res.locals.shopify?.session?.accessToken || req.shopAccessToken;
    
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    // Fetch real store data via GraphQL
    const shopDataQuery = `
      query GetStoreData {
        shop {
          name
          description
          url
          contactEmail
          currencyCode
          primaryDomain { url }
        }
        products(first: 10) {
          edges {
            node {
              title
              description
              productType
              vendor
              tags
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
        collections(first: 5) {
          edges {
            node {
              title
              description
            }
          }
        }
      }
    `;
    
    const shopifyGraphQL = async (query) => {
      const response = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });
      
      if (!response.ok) {
        throw new Error(`Shopify GraphQL error: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
      }
      
      return result.data;
    };
    
    const storeData = await shopifyGraphQL(shopDataQuery);
    
    // Prepare context for AI based on question type
    let contextPrompt = '';
    
    switch (type) {
      case 'products':
        const products = storeData.products.edges.map(e => e.node);
        const productList = products.map(p => 
          `- ${p.title} (${p.productType || 'General'}) - ${p.description ? p.description.substring(0, 100) : 'No description'}...`
        ).join('\n');
        
        contextPrompt = `Store: ${storeData.shop.name}
Products available:
${productList}

Question: "What products does this store sell?"

Generate a helpful, natural response listing the main products and categories. Be specific about actual products.`;
        break;
        
      case 'business':
        contextPrompt = `Store: ${storeData.shop.name}
Description: ${storeData.shop.description || 'E-commerce store'}
Website: ${storeData.shop.url}
Currency: ${storeData.shop.currencyCode}
Contact: ${storeData.shop.contactEmail || 'Available via website'}

Question: "Tell me about this business"

Generate a helpful response about the store's business, what they offer, and how to engage with them.`;
        break;
        
      case 'categories':
        const collections = storeData.collections.edges.map(e => e.node);
        const categoryList = collections.map(c => 
          `- ${c.title}: ${c.description ? c.description.substring(0, 80) : 'Product category'}...`
        ).join('\n');
        
        contextPrompt = `Store: ${storeData.shop.name}
Categories available:
${categoryList}

Question: "What categories does this store have?"

Generate a helpful response listing the actual categories/collections. Be specific.`;
        break;
        
      case 'contact':
        contextPrompt = `Store: ${storeData.shop.name}
Website: ${storeData.shop.url}
Contact Email: ${storeData.shop.contactEmail || 'Not specified'}

Question: "What is this store's contact information?"

Generate a helpful response with contact details. Be specific about what's available.`;
        break;
        
      case 'custom':
        const customProducts = storeData.products.edges.map(e => e.node);
        const customCollections = storeData.collections.edges.map(e => e.node);
        
        contextPrompt = `Store: ${storeData.shop.name}
Description: ${storeData.shop.description || 'E-commerce store'}
Website: ${storeData.shop.url}
Currency: ${storeData.shop.currencyCode}
Contact: ${storeData.shop.contactEmail || 'Available via website'}

Products (sample):
${customProducts.slice(0, 5).map(p => `- ${p.title} (${p.productType || 'General'})`).join('\n')}

Categories:
${customCollections.map(c => `- ${c.title}`).join('\n')}

Customer Question: "${question}"

Generate a helpful, accurate response based on the provided store information. If the information needed to answer is not available, politely indicate that and suggest how they can find out (e.g., visit the website, contact support).`;
        break;
        
      default:
        contextPrompt = `Store: ${storeData.shop.name}
General question about the store.
Generate a helpful response.`;
    }
    
    // Call Gemini Flash Lite for AI response (paid model with tokens)
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const AI_MODEL = 'google/gemini-2.5-flash-lite';
    
    if (!OPENROUTER_API_KEY) {
      console.warn('[AI-SIMULATE] No OpenRouter API key, using fallback');
      return res.json({ 
        response: 'AI simulation is temporarily unavailable. Please configure API keys.',
        fallback: true 
      });
    }
    
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || process.env.APP_URL || 'https://indexaize.com',
        'X-Title': 'indexAIze - Unlock AI Search'
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful AI assistant for an e-commerce store. Answer questions naturally and conversationally based on the provided store data. Be specific and accurate. Keep responses concise (2-3 sentences).'
          },
          {
            role: 'user',
            content: contextPrompt
          }
        ],
        temperature: 0.7
      })
    });
    
    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[AI-SIMULATE] OpenRouter error:', errorText);
      throw new Error(`AI API error: ${aiResponse.statusText}`);
    }
    
    const aiData = await aiResponse.json();
    const generatedResponse = aiData.choices[0]?.message?.content || 'Unable to generate response';
    const actualTokens = aiData.usage?.total_tokens || 0;
    
    // === TOKEN CONSUMPTION TRACKING ===
    if (res.locals.tokenBalance && res.locals.tokenReservationId) {
      // Professional & Growth: Finalize reservation with actual usage
      const tokenBalance = res.locals.tokenBalance;
      const reservationId = res.locals.tokenReservationId;
      
      // Finalize reservation (this will refund the difference between estimated and actual)
      await tokenBalance.finalizeReservation(reservationId, actualTokens);
    } else {
      // Growth Extra & Enterprise: Deduct from included tokens balance
      const TokenBalance = (await import('../db/TokenBalance.js')).default;
      const tokenBalance = await TokenBalance.findOne({ shop });
      
      if (tokenBalance && actualTokens > 0) {
        // Deduct from balance (included tokens)
        tokenBalance.balance = Math.max(0, tokenBalance.balance - actualTokens);
        tokenBalance.totalUsed = (tokenBalance.totalUsed || 0) + actualTokens;
        await tokenBalance.save();
      }
    }
    
    // Invalidate cache so new token balance is immediately visible
    try {
      const cacheService = await import('../services/cacheService.js');
      await cacheService.default.invalidateShop(shop);
    } catch (cacheErr) {
      console.error('[AI-DISCOVERY] Failed to invalidate cache:', cacheErr);
    }
    // === END TOKEN TRACKING ===
    
    res.json({ response: generatedResponse });
    
  } catch (error) {
    console.error('[AI-SIMULATE] Error:', error);
    
    // Refund reserved tokens on error (Professional & Growth only)
    if (res.locals.tokenBalance && res.locals.tokenReservationId) {
      try {
        const tokenBalance = res.locals.tokenBalance;
        const reservationId = res.locals.tokenReservationId;
        
        // Find the reservation and mark as cancelled, refund the tokens
        const reservationIndex = tokenBalance.usage.findIndex(
          u => u.metadata?.reservationId === reservationId && u.metadata?.status === 'reserved'
        );
        
        if (reservationIndex !== -1) {
          const estimatedAmount = tokenBalance.usage[reservationIndex].tokensUsed;
          
          // Refund the estimated amount back to balance
          tokenBalance.balance += estimatedAmount;
          
          // Mark reservation as cancelled
          tokenBalance.usage[reservationIndex].metadata.status = 'cancelled';
          tokenBalance.usage[reservationIndex].metadata.cancelledAt = new Date();
          
          await tokenBalance.save();
        }
      } catch (refundError) {
        console.error('[AI-SIMULATE] Error refunding tokens:', refundError);
      }
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ai-discovery/robots-txt
 */
router.get('/ai-discovery/robots-txt', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    // The token is already available in res.locals from the /api middleware
    const accessToken = res.locals.shopify?.session?.accessToken || req.shopAccessToken;
    
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const session = {
      shop: shop,
      accessToken: accessToken
    };
    
    const settings = await aiDiscoveryService.getSettings(shop, session);
    const robotsTxt = await aiDiscoveryService.generateRobotsTxt(shop);
    
    // ВАЖНО: Върнете като plain text, не JSON!
    res.type('text/plain').send(robotsTxt);
    
  } catch (error) {
    console.error('[ROBOTS-TXT] ERROR:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ai-discovery/apply-robots
 * 
 * ⚠️ CURRENTLY DISABLED - Requires Shopify Protected Scope Approval
 * 
 * This endpoint attempts to automatically write robots.txt.liquid to the store's theme.
 * However, it requires the `write_themes_assets` protected scope which is NOT available
 * without explicit approval from Shopify.
 * 
 * Status: NOT IN USE - Frontend UI does not expose this functionality
 * Alternative: Users manually copy/paste robots.txt via theme editor (Settings page)
 * 
 * To enable in the future:
 * 1. Submit "Online Store Protected Scope Exemption Request" via Shopify Partner Dashboard
 * 2. Wait for Shopify approval for `write_themes_assets` scope
 * 3. Add `write_themes_assets` to server.js scopes
 * 4. Uncomment auto-apply UI in frontend/src/pages/Settings.jsx (line ~1907)
 * 
 * See: https://partners.shopify.com/ (search for protected scope exemption)
 */
router.post('/ai-discovery/apply-robots', validateRequest(), async (req, res) => {
  // Return 501 Not Implemented with clear explanation
  return res.status(501).json({ 
    error: 'Automatic robots.txt installation is temporarily disabled',
    reason: 'Requires Shopify approval for write_themes_assets protected scope',
    alternative: 'Please use manual copy/paste method from Settings page',
    documentation: 'Contact support for manual installation instructions'
  });
  
  /* ORIGINAL CODE - Keep for future use after Shopify approval
  console.log('[APPLY ENDPOINT] Called with body:', req.body);
  
  try {
    const shop = req.shopDomain;
    
    console.log('[APPLY ENDPOINT] Shop:', shop);
    
    // Generate fresh robots.txt
    const robotsTxt = await aiDiscoveryService.generateRobotsTxt(shop);
    console.log('[APPLY ENDPOINT] Generated robots.txt length:', robotsTxt.length);
    console.log('[APPLY ENDPOINT] First 200 chars:', robotsTxt.substring(0, 200));
    
    // Apply to theme
    console.log('[APPLY ENDPOINT] Calling applyRobotsTxt...');
    const result = await applyRobotsTxt(shop, robotsTxt);
    console.log('[APPLY ENDPOINT] Result:', result);
    
    res.json(result);
  } catch (error) {
    console.error('[APPLY ENDPOINT] Error:', error.message);
    console.error('[APPLY ENDPOINT] Stack:', error.stack);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
  */
});

/**
 * DELETE /api/ai-discovery/settings - Reset settings to defaults
 */
router.delete('/ai-discovery/settings', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // The token is already available in res.locals from the /api middleware
    const accessToken = res.locals.shopify?.session?.accessToken || req.shopAccessToken;
    
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const session = { accessToken: accessToken };
    
    // Delete metafield
    const response = await fetch(
      `https://${shop}/admin/api/2024-07/metafields.json?namespace=ai_discovery&key=settings&owner_resource=shop`,
      {
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      const metafield = data.metafields?.[0];
      
      if (metafield) {
        await fetch(
          `https://${shop}/admin/api/2024-07/metafields/${metafield.id}.json`,
          {
            method: 'DELETE',
            headers: {
              'X-Shopify-Access-Token': session.accessToken
            }
          }
        );
      }
    }
    
    // NEW: Delete robots.txt redirect
    const redirectsResponse = await fetch(
      `https://${shop}/admin/api/2024-07/redirects.json?path=/robots.txt`,
      {
        headers: {
          'X-Shopify-Access-Token': session.accessToken
        }
      }
    );
    
    if (redirectsResponse.ok) {
      const redirectsData = await redirectsResponse.json();
      for (const redirect of redirectsData.redirects || []) {
        await fetch(
          `https://${shop}/admin/api/2024-07/redirects/${redirect.id}.json`,
          {
            method: 'DELETE',
            headers: {
              'X-Shopify-Access-Token': session.accessToken
            }
          }
        );
      }
    }
    
    // Clear cache
    aiDiscoveryService.cache.clear();
    
    res.json({ success: true, message: 'All settings and configurations reset' });
  } catch (error) {
    console.error('Failed to reset settings:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ai-discovery/test-assets - Test endpoint to check theme assets
 */
router.get('/ai-discovery/test-assets', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // The token is already available in res.locals from the /api middleware
    const accessToken = res.locals.shopify?.session?.accessToken || req.shopAccessToken;
    
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const session = {
      shop: shop,
      accessToken: accessToken
    };
    
    // Get theme
    const themesResponse = await fetch(
      `https://${shop}/admin/api/2024-07/themes.json`,
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    
    const themesData = await themesResponse.json();
    const activeTheme = themesData.themes?.find(t => t.role === 'main');
    
    // List all assets
    const assetsResponse = await fetch(
      `https://${shop}/admin/api/2024-07/themes/${activeTheme.id}/assets.json`,
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    
    const assetsData = await assetsResponse.json();
    
    res.json({
      theme: activeTheme.name,
      totalAssets: assetsData.assets?.length,
      robotsFiles: assetsData.assets?.filter(a => a.key.includes('robots')),
      liquidFiles: assetsData.assets?.filter(a => a.key.endsWith('.liquid')).slice(0, 10)
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Apply robots.txt to theme - GraphQL ONLY
 * 
 * ⚠️ CURRENTLY NOT FUNCTIONAL - Requires Shopify Protected Scope Approval
 * 
 * This function attempts to write robots.txt.liquid to the store's theme using GraphQL API.
 * It requires the `write_themes_assets` protected scope which Shopify only grants after
 * explicit approval via "Online Store Protected Scope Exemption Request" form.
 * 
 * Without this scope, the GraphQL mutation `themeFilesUpsert` will return:
 * "Access denied for themeFilesUpsert field. Required access: write_themes AND write_themes_assets"
 * 
 * Status: Code preserved for future use after Shopify approval
 * Current approach: Manual copy/paste by users via Settings page UI
 * 
 * @param {string} shop - Shop domain
 * @param {string} robotsTxt - Generated robots.txt content
 * @returns {Promise<object>} Result object with success/error status
 */
async function applyRobotsTxt(shop, robotsTxt) {
  // Check if plan supports auto robots
  try {
    const Q = `
      query PlansMe($shop:String!) {
        plansMe(shop:$shop) {
          plan
        }
      }
    `;
    const planResponse = await fetch(`${process.env.APP_URL}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: Q, variables: { shop } }),
    });
    if (planResponse.ok) {
      const planRes = await planResponse.json();
      if (planRes?.errors?.length) throw new Error(planRes.errors[0]?.message || 'GraphQL error');
      const planData = planRes?.data?.plansMe;
      const normalizedPlan = normalizePlan(planData.plan);
      
      const supportedPlans = ['growth', 'growth_extra', 'enterprise'];
      if (!supportedPlans.includes(normalizedPlan)) {
        throw new Error(`Auto robots.txt is only available for Growth+ plans. Current plan: ${planData.plan}`);
      }
    }
  } catch (error) {
    throw new Error(`Plan verification failed: ${error.message}`);
  }
  
  try {
    // Get the main theme
    const themesQuery = `{
      themes(first: 10) {
        edges {
          node {
            id
            name
            role
          }
        }
      }
    }`;
    
    const themesData = await originalShopGraphQL(null, shop, themesQuery);
    const mainTheme = themesData.themes.edges.find(t => t.node.role === 'MAIN');
    
    if (!mainTheme) {
      throw new Error('Main theme not found');
    }
    
    // ВАЖНО: body трябва да е обект с type и value ключове
    const mutation = `
      mutation CreateOrUpdateRobotsTxt($themeId: ID!, $filename: String!, $body: OnlineStoreThemeFileBodyInput!) {
        themeFilesUpsert(
          themeId: $themeId,
          files: [{
            filename: $filename,
            body: $body
          }]
        ) {
          upsertedThemeFiles {
            filename
            size
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;
    
    // Правилна структура на variables с body като обект
    const variables = {
      themeId: mainTheme.node.id,
      filename: "templates/robots.txt.liquid",
      body: {
        type: "TEXT",
        value: robotsTxt
      }
    };
    
    const result = await originalShopGraphQL(null, shop, mutation, variables);
    
    if (result.themeFilesUpsert?.userErrors?.length > 0) {
      const error = result.themeFilesUpsert.userErrors[0];
      
      // Ако има проблем с input типа, пробвай алтернативен подход
      if (error.message.includes('OnlineStoreThemeFileBodyInput')) {
        // Алтернативна мутация - inline структура
        const altMutation = `
          mutation CreateOrUpdateRobotsTxt($themeId: ID!) {
            themeFilesUpsert(
              themeId: $themeId,
              files: [{
                filename: "templates/robots.txt.liquid",
                body: {
                  type: TEXT,
                  value: """${robotsTxt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"""
                }
              }]
            ) {
              upsertedThemeFiles {
                filename
                size
              }
              userErrors {
                field
                message
                code
              }
            }
          }
        `;
        
        const altVariables = {
          themeId: mainTheme.node.id
        };
        
        const altResult = await originalShopGraphQL(null, shop, altMutation, altVariables);
        
        if (altResult.themeFilesUpsert?.userErrors?.length > 0) {
          throw new Error(`Alternative mutation also failed: ${altResult.themeFilesUpsert.userErrors[0].message}`);
        }
        
        if (altResult.themeFilesUpsert?.upsertedThemeFiles?.length) {
          return {
            success: true,
            message: 'robots.txt applied successfully (alternative method)',
            file: altResult.themeFilesUpsert.upsertedThemeFiles[0]
          };
        }
      }
      
      throw new Error(`Failed to update robots.txt: ${error.message} (${error.code})`);
    }
    
    if (!result.themeFilesUpsert?.upsertedThemeFiles?.length) {
      throw new Error('No files were created or updated');
    }
    
    return { 
      success: true, 
      message: 'robots.txt applied successfully',
      file: result.themeFilesUpsert.upsertedThemeFiles[0]
    };
    
  } catch (error) {
    console.error('[ROBOTS DEBUG] GraphQL Error:', error);
    
    // Последен опит - използвай themeFileCreate мутация
    if (error.message.includes('themeFilesUpsert') || error.message.includes('OnlineStoreThemeFileBodyInput')) {
      try {
        const themesQuery = `{
          themes(first: 10) {
            edges {
              node {
                id
                name
                role
              }
            }
          }
        }`;
        
        const themesData = await originalShopGraphQL(null, shop, themesQuery);
        const mainTheme = themesData.themes.edges.find(t => t.node.role === 'MAIN');
        
        // Първо изтрий съществуващия файл ако има такъв
        const deleteMutation = `
          mutation DeleteRobotsTxt($themeId: ID!) {
            themeFilesDelete(
              themeId: $themeId,
              files: ["templates/robots.txt.liquid"]
            ) {
              deletedThemeFiles {
                filename
              }
              userErrors {
                field
                message
              }
            }
          }
        `;
        
        await originalShopGraphQL(null, shop, deleteMutation, { themeId: mainTheme.node.id });
        
        // След това създай нов файл
        const createMutation = `
          mutation CreateRobotsTxt($themeId: ID!, $files: [OnlineStoreThemeFileInput!]!) {
            themeFileCreate(
              themeId: $themeId,
              files: $files
            ) {
              files {
                filename
                size
              }
              userErrors {
                field
                message
              }
            }
          }
        `;
        
        const createVariables = {
          themeId: mainTheme.node.id,
          files: [{
            filename: "templates/robots.txt.liquid",
            content: robotsTxt
          }]
        };
        
        const createResult = await originalShopGraphQL(null, shop, createMutation, createVariables);
        
        if (createResult.themeFileCreate?.userErrors?.length > 0) {
          throw new Error(`themeFileCreate failed: ${createResult.themeFileCreate.userErrors[0].message}`);
        }
        
        if (createResult.themeFileCreate?.files?.length) {
          return {
            success: true,
            message: 'robots.txt created successfully via themeFileCreate',
            file: createResult.themeFileCreate.files[0]
          };
        }
        
      } catch (createError) {
        console.error('[ROBOTS DEBUG] themeFileCreate also failed:', createError);
      }
    }
    
    throw new Error(`All GraphQL methods failed. Original error: ${error.message}`);
  }
}

// Debug endpoint for shop data
router.get('/debug-shop/:shop', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // The token is already available in res.locals from the /api middleware
    const accessToken = res.locals.shopify?.session?.accessToken || req.shopAccessToken;
    
    res.json({
      shop: shop,
      hasToken: !!accessToken,
      tokenType: accessToken?.substring(0, 6),
      note: 'Using new auth system - scopes not available'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint for authentication testing
router.get('/ai-discovery/test-auth', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // Check what's available in res.locals
    const hasAdminSession = !!res.locals.adminSession;
    const hasAccessToken = !!res.locals.shopify?.session?.accessToken || req.shopAccessToken;
    const accessToken = res.locals.shopify?.session?.accessToken || req.shopAccessToken;
    
    // Try the centralized resolver
    let resolvedToken = null;
    try {
      resolvedToken = await resolveShopToken(shop);
    } catch (e) {
      console.error('Token resolver error:', e);
    }
    
    res.json({
      shop,
      hasAdminSession,
      hasAccessToken,
      hasResolvedToken: !!resolvedToken,
      tokenPrefix: accessToken ? accessToken.substring(0, 10) + '...' : null,
      resolvedTokenPrefix: resolvedToken ? resolvedToken.substring(0, 10) + '...' : null,
      tokensMatch: accessToken === resolvedToken
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;