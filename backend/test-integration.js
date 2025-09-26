#!/usr/bin/env node
// backend/test-integration.js
// Test script to validate the new token exchange architecture

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = 'http://localhost:3000';
const TEST_SHOP = 'asapxt-teststore.myshopify.com';

// Test endpoints
const ENDPOINTS = [
  {
    name: 'Products List',
    url: `${BASE_URL}/api/products/list?shop=${TEST_SHOP}`,
    method: 'GET'
  },
  {
    name: 'Collections List',
    url: `${BASE_URL}/collections/list-graphql?shop=${TEST_SHOP}`,
    method: 'GET'
  },
  {
    name: 'Languages Shop',
    url: `${BASE_URL}/api/languages/shop/${TEST_SHOP}`,
    method: 'GET'
  },
  {
    name: 'Product Tags',
    url: `${BASE_URL}/api/products/tags/list?shop=${TEST_SHOP}`,
    method: 'GET'
  },
  {
    name: 'Collections Check',
    url: `${BASE_URL}/collections/check-definitions?shop=${TEST_SHOP}`,
    method: 'GET'
  }
];

async function testEndpoint(endpoint) {
  console.log(`\n🧪 Testing ${endpoint.name}...`);
  console.log(`   URL: ${endpoint.url}`);
  
  try {
    const response = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Integration-Test/1.0'
      }
    });
    
    const status = response.status;
    const text = await response.text();
    
    console.log(`   Status: ${status}`);
    
    if (status === 200) {
      try {
        const data = JSON.parse(text);
        console.log(`   ✅ Success: ${data.success ? 'true' : 'false'}`);
        if (data.shop) console.log(`   Shop: ${data.shop}`);
        if (data.count !== undefined) console.log(`   Count: ${data.count}`);
        if (data.auth) console.log(`   Auth: ${data.auth.source} (${data.auth.tokenType})`);
      } catch (parseError) {
        console.log(`   ⚠️  Response is not JSON: ${text.substring(0, 100)}...`);
      }
    } else if (status === 401) {
      console.log(`   ❌ Authentication failed - App may not be installed`);
      console.log(`   Response: ${text.substring(0, 200)}...`);
    } else if (status === 400) {
      console.log(`   ⚠️  Bad request: ${text.substring(0, 200)}...`);
    } else {
      console.log(`   ❌ Error ${status}: ${text.substring(0, 200)}...`);
    }
    
  } catch (error) {
    console.log(`   ❌ Network error: ${error.message}`);
  }
}

async function runTests() {
  console.log('🚀 Starting Integration Tests');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Test Shop: ${TEST_SHOP}`);
  console.log(`   Time: ${new Date().toISOString()}`);
  
  for (const endpoint of ENDPOINTS) {
    await testEndpoint(endpoint);
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n🏁 Integration tests completed');
  console.log('\n📋 Next steps:');
  console.log('   1. If you see 401 errors, install the app first:');
  console.log(`      https://${TEST_SHOP}/admin/apps/development`);
  console.log('   2. If you see 500 errors, check server logs');
  console.log('   3. If all tests pass, the integration is working!');
}

// Run tests
runTests().catch(console.error);
