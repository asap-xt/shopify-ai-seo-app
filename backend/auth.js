// backend/auth.js
// Shopify OAuth (Public distribution) – ESM

import crypto from 'crypto';
import fetch from 'node-fetch';
import express from 'express';
import Shop from './db/Shop.js';

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
    
    // Token type check
    console.log('[AUTH] Token type check:', {
      tokenPrefix: tokenData.access_token?.substring(0, 6),
      expectedPrefix: 'shpua_',
      isCorrectType: tokenData.access_token?.startsWith('shpua_')
    });
    
    // След token exchange request:
    console.log('[AUTH] Full token response:', JSON.stringify(tokenData, null, 2));
    console.log('[AUTH] Requested scopes:', process.env.SHOPIFY_API_SCOPES);
    console.log('[AUTH] Received scope:', tokenData.scope);
    console.log('[AUTH] Associated user scope:', tokenData.associated_user_scope);
    
    // Проверете какво връща Shopify
    if (!tokenData.access_token) {
      console.error('[AUTH] No access token in response!', tokenData);
      throw new Error('No access token received from Shopify');
    }
    
    return tokenData; // { access_token, scope, ... }
  } catch (error) {
    console.error('[AUTH] Token exchange error:', error);
    throw error;
  }
}

async function registerWebhooks(shop, accessToken) {
  const topics = [
    { topic: 'products/update',  address: `${APP_URL}/webhooks/products/update`,  format: 'json' },
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

// GET /auth?shop=asapxt-teststore.myshopify.com
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
  console.log('[AUTH] OAuth callback received', { 
    query: req.query,
    cookies: req.cookies 
  });
  
  try {
    const { code, hmac, shop, state, host } = req.query;

    // 1) Validate
    const stateCookie = req.cookies?.shopify_oauth_state;
    
    // Debug cookies and headers
    console.log('[AUTH DEBUG] All cookies:', Object.keys(req.cookies || {}));
    console.log('[AUTH DEBUG] Headers:', req.headers);
    
    // Temporarily skip state validation in dev mode
    if (process.env.NODE_ENV !== 'production' || !stateCookie) {
      console.warn('[AUTH] Skipping state validation in dev mode');
    } else if (!state || state !== stateCookie) {
      console.error('[AUTH] State mismatch', { state, stateCookie });
      return res.status(400).send('Invalid state');
    }
    
    if (!verifyHmac(req.query, SHOPIFY_API_SECRET)) {
      console.error('[AUTH] HMAC verification failed');
      return res.status(400).send('Invalid HMAC');
    }
    
    if (!shop || !shop.endsWith('.myshopify.com') || !code) {
      console.error('[AUTH] Missing required params', { shop, code: !!code });
      return res.status(400).send('Missing params');
    }

    // 2) Exchange code for token
    console.log('[AUTH] Requested scopes:', process.env.SHOPIFY_API_SCOPES);
    const tokenResp = await exchangeToken(shop, code);
    console.log('[AUTH] Token response:', tokenResp);
    console.log('[AUTH] Granted scopes:', tokenResp.associated_user_scope || tokenResp.scope);
    const accessToken = tokenResp.access_token;
    const scopes = tokenResp.scope || '';

    // 3) Upsert shop record
    const shopToSave = {
      shop: shop,
      accessToken: accessToken,
      scopes: scopes,
      isActive: true,
      installedAt: new Date()
    };

    console.log('[AUTH] Saving shop data:', {
      ...shopToSave,
      accessToken: shopToSave.accessToken ? 'exists' : 'missing'
    });

    await Shop.findOneAndUpdate(
      { shop }, 
      shopToSave, 
      { upsert: true, new: true }
    );
    console.log('[AUTH] Shop record updated');

    // 4) Register webhooks
    await registerWebhooks(shop, accessToken);

    // 5) Redirect to EMBEDDED app URL per Shopify docs:
    // https://{base64_decode(host)}/apps/{api_key}/
    const finalHost = host
      ? host.toString()
      : base64UrlEncode(`${shop}/admin`);
    
    const adminBase = base64UrlDecode(finalHost).replace(/\/+$/, ''); // ".../admin"
    const embeddedUrl = `https://${adminBase}/apps/${SHOPIFY_API_KEY}/`;
    
    console.log('[AUTH] Redirecting to embedded app:', embeddedUrl);
    return res.redirect(302, embeddedUrl);
    
  } catch (e) {
    console.error('[AUTH] OAuth callback error:', e);
    // Return more specific error for debugging
    return res.status(500).json({ 
      error: 'OAuth failed', 
      message: e.message,
      stack: process.env.NODE_ENV !== 'production' ? e.stack : undefined
    });
  }
});

export default router;