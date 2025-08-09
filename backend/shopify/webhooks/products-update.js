// backend/shopify/webhooks/products-update.js
import Product from '../../db/models/Product.js';
import { formatProductForAI } from '../../utils/aiFormatter.js';

export default async function productsUpdateWebhook(req, res) {
  try {
    const product = req.body;
    const formatted = formatProductForAI(product);
    const shopDomain = req.headers['x-shopify-shop-domain'];

    await Product.findOneAndUpdate(
      { shop: shopDomain, productId: product.id },
      { ...formatted, shop: shopDomain, syncedAt: new Date() },
      { upsert: true }
    );

    res.status(200).send('Webhook processed');
  } catch (err) {
    console.error('❌ Product update webhook error:', err);
    res.status(500).send('Error processing webhook');
  }
}
