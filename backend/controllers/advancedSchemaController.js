// backend/controllers/advancedSchemaController.js
import express from 'express';
import { requireShop } from './seoController.js';
import { executeShopifyGraphQL } from '../utils/tokenResolver.js';
import Subscription from '../db/Subscription.js';
import Product from '../db/Product.js';
import AdvancedSchema from '../db/AdvancedSchema.js';
import Shop from '../db/Shop.js'; // За access token
import TokenBalance from '../db/TokenBalance.js';
import fetch from 'node-fetch';
import { validateAIResponse } from '../utils/aiValidator.js';
import { extractFactualAttributes } from '../utils/factualExtractor.js';
import { 
  estimateTokensWithMargin, 
  calculateActualTokens,
  requiresTokens
} from '../billing/tokenConfig.js';
import { updateOptimizationSummary } from '../utils/optimizationSummary.js';

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

// Helper function to save schema to Shopify metafield
async function saveSchemaToMetafield(shop, productId, language, schemas) {
  try {
    const mutation = `
      mutation($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
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
    
    const variables = {
      metafields: [{
        ownerId: `gid://shopify/Product/${productId}`,
        namespace: "advanced_schema",
        key: `schemas_${language}`,
        type: "json",
        value: JSON.stringify(schemas)
      }]
    };
    
    const result = await executeShopifyGraphQL(shop, mutation, variables);
    
    if (result?.metafieldsSet?.userErrors?.length > 0) {
      console.error('[SCHEMA-METAFIELD] Error saving metafield:', result.metafieldsSet.userErrors);
      return { success: false, errors: result.metafieldsSet.userErrors };
    }
    
    return { success: true };
  } catch (error) {
    console.error('[SCHEMA-METAFIELD] Exception saving schema metafield:', error.message);
    return { success: false, error: error.message };
  }
}

// Helper function to sync products from Shopify to MongoDB
// This function fetches all products and detects AI SEO metafields to mark them as optimized
// Added debug logging to troubleshoot metafields detection - force deploy
async function syncProductsToMongoDB(shop) {
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
      
      allProducts.push(...edges.map(edge => edge.node));
      
      hasNextPage = productsData.pageInfo?.hasNextPage || false;
      cursor = productsData.pageInfo?.endCursor || null;
      
      if (edges.length === 0) break;
    }

    // Save products to MongoDB
    let syncedCount = 0;
    for (const product of allProducts) {
      const numericId = product.id.replace('gid://shopify/Product/', '');
      
      // Check if product has AI SEO metafields (indicating it's been optimized)
      const metafields = product.metafields?.edges || [];
      
      // Extract SEO languages from metafield keys (seo__en__title, seo__bg__description, etc.)
      const seoLanguages = [];
      metafields.forEach(edge => {
        const mf = edge.node;
        if (mf.namespace === 'seo_ai' && mf.key.startsWith('seo__')) {
          // Extract language from key like "seo__en__title" or "seo__bg__description"
          const keyParts = mf.key.split('__');
          if (keyParts.length >= 2) {
            const langCode = keyParts[1];
            if (!seoLanguages.includes(langCode)) {
              seoLanguages.push(langCode);
            }
          }
        }
      });
      
      // Always include 'en' as default if no languages found
      const detectedLanguages = seoLanguages.length > 0 ? [...new Set(['en', ...seoLanguages])] : ['en'];
      
      const hasSeoMetafields = seoLanguages.length > 0;
      
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
                languages: detectedLanguages.map(lang => ({ 
                  code: lang, 
                  optimized: true, 
                  hasSeo: true 
                })),
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
            languages: detectedLanguages.map(lang => ({ 
              code: lang, 
              optimized: true, 
              hasSeo: true 
            })),
            lastCheckedAt: new Date()
          },
          available: product.variants?.edges?.some(v => v.node.availableForSale) || false
        });
      }
      syncedCount++;
    }

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
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || process.env.APP_URL || 'https://indexaize.com',
        'X-Title': 'indexAIze - Unlock AI Search',
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
    const content = JSON.parse(data.choices[0].message.content);
    const usage = data.usage || {};
    
    return {
      content,
      usage: {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
        total_cost: usage.total_cost || null
      }
    };
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
      validated = validated.replace(pattern, replacement);
    }
  }
  
  return validated;
}

  // Load rich attributes settings - fetches user preferences for AI-generated schema features
  async function loadRichAttributesSettings(shop) {
  try {
    // Try to get settings from AI Discovery settings
  const response = await fetch(`${process.env.SHOPIFY_APP_URL || 'https://indexaize-aiseo-app-production.up.railway.app'}/api/ai-discovery/settings?shop=${shop}`);
    
    if (response.ok) {
      const data = await response.json();
      return data.richAttributes || {};
    }
  } catch (error) {
    // Could not load rich attributes settings
  }
  
  // Default settings if not found
  const defaultSettings = {
    material: false,
    color: false,
    size: false,
    weight: false,
    dimensions: false,
    category: false,
    audience: false,
    reviews: false,
    ratings: true, // ✅ ENABLED BY DEFAULT for better SEO
    enhancedDescription: false,
    organization: false
  };
  return defaultSettings;
}

