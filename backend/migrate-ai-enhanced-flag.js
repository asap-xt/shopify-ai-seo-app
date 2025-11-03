// backend/migrate-ai-enhanced-flag.js
// One-time migration script to mark existing AI-enhanced products in MongoDB
// Run with: node backend/migrate-ai-enhanced-flag.js <shop-domain>

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './db/Product.js';
import Shop from './db/Shop.js';

dotenv.config();

async function shopGraphQL(shop, accessToken, query, variables = {}) {
  const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

async function migrateAiEnhancedFlag(shopDomain) {
  console.log(`\n🚀 Starting AI-enhanced flag migration for: ${shopDomain}\n`);
  
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get shop and token
    const shopDoc = await Shop.findOne({ shop: shopDomain });
    if (!shopDoc || !shopDoc.accessToken) {
      throw new Error(`Shop not found or no access token: ${shopDomain}`);
    }
    console.log('✅ Found shop and access token');
    
    // Get all products from MongoDB
    const products = await Product.find({ shop: shopDomain });
    console.log(`📦 Found ${products.length} products in MongoDB`);
    
    if (products.length === 0) {
      console.log('⚠️  No products to migrate');
      return;
    }
    
    let migratedCount = 0;
    let alreadyMarkedCount = 0;
    let noEnhancementCount = 0;
    let errorCount = 0;
    
    console.log('\n🔍 Checking products for AI enhancement...\n');
    
    for (const product of products) {
      try {
        // Skip if already marked
        if (product.seoStatus?.aiEnhanced === true) {
          alreadyMarkedCount++;
          continue;
        }
        
        // Check Shopify metafields for enhancedAt timestamp
        const query = `
          query GetProductMetafields($productId: ID!) {
            product(id: $productId) {
              metafield(namespace: "seo_ai", key: "enhancedAt") {
                value
              }
            }
          }
        `;
        
        const data = await shopGraphQL(shopDomain, shopDoc.accessToken, query, {
          productId: product.productId
        });
        
        const enhancedAt = data?.product?.metafield?.value;
        
        if (enhancedAt) {
          // Product has AI enhancement, mark it
          await Product.findOneAndUpdate(
            { shop: shopDomain, productId: product.productId },
            { 'seoStatus.aiEnhanced': true },
            { new: true }
          );
          migratedCount++;
          console.log(`✅ Marked as AI-enhanced: ${product.title || product.productId}`);
        } else {
          noEnhancementCount++;
        }
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing ${product.productId}: ${error.message}`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total products:           ${products.length}`);
    console.log(`✅ Newly marked:          ${migratedCount}`);
    console.log(`ℹ️  Already marked:        ${alreadyMarkedCount}`);
    console.log(`⚠️  No AI enhancement:    ${noEnhancementCount}`);
    console.log(`❌ Errors:                ${errorCount}`);
    console.log('='.repeat(60) + '\n');
    
  } catch (error) {
    console.error(`\n❌ Migration failed: ${error.message}\n`);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
  }
}

// Get shop domain from command line
const shopDomain = process.argv[2];

if (!shopDomain) {
  console.error('\n❌ Usage: node backend/migrate-ai-enhanced-flag.js <shop-domain>\n');
  console.error('Example: node backend/migrate-ai-enhanced-flag.js mystore.myshopify.com\n');
  process.exit(1);
}

migrateAiEnhancedFlag(shopDomain)
  .then(() => {
    console.log('✅ Migration completed successfully!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n❌ Migration failed: ${error.message}\n`);
    process.exit(1);
  });

