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
    const { shop, bots, features } = req.body;
    
    if (!shop || !bots || !features) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const { session } = await getShopSession(shop);
    
    const settings = { bots, features };
    await aiDiscoveryService.updateSettings(shop, session, settings);
    
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
  console.log('[ROBOTS] Starting apply-robots endpoint');
  
  try {
    const { shop } = req.body;
    console.log('[ROBOTS] Shop:', shop);
    
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    const { session, accessToken } = await getShopSession(shop);
    console.log('[ROBOTS] Got session, accessToken exists:', !!accessToken);
    
    // Check plan
    const planResponse = await fetch(`${process.env.APP_URL}/plans/me?shop=${shop}`);
    const planData = await planResponse.json();
    console.log('[ROBOTS] Plan data:', planData);
    
    const normalizedPlan = (planData.plan || 'starter').toLowerCase().replace(/\s+/g, '_');
    console.log('[ROBOTS] Normalized plan:', normalizedPlan);
    
    if (!['growth', 'growth_extra', 'enterprise'].includes(normalizedPlan)) {
      return res.status(403).json({ 
        error: 'Automatic robots.txt requires Growth plan or higher' 
      });
    }
    
    // Get settings and generate robots.txt
    const settings = await aiDiscoveryService.getSettings(shop, session);
    const robotsTxt = aiDiscoveryService.generateRobotsTxt(settings, shop);
    console.log('[ROBOTS] Generated robots.txt length:', robotsTxt.length);
    
    // Get active theme
    const themesUrl = `https://${shop}/admin/api/2024-07/themes.json`;
    console.log('[ROBOTS] Fetching themes from:', themesUrl);
    
    const themesResponse = await fetch(themesUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('[ROBOTS] Themes response status:', themesResponse.status);
    
    if (!themesResponse.ok) {
      const errorText = await themesResponse.text();
      console.error('[ROBOTS] Themes fetch failed:', errorText);
      throw new Error('Failed to fetch themes');
    }
    
    const themesData = await themesResponse.json();
    console.log('[ROBOTS] Number of themes:', themesData.themes?.length);
    
    const activeTheme = themesData.themes?.find(t => t.role === 'main');
    console.log('[ROBOTS] Active theme:', activeTheme?.name, activeTheme?.id);
    
    if (!activeTheme) {
      return res.status(404).json({ error: 'No active theme found' });
    }
    
    // Update robots.txt.liquid
    const assetUrl = `https://${shop}/admin/api/2024-07/themes/${activeTheme.id}/assets.json`;
    console.log('[ROBOTS] Updating asset at:', assetUrl);
    
    const assetBody = {
      asset: {
        key: 'templates/robots.txt.liquid',
        value: `{% comment %}
AI Discovery - Auto-generated by AI SEO 2.0
Last updated: ${new Date().toISOString()}
{% endcomment %}
${robotsTxt}

{% comment %} Include any existing robots.txt content {% endcomment %}
`
      }
    };
    
    console.log('[ROBOTS] Asset body key:', assetBody.asset.key);
    console.log('[ROBOTS] Asset body value length:', assetBody.asset.value.length);
    
    const assetResponse = await fetch(assetUrl, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(assetBody)
    });
    
    console.log('[ROBOTS] Asset response status:', assetResponse.status);
    
    if (!assetResponse.ok) {
      const errorText = await assetResponse.text();
      console.error('[ROBOTS] Asset update failed:', errorText);
      throw new Error(`Failed to update theme asset: ${errorText}`);
    }
    
    const assetData = await assetResponse.json();
    console.log('[ROBOTS] Asset updated successfully:', assetData.asset?.key);
    
    res.json({ 
      success: true, 
      message: 'robots.txt.liquid updated successfully',
      theme: activeTheme.name
    });
    
  } catch (error) {
    console.error('[ROBOTS] Error in apply-robots:', error);
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
    
    const { session } = await getShopSession(shop);
    
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
    
    // Clear cache
    aiDiscoveryService.cache.clear();
    
    res.json({ success: true, message: 'Settings reset successfully' });
  } catch (error) {
    console.error('Failed to reset settings:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;