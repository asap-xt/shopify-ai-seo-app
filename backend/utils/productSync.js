import Shop from '../db/Shop.js';
import Product from '../db/Product.js';
import { fetchProducts } from '../utils/shopifyApi.js';
import { formatProductForAI } from '../utils/aiFormatter.js';

export async function syncProductsForShop(shopDomain) {
  const shop = await Shop.findOne({ shop: shopDomain });
  if (!shop || !shop.accessToken) throw new Error('Shop not found or not authenticated');

  const rawProducts = await fetchProducts(shop.shop, shop.accessToken);

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