// Generate enhanced product description using AI
async function generateEnhancedDescription(product, seoData, language) {
  const systemPrompt = `You are an expert e-commerce copywriter specializing in SEO-optimized product descriptions. Generate compelling, factual descriptions that convert browsers into buyers while maintaining authenticity and avoiding AI detection patterns.`;

  const prompt = `Product: ${product.title}
Current Description: ${seoData.metaDescription || product.description || 'No description available'}
Product Type: ${product.productType || 'General product'}
Vendor: ${product.vendor || 'Unknown'}
Language: ${language}
Key Features: ${seoData.bullets ? seoData.bullets.join(', ') : 'Standard features'}

Generate an enhanced product description (150-300 words) that:
1. Uses natural, conversational language with varied sentence structures
2. Incorporates key features and benefits naturally
3. Includes relevant keywords without over-optimization
4. Maintains authenticity and avoids AI detection patterns
5. Appeals to the target audience for this product type
6. Uses emotional triggers and benefit-focused language
7. Includes specific details and use cases

Writing style guidelines:
- Use contractions and natural speech patterns
- Vary sentence length and structure
- Include specific product details and scenarios
- Avoid repetitive phrases or perfect grammar
- Use benefit-focused language over feature lists
- Include emotional appeals and lifestyle connections

Return only the enhanced description text, no additional formatting.`;

  try {
    const result = await generateWithAI(prompt, systemPrompt);
    const content = result.content;
    const usage = result.usage;
    return { description: content.description || content, usage };
  } catch (error) {
    console.error('[SCHEMA] Enhanced description generation failed:', error);
    return { description: null, usage: null };
  }
}

// Generate Review schemas using AI
async function generateReviewSchemas(product, seoData, language) {
  const systemPrompt = `You are an expert at generating realistic, human-like product reviews for e-commerce. Generate 3-5 diverse, authentic-sounding reviews that feel like real customer experiences. Each review should have natural language patterns, minor imperfections, and genuine emotions.`;

  const prompt = `Product: ${product.title}
Description: ${seoData.metaDescription || product.description || 'No description available'}
Product Type: ${product.productType || 'General product'}
Language: ${language}
Key Features: ${seoData.bullets ? seoData.bullets.join(', ') : 'Standard features'}

Generate 3-5 realistic product reviews that feel human and authentic. Each review should:
1. Use natural, conversational language with minor imperfections
2. Include specific details about the product experience
3. Have varied lengths and writing styles
4. Include both positive and minor negative aspects
5. Use realistic customer names from the target language region
6. Have star ratings between 3-5 (mostly 4-5 stars)
7. Include dates from the past 6 months

Make the reviews feel genuine with:
- Natural speech patterns and contractions
- Specific product details and usage scenarios
- Emotional responses and personal experiences
- Minor complaints or suggestions for improvement
- Varied sentence structures and vocabulary

Return as JSON array with format:
[
  {
    "author": "Realistic Customer Name",
    "rating": 4,
    "reviewBody": "Natural, conversational review text with specific details and emotions",
    "datePublished": "2024-01-15"
  }
]`;

  try {
    const result = await generateWithAI(prompt, systemPrompt);
    const content = result.content;
    const usage = result.usage;
    const reviews = Array.isArray(content) ? content : content.reviews || [];
    
    const schemas = reviews.map(review => ({
      "@context": "https://schema.org",
      "@type": "Review",
      "itemReviewed": {
        "@type": "Product",
        "name": product.title
      },
      "author": {
        "@type": "Person",
        "name": review.author || "Customer"
      },
      "reviewRating": {
        "@type": "Rating",
        "ratingValue": review.rating || 4,
        "bestRating": 5
      },
      "reviewBody": review.reviewBody || "Great product!",
      "datePublished": review.datePublished || new Date().toISOString().split('T')[0]
    }));
    
    return { schemas, usage };
  } catch (error) {
    console.error('[SCHEMA] Review generation failed:', error);
    return { schemas: [], usage: null };
  }
}

