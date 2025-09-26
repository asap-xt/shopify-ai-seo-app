// backend/token-exchange.js

import '@shopify/shopify-api/adapters/node'; // <-- важно: адаптерът за Node
import express from 'express';
import dotenv from 'dotenv';
import { shopifyApi, LATEST_API_VERSION, RequestedTokenType } from '@shopify/shopify-api';
import Shop from './db/Shop.js';

dotenv.config();

const router = express.Router();

/** Normalize app URL from env and strip protocol/trailing slash */
function getHostName() {
  const raw =
    process.env.APP_URL ||
    process.env.SHOPIFY_APP_URL ||
    process.env.BASE_URL ||
    process.env.HOST ||
    '';
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const hostName = getHostName();
if (!hostName) {
  console.warn('⚠️ APP_URL/SHOPIFY_APP_URL/BASE_URL/HOST is not set. Set your public app URL in Railway.');
}

/** Initialize Shopify API client */
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  hostName, // hostname only, no protocol
});

/**
 * POST /token-exchange
 * Body: { shop: string, sessionToken: string }
 */
router.post('/', async (req, res) => {
  try {
    const { shop, sessionToken } = req.body;
    console.log('[TOKEN_EXCHANGE] Starting for shop:', shop);
    console.log('[TOKEN_EXCHANGE] Has session token:', !!sessionToken);
    if (!shop || !sessionToken) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Директен HTTP token exchange с правилните параметри
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: sessionToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TOKEN_EXCHANGE] HTTP error:', response.status, errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const tokenResult = await response.json();
    console.log('[TOKEN_EXCHANGE] Response type:', typeof tokenResult);
    console.log('[TOKEN_EXCHANGE] Response keys:', Object.keys(tokenResult || {}));
    
    const accessToken = typeof tokenResult === 'string' ? tokenResult : tokenResult.access_token;
    console.log('[TOKEN_EXCHANGE] Token starts with shpat_:', accessToken?.startsWith('shpat_'));
    
    if (!accessToken || typeof accessToken !== 'string') {
      throw new Error('No access_token in token exchange response');
    }

    await Shop.findOneAndUpdate(
      { shop },
      { 
        shop, 
        accessToken,
        appApiKey: process.env.SHOPIFY_API_KEY,  // Важно!
        updatedAt: new Date() 
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Token exchange successful for shop: ${shop}`);
    return res.status(200).json({ 
      status: 'ok', 
      shop,
      tokenSaved: true 
    });
  } catch (error) {
    console.error('❌ Token exchange error:', error);
    return res.status(500).json({ error: 'Token exchange failed' });
  }
});

export default router;
