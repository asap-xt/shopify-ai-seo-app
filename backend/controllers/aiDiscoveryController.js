// backend/controllers/aiDiscoveryController.js
import express from 'express';
import aiDiscoveryService from '../services/aiDiscoveryService.js';
import Shop from '../db/Shop.js';

const router = express.Router();

/**
 * Helper to get shop session
 */
async function getShopSession(shopParam) {
  const shopDoc = await Shop.findOne({ shop: shopParam });
  if (!shopDoc || !shopDoc.accessToken) {
    throw new Error('Shop not found or not authenticated');
  }
  
  return {
    shop: shopDoc.shop,
    accessToken: shopDoc.accessToken,
    // Create session object for shopifyAdmin
    session: {
      shop: shopDoc.shop,
      accessToken: shopDoc.accessToken
    }
  };
}

/**
 * GET /api/ai-discovery/settings
 */
router.get('/ai-discovery/settings', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    const { session } = await getShopSession(shop);
    
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
router.post('/ai-discovery/settings', async (req, res) => {
  try {
    const { shop, bots, features, advancedSchemaEnabled } = req.body;
    
    if (!shop || !bots || !features) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const { session } = await getShopSession(shop);
    
    // Get existing settings to check if advancedSchemaEnabled is being turned on
    const existingSettings = await aiDiscoveryService.getSettings(shop, session);
    
    const settings = { 
      bots, 
      features,
      ...(advancedSchemaEnabled !== undefined && { advancedSchemaEnabled })
    };
    
    await aiDiscoveryService.updateSettings(shop, session, settings);
    
    // Trigger schema generation if advancedSchemaEnabled is being turned on
    if (advancedSchemaEnabled && !existingSettings.advancedSchemaEnabled) {
      console.log('[AI-DISCOVERY] Triggering schema generation...');
      try {
        const schemaRes = await fetch(`${process.env.APP_URL || 'http://localhost:8080'}/api/schema/generate-all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop })
        });
        
        const schemaResult = await schemaRes.json();
        console.log('[AI-DISCOVERY] Schema generation response:', schemaResult);
      } catch (err) {
        console.error('[AI-DISCOVERY] Failed to trigger schema generation:', err);
      }
    }
    
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Failed to update AI Discovery settings:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ai-discovery/robots-txt
 */
router.get('/ai-discovery/robots-txt', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    const { session } = await getShopSession(shop);
    const settings = await aiDiscoveryService.getSettings(shop, session);
    const robotsTxt = aiDiscoveryService.generateRobotsTxt(settings, shop);
    
    res.type('text/plain').send(robotsTxt);
  } catch (error) {
    console.error('Failed to generate robots.txt:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ai-discovery/apply-robots
 */
router.post('/ai-discovery/apply-robots', async (req, res) => {
  try {
    const { shop } = req.body;
    const { session, accessToken } = await getShopSession(shop);
    
    // Check plan
    const planResponse = await fetch(`${process.env.APP_URL}/plans/me?shop=${shop}`);
    const planData = await planResponse.json();
    const normalizedPlan = (planData.plan || 'starter').toLowerCase().replace(/\s+/g, '_');
    
    if (!['growth', 'growth_extra', 'enterprise'].includes(normalizedPlan)) {
      return res.status(403).json({ 
        error: 'Automatic robots.txt requires Growth plan or higher' 
      });
    }
    
    // Check for existing redirect
    const existingRedirects = await fetch(
      `https://${shop}/admin/api/2024-07/redirects.json?path=/robots.txt`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken
        }
      }
    );

    if (existingRedirects.ok) {
      const data = await existingRedirects.json();
      if (data.redirects?.length > 0) {
        // Before returning success, get active bots:
        const settings = await aiDiscoveryService.getSettings(shop, session);
        const activeBots = [];
        if (settings.bots?.openai?.enabled) activeBots.push('OpenAI');
        if (settings.bots?.anthropic?.enabled) activeBots.push('Claude');
        if (settings.bots?.google?.enabled) activeBots.push('Google');
        if (settings.bots?.perplexity?.enabled) activeBots.push('Perplexity');
        if (settings.bots?.meta?.enabled) activeBots.push('Meta');
        if (settings.bots?.others?.enabled) activeBots.push('Others');

        const message = activeBots.length > 0 
          ? `robots.txt updated for: ${activeBots.join(', ')}`
          : 'robots.txt updated with default settings';

        return res.json({ success: true, message });
      }
    }
    
    // Get settings and generate robots.txt
    const settings = await aiDiscoveryService.getSettings(shop, session);
    const robotsTxtContent = aiDiscoveryService.generateRobotsTxt(settings, shop);
    
    // Create redirect from /robots.txt to our endpoint
    const redirectResponse = await fetch(
      `https://${shop}/admin/api/2024-07/redirects.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          redirect: {
            path: "/robots.txt",
            target: `${process.env.APP_URL}/ai/robots-dynamic?shop=${shop}`
          }
        })
      }
    );
    
    if (redirectResponse.ok) {
      // Before returning success, get active bots:
      const activeBots = [];
      if (settings.bots?.openai?.enabled) activeBots.push('OpenAI');
      if (settings.bots?.anthropic?.enabled) activeBots.push('Claude');
      if (settings.bots?.google?.enabled) activeBots.push('Google');
      if (settings.bots?.perplexity?.enabled) activeBots.push('Perplexity');
      if (settings.bots?.meta?.enabled) activeBots.push('Meta');
      if (settings.bots?.others?.enabled) activeBots.push('Others');

      const message = activeBots.length > 0 
        ? `robots.txt configured for: ${activeBots.join(', ')}`
        : 'robots.txt configured with default settings';

      res.json({ success: true, message });
    } else {
      throw new Error('Could not create redirect');
    }
    
  } catch (error) {
    console.error('[ROBOTS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/ai-discovery/settings - Reset settings to defaults
 */
router.delete('/ai-discovery/settings', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    const session = { accessToken: shopRecord.accessToken };
    
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
router.get('/ai-discovery/test-assets', async (req, res) => {
  try {
    const shop = req.query.shop;
    const { session, accessToken } = await getShopSession(shop);
    
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

export default router;