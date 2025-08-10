// backend/ai/deepseek.js
import fetch from 'node-fetch';

function clamp(str = '', max = 60) {
  const s = (str || '').trim().replace(/\s+/g, ' ');
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

export async function generateWithDeepSeek(product = {}) {
  const provider = (process.env.DEEPSEEK_PROVIDER || '').toLowerCase(); // 'openrouter' | ''
  let baseUrl = process.env.DEEPSEEK_API_URL || '';
  let apiKey = process.env.DEEPSEEK_API_KEY || '';
  let model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  // Optional: route чрез OpenRouter (ако ползваш OPENROUTER_API_KEY)
  if (provider === 'openrouter') {
    baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    apiKey = process.env.OPENROUTER_API_KEY || apiKey;
    model = process.env.DEEPSEEK_MODEL || 'deepseek/deepseek-chat';
  }

  if (!baseUrl) {
    throw new Error('DEEPSEEK_API_URL is not set.');
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
    throw new Error(`DeepSeek HTTP ${res.status}: ${text || res.statusText}`);
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
