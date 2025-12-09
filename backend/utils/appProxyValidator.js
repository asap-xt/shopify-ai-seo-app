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
      console.log('[APP_PROXY] No signature in query params');
      return false;
    }
    
    // Remove signature from query params
    delete query.signature;
    
    // Sort parameters lexicographically by key (Shopify requirement!)
    const sortedKeys = Object.keys(query).sort();
    const message = sortedKeys
      .map(key => `${key}=${query[key]}`)
      .join('');
    
    console.log('[APP_PROXY] HMAC message:', message);
    console.log('[APP_PROXY] Expected signature:', signature);
    
    const digest = crypto
      .createHmac('sha256', secret)
      .update(message, 'utf8')
      .digest('hex');
    
    console.log('[APP_PROXY] Calculated digest:', digest);

    // constant-time compare
    const isValid = digest.length === signature.length &&
           crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));

    console.log('[APP_PROXY] Signature valid:', isValid);
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
  console.log('[APP_PROXY_AUTH] Checking request:', req.path);
  console.log('[APP_PROXY_AUTH] Query params:', JSON.stringify(req.query));
  
  // TEMPORARY: Allow requests without signature for debugging
  if (!req.query.signature && !req.query.hmac) {
    console.log('[APP_PROXY_AUTH] No signature, allowing through');
    return next();
  }

  // Try both 'signature' and 'hmac' parameters (Shopify uses different names)
  const signature = req.query.signature || req.query.hmac;
  if (!signature) {
    console.log('[APP_PROXY_AUTH] Missing signature');
    return res.status(401).send('Unauthorized');
  }

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error('[APP_PROXY] SHOPIFY_API_SECRET not found in environment');
    return res.status(500).send('Server configuration error');
  }

  if (verifyAppProxySignature(req, secret)) {
    console.log('[APP_PROXY_AUTH] Signature verified, proceeding');
    next();
  } else {
    console.log('[APP_PROXY_AUTH] Signature verification FAILED');
    res.status(401).send('Unauthorized');
  }
}
