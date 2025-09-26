// backend/debug/tokenDiagnostics.js
// Script to diagnose token authentication issues

import mongoose from 'mongoose';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

// Connect to MongoDB
await mongoose.connect(process.env.MONGODB_URI);

// Load Shop model
const Shop = (await import('../db/Shop.js')).default;

const SHOP_DOMAIN = 'asapxt-teststore.myshopify.com';

console.log('🔍 SHOPIFY TOKEN DIAGNOSTICS');
console.log('============================\n');

// 1. Check database records
console.log('1. DATABASE RECORDS');
console.log('-------------------');

const shopRecord = await Shop.findOne({
  $or: [
    { shop: SHOP_DOMAIN },
    { shopDomain: SHOP_DOMAIN }
  ]
}).lean();

if (!shopRecord) {
  console.log('❌ No shop record found in database');
  console.log(`   Checked for: shop="${SHOP_DOMAIN}" or shopDomain="${SHOP_DOMAIN}"`);
  
  // Check if there are any records at all
  const allShops = await Shop.find({}).lean();
  console.log(`   Total shops in DB: ${allShops.length}`);
  if (allShops.length > 0) {
    console.log('   Available shops:');
    allShops.forEach(s => {
      console.log(`   - ${s.shop || s.shopDomain} (token: ${s.accessToken ? 'exists' : 'missing'})`);
    });
  }
  process.exit(1);
}

console.log('✅ Shop record found:');
console.log(`   _id: ${shopRecord._id}`);
console.log(`   shop: ${shopRecord.shop}`);
console.log(`   shopDomain: ${shopRecord.shopDomain || 'not set'}`);
console.log(`   accessToken: ${shopRecord.accessToken ? 'exists' : 'missing'}`);
console.log(`   token length: ${shopRecord.accessToken?.length || 0}`);
console.log(`   token starts with: ${shopRecord.accessToken?.substring(0, 10)}...`);
console.log(`   scopes: ${shopRecord.scopes || 'not set'}`);
console.log(`   installedAt: ${shopRecord.installedAt || 'not set'}`);
console.log(`   updatedAt: ${shopRecord.updatedAt || 'not set'}\n`);

// 2. Test token format
console.log('2. TOKEN FORMAT VALIDATION');
console.log('--------------------------');

const token = shopRecord.accessToken;
if (!token) {
  console.log('❌ No access token found');
  process.exit(1);
}

// Shopify offline tokens should start with "shpat_"
if (token.startsWith('shpat_')) {
  console.log('✅ Token format looks correct (offline access token)');
} else if (token.startsWith('shpca_')) {
  console.log('⚠️  Token appears to be an online access token (shpca_)');
  console.log('   Online tokens expire and should not be stored long-term');
} else {
  console.log('⚠️  Token format is unexpected');
  console.log(`   Expected: shpat_... or shpca_...`);
  console.log(`   Actual: ${token.substring(0, 10)}...`);
}
console.log('');

// 3. Test simple GraphQL query
console.log('3. DIRECT GRAPHQL TEST');
console.log('----------------------');

const testQuery = `
  query {
    shop {
      id
      name
      myshopifyDomain
      plan {
        displayName
      }
    }
  }
`;

try {
  const url = `https://${SHOP_DOMAIN}/admin/api/2025-07/graphql.json`;
  console.log(`Making request to: ${url}`);
  console.log(`Using token: ${token.substring(0, 10)}...`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: testQuery }),
  });

  const responseText = await response.text();
  console.log(`Response status: ${response.status}`);
  console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));

  if (!response.ok) {
    console.log('❌ GraphQL request failed');
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Response: ${responseText}`);
    
    if (response.status === 401) {
      console.log('\n🔧 POSSIBLE SOLUTIONS:');
      console.log('   1. Token is expired or revoked');
      console.log('   2. App was uninstalled and reinstalled');
      console.log('   3. Token was not properly stored during OAuth');
      console.log('   4. Scopes have changed and token needs refresh');
    }
  } else {
    try {
      const data = JSON.parse(responseText);
      if (data.errors) {
        console.log('❌ GraphQL errors:', data.errors);
      } else {
        console.log('✅ GraphQL request successful!');
        console.log('   Shop info:', data.data.shop);
      }
    } catch (e) {
      console.log('⚠️  Could not parse response as JSON');
      console.log(`   Response: ${responseText}`);
    }
  }
} catch (error) {
  console.log('❌ Request failed:', error.message);
}

// 4. Check OAuth configuration
console.log('\n4. OAUTH CONFIGURATION');
console.log('----------------------');

console.log(`SHOPIFY_API_KEY: ${process.env.SHOPIFY_API_KEY ? 'set' : 'missing'}`);
console.log(`SHOPIFY_API_SECRET: ${process.env.SHOPIFY_API_SECRET ? 'set' : 'missing'}`);
console.log(`SHOPIFY_API_SCOPES: ${process.env.SHOPIFY_API_SCOPES || 'not set'}`);
console.log(`APP_URL: ${process.env.APP_URL || 'not set'}`);

// 5. Check required scopes
console.log('\n5. SCOPE VALIDATION');
console.log('-------------------');

const requiredScopes = ['read_products', 'write_products', 'read_locales'];
const actualScopes = (shopRecord.scopes || '').split(',').map(s => s.trim());

console.log(`Required scopes: ${requiredScopes.join(', ')}`);
console.log(`Actual scopes: ${actualScopes.join(', ')}`);

const missingScopes = requiredScopes.filter(scope => !actualScopes.includes(scope));
if (missingScopes.length > 0) {
  console.log(`❌ Missing scopes: ${missingScopes.join(', ')}`);
  console.log('   App needs to be reinstalled with correct scopes');
} else {
  console.log('✅ All required scopes present');
}

console.log('\n6. RECOMMENDATIONS');
console.log('------------------');

if (!shopRecord.accessToken) {
  console.log('🔧 Run OAuth flow to get a valid token');
} else if (!shopRecord.accessToken.startsWith('shpat_')) {
  console.log('🔧 Request offline access token instead of online token');
} else {
  console.log('🔧 Token exists but is invalid - likely need to:');
  console.log('   1. Reinstall the app in the Shopify store');
  console.log('   2. Ensure offline access token is requested');
  console.log('   3. Verify all required scopes are granted');
}

await mongoose.disconnect();
console.log('\n✅ Diagnostics complete');
