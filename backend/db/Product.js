import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  shop: { type: String, required: true },
  productId: { type: Number, required: true },
  title: String,
  description: String,
  price: String,
  currency: String,
  tags: [String],
  images: [String],
  available: Boolean,
  aiOptimized: {
    title: String,
    description: String,
    altText: String,
    keywords: [String],
  },
  syncedAt: Date,
  
  // NEW FIELDS FOR BULK EDIT
  // SEO optimization status tracking
  seoStatus: {
    optimized: { type: Boolean, default: false },
    languages: [{
      code: String,
      optimized: Boolean,
      lastOptimizedAt: Date
    }],
    lastCheckedAt: Date
  },
  
  // Product metadata for display and filtering
  featuredImage: {
    url: String,
    altText: String
  },
  totalInventory: { type: Number, default: 0 },
  status: { 
    type: String, 
    enum: ['ACTIVE', 'DRAFT', 'ARCHIVED'],
    default: 'ACTIVE'
  },
  
  // Timestamps for sorting
  createdAt: { type: Date },
  publishedAt: { type: Date },
  
  // GID for easier GraphQL operations
  gid: String,
  
  // Additional Shopify fields
  vendor: String,
  productType: String,
  handle: String
});

// Existing index
productSchema.index({ shop: 1, productId: 1 }, { unique: true });

// NEW INDEXES for better query performance
productSchema.index({ shop: 1, 'seoStatus.optimized': 1 });
productSchema.index({ shop: 1, status: 1 });
productSchema.index({ shop: 1, tags: 1 });
productSchema.index({ shop: 1, createdAt: -1 });
productSchema.index({ shop: 1, publishedAt: -1 });
productSchema.index({ shop: 1, title: 'text' }); // For text search

// Pre-save hook to set GID if not present
productSchema.pre('save', function(next) {
  if (!this.gid && this.productId) {
    this.gid = `gid://shopify/Product/${this.productId}`;
  }
  next();
});

// Helper method to check if product is optimized for specific language
productSchema.methods.isOptimizedForLanguage = function(languageCode) {
  const lang = this.seoStatus?.languages?.find(l => l.code === languageCode);
  return lang?.optimized || false;
};

// Helper method to get optimization summary
productSchema.methods.getOptimizationSummary = function() {
  const optimizedLanguages = this.seoStatus?.languages?.filter(l => l.optimized) || [];
  return {
    isOptimized: this.seoStatus?.optimized || false,
    optimizedLanguagesCount: optimizedLanguages.length,
    optimizedLanguages: optimizedLanguages.map(l => l.code),
    lastOptimized: optimizedLanguages
      .map(l => l.lastOptimizedAt)
      .filter(d => d)
      .sort((a, b) => b - a)[0] || null
  };
};

export default mongoose.model('Product', productSchema);