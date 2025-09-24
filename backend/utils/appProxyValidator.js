// App Proxy HMAC verification utility
import crypto from 'crypto';

/**
 * Verify App Proxy request signature
 * @param {Object} req - Express request object
 * @param {string} secret - App secret from environment
 * @returns {boolean} - Whether the request is valid
 */
export function verifyAppProxyRequest(req, secret) {
  try {
    const signature = req.query.signature;
    if (!signature) {
      console.log('[APP_PROXY] No signature provided');
      return false;
    }

    // Remove signature from query parameters for verification
    const queryParams = { ...req.query };
    delete queryParams.signature;

    // Create query string for verification
    const queryString = Object.keys(queryParams)
      .sort()
      .map(key => `${key}=${queryParams[key]}`)
      .join('');

    // Create HMAC
    const hmac = crypto
      .createHmac('sha256', secret)
      .update(queryString)
      .digest('hex');

    // Compare signatures
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(hmac, 'hex')
    );

    console.log('[APP_PROXY] HMAC verification:', isValid ? 'VALID' : 'INVALID');
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
  console.log('[APP_PROXY] Verifying App Proxy request...');
  console.log('[APP_PROXY] Query params:', req.query);
  console.log('[APP_PROXY] Headers:', req.headers);

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error('[APP_PROXY] No SHOPIFY_API_SECRET found');
    return res.status(500).send('Server configuration error');
  }

  if (verifyAppProxyRequest(req, secret)) {
    console.log('[APP_PROXY] Request verified, proceeding...');
    next();
  } else {
    console.log('[APP_PROXY] Request verification failed');
    res.status(401).send('Unauthorized');
  }
}
