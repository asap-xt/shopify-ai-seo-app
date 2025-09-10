// backend/middleware/verifyRequest.js
import jwt from 'jsonwebtoken';
import Shop from '../db/Shop.js';

export async function verifyRequest(req, res, next) {
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');
  
  // Development bypass - if no session token but we have shop in query, allow it
  if (!sessionToken && req.query?.shop) {
    console.log('[VERIFY-REQUEST] Development bypass for shop:', req.query.shop);
    req.shopDomain = req.query.shop;
    req.shopAccessToken = 'mock-token-for-development';
    return next();
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