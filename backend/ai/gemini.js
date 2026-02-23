// backend/ai/gemini.js
// Gemini helper using OpenRouter
// PHASE 1 OPTIMIZATION: Wrapped with AI Queue for rate limiting
// Modified: 30 Nov 2024

import fetch from 'node-fetch';
import aiQueue from '../services/aiQueue.js';

/**
 * Generic Gemini response function for custom prompts
 * Uses Gemini 2.5 Flash via OpenRouter for fast, cost-effective responses
 * NOW WITH RATE LIMITING via AI Queue
 * 
 * @param {string} prompt - The prompt to send to Gemini
 * @param {object} options - Options for the request
 * @param {number} options.maxTokens - Maximum tokens in response (default: 500)
 * @param {number} options.temperature - Temperature for generation (default: 0.3)
 * @param {string} options.model - Model to use (default: 'google/gemini-2.5-flash-lite')
 * @param {string} options.priority - Queue priority: 'high' | 'normal' | 'bulk' (default: 'normal')
 * @returns {Promise<{content: string, usage: object}>}
 */
export async function getGeminiResponse(prompt, options = {}) {
  const {
    maxTokens = 500,
    temperature = 0.3,
    model = 'google/gemini-2.5-flash-lite', // Gemini 2.5 Flash Lite via OpenRouter
    priority = 'normal' // NEW: priority option
  } = options;

  // Wrap API call in queue based on priority
  const queueFn = async () => {
    const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is missing.');
    }

    console.log('[GEMINI] Calling OpenRouter with model:', model);
    console.log('[GEMINI] Prompt length:', prompt.length, 'chars');
    console.log('[GEMINI] Max tokens:', maxTokens, 'Temperature:', temperature);

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || process.env.APP_URL || 'https://indexaize.com',
        'X-Title': 'indexAIze - AI Discovery & SEO'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' }
      }),
      timeout: 30_000,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[GEMINI] OpenRouter error:', res.status, text);
      throw new Error(`Gemini (OpenRouter) HTTP ${res.status}: ${text || res.statusText}`);
    }

    const data = await res.json();
    console.log('[GEMINI] OpenRouter response received, tokens used:', data?.usage?.total_tokens || 'unknown');
    
    const content = data?.choices?.[0]?.message?.content || '';
    console.log('[GEMINI] Response length:', content.length, 'chars');
    
    // Return both content and usage
    return {
      content,
      usage: data?.usage || null
    };
  };

  // Add to appropriate queue based on priority
  if (priority === 'high') {
    return aiQueue.addHighPriority(queueFn, { model, promptLength: prompt.length });
  } else if (priority === 'bulk') {
    return aiQueue.addBulk(queueFn, { model, promptLength: prompt.length });
  } else {
    return aiQueue.add(queueFn, { model, promptLength: prompt.length });
  }
}
