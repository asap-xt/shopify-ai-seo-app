// backend/controllers/schemaController.js
import express from 'express';
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
router.get('/api/schema/preview', async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ ok: false, error: 'Missing shop parameter' });
    }

    // Check if we have access token
    const hasToken = await resolveAccessToken(shop);
    if (!hasToken) {
      return res.status(401).json({ 
        ok: false, 
        error: 'Access token not configured. Please ensure SHOPIFY_ADMIN_API_ACCESS_TOKEN is set in your environment or shop is authenticated.' 
      });
    }

    // Fetch store metadata
    const storeMetaQuery = `
      query {
        shop {
          name
          description
          email
          primaryDomain { url }
          brand {
            logo { image { url } }
            socialMediaProfiles {
              instagram { url }
              facebook { url }
              twitter { url }
              youtube { url }
            }
          }
          metafield(namespace: "seo_ai", key: "store_metadata") { value }
        }
      }
    `;

    const shopInfo = await shopGraphQL(shop, storeMetaQuery);
    const localeInfo = await getShopLocale(shop);

    // Parse store metadata if exists
    let storeMetadata = {};
    if (shopInfo?.shop?.metafield?.value) {
      try {
        storeMetadata = JSON.parse(shopInfo.shop.metafield.value);
      } catch (e) {
        console.error('Failed to parse store metadata:', e);
      }
    }

    // Generate Organization schema
    const organizationSchema = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: storeMetadata.businessName || shopInfo?.shop?.name || shop,
      url: localeInfo.url,
      ...(shopInfo?.shop?.brand?.logo?.image?.url && { logo: shopInfo.shop.brand.logo.image.url }),
      ...(storeMetadata.description && { description: storeMetadata.description }),
      ...(shopInfo?.shop?.email && { email: shopInfo.shop.email }),
      contactPoint: {
        '@type': 'ContactPoint',
        telephone: storeMetadata.phone || '',
        contactType: 'customer service',
        ...(localeInfo.languages.length > 1 && {
          availableLanguage: localeInfo.languages.map(l => ({
            '@type': 'Language',
            name: l.name,
            alternateName: l.isoCode
          }))
        })
      },
      sameAs: [
        storeMetadata.facebook,
        storeMetadata.instagram,
        storeMetadata.twitter,
        storeMetadata.youtube,
        shopInfo?.shop?.brand?.socialMediaProfiles?.facebook?.url,
        shopInfo?.shop?.brand?.socialMediaProfiles?.instagram?.url,
        shopInfo?.shop?.brand?.socialMediaProfiles?.twitter?.url,
        shopInfo?.shop?.brand?.socialMediaProfiles?.youtube?.url
      ].filter(Boolean),
      ...(storeMetadata.address && {
        address: {
          '@type': 'PostalAddress',
          streetAddress: storeMetadata.address,
          addressLocality: storeMetadata.city,
          postalCode: storeMetadata.postalCode,
          addressCountry: storeMetadata.country
        }
      })
    };

    // Generate WebSite schema
    const websiteSchema = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: storeMetadata.businessName || shopInfo?.shop?.name || shop,
      url: localeInfo.url,
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
router.post('/api/schema/generate', async (req, res) => {
  try {
    const shop = normalizeShop(req.body.shop);
    if (!shop) {
      return res.status(400).json({ ok: false, error: 'Missing shop parameter' });
    }

    // This endpoint would trigger a refresh of all schema data
    // For now, it just returns success since schemas are generated dynamically
    res.json({ ok: true, message: 'Schemas will be regenerated on next page load' });

  } catch (error) {
    console.error('Schema generate error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/schema/validate - Check schema installation
router.get('/api/schema/validate', async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({ ok: false, error: 'Missing shop parameter' });
    }
    
    // Check various aspects of the installation
    const checks = {
      hasStoreMetadata: false,
      hasProductsWithSEO: false,
      hasThemeInstallation: false,
      hasValidSchemas: false
    };

    // Check store metadata
    const metaQuery = `
      query {
        shop {
          metafield(namespace: "seo_ai", key: "store_metadata") { value }
        }
        products(first: 10, query: "metafields.seo_ai.bullets:*") {
          edges { node { id } }
        }
      }
    `;

    const data = await shopGraphQL(shop, metaQuery);
    
    checks.hasStoreMetadata = !!data?.shop?.metafield?.value;
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