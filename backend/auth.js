// backend/auth.js
// Shopify OAuth (Public distribution) – ESM

import crypto from 'crypto';
import fetch from 'node-fetch';
import express from 'express';
import Shop from './db/Shop.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

const {
  SHOPIFY_API_KEY,             // client_id
  SHOPIFY_API_SECRET,          // client_secret
  SHOPIFY_API_SCOPES,          // "write_products,read_products" и т.н.
  APP_URL,                     // "https://new-ai-seo-app-production.up.railway.app"
  SHOPIFY_API_VERSION = '2024-10',
} = process.env;

const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `${APP_URL}${CALLBACK_PATH}`;

// DEBUG: Log configuration on startup
console.log('[AUTH CONFIG]', {
  SHOPIFY_API_KEY: SHOPIFY_API_KEY ? 'SET' : 'NOT SET',
  SHOPIFY_API_SECRET: SHOPIFY_API_SECRET ? 'SET' : 'NOT SET',
  SHOPIFY_API_SCOPES,
  APP_URL,
  REDIRECT_URI,
  CALLBACK_PATH
});

// Helpers
function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function buildAuthUrl(shop, state) {
  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    scope: (SHOPIFY_API_SCOPES || '').replace(/\s/g, ''),
    redirect_uri: REDIRECT_URI,
    state,
  });
  const authUrl = `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  console.log('[AUTH] Building auth URL:', authUrl);
  return authUrl;
}

function verifyHmac(query, secret) {
  const { hmac, ...map } = query;
  const message = Object.keys(map)
    .sort()
    .map((k) => `${k}=${Array.isArray(map[k]) ? map[k].join(',') : map[k]}`)
    .join('&');

  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(hmac, 'utf8'));
}

// Verify JWT token from Shopify
function verifyJWT(token, secret) {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      clockTolerance: 5 // 5 seconds clock tolerance
      // Remove issuer validation as Shopify uses shop-specific issuers
    });
    return decoded;
  } catch (error) {
    console.error('[AUTH] JWT verification failed:', error);
    return null;
  }
}

async function exchangeToken(shop, code) {
  console.log(`[AUTH] Exchanging token for shop: ${shop}`);
  
  try {
    const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        client_id: SHOPIFY_API_KEY, 
        client_secret: SHOPIFY_API_SECRET, 
        code 
      }),
    });
    
    const responseText = await resp.text();
    console.log(`[AUTH] Token exchange response status: ${resp.status}`);
    
    if (!resp.ok) {
      console.error(`[AUTH] Token exchange failed:`, responseText);
      throw new Error(`Token exchange failed: ${resp.status} ${responseText}`);
    }
    
    const tokenData = JSON.parse(responseText);
    console.log(`[AUTH] Token exchange successful, scopes: ${tokenData.scope}`);
    
    return tokenData; // { access_token, scope, ... }
  } catch (error) {
    console.error('[AUTH] Token exchange error:', error);
    throw error;
  }
}

async function registerWebhooks(shop, accessToken) {
  const topics = [
    { topic: 'products/update',  address: `${APP_URL}/webhooks/products`,  format: 'json' },
    { topic: 'app/uninstalled',  address: `${APP_URL}/webhooks/app/uninstalled`, format: 'json' },
  ];

  for (const w of topics) {
    try {
      console.log(`[AUTH] Registering webhook: ${w.topic}`);
      await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook: w }),
      });
    } catch (e) { 
      console.error(`[AUTH] Failed to register webhook ${w.topic}:`, e);
    }
  }
}

// Exchange JWT for access token using Shopify's token exchange endpoint
async function exchangeJWTForAccessToken(jwtToken) {
  console.log('[AUTH] Exchanging JWT for access token...');
  
  try {
    const decoded = verifyJWT(jwtToken, SHOPIFY_API_SECRET);
    if (!decoded) {
      throw new Error('Invalid JWT token');
    }
    
    const shop = decoded.dest.replace('https://', '').replace('/admin', '');
    console.log('[AUTH] JWT decoded, shop:', shop);
    
    // For JWT flow, we need to use the token exchange endpoint
    const resp = await fetch('https://shopify.com/admin/api/unstable/access_tokens', {
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
    
    if (!resp.ok) {
      const error = await resp.text();
      console.error('[AUTH] Token exchange failed:', error);
      throw new Error(`Token exchange failed: ${error}`);
    }
    
    const data = await resp.json();
    console.log('[AUTH] Token exchange successful');
    
    return {
      accessToken: data.access_token,
      scope: data.scope,
      shop: shop
    };
  } catch (error) {
    console.error('[AUTH] JWT exchange error:', error);
    // Fallback: store JWT token and handle differently
    return null;
  }
}

// GET /auth?shop=example.myshopify.com
router.get('/auth', async (req, res) => {
  console.log('[AUTH] Starting OAuth flow', { query: req.query });
  
  const shop = (req.query.shop || '').toString();
  if (!shop.endsWith('.myshopify.com')) {
    console.error('[AUTH] Invalid shop domain:', shop);
    return res.status(400).send('Invalid shop');
  }
  
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('shopify_oauth_state', state, {
    httpOnly: true, 
    secure: true, 
    sameSite: 'none', 
    maxAge: 10 * 60 * 1000, 
    path: '/',
  });

  console.log('[AUTH] Redirecting to Shopify OAuth');
  return res.redirect(302, buildAuthUrl(shop, state));
});

// GET /auth/callback?code=...&hmac=...&shop=...&state=...&host=...
router.get(CALLBACK_PATH, async (req, res) => {
  console.log('=== OAUTH CALLBACK DEBUG ===');
  console.log('1. Query params:', req.query);
  
  try {
    const { code, hmac, shop, state, host, id_token } = req.query;

    // Check if we have id_token (new OAuth flow with JWT)
    if (id_token) {
      console.log('2. Processing JWT token flow...');
      
      const tokenData = await exchangeJWTForAccessToken(id_token);
      
      if (tokenData) {
        // Successfully exchanged JWT for access token
        const savedShop = await Shop.findOneAndUpdate(
          { shop: tokenData.shop }, 
          { 
            shop: tokenData.shop, 
            accessToken: tokenData.accessToken, 
            scopes: tokenData.scope, 
            installedAt: new Date(),
            jwtToken: id_token 
          }, 
          { upsert: true, new: true }
        );
        console.log('6. Saved shop doc:', savedShop);
        
        // Register webhooks
        await registerWebhooks(tokenData.shop, tokenData.accessToken);
      } else {
        // Fallback: store JWT token as placeholder
        if (!shop || !shop.endsWith('.myshopify.com')) {
          console.error('[AUTH] Missing shop parameter in JWT flow');
          return res.status(400).send('Missing shop parameter');
        }
        
        // For now, store JWT token and mark the shop as using JWT flow
        const savedShop = await Shop.findOneAndUpdate(
          { shop }, 
          { 
            shop, 
            accessToken: 'jwt-pending', // Special marker
            scopes: 'read_products,write_products,read_themes,write_themes,read_translations,write_translations,read_locales,read_metafields,write_metafields,read_metaobjects,write_metaobjects',
            installedAt: new Date(),
            jwtToken: id_token,
            useJWT: true  // Flag to indicate JWT flow
          }, 
          { upsert: true, new: true }
        );
        console.log('6. Saved shop with JWT marker:', savedShop);
      }

      // Redirect to embedded app
      const finalHost = host
        ? host.toString()
        : base64UrlEncode(`${shop}/admin`);
      
      const adminBase = base64UrlDecode(finalHost).replace(/\/+$/, '');
      const embeddedUrl = `https://${adminBase}/apps/${SHOPIFY_API_KEY}/`;
      
      console.log('[AUTH] Redirecting to embedded app (JWT flow):', embeddedUrl);
      return res.redirect(302, embeddedUrl);
    }

    // Traditional OAuth flow (for initial installation)
    const stateCookie = req.cookies?.shopify_oauth_state;
    
    // Skip state validation in development or if missing
    if (process.env.NODE_ENV === 'production' && stateCookie) {
      if (!state || state !== stateCookie) {
        console.error('[AUTH] State mismatch', { state, stateCookie });
        return res.status(400).send('Invalid state');
      }
    }
    
    if (!verifyHmac(req.query, SHOPIFY_API_SECRET)) {
      console.error('[AUTH] HMAC verification failed');
      return res.status(400).send('Invalid HMAC');
    }
    
    if (!shop || !shop.endsWith('.myshopify.com') || !code) {
      console.error('[AUTH] Missing required params', { shop, code: !!code });
      return res.status(400).send('Missing params');
    }

    // Exchange code for token
    const tokenResp = await exchangeToken(shop, code);
    const accessToken = tokenResp.access_token;
    const scopes = tokenResp.scope || '';

    const savedShop = await Shop.findOneAndUpdate(
      { shop }, 
      { shop, accessToken, scopes, installedAt: new Date() }, 
      { upsert: true, new: true }
    );
    console.log('7. Saved shop doc:', savedShop);

    // Register webhooks
    await registerWebhooks(shop, accessToken);

    // Redirect to embedded app URL
    const finalHost = host
      ? host.toString()
      : base64UrlEncode(`${shop}/admin`);
    
    const adminBase = base64UrlDecode(finalHost).replace(/\/+$/, '');
    const embeddedUrl = `https://${adminBase}/apps/${SHOPIFY_API_KEY}/`;
    
    console.log('[AUTH] Redirecting to embedded app:', embeddedUrl);
    return res.redirect(302, embeddedUrl);
    
  } catch (e) {
    console.error('=== OAUTH CALLBACK ERROR ===');
    console.error('Error details:', e);
    return res.status(500).json({ 
      error: 'OAuth failed', 
      message: e.message,
      stack: process.env.NODE_ENV !== 'production' ? e.stack : undefined
    });
  }
});

export default router;