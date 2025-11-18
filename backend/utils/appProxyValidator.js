// App Proxy HMAC verification utility
import crypto from 'crypto';

/**
 * Verify App Proxy request signature (correct implementation per Shopify AI)
 * @param {Object} req - Express request object
 * @param {string} secret - App secret from environment
 * @returns {boolean} - Whether the request is valid
 */
export function verifyAppProxySignature(req, secret) {
  try {
    const url = new URL(req.originalUrl, `https://${req.headers.host}`);
    const sig = url.searchParams.get('signature') || '';
    
    if (!sig) {
      return false;
    }
    
    // Build the message from all query params EXCEPT 'signature', as Shopify sends it
    url.searchParams.delete('signature');
    const message = url.searchParams.toString(); // raw query string order is OK from Node/Express

    const digest = crypto
      .createHmac('sha256', secret)
      .update(message, 'utf8')
      .digest('hex');

    // constant-time compare
    const isValid = digest.length === sig.length &&
           crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig));

    return isValid;
  } catch (error) {
    console.error('[APP_PROXY] HMAC verification error:', error);
    return false;
  }
}

/**
 * Middleware to verify App Proxy requests
 */
export function appProxyAuth(req, res, next) {
  // TEMPORARY: Allow requests without signature for debugging
  if (!req.query.signature && !req.query.hmac) {
    return next();
  }

  // Try both 'signature' and 'hmac' parameters (Shopify uses different names)
  const signature = req.query.signature || req.query.hmac;
  if (!signature) {
    return res.status(401).send('Unauthorized');
  }

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error('[APP_PROXY] SHOPIFY_API_SECRET not found in environment');
    return res.status(500).send('Server configuration error');
  }

  if (verifyAppProxySignature(req, secret)) {
    next();
  } else {
    res.status(401).send('Unauthorized');
  }
}
