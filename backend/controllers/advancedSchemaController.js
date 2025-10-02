// backend/controllers/advancedSchemaController.js
import express from 'express';
import { requireShop } from './seoController.js';
import { executeShopifyGraphQL } from '../utils/tokenResolver.js';
import Subscription from '../db/Subscription.js';
import Product from '../db/Product.js';
import AdvancedSchema from '../db/AdvancedSchema.js';
import Shop from '../db/Shop.js'; // За access token
import fetch from 'node-fetch';
import { validateAIResponse } from '../utils/aiValidator.js';
import { extractFactualAttributes } from '../utils/factualExtractor.js';

const router = express.Router();

// Constants
const AI_MODEL = 'google/gemini-2.5-flash-lite'; // Важно: flash-lite, не flash
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Global state tracking for schema generation
const generationStatus = new Map(); // shop -> { generating: boolean, progress: string, currentProduct: string }

// Helper function to get access token
async function getAccessToken(shop) {
  const shopRecord = await Shop.findOne({ shop });
  return shopRecord?.accessToken;
}

// Helper function to sync products from Shopify to MongoDB
// This function fetches all products and detects AI SEO metafields to mark them as optimized
// Added debug logging to troubleshoot metafields detection - force deploy
async function syncProductsToMongoDB(shop) {
  console.log(`[SYNC] Starting product sync for ${shop}...`);
  
  try {
    // GraphQL query to fetch all products
    const query = `
      query GetProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges {
            node {
              id
              handle
              title
              descriptionHtml
              productType
              vendor
              tags
              status
              createdAt
              updatedAt
              variants(first: 50) {
                edges {
                  node {
                    id
                    title
                    price
                    compareAtPrice
                    sku
                    inventoryQuantity
                    availableForSale
                  }
                }
              }
              images(first: 10) {
                edges {
                  node {
                    id
                    url
                    altText
                  }
                }
              }
              seo {
                title
                description
              }
              metafields(first: 100, namespace: "seo_ai") {
                edges {
                  node {
                    namespace
                    key
                    value
                  }
                }
              }
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const allProducts = [];
    let hasNextPage = true;
    let cursor = null;
    
    // Fetch all products using pagination
    while (hasNextPage) {
      const variables = { first: 50 };
      if (cursor) {
        variables.after = cursor;
      }
      
      const data = await executeShopifyGraphQL(shop, query, variables);
      const productsData = data?.products;
      
      if (!productsData) break;
      
      const edges = productsData.edges || [];
      console.log(`[SYNC] Fetched ${edges.length} products for ${shop}`);
      
      allProducts.push(...edges.map(edge => edge.node));
      
      hasNextPage = productsData.pageInfo?.hasNextPage || false;
      cursor = productsData.pageInfo?.endCursor || null;
      
      if (edges.length === 0) break;
    }

    console.log(`[SYNC] Total products fetched for ${shop}: ${allProducts.length}`);

    // Save products to MongoDB
    let syncedCount = 0;
    for (const product of allProducts) {
      const numericId = product.id.replace('gid://shopify/Product/', '');
      
      // Check if product has AI SEO metafields (indicating it's been optimized)
      const metafields = product.metafields?.edges || [];
      console.log(`[SYNC] Product ${product.title} - metafields count: ${metafields.length}`);
      
      if (metafields.length > 0) {
        console.log(`[SYNC] Product ${product.title} - metafields:`, metafields.map(mf => ({
          namespace: mf.node.namespace,
          key: mf.node.key,
          value: mf.node.value?.substring(0, 50) + '...'
        })));
      }
      
      const hasSeoMetafields = metafields.some(edge => 
        edge.node.namespace === 'seo_ai' && 
        edge.node.key.startsWith('seo__')
      ) || false;
      
      console.log(`[SYNC] Product ${product.title} has SEO metafields: ${hasSeoMetafields}`);
      
      // Check if product already exists
      const existingProduct = await Product.findOne({ 
        shop, 
        shopifyProductId: numericId 
      });
      
      if (existingProduct) {
        // Update existing product
        await Product.findOneAndUpdate(
          { shop, shopifyProductId: numericId },
          {
            $set: {
              title: product.title,
              description: product.descriptionHtml,
              productType: product.productType,
              vendor: product.vendor,
              tags: product.tags,
              status: product.status,
              handle: product.handle,
              createdAt: new Date(product.createdAt),
              updatedAt: new Date(product.updatedAt),
              // Update seoStatus based on metafields
              seoStatus: {
                optimized: hasSeoMetafields,
                languages: hasSeoMetafields ? [{ code: 'en', optimized: true, hasSeo: true }] : [],
                lastCheckedAt: new Date()
              }
            }
          },
          { upsert: true }
        );
      } else {
        // Create new product
        await Product.create({
          shop,
          shopifyProductId: numericId,
          productId: numericId,
          title: product.title,
          description: product.descriptionHtml,
          productType: product.productType,
          vendor: product.vendor,
          tags: product.tags,
          status: product.status,
          handle: product.handle,
          createdAt: new Date(product.createdAt),
          updatedAt: new Date(product.updatedAt),
          seoStatus: {
            optimized: hasSeoMetafields,
            languages: hasSeoMetafields ? [{ code: 'en', optimized: true, hasSeo: true }] : [],
            lastCheckedAt: new Date()
          },
          available: product.variants?.edges?.some(v => v.node.availableForSale) || false
        });
      }
      syncedCount++;
    }

    console.log(`[SYNC] Successfully synced ${syncedCount} products to MongoDB for ${shop}`);
    return { success: true, syncedCount, totalProducts: allProducts.length };
    
  } catch (error) {
    console.error(`[SYNC] Error syncing products for ${shop}:`, error);
    throw error;
  }
}

// FAQ Fallbacks за липсваща информация
const FAQ_FALLBACKS = {
  return_policy: "For detailed information about our return and refund policy, please visit our returns page or contact customer support.",
  shipping: "Shipping times vary by location and product. Please check the shipping information at checkout or contact us for specific details.",
  languages: "Our store supports multiple languages. Use the language selector to switch between available options.",
  payment: "We accept various payment methods. The available options will be displayed at checkout.",
  wholesale: "For wholesale or bulk pricing inquiries, please contact our sales team directly.",
  support: "You can reach our customer support team through the contact form on our website or via email.",
  authenticity: "We guarantee the authenticity of all our products. For specific certifications or details, please contact us.",
  privacy: "Our privacy policy details how we collect, use, and protect your personal information. You can find it linked in our website footer."
};

// Helper за OpenRouter API calls
async function generateWithAI(prompt, systemPrompt) {
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter error: ${error}`);
    }
    
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    console.error('[SCHEMA] AI generation error:', error);
    throw error;
  }
}

