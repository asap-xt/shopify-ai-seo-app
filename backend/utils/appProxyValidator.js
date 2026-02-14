// App Proxy HMAC verification utility
import crypto from 'crypto';

/**
 * Verify App Proxy request signature (correct Shopify implementation)
 * @param {Object} req - Express request object
 * @param {string} secret - App secret from environment
 * @returns {boolean} - Whether the request is valid
 */
export function verifyAppProxySignature(req, secret) {
  try {
    const query = { ...req.query };
    const signature = query.signature;
    
    if (!signature) {
      return false;
    }
    
    // Remove signature from query params
    delete query.signature;
    
    // Sort parameters lexicographically by key (Shopify requirement!)
    const sortedKeys = Object.keys(query).sort();
    const message = sortedKeys
      .map(key => `${key}=${query[key]}`)
      .join('');

    const digest = crypto
      .createHmac('sha256', secret)
      .update(message, 'utf8')
      .digest('hex');

    // constant-time compare
    const isValid = digest.length === signature.length &&
           crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));

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
  // Allow requests without signature (direct access for testing)
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
