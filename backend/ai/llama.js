import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

// Llama 3.1 inference endpoint
// Define LLAMA_API_URL in .env, e.g. https://api.llama.ai/v1/generate
const LLAMA_ENDPOINT = process.env.LLAMA_API_URL;

/**
 * Generate SEO metadata for a product using Llama 3.1
 * @param {{ title: string, description: string, tags: string[] }} product
 * @returns {Promise<{ seoTitle: string, seoDescription: string, altText: string, keywords: string[] }>}
 */
export async function generateWithLlama(product) {
  if (!LLAMA_ENDPOINT) {
    throw new Error('LLAMA_API_URL not configured in environment');
  }

  const { title, description, tags } = product;
  const payload = {
    model: 'llama-3.1',
    prompt: `Generate SEO metadata for the following product:\nTitle: ${title}\nDescription: ${description}\nTags: ${tags.join(', ')}\n\nRespond with valid JSON with keys: seoTitle, seoDescription, altText, keywords. Only return the JSON.`,
    max_tokens: 512,
    temperature: 0.7
  };

  const response = await fetch(LLAMA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LLAMA_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Llama API error: ${errText}`);
  }

  const data = await response.json();
  const content = data.text || data.output;
  if (!content) {
    throw new Error(`No output from Llama: ${JSON.stringify(data)}`);
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`Invalid JSON response from Llama: ${content}`);
  }
}
