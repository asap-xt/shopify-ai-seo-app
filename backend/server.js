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

// ---- bind to Railway-assigned PORT ASAP ----
const RAW_PORT = process.env.PORT;
if (!RAW_PORT) {
  console.warn('⚠️ PORT is not set by the platform; using 3000 fallback (local dev).');
}
const PORT = Number(RAW_PORT || 3000);

// IMPORTANT: bind 0.0.0.0 so Railway can reach the service
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
});

/**
 * Basic CORS
 */
app.use(cors({ origin: true, credentials: true }));

/**
 * Webhooks – raw body BEFORE json parser
 */
const rawJson = express.raw({ type: 'application/json' });
const attachRawBody = (req, _res, next) => { req.rawBody = req.body; next(); };

app.post('/webhooks/products/update', rawJson, attachRawBody, validateShopifyWebhook, productsUpdateWebhook);
app.post('/webhooks/app/uninstalled',   rawJson, attachRawBody, validateShopifyWebhook, uninstallWebhook);

/**
 * JSON parser for the rest
 */
app.use(bodyParser.json());

/**
 * Health
 */
app.get('/health', (_req, res) => res.status(200).send({ status: 'OK' }));

/**
 * Token exchange / Billing / Test / SEO
 */
app.use('/token-exchange', tokenExchange);
app.use('/billing', billing);

app.get('/test-sync', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) return res.status(400).send('Missing ?shop=domain');
    const count = await syncProductsForShop(shop);
    res.send(`✅ Synced ${count} products`);
  } catch (e) {
    res.status(500).send(`❌ Sync error: ${e.message}`);
  }
});

app.use('/seo', seoController);

app.get('/', (_req, res) => res.send('AI SEO 2.0 Backend is running'));

/**
 * Mongo connection, then start scheduler (but server is already listening)
 */
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) console.warn('⚠️ MONGODB_URI is not set.');

mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('✅ Connected to MongoDB');
    scheduler.start();
  })
  .catch((err) => console.error('❌ MongoDB connection error:', err));

/**
 * Safety: log unhandled errors
 */
process.on('unhandledRejection', (err) => console.error('❌ UnhandledRejection:', err));
process.on('uncaughtException',  (err) => console.error('❌ UncaughtException:', err));
