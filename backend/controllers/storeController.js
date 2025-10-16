// backend/controllers/storeController.js
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import { validateRequest } from '../middleware/shopifyAuth.js';
import { resolveShopToken } from '../utils/tokenResolver.js';


const router = express.Router();

// API version configuration
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// ---- Helper functions ----

// Normalize shop domain
function normalizeShop(s) {
  if (!s) return '';
  s = String(s).trim().toLowerCase();
  if (/^https?:\/\//.test(s)) {
    const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return u.toLowerCase();
  }
  if (!/\.myshopify\.com$/i.test(s)) return `${s.toLowerCase()}.myshopify.com`;
  return s.toLowerCase();
}

// Get shop from various sources
function getShopFromReq(req) {
  // Try different sources
  const shop = req.query.shop || 
               req.body?.shop || 
               req.headers['x-shop'] ||
               req.res?.locals?.shopify?.session?.shop;
  
  return shop ? normalizeShop(shop) : null;
}

// Resolve admin token using centralized resolver
async function resolveAdminTokenForShop(shop) {
  try {
    return await resolveShopToken(shop);
  } catch (err) {
    throw new Error(`No Admin API token available for shop ${shop}: ${err.message}`);
  }
}

// GraphQL query function
async function shopGraphQL(req, shop, query, variables = {}) {
  console.log('[STORE-GRAPHQL] Shop:', shop);
  console.log('[STORE-GRAPHQL] Query:', query.substring(0, 100) + '...');
  console.log('[STORE-GRAPHQL] Variables:', JSON.stringify(variables, null, 2));
  
  const token = await resolveAdminTokenForShop(shop);
  console.log('[STORE-GRAPHQL] Token:', token ? `${token.substring(0, 10)}...` : 'null');
  
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  console.log('[STORE-GRAPHQL] URL:', url);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  console.log('[STORE-GRAPHQL] Response status:', response.status);
  console.log('[STORE-GRAPHQL] Response headers:', Object.fromEntries(response.headers.entries()));

  const json = await response.json();
  console.log('[STORE-GRAPHQL] Response data:', JSON.stringify(json, null, 2));
  
  if (!response.ok || json.errors) {
    console.error('[STORE-GRAPHQL] Error response:', json.errors || json);
    const error = new Error(`GraphQL error: ${JSON.stringify(json.errors || json)}`);
    error.status = response.status || 500;
    throw error;
  }

  return json.data;
}

// Load plan data for shop
// Updated: Added read_markets scope support and plan override support
async function fetchPlan(shop, app = null) {
  
  // DEBUG
  console.log('ENV APP_PLAN:', process.env.APP_PLAN);
  console.log('All ENV:', Object.keys(process.env).filter(k => k.includes('APP')));

  // FIRST: Check environment variable
  const envPlan = process.env.APP_PLAN;
  if (envPlan) {
    const planMappings = {
      'starter': { plan: 'Starter', queryLimit: 50, queryCount: 0, productLimit: 50 },
      'professional': { plan: 'Professional', queryLimit: 600, queryCount: 0, productLimit: 300 },
      'growth': { plan: 'Growth', queryLimit: 1500, queryCount: 0, productLimit: 1000 },
      'growth_extra': { plan: 'Growth Extra', queryLimit: 4000, queryCount: 0, productLimit: 2000 },
      'enterprise': { plan: 'Enterprise', queryLimit: 10000, queryCount: 0, productLimit: 10000 }
    };
    
    if (planMappings[envPlan.toLowerCase()]) {
      console.log(`Using APP_PLAN from environment: ${envPlan}`);
      return planMappings[envPlan.toLowerCase()];
    }
  }

  // SECOND: Check subscription in database
  let plan = null;
  if (mongoose.connection.readyState === 1) {
    try {
      const Subscription = mongoose.models.Subscription || await import('../models/Subscription.js').then(m => m.default);
      const sub = await Subscription.findOne({ shop }).lean();
      
      if (sub) {
        plan = {
          plan: sub.plan || 'Starter',
          queryLimit: sub.queryLimit || 0,
          queryCount: sub.queryCount || 0,
          productLimit: sub.productLimit || 50
        };
      }
    } catch (err) {
      console.error('Error loading plan from DB:', err);
    }
  }

  // THIRD: Apply in-memory test override if any (same logic as seoController.js)
  if (app) {
    try {
      const override = app?.locals?.planOverrides?.get?.(shop);
      if (override) {
        console.log(`[TEST] Using plan override: ${shop} -> ${override}`);
        plan = {
          plan: override,
          queryLimit: 50,
          queryCount: 0,
          productLimit: 50
        };
      }
    } catch (e) {
      // no-op
    }
  }
  
  // FOURTH: Default plan if no subscription found
  if (!plan) {
    plan = {
      plan: 'Starter',  // Changed back to Starter as default
      queryLimit: 50,
      queryCount: 0,
      productLimit: 50
    };
  }

  return plan;
}

