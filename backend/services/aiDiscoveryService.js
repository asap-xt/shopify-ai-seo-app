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
    try {
      // Вземаме settings от metafield
      const response = await fetch(
        `https://${shop}/admin/api/2024-07/metafields.json?namespace=ai_discovery&key=settings&owner_resource=shop`,
        {
          headers: {
            'X-Shopify-Access-Token': session.accessToken,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error('Failed to fetch settings');
      }
      
      const data = await response.json();
      const metafield = data.metafields?.[0];
      let settings = null;
      
      if (metafield?.value) {
        try {
          settings = JSON.parse(metafield.value);
        } catch (e) {
          console.error('Failed to parse settings:', e);
          settings = this.getDefaultSettings();
        }
      }
      
      // Ако няма settings, връщаме defaults
      if (!settings) {
        settings = this.getDefaultSettings();
      }
      
      // НОВО: Добавяме план и availableBots
      try {
        const planResponse = await fetch(`${process.env.APP_URL}/plans/me?shop=${shop}`);
        if (planResponse.ok) {
          const planData = await planResponse.json();
          console.log('[PLAN DEBUG] Raw plan:', planData.plan);
          console.log('[PLAN DEBUG] Plan config:', planData);
          console.log('[PLAN DEBUG] Final planKey:', planData.planKey);
          settings.plan = planData.plan;
          settings.planKey = planData.planKey;
          settings.availableBots = this.getAvailableBotsForPlan(planData.planKey);
        } else {
          // Fallback стойности
          settings.plan = 'Starter';
          settings.planKey = 'starter';
          settings.availableBots = ['openai', 'perplexity'];
        }
      } catch (error) {
        console.error('Failed to fetch plan in getSettings:', error);
        settings.plan = 'Starter';
        settings.planKey = 'starter';
        settings.availableBots = ['openai', 'perplexity'];
      }
      
      this.cache.set(shop, settings, 300000); // Cache за 5 минути
      return settings;
      
    } catch (error) {
      console.error('Error in getSettings:', error);
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
    // Normalize the plan
    const normalizedPlan = plan.toLowerCase().replace(/\s+/g, '_');
    
    // All available bots - all are false by default
    const allBots = {
      openai: { name: 'OpenAI (GPTBot, ChatGPT)', enabled: false },
      perplexity: { name: 'Perplexity', enabled: false },
      anthropic: { name: 'Anthropic (Claude)', enabled: false },
      google: { name: 'Google AI (Gemini)', enabled: false },
      meta: { name: 'Meta AI', enabled: false },
      others: { name: 'Other AI Bots', enabled: false }
    };

    // CORRECT bots according to your plans:
    const availableBotsByPlan = {
      starter: ['openai', 'perplexity'], // 2 bots
      professional: ['openai', 'perplexity', 'anthropic'], // 3 bots  
      growth: ['openai', 'perplexity', 'anthropic', 'google'], // 4 bots (WITHOUT Meta & Others)
      growth_extra: ['openai', 'perplexity', 'anthropic', 'google', 'meta', 'others'], // all 6
      enterprise: ['openai', 'perplexity', 'anthropic', 'google', 'meta', 'others'] // all 6
    };

    const base = {
      bots: allBots,
      availableBots: availableBotsByPlan[normalizedPlan] || availableBotsByPlan.starter,
      features: {
        productsJson: false,
        aiSitemap: false,
        welcomePage: false,
        collectionsJson: false,
        autoRobotsTxt: ['growth', 'growth_extra', 'enterprise'].includes(normalizedPlan), // TRUE for Growth+
        storeMetadata: false,
        schemaData: false
      },
      plan: normalizedPlan, // Important - add the normalized plan here
      updatedAt: new Date().toISOString()
    };

    return base;
  }

  generateRobotsTxt(settings, shopDomain) {
    let content = '# AI Discovery by AI SEO 2.0\n';
    content += `# Generated on ${new Date().toISOString()}\n`;
    content += `# Shop: ${shopDomain}\n\n`;

    const { bots = {} } = settings;

    // OpenAI bots - check only if exists AND is enabled
    if (bots.openai?.enabled) {
      content += '# OpenAI\n';
      content += 'User-agent: GPTBot\n';
      content += 'User-agent: ChatGPT-User\n';
      content += 'Allow: /\n\n';
    }

    // Anthropic bots
    if (bots.anthropic?.enabled) {
      content += '# Anthropic\n';
      content += 'User-agent: Claude-Web\n';
      content += 'User-agent: ClaudeBot\n';
      content += 'Allow: /\n\n';
    }

    // Google bots
    if (bots.google?.enabled) {
      content += '# Google AI\n';
      content += 'User-agent: GoogleOther\n';
      content += 'User-agent: Google-Extended\n';
      content += 'Allow: /\n\n';
    }

    // Perplexity
    if (bots.perplexity?.enabled) {
      content += '# Perplexity\n';
      content += 'User-agent: PerplexityBot\n';
      content += 'Allow: /\n\n';
    }

    // Meta
    if (bots.meta?.enabled) {
      content += '# Meta AI\n';
      content += 'User-agent: Meta-ExternalAgent\n';
      content += 'Allow: /\n\n';
    }

    // Others
    if (bots.others?.enabled) {
      content += '# Other AI Bots\n';
      content += 'User-agent: Bytespider\n';
      content += 'User-agent: DeepSeekBot\n';
      content += 'Allow: /\n\n';
    }

    // AI-friendly paths
    content += '# AI-Optimized Paths\n';
    content += 'Sitemap: https://' + shopDomain + '/sitemap.xml\n';
    
    if (settings.features?.productsJson) {
      content += 'Allow: /ai/products.json\n';
    }
    if (settings.features?.welcomePage) {
      content += 'Allow: /ai/welcome\n';
    }
    
    content += 'Allow: /products/*\n';
    content += 'Allow: /collections/*\n';

    return content;
  }

  isFeatureAvailable(plan, feature) {
    const features = {
      starter: ['productsJson', 'aiSitemap'],
      professional: ['productsJson', 'aiSitemap', 'welcomePage'],
      growth: ['productsJson', 'aiSitemap', 'welcomePage', 'collectionsJson', 'autoRobotsTxt'],
      growth_extra: ['productsJson', 'aiSitemap', 'welcomePage', 'collectionsJson', 'autoRobotsTxt', 'storeMetadata'],
      enterprise: ['productsJson', 'aiSitemap', 'welcomePage', 'collectionsJson', 'autoRobotsTxt', 'storeMetadata', 'schemaData']
    };

    return features[plan]?.includes(feature) || false;
  }
}

export default new AIDiscoveryService();