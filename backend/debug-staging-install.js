// backend/debug-staging-install.js
// Diagnostic script for staging installation issues

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

console.log('\n🔍 STAGING INSTALLATION DIAGNOSTICS\n');
console.log('='.repeat(60));

// 1. Check Environment Variables
console.log('\n1️⃣ ENVIRONMENT VARIABLES:');
console.log('-'.repeat(60));

const requiredVars = {
  'SHOPIFY_API_KEY': process.env.SHOPIFY_API_KEY,
  'SHOPIFY_API_SECRET': process.env.SHOPIFY_API_SECRET ? '***SET***' : undefined,
  'APP_URL': process.env.APP_URL,
  'VITE_SHOPIFY_API_KEY': process.env.VITE_SHOPIFY_API_KEY,
  'NODE_ENV': process.env.NODE_ENV,
  'MONGODB_URI': process.env.MONGODB_URI ? '***SET***' : undefined,
};

let envIssues = [];

for (const [key, value] of Object.entries(requiredVars)) {
  const status = value ? '✅' : '❌';
  console.log(`${status} ${key}: ${value || 'NOT SET'}`);
  
  if (!value) {
    envIssues.push(key);
  }
}

// Check if API keys match
if (process.env.SHOPIFY_API_KEY && process.env.VITE_SHOPIFY_API_KEY) {
  if (process.env.SHOPIFY_API_KEY !== process.env.VITE_SHOPIFY_API_KEY) {
    console.log('❌ SHOPIFY_API_KEY and VITE_SHOPIFY_API_KEY do not match!');
    envIssues.push('API_KEY_MISMATCH');
  } else {
    console.log('✅ API keys match');
  }
}

// Check APP_URL format
if (process.env.APP_URL) {
  if (!process.env.APP_URL.startsWith('https://')) {
    console.log('⚠️  APP_URL should use HTTPS');
    envIssues.push('APP_URL_NOT_HTTPS');
  }
  if (process.env.APP_URL.endsWith('/')) {
    console.log('⚠️  APP_URL has trailing slash - this can cause issues');
    envIssues.push('APP_URL_TRAILING_SLASH');
  }
  if (process.env.APP_URL.includes('staging')) {
    console.log('✅ APP_URL contains "staging" (correct for staging env)');
  } else {
    console.log('⚠️  APP_URL does not contain "staging" - is this staging?');
  }
}

// 2. Check Expected Staging Values
console.log('\n2️⃣ EXPECTED STAGING VALUES:');
console.log('-'.repeat(60));

const expectedStaging = {
  'SHOPIFY_API_KEY': 'cbb6c395806364fba75996525ffce483',
  'APP_URL': 'https://indexaize-aiseo-app-staging.up.railway.app',
};

let stagingIssues = [];

for (const [key, expected] of Object.entries(expectedStaging)) {
  const actual = process.env[key];
  if (actual === expected) {
    console.log(`✅ ${key}: matches expected value`);
  } else {
    console.log(`❌ ${key}:`);
    console.log(`   Expected: ${expected}`);
    console.log(`   Actual:   ${actual || 'NOT SET'}`);
    stagingIssues.push(key);
  }
}

// 3. Check Redirect URLs
console.log('\n3️⃣ REDIRECT URLS (should be in Shopify Partner Dashboard):');
console.log('-'.repeat(60));

if (process.env.APP_URL) {
  const baseUrl = process.env.APP_URL.replace(/\/+$/, '');
  const redirectUrls = [
    `${baseUrl}/auth/callback`,
    `${baseUrl}/api/auth/callback`,
    `${baseUrl}/api/auth`,
    `${baseUrl}/`,
  ];
  
  redirectUrls.forEach(url => {
    console.log(`   ${url}`);
  });
  
  console.log('\n⚠️  Make sure ALL these URLs are added in Shopify Partner Dashboard');
  console.log('   → App Setup → Allowed redirection URLs');
}

// 4. Check OAuth Configuration
console.log('\n4️⃣ OAUTH CONFIGURATION:');
console.log('-'.repeat(60));

if (process.env.APP_URL && process.env.SHOPIFY_API_KEY) {
  const callbackUrl = `${process.env.APP_URL}/auth/callback`;
  console.log(`✅ Callback URL: ${callbackUrl}`);
  
  const authUrl = `https://YOUR_SHOP.myshopify.com/admin/oauth/authorize?` +
    `client_id=${process.env.SHOPIFY_API_KEY}&` +
    `scope=read_products,write_products&` +
    `redirect_uri=${encodeURIComponent(callbackUrl)}`;
  
  console.log(`\n📋 Example OAuth URL:`);
  console.log(`   ${authUrl}`);
}

// 5. Summary
console.log('\n' + '='.repeat(60));
console.log('📊 SUMMARY:');
console.log('='.repeat(60));

if (envIssues.length === 0 && stagingIssues.length === 0) {
  console.log('✅ All checks passed! Environment looks good.');
  console.log('\n🔍 Next steps:');
  console.log('   1. Check Railway logs for OAuth flow');
  console.log('   2. Check browser console for frontend errors');
  console.log('   3. Verify redirect URLs in Shopify Partner Dashboard');
} else {
  console.log('❌ Issues found:');
  
  if (envIssues.length > 0) {
    console.log(`\n   Missing/Invalid Environment Variables:`);
    envIssues.forEach(issue => {
      console.log(`   - ${issue}`);
    });
  }
  
  if (stagingIssues.length > 0) {
    console.log(`\n   Staging Configuration Mismatches:`);
    stagingIssues.forEach(issue => {
      console.log(`   - ${issue}`);
    });
  }
  
  console.log('\n🔧 Fix these issues and run this script again.');
}

console.log('\n' + '='.repeat(60) + '\n');

