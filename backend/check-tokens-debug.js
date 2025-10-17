// Debug script to check token balance
import 'dotenv/config';
import mongoose from 'mongoose';
import TokenBalance from './db/TokenBalance.js';
import Subscription from './db/Subscription.js';

const SHOP = 'asapxt-teststore.myshopify.com';

async function checkTokens() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected!\n');
    
    // Check subscription
    const subscription = await Subscription.findOne({ shop: SHOP });
    console.log('=== SUBSCRIPTION ===');
    console.log(JSON.stringify(subscription, null, 2));
    
    // Check token balance
    const tokenBalance = await TokenBalance.findOne({ shop: SHOP });
    console.log('\n=== TOKEN BALANCE ===');
    console.log(JSON.stringify(tokenBalance, null, 2));
    
    await mongoose.connection.close();
    console.log('\n✅ Done!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkTokens();

