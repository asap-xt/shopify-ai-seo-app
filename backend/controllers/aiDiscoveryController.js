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
    
    console.log('[AI-DISCOVERY] Debug token info:', {
      shop,
      hasShopifySession: !!res.locals.shopify?.session,
      hasAccessToken: !!accessToken,
      tokenStartsWith: accessToken ? accessToken.substring(0, 10) + '...' : 'none',
      hasShopAccessToken: !!req.shopAccessToken
    });
    
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

    console.log('[AI-DISCOVERY] ===== DEBUG SETTINGS =====');
    console.log('[AI-DISCOVERY] savedSettings.richAttributes:', savedSettings.richAttributes);
    console.log('[AI-DISCOVERY] defaultSettings.richAttributes:', defaultSettings.richAttributes);

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

    console.log('[AI-DISCOVERY] allFeaturesFalse:', allFeaturesFalse);
    console.log('[AI-DISCOVERY] hasRecentDefaultTimestamp:', hasRecentDefaultTimestamp);
    console.log('[AI-DISCOVERY] isFreshShop:', isFreshShop);
    console.log('[AI-DISCOVERY] Will use features:', isFreshShop ? 'defaultFeatures (all false)' : 'savedSettings.features');

    const mergedSettings = {
      plan: rawPlan,
      availableBots: defaultSettings.availableBots,
      bots: savedSettings.bots || defaultSettings.bots,
      features: isFreshShop ? defaultFeatures : savedSettings.features,
      richAttributes: savedSettings.richAttributes || defaultSettings.richAttributes,
      advancedSchemaEnabled: savedSettings.advancedSchemaEnabled || false,
      updatedAt: savedSettings.updatedAt || new Date().toISOString()
    };

    console.log('[AI-DISCOVERY] Final mergedSettings.features:', JSON.stringify(mergedSettings.features, null, 2));
    console.log('[AI-DISCOVERY] Final mergedSettings.richAttributes:', JSON.stringify(mergedSettings.richAttributes, null, 2));
    console.log('[AI-DISCOVERY] ===== END DEBUG =====');

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
    
    console.log('[AI-DISCOVERY] Saving settings for shop:', shop);
    
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
 * GET /api/ai-discovery/robots-txt
 */
router.get('/ai-discovery/robots-txt', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    console.log('[ROBOTS-TXT] Request received');
    console.log('[ROBOTS-TXT] Shop:', shop);
    console.log('[ROBOTS-TXT] Headers:', req.headers);
    
    if (!shop) {
      console.log('[ROBOTS-TXT] ERROR: Missing shop');
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
    
    console.log('[ROBOTS-TXT] Generated length:', robotsTxt?.length);
    console.log('[ROBOTS-TXT] First 100 chars:', robotsTxt?.substring(0, 100));
    
    // ВАЖНО: Върнете като plain text, не JSON!
    res.type('text/plain').send(robotsTxt);
    
  } catch (error) {
    console.error('[ROBOTS-TXT] ERROR:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ai-discovery/apply-robots
 */
router.post('/ai-discovery/apply-robots', validateRequest(), async (req, res) => {
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
 * Apply robots.txt to theme
 */
/**
 * Apply robots.txt to theme - Fixed version
 */
async function applyRobotsTxt(shop, robotsTxt) {
  console.log('[ROBOTS DEBUG] Starting applyRobotsTxt for shop:', shop);
  
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
    
    // Correct mutation structure for themeFilesUpsert
    const mutation = `
      mutation CreateOrUpdateRobotsTxt($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
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
    
    // Correct variables structure
    const variables = {
      themeId: mainTheme.node.id,
      files: [{
        filename: "templates/robots.txt.liquid",
        body: robotsTxt  // Just the string content, no wrapper object
      }]
    };
    
    console.log('[ROBOTS DEBUG] Mutation variables:', JSON.stringify(variables, null, 2));
    
    const result = await originalShopGraphQL(null, shop, mutation, variables);
    
    console.log('[ROBOTS DEBUG] Mutation result:', JSON.stringify(result, null, 2));
    
    if (result.themeFilesUpsert?.userErrors?.length > 0) {
      const error = result.themeFilesUpsert.userErrors[0];
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
    console.error('[ROBOTS DEBUG] Error:', error);
    throw error;
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