// ---- Routes ----

// Get current store metadata
router.get('/generate', validateRequest(), async (req, res) => {
  const { adminGraphql, shop } = res.locals;
  
  if (!adminGraphql) {
    return res.status(401).json({ error: 'No admin session. Reinstall app.' });
  }

  console.log('[STORE/HANDLER] Using fresh adminGraphql token for shop:', shop);

  try {

    // Check plan access
    const plan = await fetchPlan(shop, req.app);
    console.log('[STORE-DEBUG] fetchPlan result:', JSON.stringify(plan, null, 2));
    if (plan.plan === 'Starter') {
      return res.status(403).json({ 
        error: 'Store metadata requires Professional plan or higher',
        currentPlan: plan.plan
      });
    }

    // Get shop info
    const shopQuery = `{
      shop {
        id
        name
        description
        email
        contactEmail
        url
        primaryDomain {
          url
        }
      }
    }`;
    
    // Get shop locales separately (like in languageController)
    const localesQuery = `{
      shopLocales {
        locale
        primary
        published
      }
    }`;
    
    const shopResp = await adminGraphql.request(shopQuery);
    const localesResp = await adminGraphql.request(localesQuery);
    const shopInfo = shopResp?.data?.shop;
    const shopLocales = localesResp?.data?.shopLocales || [];
    
    console.log('[STORE-DEBUG] shopInfo:', JSON.stringify(shopInfo, null, 2));
    console.log('[STORE-DEBUG] shopLocales:', shopLocales);
    
    // Get markets separately (simplified query)
    const marketsQuery = `{
      markets(first: 10) {
        edges {
          node {
            id
            name
            enabled
          }
        }
      }
    }`;
    
    const marketsResp = await adminGraphql.request(marketsQuery);
    const markets = marketsResp?.data?.markets?.edges?.map(edge => edge.node) || [];
    
    console.log('[STORE-DEBUG] markets:', markets);
    console.log('[STORE-DEBUG] plan.plan:', plan.plan);
    console.log('[STORE-DEBUG] features:', {
      organizationSchema: ['professional', 'growth', 'growth extra', 'enterprise'].includes(plan.plan.toLowerCase()),
      // localBusinessSchema: plan.plan.toLowerCase() === 'enterprise' // DISABLED - not relevant for online stores
    });
    
    if (!shopInfo) return res.status(404).json({ error: 'Shop not found' });

    // Get existing metafields
    console.log('[STORE-METAFIELDS] Fetching metafields for shop:', shop);
    const metafieldsQuery = `{
      shop {
        metafields(namespace: "ai_seo_store", first: 10) {
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
    }`;

    const metafieldsResp = await adminGraphql.request(metafieldsQuery);
    console.log('[STORE-METAFIELDS] Metafields data:', JSON.stringify(metafieldsResp, null, 2));
    const metafields = {};
    
    metafieldsResp?.data?.shop?.metafields?.edges?.forEach(edge => {
      const node = edge.node;
      if (node.type === 'json') {
        const parsed = JSON.parse(node.value);
        // Special handling for organization_schema to ensure enabled state is preserved
        if (node.key === 'organization_schema') {
          metafields[node.key] = {
            id: node.id,
            value: parsed,
            // Explicitly check for enabled state
            enabled: parsed.enabled === true
          };
        } else {
          metafields[node.key] = {
            id: node.id,
            value: parsed
          };
        }
      } else {
        metafields[node.key] = {
          id: node.id,
          value: node.value
        };
      }
    });

    res.json({
      shop,
      shopId: shopInfo.id,
      shopInfo: {
        name: shopInfo.name,
        description: shopInfo.description,
        url: shopInfo.primaryDomain?.url || shopInfo.url,
        email: shopInfo.contactEmail || shopInfo.email,
        locales: shopLocales,
        markets: markets,
        currencies: ['EUR'] // Default currency for now
      },
      shopifyDefaults: {
        storeName: shopInfo.name || '',
        homePageTitle: metafields.home_page_title?.value || shopInfo.description || '',
        metaDescription: shopInfo.description || ''
      },
      existingMetadata: metafields,
      plan: plan.plan,
      features: {
        organizationSchema: ['professional', 'growth', 'growth extra', 'enterprise'].includes(plan.plan.toLowerCase()),
        // localBusinessSchema: plan.plan.toLowerCase() === 'enterprise' // DISABLED - not relevant for online stores
      }
    });
  } catch (error) {
    console.error('Error loading store metadata:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Generate AI metadata (mock for now)
router.post('/ai-generate', validateRequest(), async (req, res) => {
  console.log('[STORE/HANDLER]', req.method, req.originalUrl, {
    queryShop: req.query?.shop,
    bodyShop: req.body?.shop,
    sessionShop: res.locals?.shopify?.session?.shop,
  });

  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[STORE/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  // Тук логни и от къде четеш Admin API токена:
  const tokenSource = 'db|kv|session'; // актуализирай според твоя сторидж
  console.log('[STORE/HANDLER] Resolving Admin token', { shop, tokenSource });

  try {
    const shop = req.shopDomain;

    const { shopInfo, businessType, targetAudience } = req.body;

    // Check plan
    const plan = await fetchPlan(shop, req.app);
    if (plan.plan === 'Starter') {
      return res.status(403).json({ 
        error: 'Store metadata requires Professional plan or higher',
        currentPlan: plan.plan
      });
    }

    // TODO: Integrate with OpenRouter for actual AI generation
    // For now, return mock data
    const generatedMetadata = {
      seo: {
        title: `${shopInfo.name} - ${businessType || 'Online Store'}`,
        metaDescription: `Shop ${businessType || 'quality products'} at ${shopInfo.name}. ${targetAudience ? `Perfect for ${targetAudience}.` : ''} Fast shipping, great prices.`,
        keywords: [businessType, 'online shop', shopInfo.name].filter(Boolean)
      },
      aiMetadata: {
        businessType: businessType || 'E-commerce',
        targetAudience: targetAudience || 'General consumers',
        uniqueSellingPoints: [
          'High-quality products',
          'Competitive prices',
          'Fast shipping',
          'Excellent customer service'
        ],
        brandVoice: 'Professional and friendly',
        primaryCategories: ['General merchandise'],
        shippingInfo: 'We ship worldwide with tracking',
        returnPolicy: '30-day return policy on all items'
      }
    };

    // Add organization schema for eligible plans
    if (['professional', 'growth', 'growth extra', 'enterprise'].includes(plan.plan.toLowerCase())) {
      generatedMetadata.organizationSchema = {
        enabled: true,
        name: shopInfo.name,
        url: shopInfo.url,
        email: shopInfo.email,
        description: generatedMetadata.seo.metaDescription
      };
    }

    res.json({
      generated: true,
      metadata: generatedMetadata,
      plan: plan.plan
    });
  } catch (error) {
    console.error('Error generating metadata:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply metadata to shop
router.post('/apply', validateRequest(), async (req, res) => {
  const { adminGraphql, shop } = res.locals;
  if (!adminGraphql) return res.status(401).json({ error: 'No admin session. Reinstall app.' });
  
  console.log('[STORE-APPLY] Starting metadata save for shop:', shop);

  try {

    const { metadata, options = {} } = req.body;
    if (!metadata) return res.status(400).json({ error: 'No metadata provided' });

    // Get shop ID
    const shopQuery = `{
      shop {
        id
      }
    }`;
    
    console.log('[STORE-APPLY] Executing shop query...');
    console.log('[STORE-APPLY] Shop query:', shopQuery);
    console.log('[STORE-APPLY] adminGraphql exists:', !!adminGraphql);
    console.log('[STORE-APPLY] adminGraphql.request type:', typeof adminGraphql?.request);
    
    const shopResp = await adminGraphql.request(shopQuery);
    console.log('[STORE-APPLY] Raw shopResp:', shopResp);
    console.log('[STORE-APPLY] shopResp type:', typeof shopResp);
    
    // Shopify SDK returns { data: { shop: { id: "..." } } } directly, not wrapped in body
    const shopId = shopResp?.data?.shop?.id;
    
    console.log('[STORE-APPLY] Shop query result:', {
      hasData: !!shopResp?.data,
      hasShop: !!shopResp?.data?.shop,
      shopId: shopId,
      fullResponse: JSON.stringify(shopResp?.data, null, 2)
    });
    
    if (!shopId) {
      console.log('[STORE-APPLY] Shop ID not found in response');
      return res.status(404).json({ error: 'Shop not found' });
    }

    const metafieldsToSet = [];

    // SEO metadata - запиши само ако не е празно
    if (metadata.seo && options.updateSeo !== false) {
      const hasCustomData = metadata.seo.storeName || 
                            metadata.seo.shortDescription || 
                            metadata.seo.fullDescription || 
                            (metadata.seo.keywords && metadata.seo.keywords.length > 0);
      
      if (hasCustomData) {
        console.log('[STORE-APPLY] Saving custom SEO metadata');
        metafieldsToSet.push({
          ownerId: shopId,
          namespace: 'ai_seo_store',
          key: 'seo_metadata',
          type: 'json',
          value: JSON.stringify({
            storeName: metadata.seo.storeName || null,
            shortDescription: metadata.seo.shortDescription || null,
            fullDescription: metadata.seo.fullDescription || null,
            keywords: Array.isArray(metadata.seo.keywords) 
              ? metadata.seo.keywords 
              : (metadata.seo.keywords || '').split(',').map(k => k.trim()).filter(Boolean)
          })
        });
      } else {
        console.log('[STORE-APPLY] No custom SEO data - will use Shopify defaults');
      }
    }

    // Home page title - save as separate metafield
    if (metadata.seo?.shortDescription && options.updateSeo !== false) {
      console.log('[STORE-APPLY] Saving home page title');
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'home_page_title',
        type: 'single_line_text_field',
        value: metadata.seo.shortDescription
      });
    }

    // AI metadata
    if (metadata.aiMetadata && options.updateAiMetadata !== false) {
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'ai_metadata',
        type: 'json',
        value: JSON.stringify(metadata.aiMetadata)
      });
    }

    // Organization schema - always save to preserve enabled state
    if (metadata.organizationSchema) {
      // Ensure we have an explicit enabled state
      const orgSchemaData = {
        ...metadata.organizationSchema,
        enabled: metadata.organizationSchema.enabled === true
      };
      
      console.log('[STORE-APPLY] Organization schema data:', orgSchemaData);
      
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'organization_schema',
        type: 'json',
        value: JSON.stringify(orgSchemaData)
      });
    } else {
      console.log('[STORE-APPLY] No organization schema in metadata');
    }

    // Local business schema (Enterprise only) - DISABLED - not relevant for online stores
    /*
    if (metadata.localBusinessSchema && options.updateLocalBusiness !== false) {
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'local_business_schema',
        type: 'json',
        value: JSON.stringify(metadata.localBusinessSchema)
      });
    }
    */

    if (metafieldsToSet.length === 0) {
      console.log('[STORE-APPLY] No metafields to update');
      return res.status(400).json({ error: 'No metafields to update' });
    }

    console.log('[STORE-APPLY] Saving metafields:', metafieldsToSet.map(m => ({
      namespace: m.namespace,
      key: m.key,
      type: m.type,
      valueLength: m.value?.length || 0
    })));

    // Apply metafields
    const mutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = { metafields: metafieldsToSet };
    const resp = await adminGraphql.request(mutation, { variables });
    const result = resp?.body?.data;
    
    console.log('[STORE-APPLY] GraphQL result:', {
      metafieldsCreated: result?.metafieldsSet?.metafields?.length || 0,
      userErrors: result?.metafieldsSet?.userErrors || []
    });

    if (result?.metafieldsSet?.userErrors?.length > 0) {
      return res.status(400).json({ 
        error: 'Failed to update metafields', 
        errors: result.metafieldsSet.userErrors 
      });
    }

    res.json({
      success: true,
      updated: metafieldsToSet.map(mf => mf.key),
      metafields: result?.metafieldsSet?.metafields
    });

  } catch (error) {
    console.error('[STORE-APPLY] Error applying metadata:', error.message);
    console.error('[STORE-APPLY] Error stack:', error.stack);
    console.error('[STORE-APPLY] Error details:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Public endpoint for AI crawlers
router.get('/public/:shop', async (req, res) => {
  try {
    console.log('[STORE-PUBLIC] GET /public/:shop called');
    console.log('[STORE-PUBLIC] req.url:', req.url);
    console.log('[STORE-PUBLIC] req.path:', req.path);
    console.log('[STORE-PUBLIC] req.params:', req.params);
    console.log('[STORE-PUBLIC] req.params.shop:', req.params.shop);
    console.log('[STORE-PUBLIC] req.route:', req.route);
    
    const shop = normalizeShop(req.params.shop);
    console.log('[STORE-PUBLIC] Normalized shop:', shop);
    
    if (!shop) {
      console.log('[STORE-PUBLIC] Shop validation failed');
      return res.status(400).json({ error: 'Invalid shop' });
    }
    
    // Get metadata from shop metafields
    const query = `{
      shop {
        name
        description
        primaryDomain {
          url
        }
        metafields(namespace: "ai_seo_store", first: 10) {
          edges {
            node {
              key
              value
              type
            }
          }
        }
      }
    }`;

    const data = await shopGraphQL(req, shop, query);
    const shopData = data?.shop;
    
    if (!shopData) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Create metafield definitions for shop
    router.post('/create-definitions', validateRequest(), async (req, res) => {
      try {
        const shop = req.shopDomain;

        const mutation = `
          mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition {
                id
                name
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const definitions = [
          {
            name: 'SEO Metadata',
            namespace: 'ai_seo_store',
            key: 'seo_metadata',
            description: 'AI-generated SEO metadata',
            type: 'json',
            ownerType: 'SHOP'
          },
          {
            name: 'AI Metadata',
            namespace: 'ai_seo_store', 
            key: 'ai_metadata',
            description: 'AI business metadata',
            type: 'json',
            ownerType: 'SHOP'
          },
          {
            name: 'Home Page Title',
            namespace: 'ai_seo_store',
            key: 'home_page_title',
            description: 'Custom home page title for AI/SEO',
            type: 'single_line_text_field',
            ownerType: 'SHOP'
          }
        ];

        const results = [];
        for (const def of definitions) {
          const result = await shopGraphQL(req, shop, mutation, { definition: def });
          results.push(result);
        }

        res.json({ success: true, results });
      } catch (error) {
        console.error('Error creating definitions:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Parse metafields
    const metadata = {};
    shopData.metafields?.edges?.forEach(edge => {
      const node = edge.node;
      if (node.type === 'json') {
        metadata[node.key] = JSON.parse(node.value);
      } else {
        metadata[node.key] = node.value;
      }
    });

    // Build response for AI crawlers
    const aiResponse = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: shopData.name,
      description: shopData.description,
      url: shopData.primaryDomain?.url,
      ...metadata.seo_metadata,
      
      // Include AI-specific metadata
      aiMetadata: metadata.ai_metadata,
      
      // Include organization schema if available
      ...(metadata.organization_schema?.enabled && {
        publisher: {
          "@type": "Organization",
          ...metadata.organization_schema
        }
      }),
      
      // Include local business if available - DISABLED - not relevant for online stores
      /*
      ...(metadata.local_business_schema?.enabled && {
        location: {
          "@type": "LocalBusiness",
          ...metadata.local_business_schema
        }
      })
      */
    };

    res.json(aiResponse);
  } catch (error) {
    console.error('Error fetching public metadata:', error);
    res.status(500).json({ error: 'Failed to fetch metadata' });
  }
});

// Settings endpoints за Advanced Schema
router.get('/settings', validateRequest(), async (req, res) => {
  console.log('[STORE-SETTINGS] GET /settings called'); // DEBUG
  try {
    const shop = req.shopDomain;
    console.log('[STORE-SETTINGS] Shop:', shop); // DEBUG
    
    // Get settings from shop metafield
    const query = `{
      shop {
        metafield(namespace: "ai_seo_store", key: "app_settings") {
          value
        }
      }
    }`;
    
    console.log('[STORE-SETTINGS] Fetching metafield...'); // DEBUG
    const data = await shopGraphQL(req, shop, query);
    
    const settings = data?.shop?.metafield?.value 
      ? JSON.parse(data.shop.metafield.value)
      : { advancedSchemaEnabled: false };
    
    console.log('[STORE-SETTINGS] Retrieved settings:', settings); // DEBUG
    res.json(settings);
  } catch (error) {
    console.error('[STORE-SETTINGS] Error loading settings:', error);
    res.json({ advancedSchemaEnabled: false }); // Default settings
  }
});

router.post('/settings', validateRequest(), async (req, res) => {
  console.log('[STORE-SETTINGS] POST /settings called'); // DEBUG
  console.log('[STORE-SETTINGS] Request body:', req.body); // DEBUG
  
  try {
    const shop = req.shopDomain;
    console.log('[STORE-SETTINGS] Shop:', shop); // DEBUG
    
    // Get shop ID
    const shopQuery = `{ shop { id } }`;
    const shopData = await shopGraphQL(req, shop, shopQuery);
    const shopId = shopData?.shop?.id;
    
    console.log('[STORE-SETTINGS] Shop ID:', shopId); // DEBUG
    
    if (!shopId) return res.status(404).json({ error: 'Shop not found' });
    
    // Get current settings to check if advancedSchemaEnabled is being turned on
    const currentSettingsQuery = `{
      shop {
        metafield(namespace: "ai_seo_store", key: "app_settings") {
          value
        }
      }
    }`;
    
    const currentSettingsData = await shopGraphQL(req, shop, currentSettingsQuery);
    const currentSettings = currentSettingsData?.shop?.metafield?.value 
      ? JSON.parse(currentSettingsData.shop.metafield.value)
      : { advancedSchemaEnabled: false };
    
    // Check if advancedSchemaEnabled is being turned on
    if (req.body.advancedSchemaEnabled && !currentSettings.advancedSchemaEnabled) {
      console.log('[STORE-SETTINGS] Advanced Schema being ENABLED!'); // DEBUG
      
      // Trigger schema generation
      setTimeout(async () => {
        try {
          console.log('[STORE-SETTINGS] Triggering schema generation...'); // DEBUG
          const schemaRes = await fetch(`${process.env.APP_URL || 'http://localhost:8080'}/api/schema/generate-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shop })
          });
          
          const schemaResult = await schemaRes.json();
          console.log('[STORE-SETTINGS] Schema generation response:', schemaResult); // DEBUG
        } catch (err) {
          console.error('[STORE-SETTINGS] Failed to trigger schema generation:', err);
        }
      }, 100);
    }
    
    // Save settings
    const mutation = `
      mutation SaveSettings($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const variables = {
      metafields: [{
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'app_settings',
        type: 'json',
        value: JSON.stringify(req.body)
      }]
    };
    
    console.log('[STORE-SETTINGS] Saving metafield...'); // DEBUG
    const result = await shopGraphQL(req, shop, mutation, variables);
    
    if (result?.metafieldsSet?.userErrors?.length > 0) {
      console.error('[STORE-SETTINGS] Metafield errors:', result.metafieldsSet.userErrors); // DEBUG
      return res.status(400).json({ 
        error: 'Failed to save settings', 
        errors: result.metafieldsSet.userErrors 
      });
    }
    
    console.log('[STORE-SETTINGS] Settings saved successfully!'); // DEBUG
    res.json({ success: true });
  } catch (error) {
    console.error('[STORE-SETTINGS] Error saving settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/store/metadata-status - Check if store metadata is configured
router.get('/metadata-status', validateRequest(), async (req, res) => {
  try {
    console.log('[STORE-METADATA-STATUS] Request received');
    const shop = getShopFromReq(req);
    console.log('[STORE-METADATA-STATUS] Shop:', shop);
    
    if (!shop) {
      console.error('[STORE-METADATA-STATUS] No shop found in request');
      return res.status(400).json({ error: 'Shop not found' });
    }
    
    // Import here to avoid circular dependencies
    const { checkStoreMetadataStatus } = await import('../utils/storeContextBuilder.js');
    
    console.log('[STORE-METADATA-STATUS] Checking status for shop:', shop);
    const status = await checkStoreMetadataStatus(shop);
    console.log('[STORE-METADATA-STATUS] Status result:', JSON.stringify(status, null, 2));
    
    res.json(status);
  } catch (error) {
    console.error('[STORE-METADATA-STATUS] Error:', error);
    res.status(500).json({ 
      error: error.message,
      hasMetadata: false,
      hasPolicies: false
    });
  }
});

export default router;