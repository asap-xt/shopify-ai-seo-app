// backend/server.js

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import tokenExchange from './token-exchange.js';
import billing from './billing.js';
import scheduler from './scheduler.js';
import seoController from './controllers/seoController.js';
import { validateShopifyWebhook } from './utils/webhookValidator.js';
import productsUpdateWebhook from './shopify/webhooks/products-update.js';
import uninstallWebhook from './shopify/webhooks/uninstall.js';
import { syncProductsForShop } from './controllers/productSync.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// CORS + JSON parser for non-webhook routes
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());

// Webhook endpoints (raw body needed for HMAC verification)
app.post(
  '/webhooks/products/update',
  express.raw({ type: 'application/json' }),
  validateShopifyWebhook,
  productsUpdateWebhook
);
app.post(
  '/webhooks/app/uninstalled',
  express.raw({ type: 'application/json' }),
  validateShopifyWebhook,
  uninstallWebhook
);

// Shopify Managed token exchange
app.use('/token-exchange', tokenExchange);

// Billing endpoints
app.use('/billing', billing);

// Development-only test sync endpoint
app.get('/test-sync', async (req, res) => {
  try {
    const count = await syncProductsForShop(req.query.shop);
    res.send(`✅ Synced ${count} products`);
  } catch (e) {
    res.status(500).send(`❌ Sync error: ${e.message}`);
  }
});

// SEO generation endpoints
app.use('/seo', seoController);

// Health check
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'OK' });
});

// Default root
app.get('/', (req, res) => {
  res.send('AI SEO 2.0 Backend is running');
});

// Start scheduled sync jobs
scheduler.start();

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
