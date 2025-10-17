// Temporary script to add included tokens to Growth Extra/Enterprise accounts
import 'dotenv/config';
import mongoose from 'mongoose';
import TokenBalance from './db/TokenBalance.js';
import Subscription from './db/Subscription.js';
import { getIncludedTokens } from './billing/tokenConfig.js';

const SHOP = 'asapxt-teststore.myshopify.com';

async function fixTokens() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected!');
    
    // Get subscription
    const subscription = await Subscription.findOne({ shop: SHOP });
    if (!subscription) {
      console.error('Subscription not found for shop:', SHOP);
      process.exit(1);
    }
    
    console.log('Shop:', SHOP);
    console.log('Plan:', subscription.plan);
    
    // Get included tokens for plan
    const included = getIncludedTokens(subscription.plan);
    console.log('Included tokens:', included.tokens);
    
    if (included.tokens === 0) {
      console.log('Plan has no included tokens. Exiting.');
      process.exit(0);
    }
    
    // Get or create token balance
    const tokenBalance = await TokenBalance.getOrCreate(SHOP);
    
    console.log('Current balance:', tokenBalance.balance);
    console.log('Current totalPurchased:', tokenBalance.totalPurchased);
    console.log('Current totalUsed:', tokenBalance.totalUsed);
    
    // Add included tokens
    await tokenBalance.addIncludedTokens(included.tokens, subscription.plan, 'manual-fix');
    
    console.log('\n✅ Tokens added successfully!');
    console.log('New balance:', tokenBalance.balance);
    
    await mongoose.connection.close();
    console.log('Done!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixTokens();

