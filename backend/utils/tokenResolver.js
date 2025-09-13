// backend/utils/tokenResolver.js
export async function resolveShopToken(shop) {
  try {
    // Проверка в базата данни
    const Shop = await import('../db/Shop.js');
    const shopDoc = await Shop.default.findOne({ shop }).lean();
    
    if (shopDoc?.accessToken && shopDoc.accessToken !== 'undefined') {
      return shopDoc.accessToken;
    }
  } catch (err) {
    console.error('Error loading shop token:', err);
  }
  
  // Fallback към env (development only)
  const envToken = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
  if (envToken && envToken !== 'undefined') {
    console.warn(`Using env token for shop ${shop} - should use DB token in production`);
    return envToken;
  }
  
  
  throw new Error(`No valid access token found for shop: ${shop}`);
}
