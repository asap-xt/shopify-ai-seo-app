// backend/webhooks/products-update.js
import Product from '../db/Product.js';
import ProductChangeLog from '../db/ProductChangeLog.js';
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

    // Determine if this is a new product or update
    const isNewProduct = !existingProduct;
    const changedFields = [];
    
    if (!isNewProduct && existingProduct) {
      // Detect what changed
      if (existingProduct.title !== formatted.title) changedFields.push('title');
      if (existingProduct.description !== formatted.description) changedFields.push('description');
      if (JSON.stringify(existingProduct.variants) !== JSON.stringify(formatted.variants)) changedFields.push('variants');
      if (JSON.stringify(existingProduct.images) !== JSON.stringify(formatted.images)) changedFields.push('images');
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
    }

    const updatedProduct = await Product.findOneAndUpdate(
      { shop: shopDomain, productId: product.id },
      updateData,
      { upsert: true, new: true }
    );

    // Log change for weekly digest (only if significant change)
    const hasOptimization = updatedProduct.seoStatus === 'optimized' || 
                           updatedProduct.seoStatus === 'ai_enhanced';
    
    // Only log if new product OR significant fields changed
    if (isNewProduct || changedFields.some(f => ['title', 'description'].includes(f))) {
      await ProductChangeLog.create({
        shop: shopDomain,
        productId: String(product.id),
        productTitle: product.title,
        productHandle: product.handle,
        changeType: isNewProduct ? 'created' : 'updated',
        changedFields: isNewProduct ? ['all'] : changedFields,
        hasOptimization,
        needsAttention: !hasOptimization, // Needs attention if not optimized
        notified: false
      });
    }

    res.status(200).send('Webhook processed');
  } catch (err) {
    console.error('❌ Product update webhook error:', err);
    res.status(500).send('Error processing webhook');
  }
}