// Generate Rating schemas using AI
async function generateRatingSchemas(product, seoData, language) {
  const systemPrompt = `You are an expert at generating realistic product ratings and aggregate rating data for e-commerce. Generate authentic rating statistics that would be typical for this type of product, considering its features, price point, and target market.`;

  const prompt = `Product: ${product.title}
Description: ${seoData.metaDescription || product.description || 'No description available'}
Product Type: ${product.productType || 'General product'}
Language: ${language}
Key Features: ${seoData.bullets ? seoData.bullets.join(', ') : 'Standard features'}

Generate realistic rating statistics that feel authentic for this product type. Consider:
1. Product quality and features mentioned
2. Typical customer satisfaction for this product category
3. Price point and value perception
4. Target market and user expectations

Generate realistic rating statistics including:
1. Average rating (3.2-4.8, with most products being 3.8-4.5)
2. Total number of reviews (20-300, depending on product popularity)
3. Natural rating distribution (not too perfect, include some variation)

Make the statistics feel realistic:
- Avoid perfect distributions (like 100% 5-star reviews)
- Include some 1-2 star reviews for authenticity
- Consider product type (electronics vs clothing vs accessories)
- Vary review counts based on product popularity

Return as JSON:
{
  "ratingValue": 4.2,
  "reviewCount": 127,
  "ratingDistribution": {
    "5": 45,
    "4": 38,
    "3": 25,
    "2": 12,
    "1": 7
  }
}`;

  try {
    const result = await generateWithAI(prompt, systemPrompt);
    const content = result.content;
    const usage = result.usage;
    const ratingData = content.ratingValue ? content : content.rating || {};
    
    const schemas = [{
      "@context": "https://schema.org",
      "@type": "AggregateRating",
      "itemReviewed": {
        "@type": "Product",
        "name": product.title
      },
      "ratingValue": ratingData.ratingValue || 4.2,
      "reviewCount": ratingData.reviewCount || 100,
      "bestRating": 5,
      "worstRating": 1
    }];
    
    return { schemas, usage };
  } catch (error) {
    console.error('[SCHEMA] Rating generation failed:', error);
    return { schemas: [], usage: null };
  }
}

