// backend/utils/tokenResolver.js
// Centralized token resolver for Shopify apps

import jwt from 'jsonwebtoken';

// Cache for session tokens to avoid repeated JWT operations
const sessionTokenCache = new Map();

// Helper to verify and decode JWT tokens
function verifyAndDecodeJWT(token, secret) {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      clockTolerance: 5
      // Remove issuer validation as Shopify uses shop-specific issuers
    });
    return decoded;
  } catch (error) {
    console.error('[TOKEN_RESOLVER] JWT verification failed:', error);
    return null;
  }
}

// Extract shop domain from JWT payload
function extractShopFromJWT(jwtToken, secret) {
  const decoded = verifyAndDecodeJWT(jwtToken, secret);
  if (decoded && decoded.dest) {
    // dest format: "https://shop-name.myshopify.com/admin"
    const shop = decoded.dest.replace('https://', '').replace('/admin', '');
    return shop;
  }
  return null;
}

export async function resolveShopToken(shopDomain) {
  console.log('[TOKEN_RESOLVER] Resolving token for shop:', shopDomain);
  
  try {
    const Shop = await import('../db/Shop.js');
    const shopDoc = await Shop.default.findOne({ shop: shopDomain }).lean();
    
    console.log('[TOKEN_RESOLVER] Found shop doc:', {
      shop: shopDoc?.shop,
      hasAccessToken: !!shopDoc?.accessToken,
      accessTokenPrefix: shopDoc?.accessToken?.substring(0, 10),
      useJWT: shopDoc?.useJWT,
      hasJWTToken: !!shopDoc?.jwtToken
    });
    
    // For embedded apps, use JWT token for session-based authentication
    if (shopDoc?.jwtToken && shopDoc?.useJWT) {
      console.log('[TOKEN_RESOLVER] Using JWT token for embedded app');
      // For embedded apps, we need to exchange JWT for session token
      // This is the proper way according to Shopify documentation
      return shopDoc.jwtToken;
    }
    
    // Fallback to OAuth access token if available
    if (shopDoc?.accessToken && shopDoc.accessToken.startsWith('shpat_')) {
      console.log('[TOKEN_RESOLVER] Using OAuth access token');
      return shopDoc.accessToken;
    }
  } catch (err) {
    console.error('[TOKEN_RESOLVER] Error loading shop:', err);
  }
  
  // Fallback to env token for development
  const envToken = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || 
                   process.env.SHOPIFY_ACCESS_TOKEN ||
                   process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (envToken && envToken.startsWith('shpat_')) {
    console.log('[TOKEN_RESOLVER] Using fallback env token');
    return envToken;
  }
  
  console.error('[TOKEN_RESOLVER] No valid access token found for shop:', shopDomain);
  throw new Error('No valid access token available. App needs to be installed.');
}



// Export additional utilities
export { verifyAndDecodeJWT, extractShopFromJWT };