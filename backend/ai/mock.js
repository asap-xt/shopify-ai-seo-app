// backend/ai/mock.js
// Local/deterministic SEO generator for testing, no external API calls.

function clamp(str = '', max = 60) {
  if (!str) return '';
  const s = str.trim().replace(/\s+/g, ' ');
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

function topKeywords(title = '', tags = []) {
  const words = (title.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(w => w.length > 2);
  const base = Array.from(new Set([...(tags || []).map(t => String(t).toLowerCase()), ...words]));
  return base.slice(0, 8);
}

export async function generateWithMock(product = {}) {
  const title = product.title || 'Product';
  const desc = product.description || '';
  const tags = Array.isArray(product.tags) ? product.tags : [];

  const seoTitle = clamp(`${title} | Best Price`, 60);
  const summary = (desc || `${title} – buy now.`).replace(/\s+/g, ' ').trim();
  const seoDescription = clamp(summary, 155);
  const altText = `Photo of ${title}`;
  const keywords = topKeywords(title, tags);

  return { seoTitle, seoDescription, altText, keywords };
}