// Generate Organization schema using Store Metadata
async function generateOrganizationSchema(product, shop, language) {
  try {
    // Get store metadata from metafields
    const storeMetaQuery = `
      query {
        shop {
          name
          description
          email
          primaryDomain { url }
          organizationMetafield: metafield(namespace: "ai_seo_store", key: "organization_schema") { value }
          seoMetafield: metafield(namespace: "ai_seo_store", key: "seo_metadata") { value }
        }
      }
    `;
    
    const data = await executeShopifyGraphQL(shop, storeMetaQuery);
    const shopData = data.shop;
    
    // Parse organization schema if available
    let organizationData = {};
    if (shopData.organizationMetafield?.value) {
      try {
        organizationData = JSON.parse(shopData.organizationMetafield.value);
      } catch (e) {
        console.error('[SCHEMA] Failed to parse organization schema:', e);
      }
    }
    
    // Parse SEO metadata if available
    let seoData = {};
    if (shopData.seoMetafield?.value) {
      try {
        seoData = JSON.parse(shopData.seoMetafield.value);
      } catch (e) {
        console.error('[SCHEMA] Failed to parse SEO metadata:', e);
      }
    }
    
    const shopUrl = shopData.primaryDomain?.url || `https://${shop}`;
    
    return {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": organizationData.name || seoData.storeName || shopData.name,
      "url": shopUrl,
      "description": organizationData.description || seoData.shortDescription || shopData.description,
      "email": organizationData.email || shopData.email,
      "telephone": organizationData.phone,
      "logo": organizationData.logo || `${shopUrl}/logo.png`,
      "sameAs": organizationData.sameAs ? 
        organizationData.sameAs.split(',').map(s => s.trim()).filter(Boolean) : [],
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "customer service",
        "url": shopUrl,
        "email": organizationData.email || shopData.email
      }
    };
  } catch (error) {
    console.error('[SCHEMA] Failed to generate organization schema:', error);
    
    // Fallback to basic organization schema
    const shopName = shop.split('.')[0];
    const shopUrl = `https://${shop}`;
    
    return {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": shopName,
      "url": shopUrl,
      "logo": `${shopUrl}/logo.png`
    };
  }
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
  
  const systemPrompt = `You are an expert copywriter creating unique, store-specific FAQ answers for an e-commerce website.

CRITICAL RULES:
1. Generate UNIQUE, PERSONALIZED answers that match the store's brand and products
2. Include the store name (${shopContext.shop.name}) naturally in answers where relevant
3. Reference specific store features, policies, and contact methods when provided
4. Use a friendly, conversational tone that matches e-commerce customer service
5. For policy questions, direct users to the actual policy URL provided
6. Do NOT use generic templates - make each answer feel authentic and specific to this store
7. Keep answers concise (2-4 sentences) but informative
8. Include actionable next steps (e.g., "visit our page", "contact us at email")

Output format: { "faqs": [{"q": "question", "a": "unique answer"}] }`;
  
  const prompt = `Create FAQ answers for: **${shopContext.shop.name}**

Store Details:
- URL: ${shopUrl}
- Currency: ${shopContext.shop.currencyCode}
${shopContext.shop.description ? `- About: ${shopContext.shop.description}` : ''}
${shopContext.shop.contactEmail ? `- Contact: ${shopContext.shop.contactEmail}` : ''}
- Payment Options: ${shopContext.shop.paymentSettings?.supportedDigitalWallets?.join(', ') || 'Multiple payment methods'}

Policy URLs:
- Returns: ${shopUrl}/policies/refund-policy
- Shipping: ${shopUrl}/policies/shipping-policy
- Privacy: ${shopUrl}/policies/privacy-policy

Questions to answer:
${JSON.stringify(fixedQuestions)}

SPECIAL INSTRUCTION for "languages" question: 
Answer: "Our store is available in ${languages.length} language${languages.length > 1 ? 's' : ''}: ${languages.join(', ')}. You can switch languages using the language selector on our website."

For OTHER questions:
- Reference the store name naturally
- Link to the specific policy URLs provided
- Mention the contact email if provided
- If specific information is not provided, suggest customers visit ${shopUrl} or contact ${shopContext.shop.contactEmail || 'customer support'}
- Make each answer feel personalized to ${shopContext.shop.name}`;
  
  try {
    const result = await generateWithAI(prompt, systemPrompt);
    
    // Extract content and usage
    const content = result.content;
    const usage = result.usage;
    
    // Validate AI response to prevent hallucinations
    const validatedResponse = validateAIResponse(
      { faq: content.faqs }, 
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
    const validated = (validatedResponse.faq || content.faqs).map(faq => {
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
    
    return { schema: faqSchema, usage };
    
  } catch (error) {
    console.error('[SCHEMA] FAQ generation failed:', error);
    return { schema: null, usage: null };
  }
}

// Generate product schemas
async function generateProductSchemas(shop, productDoc) {
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
    // console.log(`[SCHEMA] generateProductSchemas returning undefined for product ${productDoc.productId}`);
    return;
  }
  
  // Get SEO data for all languages
  const languages = productDoc.seoStatus?.languages || [];
  const schemas = [];
  let totalProductUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  
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
    const result = await generateLangSchemas(product, seoData, shop, lang.code);
    schemas.push({ language: lang.code, schemas: result.schemas });
    
    // Collect usage
    if (result.usage) {
      totalProductUsage.prompt_tokens += result.usage.prompt_tokens || 0;
      totalProductUsage.completion_tokens += result.usage.completion_tokens || 0;
      totalProductUsage.total_tokens += result.usage.total_tokens || 0;
    }
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
  
  // Update optimization summary metafield
  await updateOptimizationSummary(shop, productDoc.productId);
  
  // Return schemas and usage for MongoDB storage and token tracking
  // console.log(`[SCHEMA] generateProductSchemas returning ${allSchemas.length} schemas for product ${product.id}`);
  return { schemas: allSchemas, usage: totalProductUsage };
}

// Generate schemas for specific language
async function generateLangSchemas(product, seoData, shop, language) {
  const shopUrl = `https://${shop}`;
  const productUrl = `${shopUrl}/products/${product.handle}`;
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  
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

  // Add enhanced description if enabled
  if (richAttributesSettings.enhancedDescription) {
    try {
      const result = await generateEnhancedDescription(product, seoData, language);
      if (result.description) {
        productSchema.description = result.description;
      }
      if (result.usage) {
        totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
        totalUsage.completion_tokens += result.usage.completion_tokens || 0;
        totalUsage.total_tokens += result.usage.total_tokens || 0;
      }
    } catch (error) {
      console.error('[SCHEMA] Failed to generate enhanced description:', error);
    }
  }
  
  if (additionalProperties.length > 0) {
    productSchema.additionalProperty = additionalProperties;
  }
  
  baseSchemas.push(productSchema);

  // Add Review schemas if enabled
  if (richAttributesSettings.reviews) {
    try {
      const result = await generateReviewSchemas(product, seoData, language);
      if (result.schemas) {
        baseSchemas.push(...result.schemas);
      }
      if (result.usage) {
        totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
        totalUsage.completion_tokens += result.usage.completion_tokens || 0;
        totalUsage.total_tokens += result.usage.total_tokens || 0;
      }
    } catch (error) {
      console.error('[SCHEMA] Failed to generate review schemas:', error);
    }
  }

  // Add Rating schemas if enabled
  if (richAttributesSettings.ratings) {
    try {
      const result = await generateRatingSchemas(product, seoData, language);
      if (result.schemas) {
        baseSchemas.push(...result.schemas);
      }
      if (result.usage) {
        totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
        totalUsage.completion_tokens += result.usage.completion_tokens || 0;
        totalUsage.total_tokens += result.usage.total_tokens || 0;
      }
    } catch (error) {
      console.error('[SCHEMA] Failed to generate rating schemas:', error);
    }
  }

  // Add Organization schema if enabled
  if (richAttributesSettings.organization) {
    try {
      const organizationSchema = await generateOrganizationSchema(product, shop, language);
      if (organizationSchema) {
        baseSchemas.push(organizationSchema);
      }
    } catch (error) {
      console.error('[SCHEMA] Failed to generate organization schema:', error);
    }
  }
  
  // console.log(`[SCHEMA] generateLangSchemas returning ${baseSchemas.length} schemas for product ${product.id}`);
  return { schemas: baseSchemas, usage: totalUsage };
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
    
  } catch (error) {
    console.error('[SCHEMA] Failed to install script tag:', error);
    throw error;
  }
}

