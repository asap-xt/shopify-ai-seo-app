// backend/services/aiDiscoveryService.js
class AIDiscoveryService {
  constructor() {
    this.namespace = 'ai_discovery';
    this.cache = new Map();
    this.cacheTTL = 3600000; // 1 hour
  }

  /**
   * Get AI Discovery settings for a shop
   */
  async getSettings(shop, session) {
    // Check cache
    const cacheKey = `settings:${shop}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    try {
      // Use REST API to get shop metafield
      const response = await fetch(
        `https://${shop}/admin/api/2024-07/metafields.json?namespace=${this.namespace}&key=settings`,
        {
          headers: {
            'X-Shopify-Access-Token': session.accessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch metafield: ${response.status}`);
      }

      const data = await response.json();
      const metafield = data.metafields?.[0];
      const settings = metafield ? JSON.parse(metafield.value) : this.getDefaultSettings();

      // Cache
      this.cache.set(cacheKey, {
        data: settings,
        expires: Date.now() + this.cacheTTL
      });

      return settings;
    } catch (error) {
      console.error('Failed to get settings:', error);
      return this.getDefaultSettings();
    }
  }

  /**
   * Update AI Discovery settings
   */
  async updateSettings(shop, session, settings) {
    try {
      // First, try to get existing metafield
      const getResponse = await fetch(
        `https://${shop}/admin/api/2024-07/metafields.json?namespace=${this.namespace}&key=settings`,
        {
          headers: {
            'X-Shopify-Access-Token': session.accessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      const getData = await getResponse.json();
      const existingMetafield = getData.metafields?.[0];

      const metafieldData = {
        namespace: this.namespace,
        key: 'settings',
        value: JSON.stringify({
          ...settings,
          updatedAt: new Date().toISOString()
        }),
        type: 'json'
      };

      let saveResponse;
      
      if (existingMetafield) {
        // Update existing
        saveResponse = await fetch(
          `https://${shop}/admin/api/2024-07/metafields/${existingMetafield.id}.json`,
          {
            method: 'PUT',
            headers: {
              'X-Shopify-Access-Token': session.accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ metafield: metafieldData })
          }
        );
      } else {
        // Create new
        saveResponse = await fetch(
          `https://${shop}/admin/api/2024-07/metafields.json`,
          {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': session.accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
              metafield: {
                ...metafieldData,
                owner_resource: 'shop'
              }
            })
          }
        );
      }

      if (!saveResponse.ok) {
        throw new Error(`Failed to save metafield: ${saveResponse.status}`);
      }

      // Invalidate cache
      const cacheKey = `settings:${shop}`;
      this.cache.delete(cacheKey);

      return { success: true };
    } catch (error) {
      console.error('Failed to update settings:', error);
      throw error;
    }
  }

  // ... rest of the methods remain the same
  getDefaultSettings(plan = 'starter') {
    const base = {
      bots: {
        openai: true,
        anthropic: true,
        google: true,
        perplexity: true,
        meta: false,
        others: true
      },
      features: {
        productsJson: true,
        aiSitemap: true,
        welcomePage: plan !== 'starter',
        collectionsJson: ['growth', 'growth_extra', 'enterprise'].includes(plan),
        autoRobotsTxt: ['growth', 'growth_extra', 'enterprise'].includes(plan)
      },
      updatedAt: new Date().toISOString()
    };

    return base;
  }

  generateRobotsTxt(settings, shopDomain) {
    // ... same as before
  }

  isFeatureAvailable(plan, feature) {
    // ... same as before
  }
}

export default new AIDiscoveryService();