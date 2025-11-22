// backend/auth.js
// Fixed OAuth flow that ensures offline access tokens are properly stored

import crypto from 'crypto';
import fetch from 'node-fetch';
import express from 'express';
import Shop from './db/Shop.js';
import Subscription from './db/Subscription.js';

const router = express.Router();

const {
  SHOPIFY_API_KEY,             // client_id
  SHOPIFY_API_SECRET,          // client_secret
  SHOPIFY_API_SCOPES,          // "read_products,write_products,read_locales,read_translations"
  APP_URL,                     // "https://new-ai-seo-app-production.up.railway.app"
  SHOPIFY_API_VERSION = '2025-07',
} = process.env;

const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `${APP_URL}${CALLBACK_PATH}`;

// Required scopes for the app
const REQUIRED_SCOPES = [
  'read_products',
  'write_products', 
  'read_locales',
  'read_translations'
];

// DEBUG: Log configuration on startup
console.log('[AUTH CONFIG]', {
  SHOPIFY_API_KEY: SHOPIFY_API_KEY ? 'SET' : 'NOT SET',
  SHOPIFY_API_SECRET: SHOPIFY_API_SECRET ? 'SET' : 'NOT SET', 
  SHOPIFY_API_SCOPES,
  APP_URL,
  REDIRECT_URI,
  CALLBACK_PATH,
  REQUIRED_SCOPES: REQUIRED_SCOPES.join(',')
});

// Validate required environment variables
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !APP_URL) {
  console.error('[AUTH] Missing required environment variables');
  console.error('Required: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, APP_URL');
  // Don't exit process, just log error - let server handle it
}

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
  const scopes = SHOPIFY_API_SCOPES || REQUIRED_SCOPES.join(',');
  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    scope: scopes.replace(/\s/g, ''),
    redirect_uri: REDIRECT_URI,
    state,
    // This is crucial - ensures we get offline access token
    'access_type': 'offline'
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
  console.log(`[AUTH] Exchanging code for offline access token: ${shop}`);
  
  try {
    const tokenUrl = `https://${shop}/admin/oauth/access_token`;
    const requestBody = { 
      client_id: SHOPIFY_API_KEY, 
      client_secret: SHOPIFY_API_SECRET, 
      code 
    };
    
    console.log(`[AUTH] Token exchange request to: ${tokenUrl}`);
    
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    
    const responseText = await resp.text();
    console.log(`[AUTH] Token exchange response status: ${resp.status}`);
    
    if (!resp.ok) {
      console.error(`[AUTH] Token exchange failed:`, responseText);
      throw new Error(`Token exchange failed: ${resp.status} ${responseText}`);
    }
    
    const tokenData = JSON.parse(responseText);
    console.log(`[AUTH] Token exchange successful!`);
    console.log(`[AUTH] Received scopes: ${tokenData.scope}`);
    console.log(`[AUTH] Token type: ${tokenData.access_token?.startsWith('shpat_') ? 'offline' : 'unknown'}`);
    
    // Validate token format
    if (!tokenData.access_token) {
      throw new Error('No access token received from Shopify');
    }
    
    if (!tokenData.access_token.startsWith('shpat_')) {
      console.warn(`[AUTH] Warning: Token does not start with 'shpat_', got: ${tokenData.access_token.substring(0, 10)}...`);
      console.warn(`[AUTH] This may be an online token instead of offline token`);
    }
    
    return tokenData; // { access_token, scope, ... }
  } catch (error) {
    console.error('[AUTH] Token exchange error:', error);
    throw error;
  }
}

async function testToken(shop, accessToken) {
  console.log(`[AUTH] Testing access token for shop: ${shop}`);
  
  try {
    const testQuery = `
      query TestToken {
        shop {
          id
          name
          myshopifyDomain
        }
      }
    `;
    
    const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: testQuery }),
    });

    const result = await response.json();
    
    if (!response.ok || result.errors) {
      console.error(`[AUTH] Token test failed:`, result);
      return false;
    }
    
    console.log(`[AUTH] Token test successful for shop: ${result.data?.shop?.name}`);
    return true;
    
  } catch (error) {
    console.error(`[AUTH] Token test error:`, error.message);
    return false;
  }
}

