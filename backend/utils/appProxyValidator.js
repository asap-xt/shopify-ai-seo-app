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
    console.log('[APP_PROXY] Starting HMAC verification...');
    console.log('[APP_PROXY] Query params:', req.query);
    
    const signature = req.query.signature;
    if (!signature) {
      console.log('[APP_PROXY] No signature provided');
      return false;
    }

    // Remove signature from query parameters for verification
    const queryParams = { ...req.query };
    delete queryParams.signature;
    
    console.log('[APP_PROXY] Query params without signature:', queryParams);

    // Sort parameters by key (alphabetical order)
    const sortedKeys = Object.keys(queryParams).sort();
    console.log('[APP_PROXY] Sorted keys:', sortedKeys);

    // Try different query string formats as per various Shopify documentation
    const queryStringFormats = [
      // Format 1: With '&' separator (most common)
      sortedKeys.map(key => `${key}=${queryParams[key]}`).join('&'),
      // Format 2: Without separator (some documentation suggests this)
      sortedKeys.map(key => `${key}=${queryParams[key]}`).join(''),
      // Format 3: With '&' and sorted by value too
      sortedKeys.sort().map(key => `${key}=${queryParams[key]}`).join('&'),
      // Format 4: URL encoded values
      sortedKeys.map(key => `${key}=${encodeURIComponent(queryParams[key])}`).join('&'),
      // Format 5: URL encoded keys and values
      sortedKeys.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`).join('&'),
      // Format 6: Raw query string from request
      req.url.split('?')[1]?.replace(/[?&]signature=[^&]*/, '').replace(/[?&]hmac=[^&]*/, '') || ''
    ];
    
    console.log('[APP_PROXY] Trying different query string formats:');
    queryStringFormats.forEach((format, index) => {
      console.log(`[APP_PROXY] Format ${index + 1}:`, format);
    });

    // Try each format until one works
    let isValid = false;
    let workingFormat = -1;
    let workingAlgorithm = '';
    
    // Try different algorithms and formats
    const algorithms = ['sha256', 'sha1'];
    
    for (let i = 0; i < queryStringFormats.length; i++) {
      const queryString = queryStringFormats[i];
      
      for (const algorithm of algorithms) {
        const hmac = crypto
          .createHmac(algorithm, secret)
          .update(queryString)
          .digest('hex');
        
        console.log(`[APP_PROXY] Format ${i + 1} ${algorithm.toUpperCase()} HMAC:`, hmac);
        
        if (hmac === signature) {
          isValid = true;
          workingFormat = i + 1;
          workingAlgorithm = algorithm;
          console.log(`[APP_PROXY] ✅ HMAC matches with format ${workingFormat} and algorithm ${algorithm}!`);
          break;
        }
      }
      
      if (isValid) break;
    }
    
    if (!isValid) {
      console.log('[APP_PROXY] ❌ No format matched the signature');
      console.log('[APP_PROXY] Received signature:', signature);
    }

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

  if (verifyAppProxyRequest(req, secret)) {
    console.log('[APP_PROXY] ✅ Request verified successfully');
    next();
  } else {
    console.log('[APP_PROXY] ❌ Request verification failed');
    res.status(401).send('Unauthorized');
  }
}
