// backend/ai/openrouter.js
// Single driver that calls OpenRouter (OpenAI-compatible) in JSON mode.

export async function callOpenRouterJSON({ model, system, user }) {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY');

  const url = `${baseUrl}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || process.env.APP_URL || 'https://indexaize.com',
      'X-Title': 'indexAIze - Unlock AI Search',
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenRouter HTTP ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  const text = json?.choices?.[0]?.message?.content || '';
  const usage = json?.usage || {};
  
  return {
    text,
    model: json?.model || model,
    usage: {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
      total_cost: usage.total_cost || null // OpenRouter sometimes provides cost in USD
    },
    // Legacy field for backward compatibility
    tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    costUsd: usage.total_cost || 0
  };
}