// Sanitize AI response by replacing suspicious patterns with safer alternatives
function sanitizeAIResponse(response, knownFacts) {
  // Проверяваме за често срещани "hallucinations"
  const suspiciousPatterns = [
    { pattern: /\d+\s*day[s]?\s*(money\s*back|return)/i, replacement: 'our return policy' },
    { pattern: /free\s*shipping\s*(over|on orders above)\s*\$?\d+/i, replacement: 'shipping terms (see checkout for details)' },
    { pattern: /24\/7\s*(customer\s*)?support/i, replacement: 'customer support during business hours' },
    { pattern: /\d+\s*year[s]?\s*warranty/i, replacement: 'product warranty (terms vary by product)' },
    { pattern: /\d+%\s*discount/i, replacement: 'special offers when available' }
  ];
  
  let validated = response;
  
  for (const { pattern, replacement } of suspiciousPatterns) {
    if (pattern.test(response)) {
      console.log(`[SCHEMA] Replacing suspicious pattern: ${pattern}`);
      validated = validated.replace(pattern, replacement);
    }
  }
  
  return validated;
}

// Load rich attributes settings
async function loadRichAttributesSettings(shop) {
  try {
    // Try to get settings from AI Discovery settings
    const response = await fetch(`${process.env.SHOPIFY_APP_URL || 'https://shopify-ai-seo-app.railway.app'}/api/ai-discovery/settings?shop=${shop}`);
    if (response.ok) {
      const data = await response.json();
      return data.richAttributes || {};
    }
  } catch (error) {
    console.log('[SCHEMA] Could not load rich attributes settings:', error.message);
  }
  
  // Default settings if not found
  return {
    material: false,
    color: false,
    size: false,
    weight: false,
    dimensions: false,
    category: false,
    audience: false
  };
}

// Load shop context
async function loadShopContext(shop) {
  const contextQuery = `
    query {
      shop {
        id
        name
        description
        contactEmail
        currencyCode
        primaryDomain {
          url
        }
        paymentSettings {
          supportedDigitalWallets
        }
      }
    }
  `;
  
  try {
    const data = await executeShopifyGraphQL(shop, contextQuery);
    return {
      shop: data.shop
    };
  } catch (error) {
    console.error('[SCHEMA] Failed to load shop context:', error);
    return null;
  }
}

