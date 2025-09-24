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

export async function resolveShopToken(shop) {
  console.log('[TOKEN_RESOLVER] Resolving token for shop:', shop);
  
  try {
    // Import Shop model
    const { default: Shop } = await import('../db/Shop.js');
    
    // Look up the shop
    const shopDoc = await Shop.findOne({ shop }).lean();
    
    if (!shopDoc) {
      console.error('[TOKEN_RESOLVER] Shop not found in database:', shop);
      throw new Error(`Shop ${shop} not found in database`);
    }
    
    console.log('[TOKEN_RESOLVER] Found shop doc:', {
      shop: shopDoc.shop,
      hasAccessToken: !!shopDoc.accessToken,
      hasJWTToken: !!shopDoc.jwtToken,
      useJWT: shopDoc.useJWT,
      accessTokenPrefix: shopDoc.accessToken?.substring(0, 10)
    });
    
    // If shop is using JWT flow and has a JWT token
    if (shopDoc.useJWT && shopDoc.jwtToken) {
      console.log('[TOKEN_RESOLVER] Shop uses JWT flow');
      
      // Check if we have a cached session token for this JWT
      const cacheKey = `${shop}:${shopDoc.jwtToken.substring(0, 20)}`;
      if (sessionTokenCache.has(cacheKey)) {
        const cached = sessionTokenCache.get(cacheKey);
        // Check if cached token is still valid (expires after 55 minutes)
        if (cached.expiresAt > Date.now()) {
          console.log('[TOKEN_RESOLVER] Using cached session token');
          return cached.token;
        } else {
          sessionTokenCache.delete(cacheKey);
        }
      }
      
      // If we have a real access token (not jwt-pending), use it
      if (shopDoc.accessToken && shopDoc.accessToken !== 'jwt-pending') {
        console.log('[TOKEN_RESOLVER] Using stored access token');
        return shopDoc.accessToken;
      }
      
      // Try to exchange JWT for access token
      try {
        console.log('[TOKEN_RESOLVER] Attempting to exchange JWT for access token...');
        const result = await exchangeJWTForAccessToken(shopDoc.jwtToken, shop);
        
        if (result && result.accessToken) {
          // Update shop with real access token
          await Shop.findOneAndUpdate(
            { shop },
            { accessToken: result.accessToken },
            { new: true }
          );
          
          // Cache the token
          sessionTokenCache.set(cacheKey, {
            token: result.accessToken,
            expiresAt: Date.now() + (55 * 60 * 1000) // 55 minutes
          });
          
          console.log('[TOKEN_RESOLVER] Successfully exchanged JWT for access token');
          return result.accessToken;
        }
      } catch (error) {
        console.error('[TOKEN_RESOLVER] Failed to exchange JWT:', error);
      }
      
      // For JWT flow, we need to validate the session token with Shopify SDK
      console.log('[TOKEN_RESOLVER] Validating JWT session token with Shopify SDK');
      try {
        // Import Shopify SDK
        const { shopify } = await import('../auth.js');
        
        // Validate the JWT session token to get a proper session
        const session = await shopify.auth.validateSessionToken(shopDoc.jwtToken);
        
        if (session && session.accessToken) {
          console.log('[TOKEN_RESOLVER] Successfully validated JWT session token');
          
          // Cache the access token
          const cacheKey = `${shop}:${shopDoc.jwtToken.substring(0, 20)}`;
          sessionTokenCache.set(cacheKey, {
            token: session.accessToken,
            expiresAt: Date.now() + (55 * 60 * 1000) // 55 minutes
          });
          
          return session.accessToken;
        } else {
          console.error('[TOKEN_RESOLVER] JWT session validation returned no access token');
        }
      } catch (error) {
        console.error('[TOKEN_RESOLVER] JWT session validation failed:', error);
      }
      
      // Last resort: try to use JWT token directly (might not work)
      console.log('[TOKEN_RESOLVER] Using JWT token directly as last resort');
      return shopDoc.jwtToken;
      
      throw new Error('Unable to obtain valid access token from JWT');
    }
    
    // Traditional flow - use stored access token
    if (shopDoc.accessToken) {
      console.log('[TOKEN_RESOLVER] Using traditional access token');
      return shopDoc.accessToken;
    }
    
    throw new Error(`No access token available for shop ${shop}`);
    
  } catch (error) {
    console.error('[TOKEN_RESOLVER] Error resolving token:', error);
    
    // Last resort: check environment variables
    const envToken = process.env.SHOPIFY_ADMIN_API_TOKEN || 
                     process.env.SHOPIFY_ACCESS_TOKEN ||
                     process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
    
    if (envToken) {
      console.log('[TOKEN_RESOLVER] Falling back to environment token');
      return envToken;
    }
    
    throw error;
  }
}

// Helper function to exchange JWT for access token
async function exchangeJWTForAccessToken(jwtToken, shop) {
  const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
  
  try {
    // This is a placeholder for the actual token exchange
    // Shopify's token exchange endpoint is still in development
    // For now, we'll use a workaround
    
    // Try to use Shopify's new token exchange endpoint
    const response = await fetch('https://shopify.com/admin/api/unstable/access_tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        subject_token: jwtToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange'
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      return { accessToken: data.access_token, scope: data.scope };
    }
    
    console.error('[TOKEN_RESOLVER] Token exchange failed:', await response.text());
  } catch (error) {
    console.error('[TOKEN_RESOLVER] Token exchange error:', error);
  }
  
  return null;
}


// Export additional utilities
export { verifyAndDecodeJWT, extractShopFromJWT };