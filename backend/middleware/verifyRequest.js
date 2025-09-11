// backend/middleware/verifyRequest.js
import jwt from 'jsonwebtoken';
import Shop from '../db/Shop.js';

export async function verifyRequest(req, res, next) {
  console.log('[VERIFY-REQUEST] ===== MIDDLEWARE CALLED =====');
  console.log('[VERIFY-REQUEST] Starting verification for:', req.originalUrl);
  console.log('[VERIFY-REQUEST] Method:', req.method);
  console.log('[VERIFY-REQUEST] Params:', req.params);
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');
  console.log('[VERIFY-REQUEST] Session token:', sessionToken ? 'present' : 'missing');
  console.log('[VERIFY-REQUEST] Query shop:', req.query?.shop);
  
  // Extract shop from URL path if present (e.g., /api/languages/shop/shopname.myshopify.com)
  let shopFromPath = null;
  const pathMatch = req.originalUrl.match(/\/shop\/([^\/\?]+)/);
  if (pathMatch) {
    shopFromPath = pathMatch[1];
    console.log('[VERIFY-REQUEST] Shop from path:', shopFromPath);
  }
  
  // Also check req.params for shop parameter
  if (req.params?.shop) {
    shopFromPath = req.params.shop;
    console.log('[VERIFY-REQUEST] Shop from params:', shopFromPath);
  }
  
  // Development bypass - if no session token but we have shop in query or path, allow it
  const shop = req.query?.shop || shopFromPath;
  console.log('[VERIFY-REQUEST] Checking conditions:', { sessionToken: !!sessionToken, shop });
  if (!sessionToken && shop) {
    console.log('[VERIFY-REQUEST] Development bypass for shop:', shop);
    req.shopDomain = shop;
    req.shopAccessToken = 'mock-token-for-development';
    console.log('[VERIFY-REQUEST] About to call next()');
    try {
      next();
      console.log('[VERIFY-REQUEST] next() called successfully');
    } catch (error) {
      console.error('[VERIFY-REQUEST] Error calling next():', error);
    }
    return;
  }
  
  if (!sessionToken) {
    return res.status(401).json({ error: 'Unauthorized: missing session token' });
  }

  try {
    // Decode without verification first to get the shop
    const decoded = jwt.decode(sessionToken);
    const shop = decoded?.dest?.replace('https://', '').replace('/admin', '');
    
    if (!shop) {
      return res.status(401).json({ error: 'Invalid session token' });
    }

    // Get shop record to verify it's installed
    const shopRecord = await Shop.findOne({ shop });
    if (!shopRecord || !shopRecord.accessToken) {
      return res.status(401).json({ error: 'Shop not installed' });
    }

    // Verify the token with Shopify's secret
    jwt.verify(sessionToken, process.env.SHOPIFY_API_SECRET, {
      algorithms: ['HS256'],
      audience: process.env.SHOPIFY_API_KEY,
      issuer: `https://${shop}/admin`
    });

    // Attach shop info to request
    req.shopDomain = shop;
    req.shopAccessToken = shopRecord.accessToken;
    next();
  } catch (error) {
    console.error('Session token verification failed:', error);
    return res.status(401).json({ error: 'Invalid session token' });
  }
}