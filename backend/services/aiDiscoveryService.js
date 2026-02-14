// backend/services/aiDiscoveryService.js
import AIDiscoverySettings from '../db/AIDiscoverySettings.js';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import Sitemap from '../db/Sitemap.js';
import AdvancedSchema from '../db/AdvancedSchema.js';

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
      // Check cache first
      if (this.cache.has(shop)) {
        const cached = this.cache.get(shop);
        if (cached) {
          return cached;
        }
      }
      
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
      
      // Ако няма settings в Shopify metafields, пробваме MongoDB
      if (!settings) {
        try {
          const mongoSettings = await AIDiscoverySettings.findOne({ shop });
          if (mongoSettings) {
            settings = {
              bots: mongoSettings.bots || {},
              features: mongoSettings.features || {},
              richAttributes: mongoSettings.richAttributes || {},
              advancedSchemaEnabled: mongoSettings.advancedSchemaEnabled || false
            };
          }
        } catch (mongoError) {
          console.error('[AI-DISCOVERY] Failed to read from MongoDB:', mongoError);
        }
      }
      
      // Ако все още няма settings, връщаме defaults
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
      
      // Cache settings
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
      this.cache.delete(shop);

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
        schemaData: false,
        llmsTxt: false,
        discoveryLinks: false
      },
      professional: {
        productsJson: false,
        aiSitemap: false,
        welcomePage: false,
        collectionsJson: false,
        storeMetadata: true, // Enabled by default (included in Professional)
        schemaData: false,
        llmsTxt: false,
        discoveryLinks: false
      },
      professional_plus: {
        productsJson: true, // Enabled by default (static, no tokens)
        aiSitemap: true, // Enabled by default (requires tokens when used)
        welcomePage: true, // Enabled by default (static, no tokens)
        collectionsJson: true, // Enabled by default (static, no tokens)
        storeMetadata: true, // Enabled by default (static, no tokens)
        schemaData: true, // Enabled by default (requires tokens when used)
        llmsTxt: true, // Enabled by default (static)
        discoveryLinks: true // Enabled by default (static)
      },
      growth: {
        productsJson: false,
        aiSitemap: false,
        welcomePage: false,
        collectionsJson: false,
        storeMetadata: true, // Enabled by default (included in Growth)
        schemaData: false,
        llmsTxt: false,
        discoveryLinks: false
      },
      growth_plus: {
        productsJson: true, // Enabled by default (static, no tokens)
        aiSitemap: true, // Enabled by default (requires tokens when used)
        welcomePage: true, // Enabled by default (static, no tokens)
        collectionsJson: true, // Enabled by default (static, no tokens)
        storeMetadata: true, // Enabled by default (static, no tokens)
        schemaData: true, // Enabled by default (requires tokens when used)
        llmsTxt: true, // Enabled by default (static)
        discoveryLinks: true // Enabled by default (static)
      },
      growth_extra: {
        productsJson: false,
        aiSitemap: false,
        welcomePage: false,
        collectionsJson: false,
        storeMetadata: false,
        schemaData: false,
        llmsTxt: false,
        discoveryLinks: false
      },
      enterprise: {
        productsJson: false,
        aiSitemap: false,
        welcomePage: false,
        collectionsJson: false,
        storeMetadata: false,
        schemaData: false,
        llmsTxt: false,
        discoveryLinks: false
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
        // Return minimal robots.txt that allows standard crawlers
        return '# AI Bot Access Configuration\n# Generated by indexAIze - Unlock AI Search\n# Note: This is a minimal fallback. Please configure Settings to generate full robots.txt.\n';
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
        // Return minimal robots.txt that allows standard crawlers
        return '# AI Bot Access Configuration\n# Generated by indexAIze - Unlock AI Search\n# Note: Failed to fetch settings. Please configure Settings to generate full robots.txt.\n';
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
      
      // Get user's plan first (needed for bot filtering)
      const subscription = await Subscription.findOne({ shop });
      const normalizedPlan = normalizePlan(subscription?.plan || shopRecord?.plan || 'starter');
      
      // Get available bots for this plan
      const availableBotsForPlan = this.getAvailableBotsForPlan(normalizedPlan);
      
      // Get enabled bots - FILTER by plan availability
      const enabledBots = Object.entries(settings.bots || {})
        .filter(([key, bot]) => bot.enabled && availableBotsForPlan.includes(key))
        .map(([key, _]) => key);

      // If no bots are enabled, return minimal configuration
      // Do NOT block all crawlers - this would block Google, Bing, etc.
      if (enabledBots.length === 0) {
        return '# AI Bot Access Configuration\n# Generated by indexAIze - Unlock AI Search\n# No AI bots are currently enabled for your plan. Please enable AI bots in Settings.\n';
      }

      // Get app proxy subpath from environment variable (set in Railway)
      // Default fallback: 'indexaize' (matches shopify.app.toml)
      // Can be overridden via APP_PROXY_SUBPATH env var in Railway
      const appProxySubpath = process.env.APP_PROXY_SUBPATH || 'indexaize';
      
      let robotsTxt = '# AI Bot Access Configuration\n';
      robotsTxt += '# Generated by indexAIze - Unlock AI Search\n\n';
      
      // AI Bots (already defined above)
      
      // Define plan features
      const planFeatures = {
        starter: ['productsJson', 'llmsTxt'],
        professional: ['productsJson', 'storeMetadata', 'llmsTxt'], // Store Metadata included
        professional_plus: ['productsJson', 'storeMetadata', 'welcomePage', 'collectionsJson', 'aiSitemap', 'schemaData', 'llmsTxt', 'discoveryLinks'], // All features unlocked
        growth: ['productsJson', 'storeMetadata', 'welcomePage', 'collectionsJson', 'llmsTxt', 'discoveryLinks'], // Store Metadata included
        growth_plus: ['productsJson', 'storeMetadata', 'welcomePage', 'collectionsJson', 'aiSitemap', 'schemaData', 'llmsTxt', 'discoveryLinks'], // All features unlocked
        growth_extra: ['productsJson', 'storeMetadata', 'aiSitemap', 'welcomePage', 'collectionsJson', 'llmsTxt', 'discoveryLinks'],
        enterprise: ['productsJson', 'storeMetadata', 'aiSitemap', 'welcomePage', 'collectionsJson', 'schemaData', 'llmsTxt', 'discoveryLinks']
      };
      
      const availableFeatures = planFeatures[normalizedPlan] || planFeatures.starter;
      
      // Check if Sitemap and Advanced Schema are generated (these are now managed in Store Optimization pages)
      // Sitemap can be standard OR AI-enhanced - both should be accessible
      // Note: We check for existence + generatedAt since 'content' field has select:false
      const sitemapDoc = await Sitemap.findOne({ shop }).select('generatedAt isAiEnhanced status').lean();
      const hasSitemap = sitemapDoc && sitemapDoc.generatedAt && sitemapDoc.status !== 'failed';  // Any valid sitemap
      const hasAiSitemap = sitemapDoc?.isAiEnhanced === true;  // Specifically AI-enhanced
      
      const schemaDoc = await AdvancedSchema.findOne({ shop });
      const hasAdvancedSchema = schemaDoc?.schemas?.length > 0;
      
      // Bot-specific sections
      for (const bot of enabledBots) {
        const botConfig = BOT_USER_AGENTS[bot];
        if (!botConfig) continue;
        
        robotsTxt += `# ${botConfig.name}\n`;
        
        for (const agent of botConfig.agents) {
          robotsTxt += `User-agent: ${agent}\n`;
        }
        
        // Products JSON Feed (use app proxy path)
        if (settings.features?.productsJson && availableFeatures.includes('productsJson')) {
          robotsTxt += `Allow: /apps/${appProxySubpath}/ai/products.json\n`;
        }
        
        // Collections JSON Feed (use app proxy path)
        if (settings.features?.collectionsJson && availableFeatures.includes('collectionsJson')) {
          robotsTxt += `Allow: /apps/${appProxySubpath}/ai/collections-feed.json\n`;
        }
        
        // Sitemap (use app proxy path) - check if generated (standard or AI-enhanced)
        if (hasSitemap && availableFeatures.includes('aiSitemap')) {
          robotsTxt += `Allow: /apps/${appProxySubpath}/ai/sitemap-feed.xml\n`;
        }
        
        // Welcome Page (use app proxy path)
        if (settings.features?.welcomePage && availableFeatures.includes('welcomePage')) {
          robotsTxt += `Allow: /apps/${appProxySubpath}/ai/welcome\n`;
        }
        
        // Store Metadata (use app proxy path)
        if (settings.features?.storeMetadata && availableFeatures.includes('storeMetadata')) {
          robotsTxt += `Allow: /apps/${appProxySubpath}/ai/store-metadata.json\n`;
        }
        
        // Advanced Schema Data - Plus plans and Enterprise (use app proxy path) - check if generated
        const plusPlansWithSchema = ['professional_plus', 'growth_plus', 'growth_extra', 'enterprise'];
        if (hasAdvancedSchema && plusPlansWithSchema.includes(normalizedPlan)) {
          robotsTxt += `Allow: /apps/${appProxySubpath}/ai/product/*/schemas.json\n`;
          robotsTxt += `Allow: /apps/${appProxySubpath}/ai/schema-data.json\n`;
        }
        
        // LLMs.txt (use app proxy path)
        if (settings.features?.llmsTxt && availableFeatures.includes('llmsTxt')) {
          robotsTxt += `Allow: /apps/${appProxySubpath}/llms.txt\n`;
        }
        
        // Always allow robots.txt endpoint (use app proxy path)
        robotsTxt += `Allow: /apps/${appProxySubpath}/ai/robots-dynamic\n`;
        
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
      
      // Sitemap references (XML sitemaps only - NOT for JSON endpoints)
      // Get primary domain for public URLs
      let primaryDomain = `https://${shop}`;
      try {
        const shopInfoResponse = await fetch(
          `https://${shop}/admin/api/2024-07/graphql.json`,
          {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': shopRecord.accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query: `{ shop { primaryDomain { url } } }`
            })
          }
        );
        const shopInfoData = await shopInfoResponse.json();
        if (shopInfoData?.data?.shop?.primaryDomain?.url) {
          primaryDomain = shopInfoData.data.shop.primaryDomain.url.replace(/\/$/, '');
        }
      } catch (e) {
        console.error('[ROBOTS] Failed to fetch primaryDomain:', e.message);
      }
      
      // LLMs.txt reference (AI discovery standard)
      if (settings.features?.llmsTxt && availableFeatures.includes('llmsTxt')) {
        robotsTxt += `\n# LLMs.txt (AI Discovery)\n`;
        robotsTxt += `# ${primaryDomain}/apps/${appProxySubpath}/llms.txt\n`;
      }
      
      robotsTxt += '\n# AI Discovery Sitemaps (XML only)\n';
      
      // Only XML sitemaps should be listed here - check if generated (standard or AI-enhanced)
      // Use primaryDomain (public URL) for sitemap references
      if (hasSitemap && availableFeatures.includes('aiSitemap')) {
        robotsTxt += `Sitemap: ${primaryDomain}/apps/${appProxySubpath}/ai/sitemap-feed.xml?shop=${shop}\n`;
      }
      
      // Advanced Schema Data Sitemap - Plus plans and Enterprise - check if generated
      const schemaPlans = ['professional_plus', 'growth_plus', 'growth_extra', 'enterprise'];
      if (hasAdvancedSchema && schemaPlans.includes(normalizedPlan)) {
        robotsTxt += `Sitemap: ${primaryDomain}/apps/${appProxySubpath}/ai/schema-sitemap.xml?shop=${shop}\n`;
      }
      
      // Note: JSON endpoints (products.json, collections-feed.json, etc.) are NOT sitemaps
      // They are accessed via Allow rules in User-agent sections above
      
      // IMPORTANT: Do NOT add "User-agent: * / Disallow: /" here!
      // This would block ALL crawlers including Google, Bing, and other standard search engines
      // The default Shopify robots.txt already handles standard crawlers properly
      
      return robotsTxt;
    } catch (error) {
      console.error('[AI Discovery] Error generating robots.txt:', error);
      // Return minimal robots.txt that allows standard crawlers
      return '# AI Bot Access Configuration\n# Generated by indexAIze - Unlock AI Search\n# Error occurred while generating robots.txt. Please check Settings configuration.\n';
    }
  }

  /**
   * Generate robots.txt.liquid content for Shopify theme
   * This includes Shopify's default rules via {{ content_for_robots }}
   */
  async generateRobotsTxtLiquid(shop) {
    try {
      // Get our custom AI bot rules
      const customRules = await this.generateRobotsTxt(shop);
      
      // Wrap in Liquid format with Shopify's default rules
      let liquidContent = `{% comment %}
  AI Bot Access Configuration
  Generated by indexAIze - Unlock AI Search
  This file customizes robots.txt to allow AI bots access to your optimized data.
{% endcomment %}

${customRules}

{% comment %} Include Shopify's default rules for standard crawlers {% endcomment %}
{{ content_for_robots }}
`;
      
      return liquidContent;
    } catch (error) {
      console.error('[AI Discovery] Error generating robots.txt:', error);
      // Return minimal robots.txt that allows standard crawlers
      return '# AI Bot Access Configuration\n# Generated by indexAIze - Unlock AI Search\n# Error occurred while generating robots.txt. Please check Settings configuration.\n';
    }
  }

  getAvailableBotsForPlan(planKey) {
    // Must match availableBotsByPlan in getDefaultSettings!
    const planBots = {
      'starter': ['meta', 'anthropic'],                                           // Meta AI + Claude
      'professional': ['meta', 'anthropic', 'google'],                            // + Gemini
      'professional_plus': ['meta', 'anthropic', 'google'],                       // Same as Professional
      'growth': ['meta', 'anthropic', 'google', 'openai'],                        // + ChatGPT
      'growth_plus': ['meta', 'anthropic', 'google', 'openai'],                   // Same as Growth
      'growth_extra': ['meta', 'anthropic', 'google', 'openai', 'perplexity'],    // + Perplexity
      'enterprise': ['meta', 'anthropic', 'google', 'openai', 'perplexity', 'others'] // + Others
    };
    
    return planBots[planKey] || ['meta', 'anthropic'];
  }

  isFeatureAvailable(plan, feature) {
    const features = {
      starter: ['productsJson', 'aiSitemap', 'llmsTxt'],
      professional: ['productsJson', 'aiSitemap', 'llmsTxt'],
      professional_plus: ['productsJson', 'aiSitemap', 'llmsTxt', 'discoveryLinks', 'welcomePage', 'collectionsJson', 'storeMetadata', 'schemaData'],
      growth: ['productsJson', 'aiSitemap', 'llmsTxt', 'discoveryLinks', 'welcomePage', 'collectionsJson', 'autoRobotsTxt'],
      growth_plus: ['productsJson', 'aiSitemap', 'llmsTxt', 'discoveryLinks', 'welcomePage', 'collectionsJson', 'autoRobotsTxt', 'storeMetadata', 'schemaData'],
      growth_extra: ['productsJson', 'aiSitemap', 'llmsTxt', 'discoveryLinks', 'welcomePage', 'collectionsJson', 'autoRobotsTxt', 'storeMetadata'],
      enterprise: ['productsJson', 'aiSitemap', 'llmsTxt', 'discoveryLinks', 'welcomePage', 'collectionsJson', 'autoRobotsTxt', 'storeMetadata', 'schemaData']
    };

    return features[plan]?.includes(feature) || false;
  }

  /**
   * Generate llms.txt content for a shop
   * Follows the llmstxt.org standard - Markdown format with H1, blockquote, H2 sections
   * Content is dynamic based on enabled features and plan
   */
  async generateLlmsTxt(shop) {
    try {
      // Get shop record for access token
      const shopRecord = await Shop.findOne({ shop });
      if (!shopRecord || !shopRecord.accessToken) {
        return '# Store\n\n> AI-optimized e-commerce data. Configure indexAIze settings to enable endpoints.\n';
      }

      // Get settings from metafields
      const response = await fetch(
        `https://${shop}/admin/api/2024-07/metafields.json?namespace=ai_discovery&key=settings&owner_resource=shop`,
        {
          headers: {
            'X-Shopify-Access-Token': shopRecord.accessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      let settings = null;
      if (response.ok) {
        const data = await response.json();
        const metafield = data.metafields?.[0];
        if (metafield?.value) {
          try { settings = JSON.parse(metafield.value); } catch (e) { /* use defaults */ }
        }
      }
      if (!settings) {
        settings = this.getDefaultSettings();
      }

      // Check if llmsTxt feature is enabled
      if (!settings.features?.llmsTxt) {
        return null; // Feature not enabled - return null so route can return 404
      }

      // Get plan info
      const subscription = await Subscription.findOne({ shop });
      const normalizedPlan = normalizePlan(subscription?.plan || shopRecord?.plan || 'starter');
      const appProxySubpath = process.env.APP_PROXY_SUBPATH || 'indexaize';

      // Get shop info + policies from Shopify
      let shopName = shop.replace('.myshopify.com', '');
      let shopDescription = '';
      let primaryDomain = `https://${shop}`;
      let shopEmail = '';
      let policies = [];

      try {
        const shopInfoResponse = await fetch(
          `https://${shop}/admin/api/2025-07/graphql.json`,
          {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': shopRecord.accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query: `{ 
                shop { 
                  name 
                  description 
                  email
                  primaryDomain { url } 
                  contactEmail
                  privacyPolicy { title url }
                  refundPolicy { title url }
                  shippingPolicy { title url }
                  termsOfService { title url }
                  subscriptionPolicy { title url }
                } 
              }`
            })
          }
        );
        const shopInfoData = await shopInfoResponse.json();
        const shopInfo = shopInfoData?.data?.shop;
        if (shopInfo) {
          shopName = shopInfo.name || shopName;
          shopDescription = shopInfo.description || '';
          shopEmail = shopInfo.contactEmail || shopInfo.email || '';
          if (shopInfo.primaryDomain?.url) {
            primaryDomain = shopInfo.primaryDomain.url.replace(/\/$/, '');
          }
          // Collect only policies that actually exist
          if (shopInfo.shippingPolicy?.url) policies.push({ title: shopInfo.shippingPolicy.title || 'Shipping Policy', url: shopInfo.shippingPolicy.url });
          if (shopInfo.refundPolicy?.url) policies.push({ title: shopInfo.refundPolicy.title || 'Refund Policy', url: shopInfo.refundPolicy.url });
          if (shopInfo.privacyPolicy?.url) policies.push({ title: shopInfo.privacyPolicy.title || 'Privacy Policy', url: shopInfo.privacyPolicy.url });
          if (shopInfo.termsOfService?.url) policies.push({ title: shopInfo.termsOfService.title || 'Terms of Service', url: shopInfo.termsOfService.url });
          if (shopInfo.subscriptionPolicy?.url) policies.push({ title: shopInfo.subscriptionPolicy.title || 'Subscription Policy', url: shopInfo.subscriptionPolicy.url });
        }
      } catch (e) {
        console.error('[LLMS-TXT] Failed to fetch shop info:', e.message);
      }

      // Define plan features (same as robots.txt)
      const planFeatures = {
        starter: ['productsJson', 'llmsTxt'],
        professional: ['productsJson', 'storeMetadata', 'llmsTxt'],
        professional_plus: ['productsJson', 'storeMetadata', 'welcomePage', 'collectionsJson', 'aiSitemap', 'schemaData', 'llmsTxt', 'discoveryLinks'],
        growth: ['productsJson', 'storeMetadata', 'welcomePage', 'collectionsJson', 'llmsTxt', 'discoveryLinks'],
        growth_plus: ['productsJson', 'storeMetadata', 'welcomePage', 'collectionsJson', 'aiSitemap', 'schemaData', 'llmsTxt', 'discoveryLinks'],
        growth_extra: ['productsJson', 'storeMetadata', 'aiSitemap', 'welcomePage', 'collectionsJson', 'llmsTxt', 'discoveryLinks'],
        enterprise: ['productsJson', 'storeMetadata', 'aiSitemap', 'welcomePage', 'collectionsJson', 'schemaData', 'llmsTxt', 'discoveryLinks']
      };
      const availableFeatures = planFeatures[normalizedPlan] || planFeatures.starter;

      // Check what data actually exists
      const sitemapDoc = await Sitemap.findOne({ shop }).select('generatedAt isAiEnhanced status').lean();
      const hasSitemap = sitemapDoc && sitemapDoc.generatedAt && sitemapDoc.status !== 'failed';
      const schemaDoc = await AdvancedSchema.findOne({ shop });
      const hasAdvancedSchema = schemaDoc?.schemas?.length > 0;

      // ---- Build llms.txt (Markdown format per llmstxt.org standard) ----

      // H1 - Required
      let llmsTxt = `# ${shopName}\n\n`;

      // Blockquote summary
      if (shopDescription) {
        llmsTxt += `> ${shopDescription}\n\n`;
      } else {
        llmsTxt += `> E-commerce store with AI-optimized product data and structured endpoints for AI agents.\n\n`;
      }

      // --- Product Catalog section ---
      const hasProductsJson = settings.features?.productsJson && availableFeatures.includes('productsJson');
      const hasCollectionsJson = settings.features?.collectionsJson && availableFeatures.includes('collectionsJson');

      if (hasProductsJson || hasCollectionsJson) {
        llmsTxt += `## Product Catalog\n\n`;
        if (hasProductsJson) {
          llmsTxt += `- [Products JSON Feed](${primaryDomain}/apps/${appProxySubpath}/ai/products.json): Complete product catalog with AI-optimized titles, descriptions, pricing, availability, and FAQ\n`;
        }
        if (hasCollectionsJson) {
          llmsTxt += `- [Collections Feed](${primaryDomain}/apps/${appProxySubpath}/ai/collections-feed.json): Product categories and collections with SEO metadata\n`;
        }
        llmsTxt += '\n';
      }

      // --- Store Information section ---
      const hasStoreMetadata = settings.features?.storeMetadata && availableFeatures.includes('storeMetadata');
      const hasWelcomePage = settings.features?.welcomePage && availableFeatures.includes('welcomePage');

      if (hasStoreMetadata || hasWelcomePage) {
        llmsTxt += `## Store Information\n\n`;
        if (hasStoreMetadata) {
          llmsTxt += `- [Store Metadata](${primaryDomain}/apps/${appProxySubpath}/ai/store-metadata.json): Organization schema, business information, and AI context\n`;
        }
        if (hasWelcomePage) {
          llmsTxt += `- [AI Welcome Page](${primaryDomain}/apps/${appProxySubpath}/ai/welcome): Overview of all available AI data endpoints\n`;
        }
        llmsTxt += '\n';
      }

      // --- Sitemaps section ---
      const hasAiSitemap = hasSitemap && availableFeatures.includes('aiSitemap');

      if (hasAiSitemap) {
        llmsTxt += `## Sitemaps\n\n`;
        llmsTxt += `- [AI-Enhanced Sitemap](${primaryDomain}/apps/${appProxySubpath}/ai/sitemap-feed.xml): XML sitemap with AI metadata, product features, and FAQ\n`;
        llmsTxt += `- [Standard Sitemap](${primaryDomain}/sitemap.xml): Standard XML sitemap\n`;
        llmsTxt += '\n';
      }

      // --- Schema Data section ---
      const plusPlansWithSchema = ['professional_plus', 'growth_plus', 'growth_extra', 'enterprise'];
      const hasSchemaData = hasAdvancedSchema && plusPlansWithSchema.includes(normalizedPlan);

      if (hasSchemaData) {
        llmsTxt += `## Structured Data\n\n`;
        llmsTxt += `- [Schema.org Data](${primaryDomain}/apps/${appProxySubpath}/ai/schema-data.json): Product, Organization, FAQ, and BreadcrumbList schemas\n`;
        llmsTxt += '\n';
      }

      // --- Store Policies section (only policies that actually exist in the store) ---
      if (policies.length > 0) {
        llmsTxt += `## Store Policies\n\n`;
        for (const policy of policies) {
          llmsTxt += `- [${policy.title}](${policy.url})\n`;
        }
        llmsTxt += '\n';
      }

      // --- Metadata footer ---
      llmsTxt += `---\n`;
      llmsTxt += `last-updated: ${new Date().toISOString().split('T')[0]}\n`;
      if (shopEmail) {
        llmsTxt += `contact: ${shopEmail}\n`;
      }
      llmsTxt += `crawl-delay: 1\n`;
      llmsTxt += `generator: indexAIze - Unlock AI Search\n`;

      return llmsTxt;
    } catch (error) {
      console.error('[AI Discovery] Error generating llms.txt:', error);
      return null;
    }
  }
}

export default new AIDiscoveryService();