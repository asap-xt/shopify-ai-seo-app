// backend/ai/claude.js
// Modes:
//  - OpenRouter: CLAUDE_PROVIDER=openrouter + OPENROUTER_API_KEY + CLAUDE_MODEL (може да е списък)
//  - Direct Anthropic: CLAUDE_API_KEY + optional CLAUDE_MODEL (може да е списък)

import fetch from 'node-fetch';

function clamp(str = '', max = 60) {
  const s = (str || '').trim().replace(/\s+/g, ' ');
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

function listFromEnv(value, defaults) {
  const raw = (value || '').trim();
  if (!raw) return defaults;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export async function generateWithClaude(product = {}) {
  const provider = (process.env.CLAUDE_PROVIDER || '').toLowerCase(); // 'openrouter' | ''
  const isOpenRouter = provider === 'openrouter';

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

  // 1) OpenRouter mode (препоръчително)
  if (isOpenRouter) {
    const baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY || '';
    // Балансиран (нов) → по-евтин:
    const candidates = listFromEnv(
      process.env.CLAUDE_MODEL,
      ['anthropic/claude-3.5-sonnet', 'anthropic/claude-3.5-haiku']
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
        lastErr = `Claude (OpenRouter) HTTP ${res.status}: ${text || res.statusText}`;
        // ако моделът липсва/недостъпен – пробваме следващия
        if (res.status === 404 || /model_not_found|not found/i.test(text)) {
          console.warn(`[Claude] Model not found: ${model} → trying next`);
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

  // 2) Direct Anthropic mode
  const apiKey = process.env.CLAUDE_API_KEY || '';
  const candidates = listFromEnv(
    process.env.CLAUDE_MODEL,
    ['claude-3-5-sonnet-20240620', 'claude-3-5-haiku-20241022'] // ако вторият не е наличен, първият стига
  );
  if (!apiKey) throw new Error('CLAUDE_API_KEY is missing.');

  let lastErr = 'Unknown error';
  for (const model of candidates) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        temperature: 0.4,
        system: 'You write concise, high-quality SEO metadata for ecommerce.',
        messages: [{ role: 'user', content: userPrompt }],
      }),
      timeout: 30_000,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      lastErr = `Claude (Anthropic) HTTP ${res.status}: ${text || res.statusText}`;
      if (res.status === 404 || /model_not_found|not found/i.test(lastErr)) {
        console.warn(`[Claude] Model not found: ${model} → trying next`);
        continue;
      }
      throw new Error(lastErr);
    }

    const data = await res.json();
    const content = data?.content?.[0]?.text || '{}';
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
