export default function csp(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com"
  );
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  next();
}
