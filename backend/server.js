import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import billing from './billing.js';
import scheduler from './scheduler.js';
import tokenExchange from './token-exchange.js'; // ✅ новото
import shopifyApi from './utils/shopifyApi.js';
import { validateShopifyWebhook } from './utils/webhookValidator.js';
import productsWebhook from './shopify/webhooks/products-update.js';
import uninstallWebhook from './shopify/webhooks/uninstall.js';
import { syncProductsForShop } from './controllers/productSync.js';
import tokenExchange from './token-exchange.js';





dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// Token exchange route (Shopify Managed Installation)
app.use('/token-exchange', tokenExchange);

// Billing middleware
// Webhook endpoints

// Health check
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'OK' });
});

// Default route
app.get('/', (req, res) => {
  res.send('AI SEO 2.0 Backend is running');
});

// Start scheduler (cron jobs for sync)
scheduler.start();

// Token exchange route (Shopify Managed Installation)
app.use('/token-exchange', tokenExchange);

// Billing middleware
app.use('/billing', billing);

// Webhook endpoints
app.post('/webhooks/products/update', validateShopifyWebhook, productsWebhook);
app.post('/webhooks/app/uninstalled', validateShopifyWebhook, uninstallWebhook);

// Test sync endpoint (for development only)
app.get('/test-sync', async (req, res) => {
  try {
    const count = await syncProductsForShop(req.query.shop);
    res.send(`✅ Synced ${count} products`);
  } catch (e) {
    res.status(500).send(`❌ Sync error: ${e.message}`);
  }
});
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});