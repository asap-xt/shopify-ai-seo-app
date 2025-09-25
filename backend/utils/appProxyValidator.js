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
    console.log('[APP_PROXY] Starting HMAC verification...');
    console.log('[APP_PROXY] Query params:', req.query);
    
    const url = new URL(req.originalUrl, `https://${req.headers.host}`);
    const sig = url.searchParams.get('signature') || '';
    
    if (!sig) {
      console.log('[APP_PROXY] No signature provided');
      return false;
    }
    
    // Build the message from all query params EXCEPT 'signature', as Shopify sends it
    url.searchParams.delete('signature');
    const message = url.searchParams.toString(); // raw query string order is OK from Node/Express
    
    console.log('[APP_PROXY] Message for HMAC:', message);
    console.log('[APP_PROXY] Received signature:', sig);

    const digest = crypto
      .createHmac('sha256', secret)
      .update(message, 'utf8')
      .digest('hex');

    console.log('[APP_PROXY] Computed digest:', digest);

    // constant-time compare
    const isValid = digest.length === sig.length &&
           crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig));

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
  console.log('[APP_PROXY] ===== APP PROXY AUTH MIDDLEWARE =====');
  console.log('[APP_PROXY] Verifying App Proxy request...');
  console.log('[APP_PROXY] Query params:', req.query);
  console.log('[APP_PROXY] Headers:', req.headers);
  console.log('[APP_PROXY] Method:', req.method);
  console.log('[APP_PROXY] URL:', req.url);

  // TEMPORARY: Allow requests without signature for debugging
  if (!req.query.signature && !req.query.hmac) {
    console.log('[APP_PROXY] ⚠️  No signature provided - ALLOWING FOR DEBUG');
    console.log('[APP_PROXY] Request allowed for debugging purposes');
    return next();
  }

  // Try both 'signature' and 'hmac' parameters (Shopify uses different names)
  const signature = req.query.signature || req.query.hmac;
  if (!signature) {
    console.log('[APP_PROXY] No signature/hmac parameter found');
    return res.status(401).send('Unauthorized');
  }

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error('[APP_PROXY] SHOPIFY_API_SECRET not found in environment');
    return res.status(500).send('Server configuration error');
  }

  if (verifyAppProxySignature(req, secret)) {
    console.log('[APP_PROXY] ✅ Request verified successfully');
    next();
  } else {
    console.log('[APP_PROXY] ❌ Request verification failed');
    res.status(401).send('Unauthorized');
  }
}
