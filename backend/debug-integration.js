#!/usr/bin/env node
// backend/debug-integration.js
// Debug script to monitor token exchange and authentication

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Connect to MongoDB
await mongoose.connect(process.env.MONGODB_URI);

// Load models
const Shop = (await import('./db/Shop.js')).default;

const TEST_SHOP = 'asapxt-teststore.myshopify.com';

console.log('🔍 INTEGRATION DEBUG REPORT');
console.log('==========================');
console.log(`Time: ${new Date().toISOString()}`);
console.log(`Test Shop: ${TEST_SHOP}`);
console.log('');

// 1. Check database records
console.log('📊 DATABASE RECORDS');
console.log('-------------------');
try {
  const shopRecord = await Shop.findOne({ 
    $or: [
      { shop: TEST_SHOP },
      { shopDomain: TEST_SHOP }
    ]
  }).lean();
  
  if (shopRecord) {
    console.log('✅ Shop record found in database');
    console.log(`   Shop field: ${shopRecord.shop || 'N/A'}`);
    console.log(`   ShopDomain field: ${shopRecord.shopDomain || 'N/A'}`);
    console.log(`   Access Token: ${shopRecord.accessToken ? 'Present' : 'Missing'}`);
    console.log(`   Token length: ${shopRecord.accessToken?.length || 0}`);
    console.log(`   Token prefix: ${shopRecord.accessToken?.substring(0, 10) || 'N/A'}...`);
    console.log(`   Use JWT: ${shopRecord.useJWT || false}`);
    console.log(`   Installed At: ${shopRecord.installedAt || 'N/A'}`);
    console.log(`   Plan: ${shopRecord.plan || 'N/A'}`);
  } else {
    console.log('❌ No shop record found in database');
    console.log('   This means the app is not installed');
  }
} catch (error) {
  console.log('❌ Database error:', error.message);
}

console.log('');

// 2. Check environment variables
console.log('🔧 ENVIRONMENT VARIABLES');
console.log('-------------------------');
const requiredEnvVars = [
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET', 
  'SHOPIFY_API_VERSION',
  'MONGODB_URI',
  'APP_URL'
];

requiredEnvVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    console.log(`✅ ${varName}: ${value.substring(0, 20)}...`);
  } else {
    console.log(`❌ ${varName}: Missing`);
  }
});

console.log('');

// 3. Test token resolution
console.log('🔑 TOKEN RESOLUTION TEST');
console.log('-------------------------');
try {
  const { resolveAdminTokenForShop } = await import('./utils/tokenResolver.js');
  const token = await resolveAdminTokenForShop(TEST_SHOP);
  console.log('✅ Token resolution successful');
  console.log(`   Token length: ${token.length}`);
  console.log(`   Token prefix: ${token.substring(0, 10)}...`);
} catch (error) {
  console.log('❌ Token resolution failed:', error.message);
}

console.log('');

// 4. Test modern auth
console.log('🔄 MODERN AUTH TEST');
console.log('--------------------');
try {
  const { extractSessionToken, extractShop } = await import('./middleware/modernAuth.js');
  console.log('✅ Modern auth module loaded successfully');
  console.log('   Functions available: extractSessionToken, extractShop');
} catch (error) {
  console.log('❌ Modern auth module error:', error.message);
}

console.log('');

// 5. Recommendations
console.log('💡 RECOMMENDATIONS');
console.log('------------------');
console.log('1. If no shop record found:');
console.log(`   - Install app: https://${TEST_SHOP}/admin/apps/development`);
console.log('   - Or run OAuth flow manually');
console.log('');
console.log('2. If token resolution fails:');
console.log('   - Check if access token is valid');
console.log('   - Verify token format (should start with shpat_)');
console.log('');
console.log('3. For testing with session tokens:');
console.log('   - Use browser dev tools to get session token');
console.log('   - Test endpoints with Authorization header');
console.log('');
console.log('4. Monitor logs for:');
console.log('   - [AUTH] Authenticated shop via token_exchange');
console.log('   - [TOKEN_EXCHANGE] Success for shop');
console.log('   - [GRAPHQL] Success for shop');

// Close connection
await mongoose.disconnect();
console.log('\n🏁 Debug report completed');