// Install Theme Snippet for auto-injection
async function installThemeSnippet(shop) {
  
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
    
  } catch (error) {
    console.error('[SCHEMA] Failed to install theme snippet:', error);
    throw error;
  }
}

// Main background process
async function generateAllSchemas(shop, forceBasicSeo = false) {
  // Set generation status
  generationStatus.set(shop, { 
    generating: true, 
    progress: '0%', 
    currentProduct: 'Initializing...' 
  });
  
  // === TOKEN RESERVATION & TRIAL CHECK ===
  let reservationId = null;
  let totalAITokens = 0;
  
  try {
    // Check if this feature requires tokens and reserve
    const { estimateTokensWithMargin, requiresTokens, calculateActualTokens, isBlockedInTrial } = await import('../billing/tokenConfig.js');
    const feature = 'ai-schema-advanced';
    
    if (requiresTokens(feature)) {
      // Estimate tokens (rough estimate: 500 products * 4 AI calls * 500 tokens each = 1M tokens)
      const tokenEstimate = estimateTokensWithMargin(feature, { productCount: 100 }); // Conservative estimate
      
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      // === TRIAL RESTRICTION CHECK ===
      // Get subscription to check trial status
      const Subscription = (await import('../db/Subscription.js')).default;
      const subscription = await Subscription.findOne({ shop });
      
      const now = new Date();
      const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
      const isActive = subscription?.status === 'active';
      
      // Check if plan has included tokens (Growth Extra, Enterprise)
      const planKey = (subscription?.plan || 'starter').toLowerCase().replace(/\s+/g, '_');
      const includedTokensPlans = ['growth_extra', 'enterprise'];
      const hasIncludedTokens = includedTokensPlans.includes(planKey);
      
      // CRITICAL: Block during trial ONLY for plans with included tokens
      // NOTE: We check ONLY inTrial, NOT isActive! Status is 'active' during trial.
      if (hasIncludedTokens && inTrial && isBlockedInTrial(feature)) {
        throw new Error('TRIAL_RESTRICTION: Advanced Schema Data is locked during trial period. Activate your plan to unlock.');
      }
      
      // Check token balance
      if (tokenBalance.hasBalance(tokenEstimate.withMargin)) {
        const reservation = tokenBalance.reserveTokens(tokenEstimate.withMargin, feature, { shop });
        reservationId = reservation.reservationId;
        await reservation.save();
      } else {
        console.error(`[SCHEMA] Insufficient tokens! Need: ${tokenEstimate.withMargin}, Have: ${tokenBalance.balance}`);
        throw new Error('INSUFFICIENT_TOKENS: Insufficient token balance for Advanced Schema generation');
      }
    }
    // === END TOKEN RESERVATION & TRIAL CHECK ===
    
    // Load shop context
    const shopContext = await loadShopContext(shop);
    if (!shopContext) {
      throw new Error('Failed to load shop context');
    }
    
    // Generate site-wide FAQ
    const faqResult = await generateSiteFAQ(shop, shopContext);
    const siteFAQ = faqResult.schema;
    
    // Track tokens from FAQ generation
    if (faqResult.usage) {
      totalAITokens += faqResult.usage.total_tokens || 0;
    }
    
    // First, sync products from Shopify to MongoDB if needed
    const totalProductsInMongo = await Product.countDocuments({ shop });
    
    if (totalProductsInMongo === 0) {
      try {
        await syncProductsToMongoDB(shop);
      } catch (error) {
        console.error('[SCHEMA] ❌ Failed to sync products:', error);
        // Continue anyway, maybe some products exist
      }
    }
    
    // Get ALL optimized products (basic + AI-enhanced together)
    const allProducts = await Product.find({
      shop,
      'seoStatus.optimized': true
    }).limit(500);
    
    // Also count how many have AI-enhanced
    const aiEnhancedCount = await Product.countDocuments({
      shop,
      'seoStatus.aiEnhanced': true
    });
    
    // Case 1: No products at all
    if (allProducts.length === 0) {
      throw new Error('NO_OPTIMIZED_PRODUCTS');
    }
    
    // Case 2: Only basic products, no AI-enhanced (and user didn't force basic)
    // Show recommendation modal, but don't block generation
    if (allProducts.length > 0 && aiEnhancedCount === 0 && !forceBasicSeo) {
      throw new Error('ONLY_BASIC_SEO');
    }
    
    // Use ALL optimized products (mix of basic + AI-enhanced)
    const products = allProducts;
    
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
          
          const result = await generateProductSchemas(shop, product);
          if (result?.schemas && result.schemas.length > 0) {
            allProductSchemas.push(...result.schemas);
          }
          
          // Track tokens from this product
          if (result?.usage) {
            totalAITokens += result.usage.total_tokens || 0;
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
      
      // Verification - check if data was actually saved
      const saved = await AdvancedSchema.findOne({ shop });
    } catch (err) {
      console.error('[SCHEMA] Failed to save to MongoDB:', err);
      throw err;
    }
    
    // === FINALIZE TOKEN USAGE ===
    if (reservationId && totalAITokens > 0) {
      try {
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        await tokenBalance.finalizeReservation(reservationId, totalAITokens);
        
        // Invalidate cache so new token balance is immediately visible
        try {
          const cacheService = await import('../services/cacheService.js');
          await cacheService.default.invalidateShop(shop);
        } catch (cacheErr) {
          console.error('[SCHEMA] Failed to invalidate cache:', cacheErr);
        }
      } catch (tokenErr) {
        console.error('[SCHEMA] Error finalizing token usage:', tokenErr);
      }
    }
    // === END TOKEN FINALIZATION ===
    
    // Mark generation as complete
    generationStatus.set(shop, { 
      generating: false, 
      progress: '100%', 
      currentProduct: 'Generation complete!' 
    });
    
  } catch (error) {
    console.error(`[SCHEMA] ❌ Fatal error for ${shop}:`, error);
    console.error(`[SCHEMA] ❌ Error message:`, error.message);
    console.error(`[SCHEMA] ❌ Error stack:`, error.stack);
    
    // Mark generation as failed
    generationStatus.set(shop, { 
      generating: false, 
      progress: '0%', 
      currentProduct: `Generation failed: ${error.message}` 
    });
    
    throw error;
  }
}

