// backend/middleware/attachShop.js
// Middleware to normalize and attach shop domain to request

import { normalizeShop } from '../utils/shop.js';

export function attachShop(req, _res, next) {
  console.log('[ATTACH_SHOP] Raw shop from query:', req.query?.shop);
  console.log('[ATTACH_SHOP] Raw shop from body:', req.body?.shop);
  
  const raw = req.query?.shop ?? req.body?.shop ?? req.session?.shop;
  req.shopDomain = normalizeShop(raw);
  
  console.log('[ATTACH_SHOP] Normalized shop domain:', req.shopDomain);
  
  next();
}
