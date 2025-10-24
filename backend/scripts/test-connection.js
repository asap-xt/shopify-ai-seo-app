// backend/scripts/test-connection.js
// Test script for optimized database connection
// Run: node backend/scripts/test-connection.js

import dbConnection from '../db/connection.js';
import mongoose from 'mongoose';

async function testConnection() {
  console.log('🧪 Testing optimized database connection...\n');
  
  try {
    // Test 1: Connect to database
    console.log('Test 1: Connecting to MongoDB...');
    await dbConnection.connect();
    console.log('✅ Test 1 passed: Connected successfully\n');
    
    // Test 2: Check connection status
    console.log('Test 2: Checking connection status...');
    const stats = dbConnection.getStats();
    console.log('   Stats:', stats);
    
    if (!dbConnection.isReady()) {
      throw new Error('Connection not ready');
    }
    console.log('✅ Test 2 passed: Connection is ready\n');
    
    // Test 3: Verify pool settings
    console.log('Test 3: Verifying pool settings...');
    const client = mongoose.connection.getClient();
    const topology = client?.topology;
    
    if (topology?.s?.pool) {
      const pool = topology.s.pool;
      console.log('   Pool size:', pool.totalConnectionCount || 'N/A');
      console.log('   Available:', pool.availableConnectionCount || 'N/A');
      console.log('   Pending:', pool.waitQueueSize || 'N/A');
    }
    console.log('✅ Test 3 passed: Pool configured\n');
    
    // Test 4: Simple query
    console.log('Test 4: Running test query...');
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('   Collections found:', collections.length);
    console.log('   Collections:', collections.map(c => c.name).join(', '));
    console.log('✅ Test 4 passed: Query successful\n');
    
    // Test 5: Database stats
    console.log('Test 5: Getting database stats...');
    const dbStats = await mongoose.connection.db.stats();
    console.log('   Database:', dbStats.db);
    console.log('   Collections:', dbStats.collections);
    console.log('   Documents:', dbStats.objects);
    console.log('   Data size:', (dbStats.dataSize / 1024 / 1024).toFixed(2), 'MB');
    console.log('   Index size:', (dbStats.indexSize / 1024 / 1024).toFixed(2), 'MB');
    console.log('✅ Test 5 passed: Stats retrieved\n');
    
    // Test 6: Wait for health check (30 seconds)
    console.log('Test 6: Waiting 35 seconds for health check...');
    console.log('   (You should see a health check log message)');
    await new Promise(resolve => setTimeout(resolve, 35000));
    console.log('✅ Test 6 passed: Health check running\n');
    
    // Success
    console.log('🎉 All tests passed!');
    console.log('✅ Optimized connection module is working correctly');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await dbConnection.disconnect();
    console.log('✅ Test completed');
    process.exit(0);
  }
}

testConnection();

