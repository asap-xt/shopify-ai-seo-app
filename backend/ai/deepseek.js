import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

// DeepSeek SEO generation endpoint
const DEEPSEEK_ENDPOINT = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.ai/v1/seo';

/**
 * Generate SEO metadata for a product using DeepSeek
 * @param {{ title: string, description: string, tags: string[] }} product
 * @returns {Promise<{ seoTitle: string, seoDescription: string, altText: string, keywords: string[] }>}
 */
export async function generateWithDeepSeek(product) {
  const { title, description, tags } = product;

  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({ title, description, tags })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error: ${errorText}`);
  }

  const data = await response.json();
  // Expecting { seoTitle, seoDescription, altText, keywords }
  if (!data.seoTitle || !data.seoDescription) {
    throw new Error(`Invalid response from DeepSeek: ${JSON.stringify(data)}`);
  }

  return {
    seoTitle: data.seoTitle,
    seoDescription: data.seoDescription,
    altText: data.altText,
    keywords: data.keywords || []
  };
}
