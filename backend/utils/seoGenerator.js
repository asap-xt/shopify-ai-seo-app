import { generateWithOpenAI } from '../ai/openai.js';
import { generateWithClaude } from '../ai/claude.js';
import { generateWithGemini } from '../ai/gemini.js';
import { generateWithDeepSeek } from '../ai/deepseek.js';
import { generateWithLlama } from '../ai/llama.js';
import { generateWithMock } from '../ai/mock.js';

/**
 * Generate SEO metadata for a product using the specified provider
 * @param {{ title: string, description: string, tags: string[] }} product
 * @param {string} provider - one of 'openai', 'claude', 'gemini', 'deepseek', 'llama'
 * @returns {Promise<{ seoTitle: string, seoDescription: string, altText: string, keywords: string[] }>}
 */
export async function generateSEO(product, provider) {
  switch (provider) {
    case 'mock':
      return await generateWithMock(product);
    case 'openai':
      return await generateWithOpenAI(product);
    case 'claude':
      return await generateWithClaude(product);
    case 'gemini':
      return await generateWithGemini(product);
    case 'deepseek':
      return await generateWithDeepSeek(product);
    case 'llama':
      return await generateWithLlama(product);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
