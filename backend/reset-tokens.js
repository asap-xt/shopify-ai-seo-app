// Quick script to reset token balance for a shop
import mongoose from 'mongoose';
import TokenBalance from './db/TokenBalance.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SHOP = process.argv[2] || 'asapxt-teststore.myshopify.com';

async function resetTokens() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(`✅ Connected to MongoDB`);
    
    const result = await TokenBalance.findOneAndUpdate(
      { shop: SHOP },
      {
        balance: 0,
        totalPurchased: 0,
        totalUsed: 0,
        lastPurchase: null,
        purchases: [],
        transactions: []
      },
      { new: true }
    );
    
    if (result) {
      console.log(`✅ Token balance reset for ${SHOP}`);
      console.log(`   Balance: ${result.balance}`);
      console.log(`   Total Purchased: ${result.totalPurchased}`);
      console.log(`   Total Used: ${result.totalUsed}`);
    } else {
      console.log(`⚠️  No token balance found for ${SHOP}`);
    }
    
    await mongoose.disconnect();
    console.log(`✅ Disconnected from MongoDB`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

resetTokens();