// Routes

// POST /api/schema/generate-all - Start background generation
// Returns 402 with requiresPurchase:true for Plus plans without tokens
router.post('/generate-all', async (req, res) => {
  try {
    const shop = req.shopDomain || requireShop(req);
    
    // Check plan access: Enterprise/Growth Extra (included tokens) OR Plus plans (with purchased tokens)
    const subscription = await Subscription.findOne({ shop });
    
    // Normalize plan name: "Professional Plus" → "professional_plus"
    const normalizePlan = (plan) => (plan || 'starter').toLowerCase().replace(/\s+/g, '_');
    const normalizedPlan = normalizePlan(subscription?.plan);
    
    // Plans with included tokens that have unlimited access
    const includedTokensPlans = ['enterprise', 'growth_extra'];
    
    // Plus plans that can access with purchased tokens
    const plusPlans = ['professional_plus', 'growth_plus', 'starter_plus'];
    
    // Check if plan has access
    const hasIncludedAccess = includedTokensPlans.includes(normalizedPlan);
    const isPlusPlan = plusPlans.includes(normalizedPlan);
    
    if (!hasIncludedAccess && !isPlusPlan) {
      return res.status(403).json({ 
        error: 'Advanced Schema Data requires Growth Extra, Enterprise, or Plus plans with tokens',
        currentPlan: subscription?.plan || 'none',
        normalizedPlan // debug info
      });
    }
    
    // === TRIAL RESTRICTION CHECK ===
    // IMPORTANT: Only for plans with INCLUDED tokens (Growth Extra, Enterprise)
    // Plus plans use PURCHASED tokens → no trial restriction
    const now = new Date();
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
    const isActive = subscription?.status === 'active';
    const { isBlockedInTrial } = await import('../billing/tokenConfig.js');
    const feature = 'ai-schema-advanced';
    
    // CRITICAL: Block during trial ONLY for plans with included tokens
    if (hasIncludedAccess && inTrial && !isActive && isBlockedInTrial(feature)) {
      // Get token info for Trial Activation Modal
      const { estimateTokensWithMargin } = await import('../billing/tokenConfig.js');
      const tokenEstimate = estimateTokensWithMargin(feature, { productCount: 100 });
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      return res.status(402).json({
        error: 'Advanced Schema Data is locked during trial period',
        trialRestriction: true,
        requiresActivation: true, // ← Show Trial Activation Modal
        trialEndsAt: subscription.trialEndsAt,
        currentPlan: subscription.plan,
        feature,
        tokensRequired: tokenEstimate.estimated,
        tokensWithMargin: tokenEstimate.withMargin,
        tokensAvailable: tokenBalance.balance,
        tokensNeeded: Math.max(0, tokenEstimate.withMargin - tokenBalance.balance),
        message: 'Activate your plan to unlock Advanced Schema Data with included tokens'
      });
    }
    
    // === TOKEN BALANCE CHECK ===
    // For Plus plans (purchased tokens) OR active included-tokens plans
    if (isPlusPlan) {
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      // Estimate tokens needed for Advanced Schema
      const { estimateTokensWithMargin } = await import('../billing/tokenConfig.js');
      const tokenEstimate = estimateTokensWithMargin('ai-schema-advanced', { productCount: 100 });
      
      if (!tokenBalance.hasBalance(tokenEstimate.withMargin)) {
        return res.status(402).json({ 
          error: 'Insufficient token balance',
          requiresPurchase: true, // ← Show Insufficient Tokens Modal
          needsUpgrade: false,
          currentPlan: subscription?.plan || 'none',
          tokensRequired: tokenEstimate.estimated,
          tokensWithMargin: tokenEstimate.withMargin,
          tokensAvailable: tokenBalance.balance,
          tokensNeeded: tokenEstimate.withMargin - tokenBalance.balance,
          feature: 'ai-schema-advanced',
          message: 'Purchase tokens to generate Advanced Schema Data'
        });
      }
    }
    
    // Return immediately
    res.json({ 
      success: true, 
      message: 'Advanced schema generation started in background' 
    });
    
    // Get forceBasicSeo parameter from request body
    const forceBasicSeo = req.body?.forceBasicSeo === true;
    
    // Start background process
    generateAllSchemas(shop, forceBasicSeo).catch(err => {
      console.error('[SCHEMA] ❌ Background generation failed:', err);
      console.error('[SCHEMA] ❌ Error message:', err.message);
      
      // Update status with error
      if (err.message === 'NO_OPTIMIZED_PRODUCTS') {
        generationStatus.set(shop, { 
          generating: false, 
          progress: '0%', 
          currentProduct: '',
          error: 'NO_OPTIMIZED_PRODUCTS',
          errorMessage: 'No optimized products found. Please run AISEO optimization first.'
        });
      } else if (err.message === 'ONLY_BASIC_SEO') {
        generationStatus.set(shop, { 
          generating: false, 
          progress: '0%', 
          currentProduct: '',
          error: 'ONLY_BASIC_SEO',
          errorMessage: 'Only basic AISEO found. AI-enhanced optimization is recommended for better results.'
        });
      } else if (err.message.startsWith('TRIAL_RESTRICTION:')) {
        // Trial restriction error
        generationStatus.set(shop, { 
          generating: false, 
          progress: '0%', 
          currentProduct: '',
          error: 'TRIAL_RESTRICTION',
          errorMessage: err.message.replace('TRIAL_RESTRICTION: ', '')
        });
      } else if (err.message.startsWith('INSUFFICIENT_TOKENS:')) {
        // Token balance error
        generationStatus.set(shop, { 
          generating: false, 
          progress: '0%', 
          currentProduct: '',
          error: 'INSUFFICIENT_TOKENS',
          errorMessage: err.message.replace('INSUFFICIENT_TOKENS: ', '')
        });
      } else {
        generationStatus.set(shop, { 
          generating: false, 
          progress: '0%', 
          currentProduct: '',
          error: 'GENERATION_FAILED',
          errorMessage: err.message || 'Schema generation failed'
        });
      }
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
    
    // Get current generation status from memory
    const currentStatus = generationStatus.get(shop) || { 
      generating: false, 
      progress: '0%', 
      currentProduct: '' 
    };
    
    // IMPORTANT: Check if data actually exists in MongoDB
    // This is the source of truth, not the in-memory status
    let actualDataExists = false;
    let productsWithSchema = 0;
    let hasFAQ = false;
    
    try {
      // Check MongoDB for actual saved data
      const savedSchema = await AdvancedSchema.findOne({ shop });
      
      if (savedSchema && savedSchema.schemas && savedSchema.schemas.length > 0) {
        actualDataExists = true;
        
        // Count unique products by extracting product handles from schema URLs
        const uniqueProducts = new Set();
        savedSchema.schemas.forEach(schema => {
          if (schema.url && schema.url.includes('/products/')) {
            const handle = schema.url.split('/products/')[1]?.split('#')[0];
            if (handle) {
              uniqueProducts.add(handle);
            }
          }
        });
        productsWithSchema = uniqueProducts.size;
        
        hasFAQ = !!savedSchema.siteFAQ;
      }
      
      // Also check FAQ in metafields as backup
      if (!hasFAQ) {
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
        hasFAQ = !!faqData.shop?.metafield?.value;
      }
    } catch (dbError) {
      console.error(`[SCHEMA-STATUS] Error checking MongoDB:`, dbError);
    }
    
    // Determine actual generation status
    let isActuallyGenerating = currentStatus.generating;
    
    // If memory says generating but we found complete data, generation is done
    if (isActuallyGenerating && actualDataExists) {
      isActuallyGenerating = false;
      
      // Clear the in-memory status since generation is complete
      generationStatus.set(shop, {
        generating: false,
        progress: '100%',
        currentProduct: 'Complete'
      });
    }
    
    res.json({
      enabled: true,
      generating: isActuallyGenerating,
      progress: isActuallyGenerating ? currentStatus.progress : '100%',
      currentProduct: currentStatus.currentProduct,
      error: currentStatus.error || null,
      errorMessage: currentStatus.errorMessage || null,
      hasSiteFAQ: hasFAQ,
      productsWithSchema: productsWithSchema,
      // Add this flag to help frontend know data is ready
      dataReady: actualDataExists
    });
    
  } catch (error) {
    console.error('[SCHEMA-STATUS] Error:', error);
    res.status(500).json({ 
      error: error.message,
      enabled: false,
      generating: false,
      progress: '0%',
      currentProduct: '',
      hasSiteFAQ: false,
      productsWithSchema: 0,
      dataReady: false
    });
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
