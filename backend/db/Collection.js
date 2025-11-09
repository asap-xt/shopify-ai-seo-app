// backend/db/Collection.js
// MongoDB model for Shopify Collections

import mongoose from 'mongoose';

const CollectionSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true },
  collectionId: { type: String, required: true, index: true }, // Shopify collection ID (numeric or gid)
  shopifyCollectionId: { type: String, index: true }, // Alternative field name
  gid: { type: String }, // gid://shopify/Collection/...
  
  // Collection basic data
  title: { type: String },
  handle: { type: String },
  description: { type: String },
  descriptionHtml: { type: String },
  productsCount: { type: Number, default: 0 },
  
  // SEO optimization status
  seoStatus: {
    optimized: { type: Boolean, default: false },
    aiEnhanced: { type: Boolean, default: false }, // Flag for AI-enhanced collections
    languages: [{
      code: String,
      optimized: Boolean,
      lastOptimizedAt: Date
    }],
    lastCheckedAt: Date
  },
  
  // Last known Shopify state for webhook comparison
  // Used to detect real merchant edits vs our app's metafield updates
  lastShopifyUpdate: {
    title: String,
    description: String,
    updatedAt: Date
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  syncedAt: { type: Date }
});

// Compound index for shop + collection lookup
CollectionSchema.index({ shop: 1, collectionId: 1 }, { unique: true });
CollectionSchema.index({ shop: 1, shopifyCollectionId: 1 });
CollectionSchema.index({ shop: 1, gid: 1 });

const Collection = mongoose.model('Collection', CollectionSchema);

export default Collection;

