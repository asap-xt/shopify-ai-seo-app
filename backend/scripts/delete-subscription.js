// backend/scripts/delete-subscription.js
import mongoose from 'mongoose';
import Subscription from '../db/Subscription.js';
import dotenv from 'dotenv';

dotenv.config();

const shopDomain = process.argv[2];

if (!shopDomain) {
  console.error('Usage: node backend/scripts/delete-subscription.js <shop-domain>');
  console.error('Example: node backend/scripts/delete-subscription.js testnew-asapxt.myshopify.com');
  process.exit(1);
}

async function deleteSubscription() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // First check if subscription exists
    const existingSub = await Subscription.findOne({ shop: shopDomain });
    
    if (existingSub) {
      console.log('📋 Found subscription:', {
        shop: existingSub.shop,
        plan: existingSub.plan,
        status: existingSub.status,
        pendingPlan: existingSub.pendingPlan || 'NOT SET',
        activatedAt: existingSub.activatedAt || 'NOT SET',
        createdAt: existingSub.createdAt
      });
      
      const result = await Subscription.deleteOne({ shop: shopDomain });
      
      if (result.deletedCount > 0) {
        console.log(`✅ Deleted subscription for: ${shopDomain}`);
      }
    } else {
      console.log(`⚠️ No subscription found for: ${shopDomain}`);
    }

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

deleteSubscription();

