import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

// Google Gemini via Vertex AI Generative Language API
const GEMINI_ENDPOINT = 
  'https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generateText';

/**
 * Generate SEO metadata for a product using Google Gemini (Text-Bison)
 * @param {{ title: string, description: string, tags: string[] }} product
 * @returns {Promise<{ seoTitle: string, seoDescription: string, altText: string, keywords: string[] }>}
 */
export async function generateWithGemini(product) {
  const { title, description, tags } = product;
  const prompt = `Generate SEO metadata for the following product:
Title: ${title}
Description: ${description}
Tags: ${tags.join(', ')}

Respond with valid JSON following this structure:
{
  "seoTitle": "...",
  "seoDescription": "...",
  "altText": "...",
  "keywords": ["...", "..."]
}
Only return the JSON.`;

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, temperature: 0.7, candidateCount: 1 })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${err}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.output;
  if (!content) {
    throw new Error(`No output from Gemini: ${JSON.stringify(data)}`);
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON response from Gemini: ${content}`);
  }
}