async function registerWebhooks(shop, accessToken) {
  console.log('[AUTH] Starting webhook registration using GraphQL...');
  
  try {
    // Use the GraphQL-based webhook registration from webhookRegistration.js
    const { registerAllWebhooks } = await import('./utils/webhookRegistration.js');
    
    // Create a mock request object with the access token
    const mockReq = {
      session: { accessToken },
      shopDomain: shop
    };
    
    const results = await registerAllWebhooks(mockReq, shop, APP_URL);
    
    console.log('[AUTH] Webhook registration results:', JSON.stringify(results, null, 2));
    
    return results;
  } catch (error) {
    console.error('[AUTH] Webhook registration failed:', error.message);
    throw error;
  }
}

// GET /?shop=asapxt-teststore.myshopify.com
router.get('/', async (req, res) => {
  console.log('[AUTH] Starting OAuth flow', { query: req.query });
  
  // Check environment variables
  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !APP_URL) {
    console.error('[AUTH] Missing required environment variables');
    return res.status(500).send('Server configuration error');
  }
  
  const shop = (req.query.shop || '').toString().trim();
  
  // Validate shop domain
  if (!shop) {
    console.error('[AUTH] Missing shop parameter');
    return res.status(400).send('Missing shop parameter');
  }
  
  if (!shop.endsWith('.myshopify.com')) {
    console.error('[AUTH] Invalid shop domain:', shop);
    return res.status(400).send('Invalid shop domain');
  }
  
  // Generate state for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('shopify_oauth_state', state, {
    httpOnly: true, 
    secure: APP_URL.startsWith('https://'), 
    sameSite: 'none', 
    maxAge: 10 * 60 * 1000, // 10 minutes
    path: '/',
  });

  console.log(`[AUTH] Redirecting to Shopify OAuth for shop: ${shop}`);
  return res.redirect(302, buildAuthUrl(shop, state));
});

