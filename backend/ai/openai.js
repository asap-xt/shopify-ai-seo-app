// backend/ai/openai.js
// Works in two modes:
// 1) Direct OpenAI: uses OPENAI_API_KEY + OPENAI_MODEL (e.g. gpt-4o-mini)
// 2) OpenRouter hub: set OPENAI_PROVIDER=openrouter + OPENROUTER_API_KEY + OPENAI_MODEL (e.g. openai/gpt-4o-mini)

import fetch from 'node-fetch';

function clamp(str = '', max = 60) {
  const s = (str || '').trim().replace(/\s+/g, ' ');
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

export async function generateWithOpenAI(product = {}) {
  const provider = (process.env.OPENAI_PROVIDER || '').toLowerCase(); // 'openrouter' | ''
  const isOpenRouter = provider === 'openrouter';

  const baseUrl = isOpenRouter
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  const apiKey = isOpenRouter
    ? (process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '')
    : (process.env.OPENAI_API_KEY || '');

  // Default model: OpenRouter expects vendor-prefixed slugs like 'openai/gpt-4o-mini'
  const model = isOpenRouter
    ? (process.env.OPENAI_MODEL || 'openai/gpt-4o-mini')
    : (process.env.OPENAI_MODEL || 'gpt-4o-mini');

  if (!apiKey) {
    throw new Error(isOpenRouter ? 'OPENROUTER_API_KEY is missing.' : 'OPENAI_API_KEY is missing.');
  }

  const title = product.title || 'Product';
  const description = product.description || '';
  const tags = Array.isArray(product.tags) ? product.tags.join(', ') : '';

  const prompt = `
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

  // Optional OpenRouter headers (nice-to-have, not required)
  const extraHeaders = isOpenRouter
    ? {
        // 'HTTP-Referer': process.env.BASE_URL || '',
        // 'X-Title': 'AI SEO 2.0',
      }
    : {};

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You write concise, high-quality SEO metadata for ecommerce.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      // response_format: { type: 'json_object' } // works on OpenAI; OpenRouter passes through for many models, but keep simple
    }),
    timeout: 30_000,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${text || res.statusText}`);
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
    // safe fallback if the model didn’t return strict JSON
    return {
      seoTitle: clamp(`${title} | Best Price`, 60),
      seoDescription: clamp(description || `${title} – buy now.`, 155),
      altText: `Photo of ${title}`,
      keywords: [],
    };
  }
}
