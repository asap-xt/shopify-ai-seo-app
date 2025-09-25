// backend/middleware/attachShop.js
// Middleware to normalize and attach shop domain to request

import { normalizeShop } from '../utils/normalizeShop.js';

function shopFromHostQuery(req) {
  const host = req.query?.host;
  if (!host) return null;
  try {
    const decoded = Buffer.from(host, 'base64').toString('utf8'); // admin.shopify.com/store/<shop>
    const m = decoded.match(/store\/([^/?]+)/);
    return m ? `${m[1]}.myshopify.com` : null;
  } catch { return null; }
}

export function attachShop(req, res, next) {
  console.log('[ATTACH_SHOP] Raw shop from query:', req.query?.shop);
  console.log('[ATTACH_SHOP] Raw shop from body:', req.body?.shop);
  
  const raw =
    req.query?.shop ??
    req.body?.shop ??
    req.session?.shop ??
    shopFromHostQuery(req);

  const shop = normalizeShop(raw);
  req.shopDomain = shop;
  res.locals.shop = shop;
  
  console.log('[ATTACH_SHOP] Normalized shop domain:', shop);
  
  next();
}
