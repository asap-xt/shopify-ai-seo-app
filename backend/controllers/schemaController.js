// backend/controllers/schemaController.js
import express from 'express';
import { validateRequest } from '../middleware/shopifyAuth.js';
import fetch from 'node-fetch';

const router = express.Router();

// Helper to normalize shop domain
function normalizeShop(shop) {
  if (!shop) return '';
  const s = String(shop).trim().toLowerCase();
  if (!/\.myshopify\.com$/i.test(s)) return `${s}.myshopify.com`;
  return s;
}

// Legacy access token resolver - DEPRECATED, use res.locals.adminGraphql instead

// Legacy Admin GraphQL helper - DEPRECATED, use res.locals.adminGraphql instead

// Helper to get shop's primary locale
async function getShopLocale(adminGraphql, shop) {
  try {
    const query = `
      query {
        shop {
          primaryDomain { url }
          currencyCode
          ianaTimezone
        }
        shopLocales {
          locale
          primary
          published
        }
      }
    `;
    
    const resp = await adminGraphql.request(query);
    const data = resp?.data;
    const shopLocales = data?.shopLocales || [];
    const primaryLocale = shopLocales.find(l => l.primary) || shopLocales[0];
    
    return {
      url: data?.shop?.primaryDomain?.url || `https://${shop}`,
      currency: data?.shop?.currencyCode || 'USD',
      language: primaryLocale?.locale || 'en',
      languages: shopLocales.filter(l => l.published).map(l => ({
        isoCode: l.locale,
        name: l.locale.toUpperCase()
      }))
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
router.get('/api/schema/preview', validateRequest(), async (req, res) => {
  const { adminGraphql, shop } = res.locals;
  if (!adminGraphql) return res.status(401).json({ error: 'No admin session. Reinstall app.' });
  
  try {

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

    const resp = await adminGraphql.request(storeMetaQuery);
    
    // Shopify SDK returns { data: {...} } directly, not wrapped in body
    const shopInfo = resp?.data;
    const localeInfo = await getShopLocale(adminGraphql, shop);

    // Parse organization metadata if exists
    let organizationData = {};
    if (shopInfo?.shop?.organizationMetafield?.value) {
      try {
        organizationData = JSON.parse(shopInfo.shop.organizationMetafield.value);
      } catch (e) {
        console.error('[SCHEMA-PREVIEW] Failed to parse organization metadata:', e);
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

    const productResp = await adminGraphql.request(productCountQuery);
    const productData = productResp?.body?.data;
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
router.post('/api/schema/generate', validateRequest(), async (req, res) => {
  const { adminGraphql, shop } = res.locals;
  if (!adminGraphql) return res.status(401).json({ error: 'No admin session. Reinstall app.' });
  
  try {
    // Force refresh by clearing any potential cache and triggering regeneration
    // Since schemas are generated dynamically from metafields, we just need to ensure fresh data
    
    // Check current metafields to verify data exists
    const metaQuery = `{
      shop {
        metafields(namespace: "ai_seo_store", first: 10) {
          edges {
            node {
              key
              value
              namespace
            }
          }
        }
      }
    }`;
    
    const resp = await adminGraphql.request(metaQuery);
    const metafields = resp?.data?.shop?.metafields?.edges || [];
    
    res.json({ 
      ok: true, 
      shop, 
      message: 'Schemas regenerated successfully',
      metafieldsFound: metafields.length
    });
  } catch (error) {
    console.error('[schema/generate] adminGraphql error', error);
    res.status(500).json({ error: 'Schema generation failed' });
  }
});

// GET /api/schema/status
router.get('/status', validateRequest(), async (req, res) => {
  const { adminGraphql, shop } = res.locals;
  if (!adminGraphql) return res.status(401).json({ error: 'No admin session. Reinstall app.' });
  
  try {
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

    const resp = await adminGraphql.request(metafieldsQuery);
    const data = resp?.data;
    
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
      ok: true,
      shop,
      schemas,
      stats: {
        productsWithSchema,
        totalSchemas: Object.values(schemas).filter(v => v).length,
        lastUpdated: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('[schema/status] adminGraphql error', error);
    res.status(500).json({ error: 'Failed to load schema status' });
  }
});

// GET /api/schema/validate - Check schema installation
router.get('/api/schema/validate', validateRequest(), async (req, res) => {
  const { adminGraphql, shop } = res.locals;
  if (!adminGraphql) return res.status(401).json({ error: 'No admin session. Reinstall app.' });
  
  try {
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

    const resp = await adminGraphql.request(metaQuery);
    const data = resp?.data;
    
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