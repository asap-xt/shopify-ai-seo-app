// backend/check-shop-sitemap.js
// Проверка на реалния sitemap запис
// Стартирай с: node backend/check-shop-sitemap.js

import 'dotenv/config';
import mongoose from 'mongoose';
import Sitemap from './db/Sitemap.js';

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const shop = process.env.TEST_SHOP || 'example.myshopify.com';
    
    // 1. Check current state
    console.log('\n1. Checking current sitemap for', shop);
    let existing = await Sitemap.findOne({ shop }).select('+content').lean();
    
    if (existing) {
      console.log('Found document:');
      console.log('  ID:', existing._id);
      console.log('  Generated at:', existing.generatedAt);
      console.log('  Product count:', existing.productCount);
      console.log('  Size:', existing.size);
      console.log('  Has content:', !!existing.content);
      console.log('  Content length:', existing.content?.length || 0);
      console.log('  First 100 chars:', existing.content?.substring(0, 100) || 'NO CONTENT');
    } else {
      console.log('No sitemap found for this shop');
    }

    // 2. Delete the broken record
    console.log('\n2. Deleting old record (if exists)...');
    const deleted = await Sitemap.deleteOne({ shop });
    console.log('Deleted:', deleted.deletedCount, 'records');

    // 3. Verify it's gone
    const checkDeleted = await Sitemap.findOne({ shop });
    console.log('\n3. Verify deletion - record exists:', !!checkDeleted);

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Done - Now try generating sitemap again from UI');
  }
}

check();