// backend/middleware/attachIdToken.js
// Middleware to extract id_token from Authorization header or query params
// and attach it to req.idToken for use in Token Exchange

export function attachIdToken(req, _res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  req.idToken = req.query.id_token || bearerToken || null;
  
  if (req.idToken) {
    console.log('[ATTACH_ID_TOKEN] Found id_token for Token Exchange');
  } else {
    console.log('[ATTACH_ID_TOKEN] No id_token found - Token Exchange may fail');
  }
  
  next();
}
