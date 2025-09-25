// backend/middleware/attachIdToken.js
export function attachIdToken(req, _res, next) {
  const auth = req.headers['authorization'];
  const alt  = req.headers['x-shopify-id-token'];
  const bearer = auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  req.idToken = bearer || (alt ? String(alt).trim() : null);
  next();
}
