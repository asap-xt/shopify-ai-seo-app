// backend/controllers/schemaController.js
import express from 'express';

const router = express.Router();

// Helper to normalize shop domain
function normalizeShop(shop) {
  if (!shop) return '';
  const s = String(shop).trim().toLowerCase();
  if (!/\.myshopify\.com$/i.test(s)) return `${s}.myshopify.com`;
  return s;
}

// Helper to get shop's primary locale
async function getShopLocale(shop, accessToken) {
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
    
    const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    });
    
    const data = await response.json();
    return {
      url: data.data?.shop?.primaryDomain?.url || `https://${shop}`,
      currency: data.data?.shop?.currencyCode || 'USD',
      language: data.data?.localization?.primaryLanguage?.isoCode || 'en',
      languages: data.data?.localization?.availableLanguages || []
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

    // Get access token (you'll need to implement this based on your auth)
    const accessToken = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
    if (!accessToken) {
      return res.status(401).json({ ok: false, error: 'Access token not configured' });
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

    const storeResponse = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: storeMetaQuery })
    });

    const storeData = await storeResponse.json();
    const shopInfo = storeData.data?.shop;
    const localeInfo = await getShopLocale(shop, accessToken);

    // Parse store metadata if exists
    let storeMetadata = {};
    if (shopInfo?.metafield?.value) {
      try {
        storeMetadata = JSON.parse(shopInfo.metafield.value);
      } catch (e) {
        console.error('Failed to parse store metadata:', e);
      }
    }

    // Generate Organization schema
    const organizationSchema = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: storeMetadata.businessName || shopInfo?.name || shop,
      url: localeInfo.url,
      ...(shopInfo?.brand?.logo?.image?.url && { logo: shopInfo.brand.logo.image.url }),
      ...(storeMetadata.description && { description: storeMetadata.description }),
      ...(shopInfo?.email && { email: shopInfo.email }),
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
        shopInfo?.brand?.socialMediaProfiles?.facebook?.url,
        shopInfo?.brand?.socialMediaProfiles?.instagram?.url,
        shopInfo?.brand?.socialMediaProfiles?.twitter?.url,
        shopInfo?.brand?.socialMediaProfiles?.youtube?.url
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
      name: storeMetadata.businessName || shopInfo?.name || shop,
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

    const productResponse = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: productCountQuery })
    });

    const productData = await productResponse.json();
    const products = productData.data?.products?.edges || [];

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

    const accessToken = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
    
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

    const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: metaQuery })
    });

    const data = await response.json();
    
    checks.hasStoreMetadata = !!data.data?.shop?.metafield?.value;
    checks.hasProductsWithSEO = (data.data?.products?.edges?.length || 0) > 0;
    
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