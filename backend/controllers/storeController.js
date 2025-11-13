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
  const token = await resolveAdminTokenForShop(shop);
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();
  
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
  // FIRST: Check environment variable
  const envPlan = process.env.APP_PLAN;
  if (envPlan) {
    const planMappings = {
      'starter': { plan: 'Starter', queryLimit: 50, queryCount: 0, productLimit: 70 },
      'professional': { plan: 'Professional', queryLimit: 600, queryCount: 0, productLimit: 70 },
      'professional_plus': { plan: 'Professional Plus', queryLimit: 600, queryCount: 0, productLimit: 200 },
      'growth': { plan: 'Growth', queryLimit: 1500, queryCount: 0, productLimit: 450 },
      'growth_plus': { plan: 'Growth Plus', queryLimit: 1500, queryCount: 0, productLimit: 450 },
      'growth_extra': { plan: 'Growth Extra', queryLimit: 4000, queryCount: 0, productLimit: 750 },
      'enterprise': { plan: 'Enterprise', queryLimit: 10000, queryCount: 0, productLimit: 1200 }
    };
    
    if (planMappings[envPlan.toLowerCase()]) {
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

  try {
    // Check plan access
    const plan = await fetchPlan(shop, req.app);
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
    
    // Normalize plan name for comparison (handle spaces and underscores)
    const normalizedPlan = (plan.plan || '').toLowerCase().replace(/\s+/g, '_');
    const allowedPlans = ['professional', 'professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'];
    
    if (!shopInfo) return res.status(404).json({ error: 'Shop not found' });

    // Get existing metafields
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
        organizationSchema: allowedPlans.includes(normalizedPlan),
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
  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[STORE/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

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

  try {
    const { metadata, options = {} } = req.body;
    if (!metadata) return res.status(400).json({ error: 'No metadata provided' });

    // Get shop ID
    const shopQuery = `{
      shop {
        id
      }
    }`;
    
    const shopResp = await adminGraphql.request(shopQuery);
    
    // Shopify SDK returns { data: { shop: { id: "..." } } } directly, not wrapped in body
    const shopId = shopResp?.data?.shop?.id;
    
    if (!shopId) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const metafieldsToSet = [];

    // SEO metadata - Check if all values are empty
    const isEmptySeo = metadata.seo && 
      !metadata.seo.storeName?.trim() && 
      !metadata.seo.shortDescription?.trim() && 
      !metadata.seo.fullDescription?.trim() && 
      !metadata.seo.keywords?.trim();

    // SEO metadata - ONLY save if not all empty
    if (metadata.seo && options.updateSeo !== false && !isEmptySeo) {
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
    } else if (isEmptySeo) {
      // Save empty values to clear the metafield
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'seo_metadata',
        type: 'json',
        value: JSON.stringify({
          storeName: null,
          shortDescription: null,
          fullDescription: null,
          keywords: []
        })
      });
    }

    // Home page title - save only if not empty
    if (metadata.seo?.shortDescription?.trim() && options.updateSeo !== false) {
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'home_page_title',
        type: 'single_line_text_field',
        value: metadata.seo.shortDescription
      });
    } else if (options.updateSeo !== false && isEmptySeo) {
      // Save empty value to clear the metafield
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'home_page_title',
        type: 'single_line_text_field',
        value: ''
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
      
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'organization_schema',
        type: 'json',
        value: JSON.stringify(orgSchemaData)
      });
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
      return res.status(400).json({ error: 'No metafields to update' });
    }

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
    const shop = normalizeShop(req.params.shop);
    
    if (!shop) {
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
  try {
    const shop = req.shopDomain;
    
    // Get settings from shop metafield
    const query = `{
      shop {
        metafield(namespace: "ai_seo_store", key: "app_settings") {
          value
        }
      }
    }`;
    
    const data = await shopGraphQL(req, shop, query);
    
    const settings = data?.shop?.metafield?.value 
      ? JSON.parse(data.shop.metafield.value)
      : { advancedSchemaEnabled: false };
    
    // Add plan and token balance info for frontend plan checks
    const Subscription = require('../db/Subscription');
    const TokenBalance = require('../db/TokenBalance');
    
    const subscription = await Subscription.findOne({ shop });
    const tokenBalance = await TokenBalance.findOne({ shop });
    
    // Add plan and token info to response
    const response = {
      ...settings,
      plan: subscription?.plan || 'starter',
      tokenBalance: {
        available: tokenBalance?.available || 0,
        totalUsed: tokenBalance?.totalUsed || 0
      }
    };
    
    res.json(response);
  } catch (error) {
    console.error('[STORE-SETTINGS] Error loading settings:', error);
    res.json({ 
      advancedSchemaEnabled: false,
      plan: 'starter',
      tokenBalance: { available: 0, totalUsed: 0 }
    }); // Default settings
  }
});

