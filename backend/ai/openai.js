// backend/ai/openai.js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate SEO metadata with OpenAI.
 * Falls back to model 'gpt-4o-mini' if OPENAI_MODEL not set.
 */
export async function generateWithOpenAI(product) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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
  `.trim();

  // Ask the model to return strict JSON
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'You write concise, high-quality SEO metadata for ecommerce.' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' }, // supported by gpt-4o-mini family
    temperature: 0.4,
  });

  const raw = completion.choices?.[0]?.message?.content || '{}';

  // Safe JSON parse
  try {
    const parsed = JSON.parse(raw);
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