// Generate site-wide FAQ
async function generateSiteFAQ(shop, shopContext) {
  const shopUrl = shopContext.shop.primaryDomain?.url || `https://${shop}`;
  // ВРЕМЕННО - използваме fallback за languages
  const languages = ['en']; // Default to English
  const primaryLanguage = 'en';
  
  const fixedQuestions = [
    "What is your return and refund policy?",
    "How long does shipping typically take?", 
    "Do you offer international shipping?",
    "What payment methods do you accept?",
    "How can I track my order?",
    "Do you offer bulk or wholesale pricing?",
    "How do I contact customer support?",
    "What languages is your store available in?",
    "Are your products authentic/genuine?",
    "What is your privacy policy?"
  ];
  
  const systemPrompt = `You are generating FAQ answers for a real e-commerce store.
CRITICAL RULES:
- Base answers ONLY on provided information
- If information is missing, use the provided fallback text
- Do NOT make up specific policies, prices, timeframes, or percentages
- Be helpful but truthful
- Include the actual store URL when relevant
- For languages question, use EXACTLY the provided language list
Output JSON with structure: { "faqs": [{"q": "question", "a": "answer"}] }`;
  
  const prompt = `Generate FAQ answers for this REAL store:
Store Name: ${shopContext.shop.name}
Store URL: ${shopUrl}
Available Languages: ${languages.join(', ')} (Primary: ${primaryLanguage})
Currency: ${shopContext.shop.currencyCode}
${shopContext.shop.description ? `Description: ${shopContext.shop.description}` : ''}
${shopContext.shop.contactEmail ? `Contact Email: ${shopContext.shop.contactEmail}` : ''}
Refund Policy URL: ${shopUrl}/policies/refund-policy
Shipping Policy URL: ${shopUrl}/policies/shipping-policy
Privacy Policy URL: ${shopUrl}/policies/privacy-policy

Payment Methods: Various payment methods
Digital Wallets: ${shopContext.shop.paymentSettings?.supportedDigitalWallets?.join(', ') || 'Multiple options'}

Questions: ${JSON.stringify(fixedQuestions)}

IMPORTANT: For the languages question, respond with: "Our store is available in ${languages.length} language${languages.length > 1 ? 's' : ''}: ${languages.join(', ')}. You can switch languages using the language selector on our website."

Use these fallbacks when specific information is missing:
${JSON.stringify(FAQ_FALLBACKS, null, 2)}`;
  
  try {
    const result = await generateWithAI(prompt, systemPrompt);
    
    // Validate AI response to prevent hallucinations
    const validatedResponse = validateAIResponse(
      { faq: result.faqs }, 
      {
        shopName: shopContext.shop.name,
        shopUrl: shopUrl,
        languages: languages,
        currency: shopContext.shop.currencyCode,
        description: shopContext.shop.description
      }, 
      ['faq']
    );
    
    // Validate and fix language answer
    const validated = (validatedResponse.faq || result.faqs).map(faq => {
      if (faq.q.toLowerCase().includes('languages')) {
        faq.a = `Our store is available in ${languages.length} language${languages.length > 1 ? 's' : ''}: ${languages.join(', ')}. You can switch languages using the language selector on our website.`;
      } else {
        // Sanitize FAQ answer to replace suspicious patterns
        faq.a = sanitizeAIResponse(faq.a, { shopUrl, languages });
      }
      return faq;
    });
    
    // Create FAQ schema
    const faqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": validated.map(item => ({
        "@type": "Question",
        "name": item.q,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": item.a
        }
      }))
    };
    
    // Save as shop metafield
    const mutation = `
      mutation SetFAQ($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
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
        ownerId: shopContext.shop.id,
        namespace: "advanced_schema",
        key: "site_faq",
        type: "json",
        value: JSON.stringify(faqSchema)
      }]
    };
    
    const saveResult = await executeShopifyGraphQL(shop, mutation, variables);
    
    if (saveResult.metafieldsSet?.userErrors?.length > 0) {
      console.error('[SCHEMA] Failed to save FAQ:', saveResult.metafieldsSet.userErrors);
    }
    
    return faqSchema;
    
  } catch (error) {
    console.error('[SCHEMA] FAQ generation failed:', error);
    throw error;
  }
}

// Generate product schemas
async function generateProductSchemas(shop, productDoc) {
  console.log(`[SCHEMA] generateProductSchemas called for product ${productDoc.productId}`);
  const productGid = `gid://shopify/Product/${productDoc.productId}`;
  
  // Get full product data
  const query = `
    query GetProduct($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        vendor
        productType
        tags
        collections(first: 5) {
          edges {
            node {
              title
              handle
            }
          }
        }
        images(first: 5) {
          edges {
            node {
              url
              altText
            }
          }
        }
        priceRangeV2 {
          minVariantPrice {
            amount
            currencyCode
          }
          maxVariantPrice {
            amount
            currencyCode
          }
        }
      }
    }
  `;
  
  const productData = await executeShopifyGraphQL(shop, query, { id: productGid });
  const product = productData.product;
  
  if (!product) {
    console.error(`[SCHEMA] Product not found: ${productGid}`);
    console.log(`[SCHEMA] generateProductSchemas returning undefined for product ${productDoc.productId}`);
    return;
  }
  
  // Get SEO data for all languages
  const languages = productDoc.seoStatus?.languages || [];
  const schemas = [];
  
  for (const lang of languages) {
    if (!lang.optimized) continue;
    
    // Get SEO metafield
    const metafieldQuery = `
      query GetMetafield($productId: ID!, $key: String!) {
        product(id: $productId) {
          metafield(namespace: "seo_ai", key: $key) {
            value
          }
        }
      }
    `;
    
    const mfData = await executeShopifyGraphQL(shop, metafieldQuery, { 
      productId: productGid, 
      key: `seo__${lang.code}` 
    });
    
    if (!mfData.product?.metafield?.value) continue;
    
    const seoData = JSON.parse(mfData.product.metafield.value);
    
    // Generate schemas for this language
    const langSchemas = await generateLangSchemas(product, seoData, shop, lang.code);
    schemas.push({ language: lang.code, schemas: langSchemas });
  }
  
  // Collect all schemas from all languages
  const allSchemas = [];
  
  // Save all schemas
  for (const { language, schemas: langSchemas } of schemas) {
    const saveMutation = `
      mutation SetSchema($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
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
        ownerId: productGid,
        namespace: "advanced_schema",
        key: `schemas_${language}`,
        type: "json",
        value: JSON.stringify(langSchemas)
      }]
    };
    
    // Save to Shopify metafields
    await executeShopifyGraphQL(shop, saveMutation, variables);
    
    // Also collect for MongoDB
    allSchemas.push(...langSchemas);
  }
  
  // Return schemas for MongoDB storage
  console.log(`[SCHEMA] generateProductSchemas returning ${allSchemas.length} schemas for product ${product.id}`);
  return allSchemas;
}

// Generate schemas for specific language
async function generateLangSchemas(product, seoData, shop, language) {
  const shopUrl = `https://${shop}`;
  const productUrl = `${shopUrl}/products/${product.handle}`;
  
  // Load rich attributes settings
  const richAttributesSettings = await loadRichAttributesSettings(shop);
  // console.log(`[SCHEMA] Rich attributes settings for ${shop}:`, richAttributesSettings);
  
  // Extract factual attributes if any are enabled
  const enabledAttributes = Object.keys(richAttributesSettings).filter(key => richAttributesSettings[key]);
  let richAttributes = {};
  
  if (enabledAttributes.length > 0) {
    // console.log(`[SCHEMA] Extracting factual attributes: ${enabledAttributes.join(', ')}`);
    richAttributes = extractFactualAttributes(product, enabledAttributes);
    // console.log(`[SCHEMA] Extracted rich attributes:`, richAttributes);
  }
  
  const baseSchemas = [
    // BreadcrumbList
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Home",
          "item": shopUrl
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": product.collections?.edges?.[0]?.node?.title || product.productType || "Products",
          "item": `${shopUrl}/collections/${product.collections?.edges?.[0]?.node?.handle || 'all'}`
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": seoData.title,
          "item": productUrl
        }
      ]
    },
    
    // WebPage
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${productUrl}#webpage`,
      "url": productUrl,
      "name": seoData.title,
      "description": seoData.metaDescription,
      "inLanguage": language,
      "isPartOf": {
        "@type": "WebSite",
        "@id": `${shopUrl}#website`,
        "url": shopUrl,
        "name": shop.split('.')[0]
      }
    }
  ];
  
  // FAQPage if FAQ exists
  if (seoData.faq && seoData.faq.length > 0) {
    baseSchemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": seoData.faq.map(item => ({
        "@type": "Question",
        "name": item.q,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": item.a
        }
      }))
    });
  }
  
  // ItemList for features
  if (seoData.bullets && seoData.bullets.length > 0) {
    baseSchemas.push({
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": `Key Features - ${seoData.title}`,
      "itemListElement": seoData.bullets.map((bullet, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "name": bullet
      }))
    });
  }
  
  // Enhanced Product schema
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${productUrl}#product`,
    "name": seoData.title,
    "description": seoData.metaDescription,
    "url": productUrl,
    "image": product.images?.edges?.map(e => e.node.url) || [],
    "brand": {
      "@type": "Brand",
      "name": product.vendor
    },
    "offers": {
      "@type": "AggregateOffer",
      "lowPrice": product.priceRangeV2?.minVariantPrice?.amount,
      "highPrice": product.priceRangeV2?.maxVariantPrice?.amount,
      "priceCurrency": product.priceRangeV2?.minVariantPrice?.currencyCode,
      "availability": "https://schema.org/InStock"
    }
  };
  
  // Add bullets as additionalProperty
  const additionalProperties = [];
  
  if (seoData.bullets && seoData.bullets.length > 0) {
    additionalProperties.push(...seoData.bullets.map((bullet, i) => ({
      "@type": "PropertyValue",
      "name": `Feature ${i + 1}`,
      "value": bullet
    })));
  }
  
  // Add rich attributes as additionalProperty
  if (Object.keys(richAttributes).length > 0) {
    Object.entries(richAttributes).forEach(([key, value]) => {
      if (value && richAttributesSettings[key]) {
        additionalProperties.push({
          "@type": "PropertyValue",
          "name": key.charAt(0).toUpperCase() + key.slice(1),
          "value": value
        });
      }
    });
  }
  
  if (additionalProperties.length > 0) {
    productSchema.additionalProperty = additionalProperties;
  }
  
  baseSchemas.push(productSchema);
  
  console.log(`[SCHEMA] generateLangSchemas returning ${baseSchemas.length} schemas for product ${product.id}`);
  return baseSchemas;
}

