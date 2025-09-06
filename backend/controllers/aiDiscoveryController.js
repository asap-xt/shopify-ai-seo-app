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
  try {
    const { shop } = req.body;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    const { session, accessToken } = await getShopSession(shop);
    
    // Check plan
    const planResponse = await fetch(`${process.env.APP_URL}/plans/me?shop=${shop}`);
    const planData = await planResponse.json();
    
    if (!['growth', 'growth_extra', 'enterprise'].includes(planData.plan)) {
      return res.status(403).json({ 
        error: 'Automatic robots.txt requires Growth plan or higher' 
      });
    }
    
    // Get settings and generate robots.txt
    const settings = await aiDiscoveryService.getSettings(shop, session);
    const robotsTxt = aiDiscoveryService.generateRobotsTxt(settings, shop);
    
    // Get active theme using REST API
    const themesResponse = await fetch(
      `https://${shop}/admin/api/2024-07/themes.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const themesData = await themesResponse.json();
    const activeTheme = themesData.themes?.find(t => t.role === 'main');
    
    if (!activeTheme) {
      return res.status(404).json({ error: 'No active theme found' });
    }
    
    // Create/update robots.txt.liquid
    const assetResponse = await fetch(
      `https://${shop}/admin/api/2024-07/themes/${activeTheme.id}/assets.json`,
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
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
        })
      }
    );
    
    if (!assetResponse.ok) {
      throw new Error('Failed to update theme asset');
    }
    
    res.json({ 
      success: true, 
      message: 'robots.txt.liquid updated successfully',
      theme: activeTheme.name
    });
  } catch (error) {
    console.error('Failed to apply robots.txt:', error);
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