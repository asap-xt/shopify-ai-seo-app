// backend/controllers/productSync.js

import Shop from '../db/models/Shop.js';
import Product from '../db/models/Product.js';
import { fetchProducts } from '../utils/shopifyApi.js';
import { formatProductForAI } from '../utils/aiFormatter.js';

/**
 * Sync all products from Shopify into MongoDB for a given shop.
 * @param {string} shopDomain
 * @returns {Promise<number>} number of products synced
 */
export async function syncProductsForShop(shopDomain) {
  // Намери записаното shop и неговия access token
  const shop = await Shop.findOne({ shop: shopDomain });
  if (!shop || !shop.accessToken) {
    throw new Error('Shop not found or not authenticated');
  }

  // Вземи продукти от Shopify
  const rawProducts = await fetchProducts(shop.shop, shop.accessToken);

  // Запази/обнови всеки продукт в MongoDB
  for (const raw of rawProducts) {
    const formatted = formatProductForAI(raw);
    await Product.findOneAndUpdate(
      { shop: shop.shop, productId: formatted.productId },
      { ...formatted, shop: shop.shop, syncedAt: new Date() },
      { upsert: true }
    );
  }

  return rawProducts.length;
}
