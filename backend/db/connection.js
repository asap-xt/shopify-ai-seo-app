// backend/db/connection.js
// Optimized MongoDB connection with connection pooling
// Created: 2025-01-24
// Purpose: Improve database performance and reliability at scale

import mongoose from 'mongoose';
import { dbLogger } from '../utils/logger.js';

class DatabaseConnection {
  constructor() {
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = 5;
    this.healthCheckInterval = null;
  }

  async connect() {
    // If already connected, skip
    if (this.isConnected && mongoose.connection.readyState === 1) {
      dbLogger.info('✅ Already connected to MongoDB');
      return;
    }

    // Check if MONGODB_URI is provided
    if (!process.env.MONGODB_URI) {
      dbLogger.error('❌ MONGODB_URI environment variable is not set');
      throw new Error('MONGODB_URI is required');
    }

    // DEBUG: Log MongoDB URI (hide password)
    const uriForLog = process.env.MONGODB_URI.replace(/:[^:@]+@/, ':****@');
    dbLogger.info('🔗 Connecting to:', uriForLog);

    const options = {
      // Connection Pool Settings (CONSERVATIVE for testing)
      maxPoolSize: 20,           // Reduced from 50
      minPoolSize: 2,            // Reduced from 10 (less aggressive)
      maxIdleTimeMS: 60000,      // Increased to 60s (more forgiving)
      
      // Timeouts (INCREASED for Railway)
      serverSelectionTimeoutMS: 30000,  // Increased from 15s
      socketTimeoutMS: 60000,           // Increased from 45s
      connectTimeoutMS: 20000,          // Increased from 10s
      
      // Performance
      maxConnecting: 5,          // Reduced from 10
      // compressors: ['zlib'],  // DISABLED for testing (might cause issues)
      
      // Reliability
      retryWrites: true,
      retryReads: true,
      w: 'majority',             // Write concern
      
      // Optimization
      autoIndex: false,          // Don't auto-create indexes (manual control)
      family: 4,                 // Use IPv4
    };

    try {
      await mongoose.connect(process.env.MONGODB_URI, options);
      this.isConnected = true;
      this.connectionAttempts = 0;
      
      dbLogger.info('✅ MongoDB connected with optimized pool settings');
      dbLogger.info(`   - Max Pool Size: ${options.maxPoolSize}`);
      dbLogger.info(`   - Min Pool Size: ${options.minPoolSize}`);
      dbLogger.info(`   - Host: ${mongoose.connection.host}`);
      dbLogger.info(`   - Database: ${mongoose.connection.name}`);
      
      this.setupEventHandlers();
      this.setupHealthChecks();
      
    } catch (error) {
      this.connectionAttempts++;
      dbLogger.error(`❌ MongoDB connection failed (attempt ${this.connectionAttempts}/${this.maxRetries}):`, error.message);
      
      if (this.connectionAttempts < this.maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000);
        dbLogger.warn(`   Retrying in ${delay}ms...`);
        setTimeout(() => this.connect(), delay);
      } else {
        dbLogger.error('❌ Max connection retries reached. Exiting...');
        process.exit(1);
      }
    }
  }

  setupEventHandlers() {
    mongoose.connection.on('error', (err) => {
      dbLogger.error('❌ MongoDB connection error:', err.message);
      this.isConnected = false;
    });
    
    mongoose.connection.on('disconnected', () => {
      dbLogger.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
      this.isConnected = false;
      setTimeout(() => this.connect(), 5000);
    });
    
    mongoose.connection.on('reconnected', () => {
      dbLogger.info('✅ MongoDB reconnected');
      this.isConnected = true;
    });
    
    mongoose.connection.on('close', () => {
      dbLogger.info('🔒 MongoDB connection closed');
      this.isConnected = false;
    });
  }

  setupHealthChecks() {
    // Clear any existing interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Run health check function
    const runHealthCheck = async () => {
      try {
        if (mongoose.connection.readyState !== 1) {
          dbLogger.warn('⚠️  Health Check: Connection not ready (state:', mongoose.connection.readyState, ')');
          return;
        }
        
        // Get pool statistics
        const client = mongoose.connection.getClient();
        const topology = client?.topology;
        
        if (topology?.s?.pool) {
          const pool = topology.s.pool;
          const poolSize = pool.totalConnectionCount || 0;
          const availableConnections = pool.availableConnectionCount || 0;
          const pendingRequests = pool.waitQueueSize || 0;
          
          // Log warnings for high usage
          if (pendingRequests > 10) {
            dbLogger.warn(`⚠️  High DB wait queue: ${pendingRequests} pending requests`);
          }
          
          if (poolSize > 40) {
            dbLogger.warn(`⚠️  High connection count: ${poolSize} connections (${availableConnections} available)`);
          }
          
          // Log status on EVERY check (every 30 seconds) for monitoring
          dbLogger.info(`📊 Pool Status: ${poolSize} total, ${availableConnections} available, ${pendingRequests} pending`);
        } else {
          dbLogger.warn('⚠️  Pool not available (topology?.s?.pool is null)');
        }
        
      } catch (error) {
        dbLogger.error('❌ Health check failed:', error.message);
      }
    };

    // Run IMMEDIATELY on startup
    dbLogger.info('🏥 Starting health checks (every 30 seconds)...');
    runHealthCheck();

    // Then run every 30 seconds
    this.healthCheckInterval = setInterval(runHealthCheck, 30000);
  }

  async disconnect() {
    if (!this.isConnected) {
      dbLogger.info('Already disconnected');
      return;
    }
    
    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    try {
      await mongoose.connection.close();
      this.isConnected = false;
      dbLogger.info('✅ MongoDB connection closed gracefully');
    } catch (error) {
      dbLogger.error('❌ Error closing MongoDB connection:', error.message);
    }
  }

  getStats() {
    if (!this.isConnected) return null;
    
    return {
      readyState: mongoose.connection.readyState,
      readyStateText: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState],
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      models: Object.keys(mongoose.connection.models).length,
    };
  }

  isReady() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }
}

// Singleton instance
const dbConnection = new DatabaseConnection();

// Setup graceful shutdown handlers (but don't connect yet)
export function setupShutdownHandlers() {
  process.on('SIGINT', async () => {
    dbLogger.info('\n🛑 SIGINT received, closing MongoDB connection...');
    await dbConnection.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    dbLogger.info('\n🛑 SIGTERM received, closing MongoDB connection...');
    await dbConnection.disconnect();
    process.exit(0);
  });
}

export default dbConnection;

