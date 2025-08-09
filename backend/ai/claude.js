import { Anthropic, HUMAN_PROMPT } from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
 dotenv.config();

// Initialize Anthropic Claude client with API key from .env
const claude = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

/**
 * Generate SEO metadata for a product using Anthropic Claude
 * @param {{ title: string, description: string, tags: string[] }} product
 * @returns {Promise<{ seoTitle: string, seoDescription: string, altText: string, keywords: string[] }>}
 */
export async function generateWithClaude(product) {
  const { title, description, tags } = product;
  const prompt = `${HUMAN_PROMPT}Generate SEO metadata for the following product:
Title: ${title}
Description: ${description}
Tags: ${tags.join(", ")}

Respond with valid JSON following this structure:
{
  "seoTitle": "...",
  "seoDescription": "...",
  "altText": "...",
  "keywords": ["...", "..."]
}
Only return the JSON.${AI_PROMPT}`;

  const response = await claude.complete({
    model: 'claude-v1',
    prompt,
    max_tokens_to_sample: 500,
    temperature: 0.7,
  });

  const content = response.completion;

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON response from Claude: ${content}`);
  }
}