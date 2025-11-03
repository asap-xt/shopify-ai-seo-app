// backend/ai/gemini.js
// Modes:
//  - OpenRouter: GEMINI_PROVIDER=openrouter + OPENROUTER_API_KEY + GEMINI_MODEL (може да е списък)
//  - Direct Google: GEMINI_API_KEY + optional GEMINI_MODEL (може да е списък)

import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';

function clamp(str = '', max = 60) {
  const s = (str || '').trim().replace(/\s+/g, ' ');
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

function listFromEnv(value, defaults) {
  const raw = (value || '').trim();
  if (!raw) return defaults;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export async function generateWithGemini(product = {}) {
  const provider = (process.env.GEMINI_PROVIDER || '').toLowerCase(); // 'openrouter' | ''
  const title = product.title || 'Product';
  const description = product.description || '';
  const tags = Array.isArray(product.tags) ? product.tags.join(', ') : '';

  const userPrompt = `
You are an ecommerce SEO assistant.
Return concise, high-converting SEO metadata for a Shopify product.

Product:
- Title: ${title}
- Description: ${description}
- Tags: ${tags}

Output MUST be JSON:
{
  "seoTitle": "... (max 60 chars)",
  "seoDescription": "... (max 155 chars)",
  "altText": "...",
  "keywords": ["kw1","kw2","kw3","kw4","kw5"]
}
Only return JSON.
  `.trim();

  // 1) OpenRouter mode
  if (provider === 'openrouter') {
    const baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    // нови и по-евтини варианти → после pro
    const candidates = listFromEnv(
      process.env.GEMINI_MODEL,
      ['google/gemini-1.5-flash', 'google/gemini-1.5-flash-8b', 'google/gemini-1.5-pro']
    );
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is missing.');

    let lastErr = 'Unknown error';
    for (const model of candidates) {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You write concise, high-quality SEO metadata for ecommerce.' },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.4,
        }),
        timeout: 30_000,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        lastErr = `Gemini (OpenRouter) HTTP ${res.status}: ${text || res.statusText}`;
        if (res.status === 404 || /model_not_found|not found/i.test(lastErr)) {
          console.warn(`[Gemini] Model not found: ${model} → trying next`);
          continue;
        }
        throw new Error(lastErr);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || '{}';
      try {
        const parsed = JSON.parse(content);
        return {
          seoTitle: clamp(parsed.seoTitle, 60),
          seoDescription: clamp(parsed.seoDescription, 155),
          altText: parsed.altText || `Photo of ${title}`,
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        };
      } catch {
        return {
          seoTitle: clamp(`${title} | Best Price`, 60),
          seoDescription: clamp(description || `${title} – buy now.`, 155),
          altText: `Photo of ${title}`,
          keywords: [],
        };
      }
    }
    throw new Error(lastErr);
  }

  // 2) Direct Google SDK
  const apiKey = process.env.GEMINI_API_KEY || '';
  const candidates = listFromEnv(
    process.env.GEMINI_MODEL,
    ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro']
  );
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing.');

  const genAI = new GoogleGenerativeAI(apiKey);

  let lastErr = 'Unknown error';
  for (const modelId of candidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.4 },
      });
      const text = result?.response?.text?.() || '{}';

      try {
        const parsed = JSON.parse(text);
        return {
          seoTitle: clamp(parsed.seoTitle, 60),
          seoDescription: clamp(parsed.seoDescription, 155),
          altText: parsed.altText || `Photo of ${title}`,
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        };
      } catch {
        return {
          seoTitle: clamp(`${title} | Best Price`, 60),
          seoDescription: clamp(description || `${title} – buy now.`, 155),
          altText: `Photo of ${title}`,
          keywords: [],
        };
      }
    } catch (e) {
      lastErr = e?.message || String(e);
      console.warn(`[Gemini] Candidate failed (${modelId}): ${lastErr}`);
      continue;
    }
  }
  throw new Error(lastErr);
}

/**
 * Generic Gemini response function for custom prompts
 * Uses Gemini 2.5 Flash via OpenRouter for fast, cost-effective responses
 */
export async function getGeminiResponse(prompt, options = {}) {
  const {
    maxTokens = 500,
    temperature = 0.3,
    model = 'google/gemini-2.5-flash-lite' // Gemini 2.5 Flash Lite via OpenRouter
  } = options;

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
      'X-Title': 'indexAIze - Unlock AI Search'
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
}
