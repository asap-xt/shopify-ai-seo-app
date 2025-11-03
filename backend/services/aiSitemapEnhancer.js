// backend/services/aiSitemapEnhancer.js
// AI-powered enhancements for sitemap generation

import { getGeminiResponse } from '../ai/gemini.js';

/**
 * Generate AI-optimized product summary
 * Priority 1: High impact, easy implementation
 */
export async function generateAISummary(product) {
  try {
    const prompt = `Analyze this product and create a 2-3 sentence summary optimized for AI search engines.
Focus on key features, use cases, and what makes it unique.

Product: ${product.title}
Description: ${product.description || 'No description'}
Category: ${product.productType || 'General'}
Tags: ${product.tags?.join(', ') || 'None'}
Price: ${product.price || 'N/A'}
Brand: ${product.vendor || 'N/A'}

Format: Plain text, no markdown, concise and informative. Maximum 3 sentences.`;

    const result = await getGeminiResponse(prompt, {
      maxTokens: 200,
      temperature: 0.3 // Lower temperature for consistency
    });

    return { data: result.content.trim(), usage: result.usage };
  } catch (error) {
    console.error('[AI-SITEMAP] Error generating summary:', error);
    // Fallback to basic description
    return { data: product.description?.substring(0, 200) || product.title, usage: null };
  }
}

/**
 * Generate semantic tags
 * Priority 1: High impact, easy implementation
 */
export async function generateSemanticTags(product) {
  try {
    const prompt = `Analyze this product and generate structured semantic tags.

Product: ${product.title}
Description: ${product.description || 'No description'}
Category: ${product.productType || 'General'}
Existing Tags: ${product.tags?.join(', ') || 'None'}
Brand: ${product.vendor || 'N/A'}

Generate the following:
1. Category hierarchy (e.g., "Electronics > Computers > Laptops")
2. Primary use case (e.g., "Professional Work", "Gaming", "Everyday Use")
3. Target skill level (e.g., "Beginner", "Intermediate", "Advanced", "Expert")
4. Season/time relevance (e.g., "All-Season", "Winter", "Summer", or "Year-Round")

Format as JSON:
{
  "category_hierarchy": "string",
  "use_case": "string",
  "skill_level": "string",
  "season": "string"
}`;

    const result = await getGeminiResponse(prompt, {
      maxTokens: 300,
      temperature: 0.2
    });

    // Parse JSON response
    const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
    const parsed = JSON.parse(cleaned);
    
    return {
      data: {
        categoryHierarchy: parsed.category_hierarchy || product.productType || 'General',
        useCase: parsed.use_case || 'General Use',
        skillLevel: parsed.skill_level || 'All Levels',
        season: parsed.season || 'Year-Round'
      },
      usage: result.usage
    };
  } catch (error) {
    console.error('[AI-SITEMAP] Error generating semantic tags:', error);
    // Fallback to basic tags
    return {
      data: {
        categoryHierarchy: product.productType || 'General',
        useCase: 'General Use',
        skillLevel: 'All Levels',
        season: 'Year-Round'
      },
      usage: null
    };
  }
}

/**
 * Generate context hints
 * Priority 2: Medium impact, medium complexity
 */
export async function generateContextHints(product) {
  try {
    const prompt = `Analyze this product and provide context hints for AI search engines.

Product: ${product.title}
Description: ${product.description || 'No description'}
Category: ${product.productType || 'General'}
Tags: ${product.tags?.join(', ') || 'None'}
Price: ${product.price || 'N/A'}
Brand: ${product.vendor || 'N/A'}

Generate:
1. Best for: Who is this product best suited for? (one sentence)
2. Key differentiator: What makes this product unique? (one sentence)
3. Target audience: Who should buy this? (brief description)

Format as JSON:
{
  "best_for": "string",
  "key_differentiator": "string",
  "target_audience": "string"
}`;

    const result = await getGeminiResponse(prompt, {
      maxTokens: 400,
      temperature: 0.3
    });

    const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
    const parsed = JSON.parse(cleaned);
    
    return {
      data: {
        bestFor: parsed.best_for || `Ideal for ${product.productType || 'general'} needs`,
        keyDifferentiator: parsed.key_differentiator || `Quality ${product.productType || 'product'} from ${product.vendor || 'trusted brand'}`,
        targetAudience: parsed.target_audience || 'General consumers'
      },
      usage: result.usage
    };
  } catch (error) {
    console.error('[AI-SITEMAP] Error generating context hints:', error);
    return {
      data: {
        bestFor: `Ideal for ${product.productType || 'general'} needs`,
        keyDifferentiator: `Quality ${product.productType || 'product'}`,
        targetAudience: 'General consumers'
      },
      usage: null
    };
  }
}

/**
 * Generate Q&A pairs
 * Priority 2: Medium impact, medium complexity
 */
export async function generateProductQA(product) {
  try {
    const prompt = `Generate the top 3-5 most likely questions customers would ask about this product, with clear answers.

Product: ${product.title}
Description: ${product.description || 'No description'}
Category: ${product.productType || 'General'}
Tags: ${product.tags?.join(', ') || 'None'}
Price: ${product.price || 'N/A'}
Brand: ${product.vendor || 'N/A'}

Generate 3-5 common questions and their answers. Focus on:
- Who should use this product
- What makes it different
- What features it has
- When/where to use it
- How it compares to alternatives

Format as JSON array:
[
  {
    "question": "string",
    "answer": "string"
  }
]`;

    const result = await getGeminiResponse(prompt, {
      maxTokens: 800,
      temperature: 0.4
    });

    const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
    const parsed = JSON.parse(cleaned);
    
    return { data: Array.isArray(parsed) ? parsed.slice(0, 5) : [], usage: result.usage };
  } catch (error) {
    console.error('[AI-SITEMAP] Error generating Q&A:', error);
    return { data: [], usage: null };
  }
}

