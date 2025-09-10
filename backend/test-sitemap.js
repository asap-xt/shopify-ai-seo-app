// backend/test-sitemap.js
// Тестов скрипт за проверка на MongoDB sitemap запазването
// Стартирай с: node backend/test-sitemap.js

import 'dotenv/config';
import mongoose from 'mongoose';
import Sitemap from './db/Sitemap.js';

async function test() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const testShop = process.env.TEST_SHOP || 'example.myshopify.com';
    
    // 1. Check if sitemap exists
    console.log('\n1. Checking existing sitemap...');
    let existing = await Sitemap.findOne({ shop: testShop }).select('+content');
    console.log('Found:', !!existing);
    console.log('Has content:', !!(existing?.content));
    console.log('Content length:', existing?.content?.length || 0);
    console.log('Generated at:', existing?.generatedAt);

    // 2. Try to save a test sitemap
    console.log('\n2. Saving test sitemap...');
    const testXml = '<?xml version="1.0"?><urlset>TEST</urlset>';
    const saved = await Sitemap.findOneAndUpdate(
      { shop: testShop },
      {
        shop: testShop,
        generatedAt: new Date(),
        url: `https://${testShop}/sitemap.xml`,
        productCount: 10,
        size: Buffer.byteLength(testXml, 'utf8'),
        plan: 'growth',
        status: 'completed',
        content: testXml
      },
      { upsert: true, new: true, select: '+content' }
    );
    
    console.log('Saved:', !!saved);
    console.log('Saved content:', saved.content);

    // 3. Try to retrieve it again
    console.log('\n3. Retrieving saved sitemap...');
    const retrieved = await Sitemap.findOne({ shop: testShop }).select('+content');
    console.log('Retrieved:', !!retrieved);
    console.log('Has content:', !!(retrieved?.content));
    console.log('Content:', retrieved?.content);

    // 4. Check without select
    console.log('\n4. Checking without select...');
    const withoutSelect = await Sitemap.findOne({ shop: testShop });
    console.log('Found without select:', !!withoutSelect);
    console.log('Has content field:', 'content' in (withoutSelect?.toObject() || {}));

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Done');
  }
}

test();