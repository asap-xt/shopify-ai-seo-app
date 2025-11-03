// backend/webhooks/products-update.js
import Product from '../db/Product.js';
import { formatProductForAI } from '../../utils/aiFormatter.js';

export default async function productsUpdateWebhook(req, res) {
  try {
    const product = req.body;
    const formatted = formatProductForAI(product);
    const shopDomain = req.headers['x-shopify-shop-domain'];

    console.log(`[PRODUCTS-UPDATE-WEBHOOK] ===== Webhook received for product ${product.id} =====`);
    console.log(`[PRODUCTS-UPDATE-WEBHOOK] Shop: ${shopDomain}`);
    console.log(`[PRODUCTS-UPDATE-WEBHOOK] Product title: ${product.title}`);

    // Get existing product to check if it exists and preserve seoStatus
    const existingProduct = await Product.findOne({ 
      shop: shopDomain, 
      productId: product.id 
    });

    console.log(`[PRODUCTS-UPDATE-WEBHOOK] Existing product found:`, !!existingProduct);
    if (existingProduct) {
      console.log(`[PRODUCTS-UPDATE-WEBHOOK] Existing seoStatus:`, existingProduct.seoStatus);
      console.log(`[PRODUCTS-UPDATE-WEBHOOK] Existing title: "${existingProduct.title}"`);
      console.log(`[PRODUCTS-UPDATE-WEBHOOK] New title: "${formatted.title}"`);
      console.log(`[PRODUCTS-UPDATE-WEBHOOK] Title changed:`, existingProduct.title !== formatted.title);
      console.log(`[PRODUCTS-UPDATE-WEBHOOK] Existing description length: ${existingProduct.description?.length || 0}`);
      console.log(`[PRODUCTS-UPDATE-WEBHOOK] New description length: ${formatted.description?.length || 0}`);
    }

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
