// backend/webhooks/products-update.js
import Product from '../db/Product.js';
import { formatProductForAI } from '../../utils/aiFormatter.js';

export default async function productsUpdateWebhook(req, res) {
  try {
    const product = req.body;
    const formatted = formatProductForAI(product);
    const shopDomain = req.headers['x-shopify-shop-domain'];

    // Get existing product to check if it exists and preserve seoStatus
    const existingProduct = await Product.findOne({ 
      shop: shopDomain, 
      productId: product.id 
    });

    // Prepare update data
    const updateData = {
      ...formatted,
      shop: shopDomain,
      syncedAt: new Date()
    };

    // CRITICAL: Always preserve existing seoStatus
    if (existingProduct?.seoStatus) {
      updateData.seoStatus = existingProduct.seoStatus;
      console.log(`[PRODUCTS-UPDATE-WEBHOOK] ✅ Preserving seoStatus:`, updateData.seoStatus);
    } else {
      console.log(`[PRODUCTS-UPDATE-WEBHOOK] ⚠️ No existing seoStatus to preserve`);
    }

    const updatedProduct = await Product.findOneAndUpdate(
      { shop: shopDomain, productId: product.id },
      updateData,
      { upsert: true, new: true }
    );

    console.log(`[PRODUCTS-UPDATE-WEBHOOK] Product updated successfully`);
    console.log(`[PRODUCTS-UPDATE-WEBHOOK] Updated seoStatus:`, updatedProduct.seoStatus);
    console.log(`[PRODUCTS-UPDATE-WEBHOOK] ===== Webhook processing complete =====`);

    res.status(200).send('Webhook processed');
  } catch (err) {
    console.error('❌ Product update webhook error:', err);
    res.status(500).send('Error processing webhook');
  }
}
