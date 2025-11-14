export default function csp(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com https://youtu.be"
  );
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  next();
}
