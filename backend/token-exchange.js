import express from 'express';
import dotenv from 'dotenv';
import { shopifyApi, LATEST_API_VERSION, RequestedTokenType } from '@shopify/shopify-api';

import Shop from './db/models/Shop.js'; // ще създадем този модел веднага след това

dotenv.config();

const router = express.Router();

// Инициализация на Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  hostName: process.env.APP_URL.replace(/^https?:\/\//, ''),
});

router.post('/', async (req, res) => {
  const { shop, sessionToken } = req.body;

  if (!shop || !sessionToken) {
    return res.status(400).json({ error: 'Missing shop or sessionToken' });
  }

  try {
    const accessToken = await shopify.auth.tokenExchange({
      shop,
      sessionToken,
      requestedTokenType: RequestedTokenType.OfflineAccessToken,
    });

    // Запис в MongoDB
    await Shop.findOneAndUpdate(
      { shop },
      { shop, accessToken, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    console.log(`✅ Token exchange successful for shop: ${shop}`);
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('❌ Token exchange error:', error);
    res.status(500).json({ error: 'Token exchange failed' });
  }
});

export default router;
