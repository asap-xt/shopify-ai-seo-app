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
    const accessToken = res.locals.adminSession?.accessToken;
    
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const session = {
      shop: shop,
      accessToken: accessToken
    };
    
    // Get current plan
    const planResponse = await fetch(`${process.env.APP_URL}/plans/me?shop=${shop}`);
    const planData = await planResponse.json();
    const rawPlan = planData.plan || 'starter';
    const normalizedPlan = rawPlan.toLowerCase().replace(/\s+/g, '_');
    
    // Get saved settings
    const savedSettings = await aiDiscoveryService.getSettings(shop, session);
    
    // Get default structure for the plan
    const defaultSettings = aiDiscoveryService.getDefaultSettings(normalizedPlan);
    
    // IMPORTANT: Don't merge features from defaultSettings if there are no saved settings
    const mergedSettings = {
      plan: rawPlan,
      availableBots: defaultSettings.availableBots,
      bots: savedSettings.bots || defaultSettings.bots,
      features: savedSettings.features || defaultSettings.features, // Will be all false from default
      advancedSchemaEnabled: savedSettings.advancedSchemaEnabled || false, // ADD THIS
      updatedAt: savedSettings.updatedAt || new Date().toISOString()
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
    const shop = req.shopDomain || req.query.shop;
    const { bots, features, advancedSchemaEnabled } = req.body;
    
    console.log('[AI-DISCOVERY] Saving settings for shop:', shop);
    
    if (!bots || !features) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // The token is already available in res.locals from the /api middleware
    const accessToken = res.locals.adminSession?.accessToken;
    
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const session = {
      shop: shop,
      accessToken: accessToken
    };
    
    // Save to MongoDB
    const enabled = Object.values(features || {}).some(f => f === true);
    
    const settings = await AIDiscoverySettings.findOneAndUpdate(
      { shop },
      { 
        shop,
        bots: bots || {},
        features: features || {},
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
    
    // The token is already available in res.locals from the /api middleware
    const accessToken = res.locals.adminSession?.accessToken;
    
    if (!accessToken) {
      throw new Error('No access token available');
    }
    
    const session = {
      shop: shop,
      accessToken: accessToken
    };
    
    const settings = await aiDiscoveryService.getSettings(shop, session);
    const robotsTxt = await aiDiscoveryService.generateRobotsTxt(shop);
    
    res.type('text/plain').send(robotsTxt);
  } catch (error) {
    console.error('Failed to generate robots.txt:', error);
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
    const accessToken = res.locals.adminSession?.accessToken;
    
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
    const accessToken = res.locals.adminSession?.accessToken;
    
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
async function applyRobotsTxt(shop, robotsTxt) {
  console.log('[ROBOTS] Starting applyRobotsTxt for shop:', shop);
  
  // Use the centralized token resolver
  const accessToken = await resolveShopToken(shop);
  
  if (!accessToken) {
    throw new Error('No access token available for shop');
  }
  
  // Now use originalShopGraphQL with the shop parameter
  // The token will be resolved by the seoController's shopGraphQL function
  
  // Проверяваме дали планът поддържа autoRobotsTxt
  try {
    const planResponse = await fetch(`${process.env.APP_URL}/plans/me?shop=${shop}`);
    if (planResponse.ok) {
      const planData = await planResponse.json();
      const normalizedPlan = normalizePlan(planData.plan);
      
      // Проверяваме дали планът поддържа autoRobotsTxt
      const supportedPlans = ['growth', 'growth_extra', 'enterprise'];
      if (!supportedPlans.includes(normalizedPlan)) {
        throw new Error(`Auto robots.txt is only available for Growth+ plans. Current plan: ${planData.plan}`);
      }
      
      console.log('[ROBOTS DEBUG] Plan check passed:', normalizedPlan);
    } else {
      console.warn('[ROBOTS DEBUG] Could not fetch plan, proceeding anyway');
    }
  } catch (error) {
    console.error('[ROBOTS DEBUG] Plan check failed:', error.message);
    throw new Error(`Plan verification failed: ${error.message}`);
  }
  
  console.log('[ROBOTS DEBUG] Content length:', robotsTxt.length);
  
  try {
    // Първо намираме активната тема
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
    
    console.log('[ROBOTS DEBUG] Fetching themes...');
    const themesData = await originalShopGraphQL(shop, themesQuery);
    console.log('[ROBOTS DEBUG] Themes data:', JSON.stringify(themesData, null, 2));
    
    const mainTheme = themesData.themes.edges.find(t => t.node.role === 'MAIN');
    
    if (!mainTheme) {
      console.error('[ROBOTS DEBUG] No main theme found!');
      throw new Error('Main theme not found');
    }
    
    const themeId = mainTheme.node.id;
    console.log('[ROBOTS DEBUG] Main theme ID:', themeId);
    console.log('[ROBOTS DEBUG] Main theme name:', mainTheme.node.name);
    
    // Създаваме/обновяваме robots.txt.liquid файла
    const mutation = `
      mutation createOrUpdateFile($themeId: ID!, $files: [OnlineStoreThemeFileInput!]!) {
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
    
    const variables = {
      themeId: themeId,
      files: [{
        filename: "templates/robots.txt.liquid",
        body: {
          type: "TEXT",
          value: robotsTxt
        }
      }]
    };
    
    console.log('[ROBOTS DEBUG] Mutation variables:', JSON.stringify(variables, null, 2));
    
    const result = await originalShopGraphQL(shop, mutation, variables);
    console.log('[ROBOTS DEBUG] Mutation result:', JSON.stringify(result, null, 2));
    
    if (result.themeFilesUpsert?.userErrors?.length > 0) {
      const error = result.themeFilesUpsert.userErrors[0];
      console.error('[ROBOTS DEBUG] User errors:', result.themeFilesUpsert.userErrors);
      throw new Error(`Failed to update robots.txt: ${error.message} (${error.code})`);
    }
    
    // Проверяваме дали файлът наистина е създаден
    if (result.themeFilesUpsert?.upsertedThemeFiles?.length > 0) {
      console.log('[ROBOTS DEBUG] File created successfully:', result.themeFilesUpsert.upsertedThemeFiles[0]);
    } else {
      console.warn('[ROBOTS DEBUG] No files were created!');
    }
    
    console.log('[AI Discovery] robots.txt applied successfully');
    return { success: true, message: 'robots.txt applied successfully' };
    
  } catch (error) {
    console.error('[ROBOTS DEBUG] Error applying robots.txt:', error);
    console.error('[ROBOTS DEBUG] Error stack:', error.stack);
    throw error;
  }
}

// Debug endpoint for shop data
router.get('/debug-shop/:shop', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // The token is already available in res.locals from the /api middleware
    const accessToken = res.locals.adminSession?.accessToken;
    
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
    const shop = req.shopDomain || req.query.shop;
    
    // Check what's available in res.locals
    const hasAdminSession = !!res.locals.adminSession;
    const hasAccessToken = !!res.locals.adminSession?.accessToken;
    const accessToken = res.locals.adminSession?.accessToken;
    
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