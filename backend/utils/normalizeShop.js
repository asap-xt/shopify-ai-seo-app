// backend/utils/normalizeShop.js
// Унифицирана нормализация на shop domain

export function normalizeShop(input) {
  let v = Array.isArray(input) ? input[0] : input;
  if (!v) return null;
  v = String(v).trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/admin.*$/, '')
    .replace(/[, ].*$/, '') // в случай на "a,b"
    .toLowerCase();
  if (!v.endsWith('.myshopify.com')) v = `${v}.myshopify.com`;
  return v;
}
