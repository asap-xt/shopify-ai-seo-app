// backend/auth.js
// Shopify OAuth (Public distribution) — ESM

import crypto from 'crypto';
import fetch from 'node-fetch'; // ако си на Node 18+, вграден fetch съществува; този import е безопасен
import express from 'express';
import Shop from './db/Shop.js';

const router = express.Router();

const {
  SHOPIFY_API_KEY,             // client_id
  SHOPIFY_API_SECRET,          // client_secret
  SHOPIFY_API_SCOPES,          // напр: "write_products,read_products,read_themes,write_themes"
  APP_URL,                     // напр: "https://new-ai-seo-app-production.up.railway.app"
  SHOPIFY_API_VERSION = '2024-07',
} = process.env;

const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `${APP_URL}${CALLBACK_PATH}`;

// Helpers
function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildAuthUrl(shop, state) {
  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    scope: (SHOPIFY_API_SCOPES || '').replace(/\s/g, ''),
    redirect_uri: REDIRECT_URI,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

function verifyHmac(query, secret) {
  const { hmac, ...map } = query;
  const message = Object.keys(map)
    .sort()
    .map((k) => `${k}=${Array.isArray(map[k]) ? map[k].join(',') : map[k]}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(hmac, 'utf8'));
}

async function exchangeToken(shop, code) {
  const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Token exchange failed: ${resp.status} ${t}`);
  }
  return resp.json(); // { access_token, scope, ... }
}

async function registerWebhooks(shop, accessToken) {
  const topics = [
    {
      topic: 'products/update',
      address: `${APP_URL}/webhooks/products/update`,
      format: 'json',
    },
    {
      topic: 'app/uninstalled',
      address: `${APP_URL}/webhooks/app/uninstalled`,
      format: 'json',
    },
  ];

  for (const w of topics) {
    await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ webhook: w }),
    }).catch(() => {});
  }
}

// GET /auth?shop=asapxt-teststore.myshopify.com
router.get('/auth', async (req, res) => {
  const shop = (req.query.shop || '').toString();
  if (!shop.endsWith('.myshopify.com')) {
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

  const redirectUrl = buildAuthUrl(shop, state);
  return res.redirect(302, redirectUrl);
});

// GET /auth/callback?code=...&hmac=...&shop=...&state=...&host=...
router.get(CALLBACK_PATH, async (req, res) => {
  try {
    const { code, hmac, shop, state, host } = req.query;

    // 1) Validate
    const stateCookie = req.cookies?.shopify_oauth_state;
    if (!state || !stateCookie || state !== stateCookie) {
      return res.status(400).send('Invalid state');
    }
    if (!verifyHmac(req.query, SHOPIFY_API_SECRET)) {
      return res.status(400).send('Invalid HMAC');
    }
    if (!shop || !shop.endsWith('.myshopify.com') || !code) {
      return res.status(400).send('Missing params');
    }

    // 2) Exchange code for token
    const tokenResp = await exchangeToken(shop, code);
    const accessToken = tokenResp.access_token;
    const scopes = tokenResp.scope || '';

    // 3) Upsert shop record
    await Shop.findOneAndUpdate(
      { shop },
      { shop, accessToken, scopes, installedAt: new Date() },
      { upsert: true, new: true }
    );

    // 4) Register webhooks
    await registerWebhooks(shop, accessToken);

    // 5) Redirect to embedded app
    // host може да липсва, ако идваш от install линк — създаваме го
    const safeHost = host
      ? host.toString()
      : base64UrlEncode(`${shop}/admin`);

    // Връщаме към нашия SPA (Vite build), който вече е embed + App Bridge
    return res.redirect(302, `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(safeHost)}`);
  } catch (e) {
    console.error('OAuth callback error:', e);
    return res.status(500).send('OAuth failed');
  }
});

export default router;
