// backend/services/aiDiscoveryService.js
import AIDiscoverySettings from '../db/AIDiscoverySettings.js';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';

// Helper function to normalize plan names
const normalizePlan = (plan) => {
  return (plan || 'starter').toLowerCase().replace(' ', '_');
};

// Bot user agents configuration
const BOT_USER_AGENTS = {
  openai: {
    name: 'OpenAI',
    agents: ['GPTBot', 'ChatGPT-User']
  },
  anthropic: {
    name: 'Anthropic',
    agents: ['Claude-Web', 'ClaudeBot']
  },
  google: {
    name: 'Google AI',
    agents: ['GoogleOther', 'Google-Extended']
  },
  perplexity: {
    name: 'Perplexity',
    agents: ['PerplexityBot']
  },
  meta: {
    name: 'Meta AI',
    agents: ['Meta-ExternalAgent']
  },
  others: {
    name: 'Other AI Bots',
    agents: ['Bytespider', 'DeepSeekBot']
  }
};

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
      
      // Ensure advancedSchemaEnabled is included
      if (settings.advancedSchemaEnabled === undefined) {
        settings.advancedSchemaEnabled = false;
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

  async generateRobotsTxt(shop) {
    try {
      // Get shop record for access token
      const shopRecord = await Shop.findOne({ shop });
      if (!shopRecord || !shopRecord.accessToken) {
        console.log('[ROBOTS] No shop record or access token found for:', shop);
        return 'User-agent: *\nDisallow: /';
      }
      
      // Use the same method as getSettings - fetch from Shopify metafields
      const response = await fetch(
        `https://${shop}/admin/api/2024-07/metafields.json?namespace=ai_discovery&key=settings&owner_resource=shop`,
        {
          headers: {
            'X-Shopify-Access-Token': shopRecord.accessToken,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        console.log('[ROBOTS] Failed to fetch settings from metafields:', response.status);
        return 'User-agent: *\nDisallow: /';
      }
      
      const data = await response.json();
      const metafield = data.metafields?.[0];
      let settings = null;
      
      if (metafield?.value) {
        try {
          settings = JSON.parse(metafield.value);
        } catch (e) {
          console.error('[ROBOTS] Failed to parse settings:', e);
          settings = this.getDefaultSettings();
        }
      }
      
      // If no settings, use defaults
      if (!settings) {
        console.log('[ROBOTS] No settings found for shop:', shop);
        settings = this.getDefaultSettings();
      }
      
      console.log('[ROBOTS] Settings found:', JSON.stringify(settings, null, 2));
      
      // Check if AI Discovery is enabled and has features
      const hasEnabledFeatures = settings.features && 
        Object.values(settings.features).some(f => f === true);
      
      console.log('[ROBOTS] Has enabled features:', hasEnabledFeatures);
      console.log('[ROBOTS] Settings enabled:', settings.enabled);
      
      if (!settings.enabled || !hasEnabledFeatures) {
        console.log('[ROBOTS] AI Discovery not enabled or no features selected');
        return 'User-agent: *\nDisallow: /';
      }
      
      // Get user's plan (reuse existing shopRecord)
      const subscription = await Subscription.findOne({ shop });
      const normalizedPlan = normalizePlan(subscription?.plan || shopRecord?.plan || 'starter');
      
      let robotsTxt = '# AI Bot Access Configuration\n';
      robotsTxt += '# Generated by Shopify AI SEO\n\n';
      
      // AI Bots
      const enabledBots = Object.entries(settings.bots || {})
        .filter(([_, bot]) => bot.enabled)
        .map(([key, _]) => key);
      
      if (enabledBots.length === 0) {
        return '# No AI bots have been configured for access\nUser-agent: *\nDisallow: /';
      }
      
      // Define plan features
      const planFeatures = {
        starter: ['productsJson', 'aiSitemap'],
        professional: ['productsJson', 'aiSitemap', 'welcomePage'],
        growth: ['productsJson', 'aiSitemap', 'welcomePage', 'collectionsJson'],
        growth_extra: ['productsJson', 'aiSitemap', 'welcomePage', 'collectionsJson', 'storeMetadata'],
        enterprise: ['productsJson', 'aiSitemap', 'welcomePage', 'collectionsJson', 'storeMetadata', 'schemaData']
      };
      
      const availableFeatures = planFeatures[normalizedPlan] || planFeatures.starter;
      
      // Bot-specific sections
      for (const bot of enabledBots) {
        const botConfig = BOT_USER_AGENTS[bot];
        if (!botConfig) continue;
        
        robotsTxt += `# ${botConfig.name}\n`;
        
        for (const agent of botConfig.agents) {
          robotsTxt += `User-agent: ${agent}\n`;
        }
        
        // Products JSON Feed
        if (settings.features?.productsJson && availableFeatures.includes('productsJson')) {
          robotsTxt += 'Allow: /ai/products.json\n';
        }
        
        // Collections JSON Feed
        if (settings.features?.collectionsJson && availableFeatures.includes('collectionsJson')) {
          robotsTxt += 'Allow: /ai/collections-feed.json\n';
        }
        
        // AI Sitemap
        if (settings.features?.aiSitemap && availableFeatures.includes('aiSitemap')) {
          robotsTxt += 'Allow: /ai/sitemap-feed.xml\n';
        }
        
        // Welcome Page
        if (settings.features?.welcomePage && availableFeatures.includes('welcomePage')) {
          robotsTxt += 'Allow: /ai/welcome\n';
        }
        
        // Store Metadata - Growth Extra+
        if (settings.features?.storeMetadata && availableFeatures.includes('storeMetadata')) {
          robotsTxt += 'Allow: /ai/store-metadata.json\n';
        }
        
        // Advanced Schema Data - Enterprise only
        if (settings.features?.schemaData && normalizedPlan === 'enterprise') {
          robotsTxt += 'Allow: /ai/product/*/schemas.json\n';
        }
        
        robotsTxt += '\n';
      }
      
      // Sitemap references
      robotsTxt += '# AI Discovery Endpoints\n';
      
      if (settings.features?.productsJson && availableFeatures.includes('productsJson')) {
        robotsTxt += `Sitemap: https://${process.env.APP_URL || 'new-ai-seo-app-production.up.railway.app'}/ai/products.json?shop=${shop}\n`;
      }
      
      if (settings.features?.aiSitemap && availableFeatures.includes('aiSitemap')) {
        robotsTxt += `Sitemap: https://${process.env.APP_URL || 'new-ai-seo-app-production.up.railway.app'}/ai/sitemap-feed.xml?shop=${shop}\n`;
      }
      
      if (settings.features?.collectionsJson && availableFeatures.includes('collectionsJson')) {
        robotsTxt += `Sitemap: https://${process.env.APP_URL || 'new-ai-seo-app-production.up.railway.app'}/ai/collections-feed.json?shop=${shop}\n`;
      }
      
      if (settings.features?.storeMetadata && availableFeatures.includes('storeMetadata')) {
        robotsTxt += `Sitemap: https://${process.env.APP_URL || 'new-ai-seo-app-production.up.railway.app'}/ai/store-metadata.json?shop=${shop}\n`;
      }
      
      // Advanced Schema Data - Only for Enterprise
      if (settings.features?.schemaData && normalizedPlan === 'enterprise') {
        robotsTxt += '\n# Advanced Schema Data\n';
        robotsTxt += `Sitemap: https://${process.env.APP_URL || 'new-ai-seo-app-production.up.railway.app'}/ai/schema-sitemap.xml?shop=${shop}\n`;
      }
      
      // Default deny
      robotsTxt += '\n# Block all other crawlers\n';
      robotsTxt += 'User-agent: *\n';
      robotsTxt += 'Disallow: /\n';
      
      return robotsTxt;
    } catch (error) {
      console.error('[AI Discovery] Error generating robots.txt:', error);
      return 'User-agent: *\nDisallow: /';
    }
  }

  getAvailableBotsForPlan(planKey) {
    const planBots = {
      'starter': ['openai', 'perplexity'],
      'professional': ['openai', 'anthropic', 'perplexity', 'google'],
      'growth': ['openai', 'anthropic', 'perplexity', 'google'],
      'growth extra': ['openai', 'anthropic', 'perplexity', 'google', 'meta', 'other'],
      'enterprise': ['openai', 'anthropic', 'perplexity', 'google', 'meta', 'other']
    };
    
    return planBots[planKey] || ['openai', 'perplexity'];
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