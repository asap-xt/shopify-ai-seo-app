// backend/controllers/schemaController.js
import express from 'express';
import { validateRequest } from '../middleware/shopifyAuth.js';
import { verifyRequest } from '../middleware/verifyRequest.js';
import fetch from 'node-fetch';

const router = express.Router();

// Helper to normalize shop domain
function normalizeShop(shop) {
  if (!shop) return '';
  const s = String(shop).trim().toLowerCase();
  if (!/\.myshopify\.com$/i.test(s)) return `${s}.myshopify.com`;
  return s;
}

// Resolve access token - same pattern as seoController.js
async function resolveAccessToken(shop) {
  // First try to get from database (if you have MongoDB)
  try {
    const Shop = (await import('../models/Shop.js')).default;
    const shopDoc = await Shop.findOne({ shop });
    if (shopDoc?.accessToken) return shopDoc.accessToken;
  } catch (err) {
    // No DB available, continue to env fallback
    console.log('Shop model not available, using env token');
  }
  
  // Check both possible env variable names (like in seoController.js)
  const token = 
    (process.env.SHOPIFY_ADMIN_API_TOKEN && process.env.SHOPIFY_ADMIN_API_TOKEN.trim()) ||
    (process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN && process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN.trim());
    
  return token || null;
}

// Admin GraphQL helper
async function shopGraphQL(shop, query, variables = {}) {
  const accessToken = await resolveAccessToken(shop);
  if (!accessToken) throw new Error('No access token available');
  
  const url = `https://${shop}/admin/api/2025-07/graphql.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  
  const data = await response.json();
  if (data.errors) throw new Error(data.errors[0]?.message || 'GraphQL error');
  return data.data;
}

// Helper to get shop's primary locale
async function getShopLocale(shop) {
  try {
    const query = `
      query {
        shop {
          primaryDomain { url }
          currencyCode
          ianaTimezone
        }
        localization {
          availableLanguages { isoCode name }
          primaryLanguage { isoCode name }
        }
      }
    `;
    
    const data = await shopGraphQL(shop, query);
    return {
      url: data?.shop?.primaryDomain?.url || `https://${shop}`,
      currency: data?.shop?.currencyCode || 'USD',
      language: data?.localization?.primaryLanguage?.isoCode || 'en',
      languages: data?.localization?.availableLanguages || []
    };
  } catch (err) {
    console.error('Failed to get shop locale:', err);
    return {
      url: `https://${shop}`,
      currency: 'USD',
      language: 'en',
      languages: []
    };
  }
}