/**
 * Analyze sentiment and tone
 * Priority 3: Lower impact, easy implementation
 */
export async function analyzeSentiment(product) {
  try {
    const prompt = `Analyze the tone and target emotion of this product.

Product: ${product.title}
Description: ${product.description || 'No description'}
Category: ${product.productType || 'General'}
Brand: ${product.vendor || 'N/A'}

Determine:
1. Tone: How should this product be presented? (choose one: professional, playful, technical, luxury, casual, sporty, elegant)
2. Target emotion: What emotion should this product evoke? (choose one: excitement, confidence, comfort, trust, aspiration, joy, security)

Format as JSON:
{
  "tone": "string",
  "target_emotion": "string"
}`;

    const result = await getGeminiResponse(prompt, {
      maxTokens: 150,
      temperature: 0.2
    });

    const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
    const parsed = JSON.parse(cleaned);
    
    return {
      data: {
        tone: parsed.tone || 'professional',
        targetEmotion: parsed.target_emotion || 'confidence'
      },
      usage: result.usage
    };
  } catch (error) {
    console.error('[AI-SITEMAP] Error analyzing sentiment:', error);
    return {
      data: {
        tone: 'professional',
        targetEmotion: 'confidence'
      },
      usage: null
    };
  }
}

/**
 * Find related products (using simple matching for now)
 * Priority 3: Lower impact, higher complexity
 * Note: This is a simplified version. For better results, implement vector similarity.
 */
export function findRelatedProducts(product, allProducts, maxResults = 5) {
  try {
    const related = [];
    
    // Score products by similarity
    for (const other of allProducts) {
      if (other.node.id === product.id) continue;
      
      let score = 0;
      
      // Same category
      if (other.node.productType === product.productType) score += 3;
      
      // Same vendor
      if (other.node.vendor === product.vendor) score += 2;
      
      // Shared tags
      const productTags = new Set(product.tags || []);
      const otherTags = other.node.tags || [];
      const sharedTags = otherTags.filter(tag => productTags.has(tag)).length;
      score += sharedTags;
      
      // Similar price range (within 30%)
      if (product.price && other.node.priceRangeV2?.minVariantPrice?.amount) {
        const priceRatio = parseFloat(other.node.priceRangeV2.minVariantPrice.amount) / parseFloat(product.price);
        if (priceRatio >= 0.7 && priceRatio <= 1.3) score += 1;
      }
      
      if (score > 0) {
        related.push({ product: other.node, score });
      }
    }
    
    // Sort by score and return top results
    return related
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(r => r.product);
  } catch (error) {
    console.error('[AI-SITEMAP] Error finding related products:', error);
    return [];
  }
}

/**
 * Batch generate all AI enhancements for a product
 * This is the main function to call
 * Uses Gemini 2.5 Flash (Lite) for fast, cost-effective generation
 */
export async function enhanceProductForSitemap(product, allProducts = [], options = {}) {
  const {
    enableSummary = true,
    enableSemanticTags = true,
    enableContextHints = true,
    enableQA = true,
    enableSentiment = true,
    enableRelated = true
  } = options;

  try {
    // Run all enhancements in parallel for speed
    // Note: Each function now returns {data, usage} from getGeminiResponse
    // Use Promise.allSettled to prevent one failure from breaking all
    const results = await Promise.allSettled([
      enableSummary ? generateAISummary(product) : Promise.resolve({data: null, usage: null}),
      enableSemanticTags ? generateSemanticTags(product) : Promise.resolve({data: null, usage: null}),
      enableContextHints ? generateContextHints(product) : Promise.resolve({data: null, usage: null}),
      enableQA ? generateProductQA(product) : Promise.resolve({data: null, usage: null}),
      enableSentiment ? analyzeSentiment(product) : Promise.resolve({data: null, usage: null})
    ]);

    // Extract successful results
    const [summaryResult, semanticTagsResult, contextHintsResult, qaResult, sentimentResult] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const names = ['summary', 'semanticTags', 'contextHints', 'qa', 'sentiment'];
        console.error(`[AI-SITEMAP] Failed to generate ${names[index]} for ${product.title}:`, result.reason);
        return {data: null, usage: null};
      }
    });

    // Find related products (synchronous, fast)
    const relatedProducts = enableRelated ? findRelatedProducts(product, allProducts) : [];

    // Collect total usage
    const totalUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
    
    [summaryResult, semanticTagsResult, contextHintsResult, qaResult, sentimentResult].forEach(result => {
      if (result?.usage) {
        totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
        totalUsage.completion_tokens += result.usage.completion_tokens || 0;
        totalUsage.total_tokens += result.usage.total_tokens || 0;
      }
    });

    const enhancedData = {
      summary: summaryResult?.data || null,
      semanticTags: semanticTagsResult?.data || null,
      contextHints: contextHintsResult?.data || null,
      qa: qaResult?.data || null,
      sentiment: sentimentResult?.data || null,
      relatedProducts,
      usage: totalUsage
    };

    return enhancedData;
  } catch (error) {
    console.error('[AI-SITEMAP] Fatal error enhancing product:', error);
    console.error('[AI-SITEMAP] Error stack:', error.stack);
    return null;
  }
}

