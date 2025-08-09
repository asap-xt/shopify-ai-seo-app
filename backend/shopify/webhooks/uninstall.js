// backend/shopify/webhooks/uninstall.js
import Shop from '../../db/models/Shop.js';
import Subscription from '../../db/models/Subscription.js';
import Product from '../../db/models/Product.js';
import SyncLog from '../../db/models/SyncLog.js';

export default async function uninstallWebhook(req, res) {
  try {
    const shopDomain = req.body.myshopify_domain;

    await Promise.all([
      Shop.deleteOne({ shop: shopDomain }),
      Subscription.deleteOne({ shop: shopDomain }),
      Product.deleteMany({ shop: shopDomain }),
      SyncLog.deleteMany({ shop: shopDomain }),
    ]);

    console.log(`🗑️ Data cleaned for uninstalled shop: ${shopDomain}`);
    res.status(200).send('Cleanup successful');
  } catch (err) {
    console.error('❌ Uninstall webhook error:', err);
    res.status(500).send('Error during uninstall cleanup');
  }
}