// GET /api/schema/preview - Get all active schemas
router.get('/api/schema/preview', verifyRequest, async (req, res) => {
  console.log('[SCHEMA/HANDLER]', req.method, req.originalUrl, {
    queryShop: req.query?.shop,
    bodyShop: req.body?.shop,
    sessionShop: res.locals?.shopify?.session?.shop,
  });

  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[SCHEMA/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  // Тук логни и от къде четеш Admin API токена:
  const tokenSource = 'db|kv|session'; // актуализирай според твоя сторидж
  console.log('[SCHEMA/HANDLER] Resolving Admin token', { shop, tokenSource });

  try {
    const shop = req.shopDomain;

    // Check if we have access token
    const hasToken = await resolveAccessToken(shop);
    if (!hasToken) {
      return res.status(401).json({ 
        ok: false, 
        error: 'Access token not configured. Please ensure SHOPIFY_ADMIN_API_TOKEN is set in your environment or shop is authenticated.' 
      });
    }

    // Fetch store metadata - UPDATED to use correct namespace and key
    const storeMetaQuery = `
      query {
        shop {
          name
          description
          email
          primaryDomain { url }
          organizationMetafield: metafield(namespace: "ai_seo_store", key: "organization_schema") { value }
          seoMetafield: metafield(namespace: "ai_seo_store", key: "seo_metadata") { value }
          aiMetafield: metafield(namespace: "ai_seo_store", key: "ai_metadata") { value }
        }
      }
    `;

    const shopInfo = await shopGraphQL(shop, storeMetaQuery);
    const localeInfo = await getShopLocale(shop);

    // Parse organization metadata if exists
    let organizationData = {};
    if (shopInfo?.shop?.organizationMetafield?.value) {
      try {
        organizationData = JSON.parse(shopInfo.shop.organizationMetafield.value);
        console.log('Parsed organization data:', organizationData); // DEBUG
      } catch (e) {
        console.error('Failed to parse organization metadata:', e);
      }
    }

    // Parse SEO metadata if exists
    let seoData = {};
    if (shopInfo?.shop?.seoMetafield?.value) {
      try {
        seoData = JSON.parse(shopInfo.shop.seoMetafield.value);
      } catch (e) {
        console.error('Failed to parse SEO metadata:', e);
      }
    }

    // Generate Organization schema - UPDATED to use organizationData structure
    const organizationSchema = organizationData.enabled ? {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: organizationData.name || shopInfo?.shop?.name || shop,
      url: localeInfo.url,
      ...(organizationData.logo && { logo: organizationData.logo }),
      ...(seoData.description && { description: seoData.description }),
      ...(organizationData.email && { email: organizationData.email }),
      ...(organizationData.phone && {
        contactPoint: {
          '@type': 'ContactPoint',
          telephone: organizationData.phone,
          contactType: 'customer service',
          ...(localeInfo.languages.length > 1 && {
            availableLanguage: localeInfo.languages.map(l => ({
              '@type': 'Language',
              name: l.name,
              alternateName: l.isoCode
            }))
          })
        }
      }),
      // Parse sameAs from comma-separated string to array
      ...(organizationData.sameAs && {
        sameAs: organizationData.sameAs.split(',').map(url => url.trim()).filter(Boolean)
      })
    } : null;

    // Generate WebSite schema
    const websiteSchema = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: organizationData.name || shopInfo?.shop?.name || shop,
      url: localeInfo.url,
      ...(seoData.description && { description: seoData.description }),
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${localeInfo.url}/search?q={search_term_string}`
        },
        'query-input': 'required name=search_term_string'
      },
      ...(localeInfo.languages.length > 1 && {
        inLanguage: localeInfo.languages.map(l => l.isoCode)
      })
    };

    // Count products with SEO data
    const productCountQuery = `
      query {
        products(first: 250, query: "metafields.seo_ai.bullets:*") {
          edges {
            node {
              id
              title
            }
          }
        }
      }
    `;

    const productData = await shopGraphQL(shop, productCountQuery);
    const products = productData?.products?.edges || [];

    res.json({
      ok: true,
      schemas: {
        organization: organizationSchema,
        website: websiteSchema,
        products: products.map(p => ({ id: p.node.id, title: p.node.title }))
      }
    });

  } catch (error) {
    console.error('Schema preview error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/schema/generate - Regenerate schemas from latest data
router.post('/api/schema/generate', verifyRequest, async (req, res) => {
  console.log('[SCHEMA/HANDLER]', req.method, req.originalUrl, {
    queryShop: req.query?.shop,
    bodyShop: req.body?.shop,
    sessionShop: res.locals?.shopify?.session?.shop,
  });

  const shop =
    req.query?.shop ||
    req.body?.shop ||
    res.locals?.shopify?.session?.shop;

  if (!shop) {
    console.error('[SCHEMA/HANDLER] No shop resolved — cannot load Admin API token');
    return res.status(400).json({ error: 'Shop not provided' });
  }

  // Тук логни и от къде четеш Admin API токена:
  const tokenSource = 'db|kv|session'; // актуализирай според твоя сторидж
  console.log('[SCHEMA/HANDLER] Resolving Admin token', { shop, tokenSource });

  try {
    const shop = req.shopDomain;

    // This endpoint would trigger a refresh of all schema data
    // For now, it just returns success since schemas are generated dynamically
    res.json({ ok: true, message: 'Schemas will be regenerated on next page load' });

  } catch (error) {
    console.error('Schema generate error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/schema/status
router.get('/status', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;

    // Get existing metafields to check what's configured
    const metafieldsQuery = `{
      shop {
        metafields(namespace: "ai_seo_store", first: 10) {
          edges {
            node {
              key
              value
            }
          }
        }
      }
      products(first: 250, query: "metafield_namespace:seo_ai") {
        pageInfo {
          hasNextPage
        }
        edges {
          node {
            id
          }
        }
      }
    }`;

    const data = await shopGraphQL(shop, metafieldsQuery);
    
    // Check which schemas are configured
    const schemas = {
      organization: false,
      localBusiness: false,
      breadcrumb: false,
      collections: false
    };
    
    // Parse metafields
    data?.shop?.metafields?.edges?.forEach(edge => {
      const node = edge.node;
      if (node.key === 'organization_schema') {
        const value = JSON.parse(node.value);
        schemas.organization = value?.enabled || false;
      }
      if (node.key === 'local_business_schema') {
        const value = JSON.parse(node.value);
        schemas.localBusiness = value?.enabled || false;
      }
      // Add more schema checks as needed
    });
    
    // Count products with SEO
    const productsWithSchema = data?.products?.edges?.length || 0;
    
    res.json({
      schemas,
      stats: {
        productsWithSchema,
        totalSchemas: Object.values(schemas).filter(v => v).length,
        lastUpdated: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error getting schema status:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/schema/validate - Check schema installation
router.get('/api/schema/validate', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // Check various aspects of the installation
    const checks = {
      hasStoreMetadata: false,
      hasProductsWithSEO: false,
      hasThemeInstallation: false,
      hasValidSchemas: false
    };

    // Check store metadata - UPDATED to check organization_schema
    const metaQuery = `
      query {
        shop {
          organizationMetafield: metafield(namespace: "ai_seo_store", key: "organization_schema") { value }
          seoMetafield: metafield(namespace: "ai_seo_store", key: "seo_metadata") { value }
        }
        products(first: 10, query: "metafields.seo_ai.bullets:*") {
          edges { node { id } }
        }
      }
    `;

    const data = await shopGraphQL(shop, metaQuery);
    
    // Check if organization schema exists and is enabled
    let hasOrgSchema = false;
    if (data?.shop?.organizationMetafield?.value) {
      try {
        const orgData = JSON.parse(data.shop.organizationMetafield.value);
        hasOrgSchema = orgData.enabled === true;
      } catch (e) {
        console.error('Failed to parse org schema:', e);
      }
    }
    
    checks.hasStoreMetadata = hasOrgSchema || !!data?.shop?.seoMetafield?.value;
    checks.hasProductsWithSEO = (data?.products?.edges?.length || 0) > 0;
    
    // Note: We can't directly check theme files, but we can provide guidance
    checks.hasThemeInstallation = 'manual_check_required';
    checks.hasValidSchemas = checks.hasStoreMetadata || checks.hasProductsWithSEO;

    res.json({
      ok: checks.hasValidSchemas,
      checks,
      message: checks.hasValidSchemas 
        ? 'Schema data is configured correctly' 
        : 'Some schema configurations are missing'
    });

  } catch (error) {
    console.error('Schema validate error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;