// GET /callback?code=...&hmac=...&shop=...&state=...&host=...
router.get('/callback', async (req, res) => {
  console.log('[AUTH] OAuth callback received', { 
    query: req.query,
    cookies: req.cookies 
  });
  
  try {
    // Check environment variables
    if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !APP_URL) {
      console.error('[AUTH] Missing required environment variables');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    const { code, hmac, shop, state, host } = req.query;

    // 1) Validate state (CSRF protection)
    const stateCookie = req.cookies?.shopify_oauth_state;
    if (!state || !stateCookie || state !== stateCookie) {
      console.error('[AUTH] State mismatch', { state, stateCookie });
      return res.status(400).send('Invalid state parameter - possible CSRF attack');
    }
    
    // 2) Verify HMAC
    if (!verifyHmac(req.query, SHOPIFY_API_SECRET)) {
      console.error('[AUTH] HMAC verification failed');
      return res.status(400).send('HMAC verification failed');
    }
    
    // 3) Validate required parameters
    if (!shop || !shop.endsWith('.myshopify.com') || !code) {
      console.error('[AUTH] Missing required params', { shop, code: !!code });
      return res.status(400).send('Missing required parameters');
    }

    // 4) Exchange code for access token
    const tokenResp = await exchangeToken(shop, code);
    const accessToken = tokenResp.access_token;
    const scopes = tokenResp.scope || '';

    // 5) Test the token before saving
    const tokenIsValid = await testToken(shop, accessToken);
    if (!tokenIsValid) {
      console.error('[AUTH] Received invalid token from Shopify');
      return res.status(500).send('Received invalid access token');
    }

    // 6) Save shop record to database
    console.log('[AUTH] Saving shop record to database...');
    
    // Ensure accessToken is always a string
    const accessTokenString = typeof accessToken === 'object' && accessToken.accessToken 
      ? accessToken.accessToken 
      : accessToken;
    
    const shopRecord = await Shop.findOneAndUpdate(
      { shop }, 
      { 
        shop, 
        accessToken: accessTokenString, 
        appApiKey: SHOPIFY_API_KEY, // ВАЖНО: записваме API key за validation
        scopes, 
        installedAt: new Date(),
        updatedAt: new Date(),
        tokenType: accessTokenString.startsWith('shpat_') ? 'offline' : 'online',
        isActive: true,
        needsTokenExchange: false // Token exchange вече е завършен
      }, 
      { upsert: true, new: true }
    );
    
    console.log('[AUTH] Shop record saved:', {
      id: shopRecord._id,
      shop: shopRecord.shop,
      tokenType: shopRecord.tokenType,
      scopes: shopRecord.scopes
    });

    // 7) Add to SendGrid list (non-blocking)
    // Fetch shop email and add to SendGrid App Users list
    import('../services/sendgridListsService.js').then(async (sendgridModule) => {
      const sendgridListsService = sendgridModule.default;
      try {
        // Fetch shop email from Shopify API
        const shopQuery = `
          query {
            shop {
              email
              name
            }
          }
        `;
        const shopResponse = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: shopQuery }),
        });
        
        if (shopResponse.ok) {
          const shopData = await shopResponse.json();
          const shopEmail = shopData.data?.shop?.email;
          const shopName = shopData.data?.shop?.name;
          
          if (shopEmail) {
            await sendgridListsService.addToAppUsersList(shopEmail, shop, shopName);
          } else {
            console.warn('[AUTH] Shop email not found in Shopify API response');
          }
        }
      } catch (error) {
        console.error('[AUTH] Failed to add to SendGrid list:', error.message);
      }
    }).catch(error => {
      console.error('[AUTH] SendGrid list service error:', error.message);
    });

    // 8) Register webhooks (non-blocking)
    registerWebhooks(shop, accessToken).catch(error => {
      console.error('[AUTH] Webhook registration failed:', error.message);
    });


    // 9) Clear state cookie
    res.clearCookie('shopify_oauth_state');

    // 10) Check for active subscription
    console.log('[AUTH] Checking for active subscription...');
    const subscription = await Subscription.findOne({ shop }).lean();
    
    const hasActiveSubscription = subscription && 
      subscription.status === 'active' && 
      !subscription.cancelledAt;
    
    console.log('[AUTH] Subscription status:', {
      exists: !!subscription,
      status: subscription?.status,
      plan: subscription?.plan,
      hasActive: hasActiveSubscription
    });

    // 11) Redirect to appropriate page
    const finalHost = host
      ? host.toString()
      : base64UrlEncode(`${shop}/admin`);
    
    const adminBase = base64UrlDecode(finalHost).replace(/\/+$/, '');
    
    // Redirect to appropriate page with embedded params
    // CRITICAL: Include embedded=1 and host for proper iframe loading
    const baseUrl = `https://${adminBase}/apps/${SHOPIFY_API_KEY}`;
    
    if (!hasActiveSubscription) {
      // No subscription → Billing page (plan selection)
      const billingUrl = `${baseUrl}/billing?embedded=1&shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(finalHost)}`;
      console.log('[AUTH] No active subscription, redirecting to billing:', billingUrl);
      return res.redirect(302, billingUrl);
    }
    
    // Active subscription → Dashboard
    const dashboardUrl = `${baseUrl}/?embedded=1&shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(finalHost)}`;
    console.log('[AUTH] Active subscription found, redirecting to dashboard:', dashboardUrl);
    return res.redirect(302, dashboardUrl);
    
  } catch (error) {
    console.error('[AUTH] OAuth callback error:', error);
    
    // Clear state cookie on error
    res.clearCookie('shopify_oauth_state');
    
    return res.status(500).json({ 
      error: 'OAuth authentication failed', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /status?shop=...  (debug endpoint)
router.get('/status', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    const shopRecord = await Shop.findOne({ shop }).lean();
    
    if (!shopRecord) {
      return res.json({
        shop,
        authenticated: false,
        message: 'Shop not found in database'
      });
    }

    // Test token
    const tokenValid = await testToken(shop, shopRecord.accessToken);

    return res.json({
      shop,
      authenticated: !!shopRecord.accessToken && tokenValid,
      tokenType: shopRecord.tokenType,
      scopes: shopRecord.scopes,
      installedAt: shopRecord.installedAt,
      tokenValid,
      message: tokenValid ? 'Authentication successful' : 'Token is invalid'
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Status check failed',
      message: error.message
    });
  }
});

export default router;