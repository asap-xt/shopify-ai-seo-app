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
    default:           return process.env.LLAMA_API_URL || '';
  }
}

function buildCandidates(provider, envModel) {
  const m = (envModel || '').trim();
  if (provider === 'groq') {
    const base = ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile'];
    if (m && !base.includes(m)) return [m, ...base];
    return m ? [m, ...base.filter(x => x !== m)] : base;
  }
  if (provider === 'openrouter') {
    const base = ['meta-llama/llama-3.1-8b-instruct', 'meta-llama/llama-3.1-70b-instruct'];
    if (m && !base.includes(m)) return [m, ...base];
    return m ? [m, ...base.filter(x => x !== m)] : base;
  }
  return [m || 'llama-3.1-8b-instruct'];
}

export async function generateWithLlama(product = {}) {
  const provider = (process.env.LLAMA_PROVIDER || '').toLowerCase();
  const baseUrl  = inferBaseUrl(provider);
  const apiKey =
  (process.env.LLAMA_PROVIDER || '').toLowerCase() === 'openrouter'
    ? (process.env.OPENROUTER_API_KEY || process.env.LLAMA_API_KEY || '')
    : (process.env.LLAMA_API_KEY || '');

  if (!baseUrl) throw new Error('LLAMA_API_URL is not set and no known provider selected.');
  if (!apiKey)  throw new Error('LLAMA_API_KEY is missing.');

  const candidates = buildCandidates(provider, process.env.LLAMA_MODEL);
  console.log(`[Llama] Boot with provider=${provider}, models=${candidates.join(', ')}`);

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

  let lastErrText = 'Unknown error';

  for (const model of candidates) {
    try {
      console.log(`[Llama] Trying model=${model}`);
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_SITE_URL || process.env.APP_URL || 'https://indexaize.com',
          'X-Title': 'indexAIze - Unlock AI Search',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You write concise, high-quality SEO metadata for ecommerce.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.4,
        }),
        timeout: 30_000,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        lastErrText = `Llama HTTP ${res.status}: ${text || res.statusText}`;
        if (res.status === 404 || /model_not_found/i.test(text)) {
          console.warn(`[Llama] Model not found: ${model} → trying next`);
          continue;
        }
        throw new Error(lastErrText);
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
    } catch (e) {
      lastErrText = e?.message || String(e);
      console.warn(`[Llama] Candidate failed (${model}): ${lastErrText}`);
      continue;
    }
  }

  throw new Error(lastErrText);
}
