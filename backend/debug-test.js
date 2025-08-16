// backend/debug-test.js
// Run with: node backend/debug-test.js

import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

console.log('\n=== SHOPIFY APP CONFIGURATION CHECK ===\n');

// 1. Check Environment Variables
console.log('1. Environment Variables:');
const requiredEnvVars = [
  'APP_URL',
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'SHOPIFY_API_SCOPES',
  'MONGODB_URI',
  'PORT'
];

const envStatus = {};
requiredEnvVars.forEach(varName => {
  const value = process.env[varName];
  envStatus[varName] = value ? '✓ SET' : '✗ MISSING';
  if (varName === 'APP_URL' && value) {
    console.log(`   ${varName}: ${value}`);
  } else {
    console.log(`   ${varName}: ${envStatus[varName]}`);
  }
});

// 2. Check URL Configuration
console.log('\n2. URL Configuration:');
const appUrl = process.env.APP_URL;
if (appUrl) {
  console.log(`   Base URL: ${appUrl}`);
  console.log(`   Auth URL: ${appUrl}/auth`);
  console.log(`   Callback URL: ${appUrl}/auth/callback`);
  console.log(`   Token Exchange: ${appUrl}/token-exchange`);
  
  // Check if URL has trailing slash
  if (appUrl.endsWith('/')) {
    console.log('   ⚠️  WARNING: APP_URL has trailing slash - this can cause issues!');
  }
}

// 3. Test Server Connectivity
console.log('\n3. Testing Server Connectivity:');
if (appUrl) {
  try {
    console.log(`   Checking ${appUrl}/health ...`);
    const response = await fetch(`${appUrl}/health`, { timeout: 5000 });
    if (response.ok) {
      const data = await response.json();
      console.log(`   ✓ Server is reachable: ${JSON.stringify(data)}`);
    } else {
      console.log(`   ✗ Server returned: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.log(`   ✗ Failed to reach server: ${error.message}`);
  }

  // Check debug endpoints
  try {
    console.log(`   Checking ${appUrl}/debug/routes ...`);
    const response = await fetch(`${appUrl}/debug/routes`, { timeout: 5000 });
    if (response.ok) {
      const data = await response.json();
      console.log(`   ✓ Available routes: ${data.routes.length}`);
      
      // Check for critical routes
      const criticalRoutes = ['/auth', '/auth/callback', '/token-exchange'];
      criticalRoutes.forEach(route => {
        const exists = data.routes.some(r => r.path === route);
        console.log(`     ${route}: ${exists ? '✓' : '✗'}`);
      });
    }
  } catch (error) {
    console.log(`   ⚠️  Could not check routes: ${error.message}`);
  }
}

// 4. Shopify Configuration
console.log('\n4. Shopify Configuration:');
console.log(`   Client ID: ${process.env.SHOPIFY_API_KEY || 'NOT SET'}`);
console.log(`   Scopes: ${process.env.SHOPIFY_API_SCOPES || 'NOT SET'}`);

// 5. Generate Test URLs
console.log('\n5. Test URLs:');
if (process.env.SHOPIFY_API_KEY && appUrl) {
  const testShop = 'your-test-shop.myshopify.com';
  console.log(`   OAuth Start URL: ${appUrl}/auth?shop=${testShop}`);
  console.log(`   Direct Install URL: https://${testShop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${encodeURIComponent(process.env.SHOPIFY_API_SCOPES || '')}&redirect_uri=${encodeURIComponent(appUrl + '/auth/callback')}`);
}

// 6. Common Issues Check
console.log('\n6. Common Issues Check:');
const issues = [];

if (!envStatus['SHOPIFY_API_KEY']) issues.push('Missing SHOPIFY_API_KEY');
if (!envStatus['SHOPIFY_API_SECRET']) issues.push('Missing SHOPIFY_API_SECRET');
if (!envStatus['APP_URL']) issues.push('Missing APP_URL');
if (appUrl && appUrl.endsWith('/')) issues.push('APP_URL has trailing slash');
if (appUrl && !appUrl.startsWith('https://')) issues.push('APP_URL must use HTTPS');

if (issues.length > 0) {
  console.log('   ⚠️  Found issues:');
  issues.forEach(issue => console.log(`     - ${issue}`));
} else {
  console.log('   ✓ No obvious configuration issues found');
}

console.log('\n=== END OF CHECK ===\n');

// Keep process alive for a moment to ensure all async operations complete
setTimeout(() => process.exit(0), 1000);