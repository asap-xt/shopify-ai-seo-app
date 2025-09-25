// backend/utils/shop.js
// Shop domain normalization utility

export function normalizeShop(input) {
  if (!input) return null;
  
  // Handle arrays (duplicated parameters)
  let shop = Array.isArray(input) ? input[0] : input;
  if (typeof shop !== 'string') shop = String(shop);
  
  // Remove duplicates/commas and normalize
  shop = shop.split(',')[0].trim().toLowerCase();
  
  // Add .myshopify.com if missing
  if (!shop.endsWith('.myshopify.com')) {
    shop += '.myshopify.com';
  }
  
  // Validate format
  const ok = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
  return ok ? shop : null;
}
