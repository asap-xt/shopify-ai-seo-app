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

    // Token exchange
    const tokenResult = await shopify.auth.tokenExchange({
      shop,
      sessionToken,
      requestedTokenType: RequestedTokenType.OfflineAccessToken,
    });
    
    console.log('[TOKEN_EXCHANGE] Response type:', typeof tokenResult);
    console.log('[TOKEN_EXCHANGE] Response keys:', Object.keys(tokenResult || {}));
    
    // Извличане на токена от резултата
    let accessToken;
    if (tokenResult && typeof tokenResult === 'object') {
      if (tokenResult.session && tokenResult.session.accessToken) {
        accessToken = tokenResult.session.accessToken;
      } else if (tokenResult.accessToken) {
        accessToken = tokenResult.accessToken;
      } else {
        throw new Error('No accessToken found in token result');
      }
    } else {
      accessToken = tokenResult;
    }
    
    console.log('[TOKEN_EXCHANGE] Extracted token type:', typeof accessToken);
    console.log('[TOKEN_EXCHANGE] Token starts with shpat_:', accessToken?.startsWith('shpat_'));
    
    if (!accessToken || typeof accessToken !== 'string') {
      throw new Error('Invalid accessToken extracted from token exchange result');
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