router.post('/settings', validateRequest(), async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // Get shop ID
    const shopQuery = `{ shop { id } }`;
    const shopData = await shopGraphQL(req, shop, shopQuery);
    const shopId = shopData?.shop?.id;
    
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
      // Trigger schema generation
      setTimeout(async () => {
        try {
          const schemaRes = await fetch(`${process.env.APP_URL || 'http://localhost:8080'}/api/schema/generate-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shop })
          });
          
          await schemaRes.json();
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
    
    const result = await shopGraphQL(req, shop, mutation, variables);
    
    if (result?.metafieldsSet?.userErrors?.length > 0) {
      return res.status(400).json({ 
        error: 'Failed to save settings', 
        errors: result.metafieldsSet.userErrors 
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('[STORE-SETTINGS] Error saving settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/store/metadata-status - Check if store metadata is configured
router.get('/metadata-status', validateRequest(), async (req, res) => {
  try {
    const shop = getShopFromReq(req);
    
    if (!shop) {
      console.error('[STORE-METADATA-STATUS] No shop found in request');
      return res.status(400).json({ error: 'Shop not found' });
    }
    
    // Import here to avoid circular dependencies
    const { checkStoreMetadataStatus } = await import('../utils/storeContextBuilder.js');
    
    const status = await checkStoreMetadataStatus(shop);
    
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

// POST /api/store/prepare-uninstall - Clean all app data before uninstall
router.post('/prepare-uninstall', validateRequest(), async (req, res) => {
  try {
    const shop = getShopFromReq(req);
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop not found' });
    }
    
    const results = {
      metafieldDefinitions: { deleted: 0, errors: [] },
      productSeoData: { cleared: 0, errors: [] },
      collectionSeoData: { cleared: 0, errors: [] },
      storeMetadata: { deleted: false, error: null },
      advancedSchemas: { deleted: false, error: null }
    };
    
    // 1. Delete all metafield definitions (this also deletes all associated values automatically)
    try {
      // Query all metafield definitions for seo_ai namespace
      const definitionsQuery = `
        query {
          metafieldDefinitions(first: 250, ownerType: PRODUCT, namespace: "seo_ai") {
            nodes {
              id
              key
              namespace
            }
          }
        }
      `;
      
      const defsData = await shopGraphQL(req, shop, definitionsQuery);
      const definitions = defsData?.metafieldDefinitions?.nodes || [];
      
      // Delete each definition
      for (const def of definitions) {
        try {
          const deleteMutation = `
            mutation($id: ID!, $deleteAllAssociatedMetafields: Boolean!) {
              metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: $deleteAllAssociatedMetafields) {
                deletedDefinitionId
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          
          const deleteResult = await shopGraphQL(req, shop, deleteMutation, { 
            id: def.id, 
            deleteAllAssociatedMetafields: true 
          });
          
          if (deleteResult?.metafieldDefinitionDelete?.userErrors?.length > 0) {
            console.error('[PREPARE-UNINSTALL] Error deleting definition:', def.key, deleteResult.metafieldDefinitionDelete.userErrors);
            results.metafieldDefinitions.errors.push({
              key: def.key,
              errors: deleteResult.metafieldDefinitionDelete.userErrors
            });
          } else {
            results.metafieldDefinitions.deleted++;
          }
        } catch (err) {
          console.error('[PREPARE-UNINSTALL] Exception deleting definition:', def.key, err.message);
          results.metafieldDefinitions.errors.push({
            key: def.key,
            error: err.message
          });
        }
      }
      
      // Also delete collection metafield definitions
      const collectionDefsQuery = `
        query {
          metafieldDefinitions(first: 250, ownerType: COLLECTION, namespace: "seo_ai") {
            nodes {
              id
              key
              namespace
            }
          }
        }
      `;
      
      const collectionDefsData = await shopGraphQL(req, shop, collectionDefsQuery);
      const collectionDefinitions = collectionDefsData?.metafieldDefinitions?.nodes || [];
      
      for (const def of collectionDefinitions) {
        try {
          const deleteMutation = `
            mutation($id: ID!, $deleteAllAssociatedMetafields: Boolean!) {
              metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: $deleteAllAssociatedMetafields) {
                deletedDefinitionId
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          
          const deleteResult = await shopGraphQL(req, shop, deleteMutation, { 
            id: def.id, 
            deleteAllAssociatedMetafields: true 
          });
          
          if (deleteResult?.metafieldDefinitionDelete?.userErrors?.length > 0) {
            console.error('[PREPARE-UNINSTALL] Error deleting collection definition:', def.key, deleteResult.metafieldDefinitionDelete.userErrors);
            results.metafieldDefinitions.errors.push({
              key: def.key,
              errors: deleteResult.metafieldDefinitionDelete.userErrors
            });
          } else {
            results.metafieldDefinitions.deleted++;
          }
        } catch (err) {
          console.error('[PREPARE-UNINSTALL] Exception deleting collection definition:', def.key, err.message);
          results.metafieldDefinitions.errors.push({
            key: def.key,
            error: err.message
          });
        }
      }
      
      // Also delete advanced_schema definitions for products
      const advancedSchemaDefsQuery = `
        query {
          metafieldDefinitions(first: 250, ownerType: PRODUCT, namespace: "advanced_schema") {
            nodes {
              id
              key
              namespace
            }
          }
        }
      `;
      
      const advancedSchemaDefsData = await shopGraphQL(req, shop, advancedSchemaDefsQuery);
      const advancedSchemaDefinitions = advancedSchemaDefsData?.metafieldDefinitions?.nodes || [];
      
      for (const def of advancedSchemaDefinitions) {
        try {
          const deleteMutation = `
            mutation($id: ID!, $deleteAllAssociatedMetafields: Boolean!) {
              metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: $deleteAllAssociatedMetafields) {
                deletedDefinitionId
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          
          const deleteResult = await shopGraphQL(req, shop, deleteMutation, { 
            id: def.id, 
            deleteAllAssociatedMetafields: true 
          });
          
          if (deleteResult?.metafieldDefinitionDelete?.userErrors?.length > 0) {
            console.error('[PREPARE-UNINSTALL] Error deleting advanced_schema definition:', def.key, deleteResult.metafieldDefinitionDelete.userErrors);
            results.metafieldDefinitions.errors.push({
              key: def.key,
              errors: deleteResult.metafieldDefinitionDelete.userErrors
            });
          } else {
            results.metafieldDefinitions.deleted++;
          }
        } catch (err) {
          console.error('[PREPARE-UNINSTALL] Exception deleting advanced_schema definition:', def.key, err.message);
          results.metafieldDefinitions.errors.push({
            key: def.key,
            error: err.message
          });
        }
      }
      
    } catch (err) {
      console.error('[PREPARE-UNINSTALL] Error in metafield definitions cleanup:', err.message);
      results.metafieldDefinitions.errors.push({ error: err.message });
    }
    
    // 2. Clear product.seo and collection.seo data (Translate & Adapt data)
    try {
      // Get ALL products from Shopify (not just MongoDB records)
      // This ensures we clear SEO data even if products weren't tracked in our DB
      const productsQuery = `
        query {
          products(first: 250) {
            edges {
              node {
                id
                seo {
                  title
                  description
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;
      
      let allProducts = [];
      let hasNextPage = true;
      let cursor = null;
      
      // Fetch all products with pagination
      while (hasNextPage) {
        const query = cursor 
          ? `query { products(first: 250, after: "${cursor}") { edges { node { id seo { title description } } } pageInfo { hasNextPage endCursor } } }`
          : productsQuery;
        
        const productsData = await shopGraphQL(req, shop, query);
        const edges = productsData?.products?.edges || [];
        
        // Only include products that have SEO data set
        const productsWithSeo = edges.filter(edge => {
          const seo = edge.node.seo;
          return seo && (seo.title || seo.description);
        });
        
        allProducts.push(...productsWithSeo.map(edge => edge.node));
        
        hasNextPage = productsData?.products?.pageInfo?.hasNextPage || false;
        cursor = productsData?.products?.pageInfo?.endCursor;
      }
      
      // Clear SEO data for each product (set to empty strings)
      for (const product of allProducts) {
        try {
          const clearSeoMutation = `
            mutation($input: ProductInput!) {
              productUpdate(input: $input) {
                product {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          
          const clearResult = await shopGraphQL(req, shop, clearSeoMutation, {
            input: {
              id: product.id,
              seo: {
                title: null,
                description: null
              }
            }
          });
          
          if (clearResult?.productUpdate?.userErrors?.length > 0) {
            console.error('[PREPARE-UNINSTALL] Error clearing product SEO:', product.id, clearResult.productUpdate.userErrors);
            results.productSeoData.errors.push({
              productId: product.id,
              errors: clearResult.productUpdate.userErrors
            });
          } else {
            results.productSeoData.cleared++;
          }
        } catch (err) {
          console.error('[PREPARE-UNINSTALL] Exception clearing product SEO:', product.id, err.message);
          results.productSeoData.errors.push({
            productId: product.id,
            error: err.message
          });
        }
      }
      
      // Get ALL collections from Shopify (not just MongoDB records)
      const collectionsQuery = `
        query {
          collections(first: 250) {
            edges {
              node {
                id
                seo {
                  title
                  description
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;
      
      let allCollections = [];
      hasNextPage = true;
      cursor = null;
      
      // Fetch all collections with pagination
      while (hasNextPage) {
        const query = cursor 
          ? `query { collections(first: 250, after: "${cursor}") { edges { node { id seo { title description } } } pageInfo { hasNextPage endCursor } } }`
          : collectionsQuery;
        
        const collectionsData = await shopGraphQL(req, shop, query);
        const edges = collectionsData?.collections?.edges || [];
        
        // Only include collections that have SEO data set
        const collectionsWithSeo = edges.filter(edge => {
          const seo = edge.node.seo;
          return seo && (seo.title || seo.description);
        });
        
        allCollections.push(...collectionsWithSeo.map(edge => edge.node));
        
        hasNextPage = collectionsData?.collections?.pageInfo?.hasNextPage || false;
        cursor = collectionsData?.collections?.pageInfo?.endCursor;
      }
      
      // Clear SEO data for each collection
      for (const collection of allCollections) {
        try {
          const clearSeoMutation = `
            mutation($input: CollectionInput!) {
              collectionUpdate(collection: $input) {
                collection {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          
          const clearResult = await shopGraphQL(req, shop, clearSeoMutation, {
            input: {
              id: collection.id,
              seo: {
                title: null,
                description: null
              }
            }
          });
          
          if (clearResult?.collectionUpdate?.userErrors?.length > 0) {
            console.error('[PREPARE-UNINSTALL] Error clearing collection SEO:', collection.id, clearResult.collectionUpdate.userErrors);
            results.collectionSeoData.errors.push({
              collectionId: collection.id,
              errors: clearResult.collectionUpdate.userErrors
            });
          } else {
            results.collectionSeoData.cleared++;
          }
        } catch (err) {
          console.error('[PREPARE-UNINSTALL] Exception clearing collection SEO:', collection.id, err.message);
          results.collectionSeoData.errors.push({
            collectionId: collection.id,
            error: err.message
          });
        }
      }
      
    } catch (err) {
      console.error('[PREPARE-UNINSTALL] Error clearing SEO data:', err.message);
      results.productSeoData.errors.push({ error: err.message });
      results.collectionSeoData.errors.push({ error: err.message });
    }
    
    // 3. Delete store metadata (app_settings namespace)
    try {
      const deleteStoreMetaMutation = `
        mutation {
          metafieldsDelete(metafields: [
            { ownerId: "gid://shopify/Shop/${shop.replace('.myshopify.com', '')}", namespace: "app_settings", key: "store_metadata" }
          ]) {
            deletedMetafields {
              ownerId
              namespace
              key
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      
      const storeMetaResult = await shopGraphQL(req, shop, deleteStoreMetaMutation);
      
      if (storeMetaResult?.metafieldsDelete?.userErrors?.length > 0) {
        console.error('[PREPARE-UNINSTALL] Error deleting store metadata:', storeMetaResult.metafieldsDelete.userErrors);
        results.storeMetadata.error = storeMetaResult.metafieldsDelete.userErrors;
      } else {
        results.storeMetadata.deleted = true;
      }
    } catch (err) {
      console.error('[PREPARE-UNINSTALL] Exception deleting store metadata:', err.message);
      results.storeMetadata.error = err.message;
    }
    
    // 4. Delete advanced schemas
    try {
      // Import AdvancedSchema model
      const { default: AdvancedSchema } = await import('../db/AdvancedSchema.js');
      const deletedSchemas = await AdvancedSchema.deleteMany({ shop });
      results.advancedSchemas.deleted = deletedSchemas.deletedCount > 0;
    } catch (err) {
      console.error('[PREPARE-UNINSTALL] Exception deleting advanced schemas:', err.message);
      results.advancedSchemas.error = err.message;
    }
    
    res.json({
      success: true,
      message: 'App data cleaned successfully',
      results
    });
    
  } catch (error) {
    console.error('[PREPARE-UNINSTALL] Fatal error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

export default router;