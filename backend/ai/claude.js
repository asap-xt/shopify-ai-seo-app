// backend/ai/claude.js
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

/**
 * Generate SEO metadata with Claude
 * Falls back to 'claude-3-5-sonnet-20240620' if CLAUDE_MODEL not set
 */
export async function generateWithClaude(product) {
  const model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20240620';

  const prompt = `
You are an ecommerce SEO assistant.
Return concise, high-converting SEO metadata for a Shopify product.
Product:
- Title: ${product.title || ''}
- Description: ${product.description || ''}
- Tags: ${(product.tags || []).join(', ')}

Output MUST be valid JSON with keys:
{
  "seoTitle": "... (max 60 chars)",
  "seoDescription": "... (max 155 chars)",
  "altText": "... (for main product image)",
  "keywords": ["kw1","kw2","kw3","kw4","kw5"]
}
Only return JSON.
  `.trim();

  const msg = await anthropic.messages.create({
    model,
    max_tokens: 600,
    temperature: 0.4,
    messages: [
      { role: 'user', content: prompt }
    ],
  });

  // Claude messages API returns an array of content blocks
  const text = msg?.content?.[0]?.text || '{}';

  try {
    const parsed = JSON.parse(text);
    return {
      seoTitle: parsed.seoTitle || '',
      seoDescription: parsed.seoDescription || '',
      altText: parsed.altText || '',
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    // Fallback if model returned non-JSON
    return {
      seoTitle: '',
      seoDescription: '',
      altText: '',
      keywords: [],
    };
  }
}
