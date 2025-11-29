// backend/db/ProductChangeLog.js
// Tracks product changes for weekly digest notifications

import mongoose from 'mongoose';

const ProductChangeLogSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    index: true
  },
  productId: {
    type: String,
    required: true
  },
  productTitle: {
    type: String,
    required: true
  },
  productHandle: {
    type: String
  },
  changeType: {
    type: String,
    enum: ['created', 'updated', 'deleted'],
    required: true
  },
  changedFields: {
    type: [String], // e.g. ['title', 'description', 'variants']
    default: []
  },
  hasOptimization: {
    type: Boolean,
    default: false // Does product have SEO optimization?
  },
  needsAttention: {
    type: Boolean,
    default: true // Should be included in digest?
  },
  notified: {
    type: Boolean,
    default: false // Has been included in a digest email?
  },
  notifiedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
ProductChangeLogSchema.index({ shop: 1, notified: 1, createdAt: -1 });
ProductChangeLogSchema.index({ shop: 1, createdAt: -1 });

// Clean up old notified records (keep for 30 days)
ProductChangeLogSchema.index({ notifiedAt: 1 }, { 
  expireAfterSeconds: 30 * 24 * 60 * 60 // 30 days
});

const ProductChangeLog = mongoose.model('ProductChangeLog', ProductChangeLogSchema);

export default ProductChangeLog;

