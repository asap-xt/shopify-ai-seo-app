// backend/middleware/attachIdToken.js
export function attachIdToken(req, _res, next) {
  const h = req.headers['authorization'] || req.headers['Authorization'] || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : null;
  // allow both header and ?id_token=
  req.idToken = req.query?.id_token || bearer || null;
  next();
}
