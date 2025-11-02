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
    agents: ['GPTBot', 'ChatGPT-User', 'CCBot']
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
    agents: ['Meta-ExternalAgent', 'MetaBot', 'MetaAI']
  },
  microsoft: {
    name: 'Microsoft AI',
    agents: ['BingBot', 'MicrosoftBot', 'CopilotBot']
  },
  you: {
    name: 'You.com AI',
    agents: ['YouBot', 'YouAI']
  },
  brave: {
    name: 'Brave AI',
    agents: ['BraveBot', 'BraveAI']
  },
  duckduckgo: {
    name: 'DuckDuckGo AI',
    agents: ['DuckDuckBot', 'DuckDuckGoBot']
  },
  yandex: {
    name: 'Yandex AI',
    agents: ['YandexBot', 'YandexAI']
  },
  others: {
    name: 'Other AI Bots',
    agents: ['Bytespider', 'DeepSeekBot', 'DeepSeek', 'Bard', 'AI2Bot', 'ChatGPT-User']
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
      // Direct GraphQL call using session.accessToken
      const metafieldsQuery = `
        query GetShopMetafields {
          shop {
            metafields(namespace: "ai_discovery", first: 10) {
              edges {
                node {
                  id
                  key
                  value
                  type
                }
              }
            }
          }
        }
      `;
      
      const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: metafieldsQuery })
      });
      
      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
      }
      
      const metafields = result.data?.shop?.metafields?.edges || [];
      
      let settings = null;
      
      // Find the settings metafield
      const settingsMetafield = metafields.find(edge => edge.node.key === 'settings');
      
      if (settingsMetafield?.node?.value) {
        try {
          settings = JSON.parse(settingsMetafield.node.value);
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
        const Q = `
          query PlansMe($shop:String!) {
            plansMe(shop:$shop) {
              plan
              planKey
            }
          }
        `;
        const planResponse = await fetch(`${process.env.APP_URL}/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: Q, variables: { shop } }),
        });
        if (planResponse.ok) {
          const res = await planResponse.json();
          if (res?.errors?.length) throw new Error(res.errors[0]?.message || 'GraphQL error');
          const planData = res?.data?.plansMe;
          settings.plan = planData.plan;
          settings.planKey = planData.planKey;
          settings.availableBots = this.getAvailableBotsForPlan(planData.planKey);
        } else {
          // Fallback стойности
          settings.plan = 'Starter';
          settings.planKey = 'starter';
          settings.availableBots = ['meta', 'anthropic']; // Starter default
        }
      } catch (error) {
        console.error('Failed to fetch plan in getSettings:', error);
        settings.plan = 'Starter';
        settings.planKey = 'starter';
        settings.availableBots = ['meta', 'anthropic']; // Starter default
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

    // AI Bot Access per plan (matches billing descriptions)
    const availableBotsByPlan = {
      starter: ['meta', 'anthropic'],                                           // Meta AI + Claude
      professional: ['meta', 'anthropic', 'google'],                            // + Gemini
      professional_plus: ['meta', 'anthropic', 'google'],                       // Same as Professional
      growth: ['meta', 'anthropic', 'google', 'openai'],                       // + ChatGPT
      growth_plus: ['meta', 'anthropic', 'google', 'openai'],                  // Same as Growth
      growth_extra: ['meta', 'anthropic', 'google', 'openai', 'perplexity'],  // + Perplexity
      enterprise: ['meta', 'anthropic', 'google', 'openai', 'perplexity', 'others'] // + Others
    };

    // Plan-specific default features (enabled by default based on plan)
    const defaultFeaturesByPlan = {
      starter: {
        productsJson: false,
        aiSitemap: false,
        welcomePage: false,
        collectionsJson: false,
        storeMetadata: false,
        schemaData: false
      },
      professional: {
        productsJson: false,
        aiSitemap: false,
        welcomePage: false,
        collectionsJson: false,
        storeMetadata: true, // Enabled by default (included in Professional)
        schemaData: false
      },
      professional_plus: {
        productsJson: true, // Enabled by default
        aiSitemap: true, // Enabled by default (requires tokens when used)
        welcomePage: true, // Enabled by default (requires tokens when used)
        collectionsJson: true, // Enabled by default (requires tokens when used)
        storeMetadata: true, // Enabled by default (requires tokens when used)
        schemaData: true // Enabled by default (requires tokens when used)
      },
      growth: {
        productsJson: false,
        aiSitemap: false,
        welcomePage: false,
        collectionsJson: false,
        storeMetadata: true, // Enabled by default (included in Growth)
        schemaData: false
      },
      growth_plus: {
        productsJson: true, // Enabled by default
        aiSitemap: true, // Enabled by default (requires tokens when used)
        welcomePage: true, // Enabled by default (Growth includes, no tokens)
        collectionsJson: true, // Enabled by default (Growth includes, no tokens)
        storeMetadata: true, // Enabled by default (requires tokens when used)
        schemaData: true // Enabled by default (requires tokens when used)
      },
      growth_extra: {
        productsJson: false,
        aiSitemap: false,
        welcomePage: false,
        collectionsJson: false,
        storeMetadata: false,
        schemaData: false
      },
      enterprise: {
        productsJson: false,
        aiSitemap: false,
        welcomePage: false,
        collectionsJson: false,
        storeMetadata: false,
        schemaData: false
      }
    };

    const base = {
      bots: allBots,
      availableBots: availableBotsByPlan[normalizedPlan] || availableBotsByPlan.starter,
      features: {
        ...(defaultFeaturesByPlan[normalizedPlan] || defaultFeaturesByPlan.starter),
        autoRobotsTxt: false // Always false by default - user must enable manually
      },
      richAttributes: {
        material: false,
        color: false,
        size: false,
        weight: false,
        dimensions: false,
        category: false,
        audience: false,
        reviews: false,
        ratings: false,
        enhancedDescription: false,
        organization: false
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
        settings = this.getDefaultSettings();
      }
      
      // Get enabled bots
      const enabledBots = Object.entries(settings.bots || {})
        .filter(([_, bot]) => bot.enabled)
        .map(([key, _]) => key);

      // If no bots are enabled, block everything
      if (enabledBots.length === 0) {
        return 'User-agent: *\nDisallow: /';
      }

      // Continue with robots.txt generation even if no features selected
      // Bots will still be listed, just without specific Allow rules
      
      // Get user's plan (reuse existing shopRecord)
      const subscription = await Subscription.findOne({ shop });
      const normalizedPlan = normalizePlan(subscription?.plan || shopRecord?.plan || 'starter');
      
      let robotsTxt = '# AI Bot Access Configuration\n';
      robotsTxt += '# Generated by Shopify AI SEO\n\n';
      
      // AI Bots (already defined above)
      
      // Define plan features
      const planFeatures = {
        starter: ['productsJson'],
        professional: ['productsJson', 'storeMetadata'], // Store Metadata included
        professional_plus: ['productsJson', 'storeMetadata', 'welcomePage', 'collectionsJson', 'aiSitemap', 'schemaData'], // All features unlocked, some require tokens
        growth: ['productsJson', 'storeMetadata', 'welcomePage', 'collectionsJson'], // Store Metadata included
        growth_plus: ['productsJson', 'storeMetadata', 'welcomePage', 'collectionsJson', 'aiSitemap', 'schemaData'], // All features unlocked, some require tokens
        growth_extra: ['productsJson', 'storeMetadata', 'aiSitemap', 'welcomePage', 'collectionsJson'],
        enterprise: ['productsJson', 'storeMetadata', 'aiSitemap', 'welcomePage', 'collectionsJson', 'schemaData']
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
        
        // Always allow robots.txt endpoint
        robotsTxt += 'Allow: /ai/robots-dynamic\n';
        
        // Allow important store pages for context
        robotsTxt += 'Allow: /products/\n';
        robotsTxt += 'Allow: /collections/\n';
        robotsTxt += 'Allow: /pages/\n';
        
        // Crawl delay for better performance
        if (bot === 'openai' || bot === 'anthropic' || bot === 'google') {
          robotsTxt += 'Crawl-delay: 1\n';
        } else if (bot === 'perplexity' || bot === 'meta') {
          robotsTxt += 'Crawl-delay: 2\n';
        } else {
          robotsTxt += 'Crawl-delay: 3\n';
        }
        
        robotsTxt += '\n';
      }
      
      // Sitemap references
      robotsTxt += '# AI Discovery Endpoints\n';
      
      if (settings.features?.welcomePage && availableFeatures.includes('welcomePage')) {
        robotsTxt += `Sitemap: https://${shop}/apps/new-ai-seo/ai/welcome?shop=${shop}\n`;
      }
      
      if (settings.features?.productsJson && availableFeatures.includes('productsJson')) {
        robotsTxt += `Sitemap: https://${shop}/apps/new-ai-seo/ai/products.json?shop=${shop}\n`;
      }
      
      if (settings.features?.aiSitemap && availableFeatures.includes('aiSitemap')) {
        robotsTxt += `Sitemap: https://${shop}/apps/new-ai-seo/ai/sitemap-feed.xml?shop=${shop}\n`;
      }
      
      if (settings.features?.collectionsJson && availableFeatures.includes('collectionsJson')) {
        robotsTxt += `Sitemap: https://${shop}/apps/new-ai-seo/ai/collections-feed.json?shop=${shop}\n`;
      }
      
      if (settings.features?.storeMetadata && availableFeatures.includes('storeMetadata')) {
        robotsTxt += `Sitemap: https://${shop}/apps/new-ai-seo/ai/store-metadata.json?shop=${shop}\n`;
      }
      
      // Advanced Schema Data - Only for Enterprise
      if (settings.features?.schemaData && normalizedPlan === 'enterprise') {
        robotsTxt += '\n# Advanced Schema Data\n';
        robotsTxt += `Sitemap: https://${shop}/apps/new-ai-seo/ai/schema-sitemap.xml?shop=${shop}\n`;
      }
      
      // Always include robots.txt endpoint as sitemap
      robotsTxt += '\n# Dynamic robots.txt\n';
      robotsTxt += `Sitemap: https://${shop}/apps/new-ai-seo/ai/robots-dynamic?shop=${shop}\n`;
      
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
      'growth': ['openai', 'anthropic', 'perplexity', 'google', 'microsoft'],
      'growth extra': ['openai', 'anthropic', 'perplexity', 'google', 'meta', 'microsoft', 'you', 'brave'],
      'enterprise': ['openai', 'anthropic', 'perplexity', 'google', 'meta', 'microsoft', 'you', 'brave', 'duckduckgo', 'yandex', 'others']
    };
    
    return planBots[planKey] || ['openai', 'perplexity'];
  }

  isFeatureAvailable(plan, feature) {
    const features = {
      starter: ['productsJson', 'aiSitemap'],
      professional: ['productsJson', 'aiSitemap'],
      growth: ['productsJson', 'aiSitemap', 'welcomePage', 'collectionsJson', 'autoRobotsTxt'],
      growth_extra: ['productsJson', 'aiSitemap', 'welcomePage', 'collectionsJson', 'autoRobotsTxt', 'storeMetadata'],
      enterprise: ['productsJson', 'aiSitemap', 'welcomePage', 'collectionsJson', 'autoRobotsTxt', 'storeMetadata', 'schemaData']
    };

    return features[plan]?.includes(feature) || false;
  }
}

export default new AIDiscoveryService();