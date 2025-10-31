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

export function attachShop(req, _res, next) {
  const qShop  = Array.isArray(req.query.shop) ? req.query.shop[0] : req.query.shop;
  const bShop  = Array.isArray(req.body?.shop) ? req.body.shop[0] : req.body?.shop;
  const sShop  = Array.isArray(req.session?.shop) ? req.session.shop[0] : req.session?.shop;
  const pShop  = Array.isArray(req.params?.shop) ? req.params.shop[0] : req.params?.shop;
  const raw    = qShop ?? bShop ?? sShop ?? pShop ?? shopFromHostQuery(req);

  req.shopDomain = normalizeShop(raw); // винаги низ или null
  
  next();
}