// Install Script Tag for auto-injection
async function installScriptTag(shop) {
  try {
    // Първо проверяваме дали вече има script tag
    const checkQuery = `
      query {
        scriptTags(first: 100) {
          edges {
            node {
              id
              src
            }
          }
        }
      }
    `;
    
    const existing = await executeShopifyGraphQL(shop, checkQuery);
    const ourScriptTag = existing.scriptTags?.edges?.find(edge => 
      edge.node.src.includes('/api/schema/auto-inject.js')
    );
    
    if (ourScriptTag) {
      console.log('[SCHEMA] Script tag already installed');
      return;
    }
    
    // Инсталираме нов script tag
    const mutation = `
      mutation CreateScriptTag($input: ScriptTagInput!) {
        scriptTagCreate(input: $input) {
          scriptTag {
            id
            src
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const variables = {
      input: {
        src: `${process.env.APP_URL}/api/schema/auto-inject.js?shop=${shop}`,
        displayScope: "ONLINE_STORE"
      }
    };
    
    const result = await executeShopifyGraphQL(shop, mutation, variables);
    
    if (result.scriptTagCreate?.userErrors?.length > 0) {
      throw new Error(result.scriptTagCreate.userErrors[0].message);
    }
    
    console.log('[SCHEMA] Script tag installed successfully');
    
  } catch (error) {
    console.error('[SCHEMA] Failed to install script tag:', error);
    throw error;
  }
}

// Install Theme Snippet for auto-injection
async function installThemeSnippet(shop) {
  console.log('[SCHEMA] Installing theme snippet...');
  
  try {
    // Намираме активната тема
    const themesQuery = `{
      themes(first: 10) {
        edges {
          node {
            id
            name
            role
          }
        }
      }
    }`;
    
    const themesData = await executeShopifyGraphQL(shop, themesQuery);
    const mainTheme = themesData.themes.edges.find(t => t.node.role === 'MAIN')?.node;
    
    if (!mainTheme) {
      throw new Error('No main theme found');
    }
    
    // Създаваме snippet файла
    const snippetContent = `{%- comment -%} AI Schema Data - Auto-generated {%- endcomment -%}
{%- if product -%}
  {%- assign schema_key = 'schemas_' | append: request.locale.iso_code -%}
  {%- assign schemas = product.metafields.advanced_schema[schema_key].value -%}
  {%- if schemas -%}
    <script type="application/ld+json">
      {{ schemas }}
    </script>
  {%- endif -%}
{%- endif -%}

{%- comment -%} Site-wide FAQ Schema {%- endcomment -%}
{%- if shop.metafields.advanced_schema.site_faq -%}
  <script type="application/ld+json">
    {{ shop.metafields.advanced_schema.site_faq.value }}
  </script>
{%- endif -%}`;

    // Създаваме файла чрез REST API
    const themeId = mainTheme.id.split('/').pop();
    const putUrl = `https://${shop}/admin/api/2024-01/themes/${themeId}/assets.json`;
    const accessToken = await getAccessToken(shop);
    
    const response = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        asset: {
          key: 'snippets/ai-schema.liquid',
          value: snippetContent
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create snippet: ${response.statusText}`);
    }
    
    // Проверяваме theme.liquid
    const themeFileResponse = await fetch(`${putUrl}?asset[key]=layout/theme.liquid`, {
      headers: {
        'X-Shopify-Access-Token': accessToken
      }
    });
    
    const themeFile = await themeFileResponse.json();
    let themeContent = themeFile.asset.value;
    
    // Добавяме snippet ако не съществува
    if (!themeContent.includes("render 'ai-schema'")) {
      themeContent = themeContent.replace(
        '</head>',
        `  {% render 'ai-schema' %}\n</head>`
      );
      
      // Обновяваме theme.liquid
      await fetch(putUrl, {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          asset: {
            key: 'layout/theme.liquid',
            value: themeContent
          }
        })
      });
    }
    
    console.log('[SCHEMA] Theme snippet installed successfully');
    
  } catch (error) {
    console.error('[SCHEMA] Failed to install theme snippet:', error);
    throw error;
  }
}

// Main background process
async function generateAllSchemas(shop) {
  console.log(`[SCHEMA] Starting advanced schema generation for ${shop}`);
  
  // Set generation status
  generationStatus.set(shop, { 
    generating: true, 
    progress: '0%', 
    currentProduct: 'Initializing...' 
  });
  
  try {
    // ПРЕМАХВАМЕ script tag частта напълно
    // await installScriptTag(shop); // ПРЕМАХВАМЕ ТОВА
    console.log('[SCHEMA] Using theme snippet approach (no script tags needed)');
    
    // Load shop context
    const shopContext = await loadShopContext(shop);
    if (!shopContext) {
      throw new Error('Failed to load shop context');
    }
    
    // Generate site-wide FAQ
    console.log('[SCHEMA] Generating site FAQ...');
    const siteFAQ = await generateSiteFAQ(shop, shopContext);
    
    // First, sync products from Shopify to MongoDB if needed
    console.log('[SCHEMA] Checking if products need to be synced...');
    const totalProductsInMongo = await Product.countDocuments({ shop });
    console.log(`[SCHEMA] Products in MongoDB: ${totalProductsInMongo}`);
    
    if (totalProductsInMongo === 0) {
      console.log('[SCHEMA] No products in MongoDB, syncing from Shopify...');
      try {
        const syncResult = await syncProductsToMongoDB(shop);
        console.log(`[SCHEMA] Sync completed: ${syncResult.syncedCount} products synced`);
      } catch (error) {
        console.error('[SCHEMA] Failed to sync products:', error);
        // Continue anyway, maybe some products exist
      }
    }
    
    // Get all products with SEO
    console.log('[SCHEMA] Looking for products with optimized SEO...');
    console.log('[SCHEMA] Query:', JSON.stringify({
      shop,
      'seoStatus.optimized': true
    }));
    
    const products = await Product.find({
      shop,
      'seoStatus.optimized': true
    }).limit(500);
    
    console.log(`[SCHEMA] Found ${products.length} products with optimized SEO`);
    
    // DEBUG: Let's also check total products and products with any SEO
    const totalProducts = await Product.countDocuments({ shop });
    const productsWithAnySeo = await Product.countDocuments({ 
      shop,
      'seoStatus': { $exists: true }
    });
    
    console.log(`[SCHEMA] DEBUG - Total products: ${totalProducts}`);
    console.log(`[SCHEMA] DEBUG - Products with any SEO: ${productsWithAnySeo}`);
    console.log(`[SCHEMA] DEBUG - Products with optimized SEO: ${products.length}`);
    
    // DEBUG: Let's also check what the actual product documents look like
    if (productsWithAnySeo > 0) {
      const sampleProduct = await Product.findOne({ 
        shop,
        'seoStatus': { $exists: true }
      });
      console.log('[SCHEMA] DEBUG - Sample product with SEO:', JSON.stringify(sampleProduct, null, 2));
    }
    
    if (products.length === 0) {
      console.log('[SCHEMA] ⚠️ No products with optimized SEO found!');
      console.log('[SCHEMA] This means product schemas cannot be generated.');
      console.log('[SCHEMA] Users need to optimize products first in Bulk Edit.');
    }
    
    // Collect all generated schemas
    const allProductSchemas = [];
    
    // Process in batches
    const batchSize = 10;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, Math.min(i + batchSize, products.length));
      
      await Promise.all(batch.map(async (product) => {
        try {
          // console.log(`[SCHEMA] Processing product ${product.productId}...`);
          
          // Update progress
          const progressPercent = Math.round(((i + 1) / products.length) * 100);
          generationStatus.set(shop, {
            generating: true,
            progress: `${progressPercent}%`,
            currentProduct: `Processing ${product.title || product.productId}...`
          });
          
          const productSchemas = await generateProductSchemas(shop, product);
          // console.log(`[SCHEMA] Product ${product.productId} returned ${productSchemas ? productSchemas.length : 0} schemas`);
          if (productSchemas && productSchemas.length > 0) {
            allProductSchemas.push(...productSchemas);
            // console.log(`[SCHEMA] Added ${productSchemas.length} schemas to collection. Total: ${allProductSchemas.length}`);
          } else {
            console.log(`[SCHEMA] No schemas generated for product ${product.productId}`);
          }
        } catch (err) {
          console.error(`[SCHEMA] Failed for product ${product.productId}:`, err);
        }
      }));
      
      // console.log(`[SCHEMA] Processed ${Math.min(i + batchSize, products.length)}/${products.length} products`);
    }
    
    // Save to MongoDB
    try {
      await AdvancedSchema.findOneAndUpdate(
        { shop },
        {
          shop,
          schemas: allProductSchemas,
          siteFAQ,
          generatedAt: new Date(),
          updatedAt: new Date()
        },
        { upsert: true }
      );
      console.log(`[SCHEMA] Saved ${allProductSchemas.length} schemas to MongoDB`);
      
      // Verification - check if data was actually saved
      const saved = await AdvancedSchema.findOne({ shop });
      // console.log('[SCHEMA] Verification - saved document exists:', !!saved);
      // console.log('[SCHEMA] Verification - schemas count:', saved?.schemas?.length);
      // console.log('[SCHEMA] Verification - first schema:', saved?.schemas?.[0]);
    } catch (err) {
      console.error('[SCHEMA] Failed to save to MongoDB:', err);
      throw err;
    }
    
    console.log(`[SCHEMA] Completed schema generation for ${shop}`);
    
    // Mark generation as complete
    generationStatus.set(shop, { 
      generating: false, 
      progress: '100%', 
      currentProduct: 'Generation complete!' 
    });
    
  } catch (error) {
    console.error(`[SCHEMA] Fatal error for ${shop}:`, error);
    
    // Mark generation as failed
    generationStatus.set(shop, { 
      generating: false, 
      progress: '0%', 
      currentProduct: 'Generation failed' 
    });
    
    throw error;
  }
}

// Routes

// POST /api/schema/generate-all - Start background generation
router.post('/generate-all', async (req, res) => {
  console.log('[SCHEMA] ============================================'); // DEBUG
  console.log('[SCHEMA] Generate-all endpoint called at:', new Date().toISOString()); // DEBUG
  console.log('[SCHEMA] Request headers:', req.headers); // DEBUG
  console.log('[SCHEMA] Request body:', req.body); // DEBUG
  console.log('[SCHEMA] req.shopDomain:', req.shopDomain); // DEBUG
  
  try {
    const shop = req.shopDomain || requireShop(req);
    console.log('[SCHEMA] Shop extracted:', shop); // DEBUG
    
    // Check Enterprise plan
    console.log('[SCHEMA] Checking subscription...'); // DEBUG
    const subscription = await Subscription.findOne({ shop });
    console.log('[SCHEMA] Subscription found:', subscription); // DEBUG
    console.log('[SCHEMA] Plan:', subscription?.plan); // DEBUG
    
    if (subscription?.plan !== 'enterprise') {
      console.log('[SCHEMA] NOT ENTERPRISE - rejecting'); // DEBUG
      return res.status(403).json({ 
        error: 'Advanced Schema Data requires Enterprise plan',
        currentPlan: subscription?.plan || 'none'
      });
    }
    
    console.log('[SCHEMA] Enterprise plan confirmed!'); // DEBUG
    
    // Return immediately
    res.json({ 
      success: true, 
      message: 'Advanced schema generation started in background' 
    });
    
    // Start background process
    console.log('[SCHEMA] Starting background generation NOW...'); // DEBUG
    generateAllSchemas(shop).catch(err => {
      console.error('[SCHEMA] ❌ Background generation failed:', err);
    });
    
  } catch (error) {
    console.error('[SCHEMA] ❌ Endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/schema/status - Check generation status
router.get('/status', async (req, res) => {
  try {
    const shop = requireShop(req);
    
    // Get current generation status
    const currentStatus = generationStatus.get(shop) || { generating: false, progress: '0%', currentProduct: '' };
    
    // Check if FAQ exists
    const faqQuery = `
      query {
        shop {
          metafield(namespace: "advanced_schema", key: "site_faq") {
            value
          }
        }
      }
    `;
    
    const faqData = await executeShopifyGraphQL(shop, faqQuery);
    const hasFAQ = !!faqData.shop?.metafield?.value;
    
    // Check product count
    const productsWithSchema = await Product.countDocuments({
      shop,
      'advancedSchema.generated': true
    });
    
    res.json({
      enabled: true,
      generating: currentStatus.generating,
      progress: currentStatus.progress,
      currentProduct: currentStatus.currentProduct,
      hasSiteFAQ: hasFAQ,
      productsWithSchema
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/schema/site-faq - Get site FAQ
router.get('/site-faq', async (req, res) => {
  try {
    const shop = requireShop(req);
    
    const query = `
      query {
        shop {
          metafield(namespace: "advanced_schema", key: "site_faq") {
            value
          }
        }
      }
    `;
    
    const data = await executeShopifyGraphQL(shop, query);
    
    if (!data.shop?.metafield?.value) {
      return res.status(404).json({ error: 'FAQ not found' });
    }
    
    res.json(JSON.parse(data.shop.metafield.value));
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Public endpoint за автоматичното вмъкване
router.get('/auto-inject.js', async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).send('// Shop parameter required');
  }
  
  // Връщаме JavaScript който проверява за продуктова страница и зарежда schemas
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
(function() {
  // Проверяваме дали сме на продуктова страница
  if (window.location.pathname.includes('/products/')) {
    // Извличаме product handle от URL
    const pathParts = window.location.pathname.split('/');
    const productIndex = pathParts.indexOf('products');
    const handle = pathParts[productIndex + 1];
    
    if (handle) {
      // Зареждаме schemas за този продукт
      const lang = document.documentElement.lang || 'en';
      const script = document.createElement('script');
      script.src = '${process.env.APP_URL}/api/schema/product-schemas?shop=${shop}&handle=' + handle + '&lang=' + lang;
      script.async = true;
      document.head.appendChild(script);
    }
  }
  
  // Зареждаме site-wide FAQ на всички страници
  const faqScript = document.createElement('script');
  faqScript.src = '${process.env.APP_URL}/api/schema/site-faq-script?shop=${shop}';
  faqScript.async = true;
  document.head.appendChild(faqScript);
})();
  `);
});

