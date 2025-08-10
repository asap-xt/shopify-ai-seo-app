// backend/server.js
// Express server for AI SEO 2.0 (Shopify Embedded App)
// - Uses Shopify Managed Installation (token-exchange)
// - Proper webhook handling with raw body for HMAC verification
// - Starts scheduler only after MongoDB connection is established

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

/**
 * Basic CORS. Keep it simple; Shopify admin will iframe the app.
 */
app.use(cors({ origin: true, credentials: true }));

/**
 * ──────────────────────────────────────────────────────────────
 * Webhooks MUST receive the raw request body to validate HMAC.
 * We register webhook routes BEFORE the global JSON parser.
 * ──────────────────────────────────────────────────────────────
 */
const rawJson = express.raw({ type: 'application/json' });
const attachRawBody = (req, _res, next) => {
  // Store the raw buffer for HMAC validator
  req.rawBody = req.body;
  next();
};

app.post(
  '/webhooks/products/update',
  rawJson,
  attachRawBody,
  validateShopifyWebhook,
  productsUpdateWebhook
);

app.post(
  '/webhooks/app/uninstalled',
  rawJson,
  attachRawBody,
  validateShopifyWebhook,
  uninstallWebhook
);

/**
 * Global JSON parser for all NON-webhook routes.
 * (Placed after webhook routes so it won't consume their raw body)
 */
app.use(bodyParser.json());

/**
 * Health check (early)
 */
app.get
