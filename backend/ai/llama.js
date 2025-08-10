// backend/ai/llama.js
import fetch from 'node-fetch';

function clamp(str = '', max = 60) {
  const s = (str || '').trim().replace(/\s+/g, ' ');
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

function inferBaseUrl(provider) {
  switch (provider) {
    case 'groq':       return 'https://api.groq.com/openai/v1/chat/completions';
    case 'together':   return 'https://api.together.xyz/v1/chat/completions';
    case 'fireworks':  return 'https://api.fireworks.ai/inference/v1/chat/completions';
    case 'openrouter': return 'https://openrouter.ai/api/v1/chat/completions';
    default:           return process.env.LLAMA_API_URL || ''; // custom/self-hosted
  }
}

export async function generateWithLlama(product = {}) {
  const provider = (process.env.LLAMA_PROVIDER || '').toLowerCase(); // groq|together|fireworks|openrouter|''
  const baseUrl  = inferBaseUrl(provider);
  const apiKey   = process.env.LLAMA_API_KEY || '';
  const model    = process.env.LLAMA_MODEL || (
    provider === 'openrouter' ? 'meta-llama/llama-3.1-8b-instruct' :
    'llama-3.1-8b-instruct'
  );

  if (!baseUrl) {
    throw new Error(
      'LLAMA_API_URL is not set and no known provider selected. Set LLAMA_PROVIDER=groq|together|fireworks|openrouter OR provide LLAMA_API_URL.',
    );
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

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You write concise, high-quality SEO metadata for ecommerce.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4
    }),
    timeout: 30_000,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Llama HTTP ${res.status}: ${text || res.statusText}`);
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