// Endpoint за product schemas
router.get('/product-schemas', async (req, res) => {
  const { shop, handle, lang = 'en' } = req.query;
  
  if (!shop || !handle) {
    return res.status(400).send('// Missing parameters');
  }
  
  try {
    // Get product by handle
    const query = `
      query GetProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          metafield(namespace: "advanced_schema", key: "schemas_${lang}") {
            value
          }
        }
      }
    `;
    
    const data = await executeShopifyGraphQL(shop, query, { handle });
    
    if (!data.productByHandle?.metafield?.value) {
      return res.status(404).send('// Schema not found');
    }
    
    const schemas = JSON.parse(data.productByHandle.metafield.value);
    
    // Връщаме script който добавя schemas
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
(function() {
  var script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = ${JSON.stringify(JSON.stringify(schemas))};
  document.head.appendChild(script);
})();
    `);
    
  } catch (error) {
    res.status(500).send(`// Error: ${error.message}`);
  }
});

// Site FAQ script
router.get('/site-faq-script', async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).send('// Shop required');
  }
  
  try {
    const query = `
      query {
        shop {
          metafield(namespace: "advanced_schema", key: "site_faq") {
            value
          }
        }
      }
    `;
    
    const data = await executeShopifyGraphQL(shop, query);
    
    if (data.shop?.metafield?.value) {
      const faq = data.shop.metafield.value;
      
      res.setHeader('Content-Type', 'application/javascript');
      res.send(`
(function() {
  var script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = ${JSON.stringify(faq)};
  document.head.appendChild(script);
})();
      `);
    } else {
      res.send('// No FAQ found');
    }
    
  } catch (error) {
    res.status(500).send(`// Error: ${error.message}`);
  }
});

