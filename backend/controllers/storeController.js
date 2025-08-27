// backend/controllers/storeController.js
import express from 'express';
import mongoose from 'mongoose';

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

// Resolve admin token for shop (similar to other controllers)
async function resolveAdminTokenForShop(shop) {
  // 1) Check session (OAuth per-shop)
  // This would typically come from your session storage
  // For now, we'll use environment variable as fallback
  
  const envToken =
    process.env.SHOPIFY_ADMIN_API_TOKEN ||
    process.env.SHOPIFY_ACCESS_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;

  if (envToken) return envToken;

  throw new Error('No Admin API token available for this shop');
}

// GraphQL query function
async function shopGraphQL(shop, query, variables = {}) {
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
    const error = new Error(`GraphQL error: ${JSON.stringify(json.errors || json)}`);
    error.status = response.status || 500;
    throw error;
  }

  return json.data;
}

// Load plan data for shop
async function fetchPlan(shop) {
  // Check if we have MongoDB and Subscription model
  if (mongoose.connection.readyState === 1) {
    try {
      const Subscription = mongoose.models.Subscription || await import('../models/Subscription.js').then(m => m.default);
      const sub = await Subscription.findOne({ shop }).lean();
      
      if (sub) {
        return {
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
  
  // Default plan if no subscription found
  return {
    plan: 'Starter',
    queryLimit: 10,
    queryCount: 0,
    productLimit: 50
  };
}

// ---- Routes ----

// Get current store metadata
router.get('/generate', async (req, res) => {
  try {
    const shop = getShopFromReq(req);
    if (!shop) return res.status(400).json({ error: 'Shop not specified' });

    // Check plan access
    const plan = await fetchPlan(shop);
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
    
    const shopData = await shopGraphQL(shop, shopQuery);
    const shopInfo = shopData?.shop;
    
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

    const metafieldsData = await shopGraphQL(shop, metafieldsQuery);
    const metafields = {};
    
    metafieldsData?.shop?.metafields?.edges?.forEach(edge => {
      const node = edge.node;
      metafields[node.key] = {
        id: node.id,
        value: node.type === 'json' ? JSON.parse(node.value) : node.value
      };
    });

    res.json({
      shop,
      shopId: shopInfo.id,
      shopInfo: {
        name: shopInfo.name,
        description: shopInfo.description,
        url: shopInfo.primaryDomain?.url || shopInfo.url,
        email: shopInfo.contactEmail || shopInfo.email
      },
      existingMetadata: metafields,
      plan: plan.plan,
      features: {
        organizationSchema: ['Professional', 'Growth', 'Growth Extra', 'Enterprise'].includes(plan.plan),
        localBusinessSchema: plan.plan === 'Enterprise'
      }
    });
  } catch (error) {
    console.error('Error loading store metadata:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Generate AI metadata (mock for now)
router.post('/ai-generate', async (req, res) => {
  try {
    const shop = getShopFromReq(req);
    if (!shop) return res.status(400).json({ error: 'Shop not specified' });

    const { shopInfo, businessType, targetAudience } = req.body;

    // Check plan
    const plan = await fetchPlan(shop);
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
    if (['Professional', 'Growth', 'Growth Extra', 'Enterprise'].includes(plan.plan)) {
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
router.post('/apply', async (req, res) => {
  try {
    const shop = getShopFromReq(req);
    if (!shop) return res.status(400).json({ error: 'Shop not specified' });

    const { metadata, options = {} } = req.body;
    if (!metadata) return res.status(400).json({ error: 'No metadata provided' });

    // Get shop ID
    const shopQuery = `{
      shop {
        id
      }
    }`;
    
    const shopData = await shopGraphQL(shop, shopQuery);
    const shopId = shopData?.shop?.id;
    
    if (!shopId) return res.status(404).json({ error: 'Shop not found' });

    const metafieldsToSet = [];

    // SEO metadata
    if (metadata.seo && options.updateSeo !== false) {
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'seo_metadata',
        type: 'json',
        value: JSON.stringify(metadata.seo)
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

    // Organization schema
    if (metadata.organizationSchema && options.updateOrganization !== false) {
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'organization_schema',
        type: 'json',
        value: JSON.stringify(metadata.organizationSchema)
      });
    }

    // Local business schema (Enterprise only)
    if (metadata.localBusinessSchema && options.updateLocalBusiness !== false) {
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: 'ai_seo_store',
        key: 'local_business_schema',
        type: 'json',
        value: JSON.stringify(metadata.localBusinessSchema)
      });
    }

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
    const result = await shopGraphQL(shop, mutation, variables);

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
    console.error('Error applying metadata:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Public endpoint for AI crawlers
router.get('/public/:shop', async (req, res) => {
  try {
    const shop = normalizeShop(req.params.shop);
    if (!shop) return res.status(400).json({ error: 'Invalid shop' });
    
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

    const data = await shopGraphQL(shop, query);
    const shopData = data?.shop;
    
    if (!shopData) {
      return res.status(404).json({ error: 'Shop not found' });
    }

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
      
      // Include local business if available
      ...(metadata.local_business_schema?.enabled && {
        location: {
          "@type": "LocalBusiness",
          ...metadata.local_business_schema
        }
      })
    };

    res.json(aiResponse);
  } catch (error) {
    console.error('Error fetching public metadata:', error);
    res.status(500).json({ error: 'Failed to fetch metadata' });
  }
});

export default router;