// Sitemap за schemas
router.get('/schema-sitemap.xml', async (req, res) => {
  const shop = req.query.shop;
  const products = await Product.find({ shop, 'advancedSchema.generated': true });
  
  let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  
  products.forEach(product => {
    sitemap += `  <url>
    <loc>https://${process.env.APP_URL}/ai/product/${product.handle}/schemas.json?shop=${shop}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
  </url>\n`;
  });
  
  sitemap += '</urlset>';
  
  res.setHeader('Content-Type', 'application/xml');
  res.send(sitemap);
});

// DELETE /api/schema/delete - Delete all schemas for a shop
router.delete('/delete', async (req, res) => {
  try {
    const shop = requireShop(req);
    
    // Delete only from MongoDB (don't touch Shopify metafields)
    await AdvancedSchema.findOneAndDelete({ shop });
    
    res.json({ success: true, message: 'Advanced schema data deleted' });
  } catch (error) {
    console.error('[SCHEMA] Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint for shop data
router.get('/debug-shop/:shop', async (req, res) => {
  try {
    const shop = req.params.shop;
    const shopRecord = await Shop.findOne({ shop });
    
    res.json({
      shop: shopRecord?.shop,
      hasToken: !!shopRecord?.accessToken,
      tokenLength: shopRecord?.accessToken?.length,
      tokenPrefix: shopRecord?.accessToken?.substring(0, 10) + '...',
      scopes: shopRecord?.scopes,
      updatedAt: shopRecord?.updatedAt
    });
  } catch (error) {
    console.error('[DEBUG] Shop debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;