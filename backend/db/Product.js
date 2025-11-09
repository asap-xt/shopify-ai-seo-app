import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true },
  shopifyProductId: { type: String, required: true },
  productId: String, // Keep for compatibility but allow string
  title: String,
  description: String,
  price: String,
  currency: String,
  tags: [String],
  images: [{
    id: String,
    alt: String,
    url: String
  }],
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
    aiEnhanced: { type: Boolean, default: false }, // Flag for AI-enhanced products
    languages: [{
      code: String,
      optimized: Boolean,
      hasSeo: Boolean,
      hasBullets: Boolean,
      hasFaq: Boolean,
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
  
  // Динамичен SEO статус за всеки език - използваме обекти за пълна информация
  languages: [{
    locale: { type: String, required: true },
    name: { type: String, default: '' },
    primary: { type: Boolean, default: false },
    published: { type: Boolean, default: true }
  }],
  availableLanguages: [{
    locale: { type: String, required: true },
    name: { type: String, default: '' },
    primary: { type: Boolean, default: false },
    published: { type: Boolean, default: true }
  }],
  
  // Съхранявайте метаполетата за референция
  _metafields: mongoose.Schema.Types.Mixed,
  
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
productSchema.index({ shop: 1, shopifyProductId: 1 }, { unique: true });
productSchema.index({ shop: 1, productId: 1 }); // For aiEnhanced queries
productSchema.index({ shop: 1, handle: 1 });

// Normalization function for backward compatibility
function normalizeLangs(val) {
  if (!Array.isArray(val)) return [];
  if (val.length && typeof val[0] === 'string') {
    return val.map(l => ({ locale: l, name: '', primary: false, published: true }));
  }
  if (val.length && typeof val[0] === 'object' && val[0] !== null) return val;
  return [];
}

// Apply normalization to language fields
productSchema.path('languages').set(normalizeLangs);
productSchema.path('availableLanguages').set(normalizeLangs);

// NEW INDEXES for better query performance
productSchema.index({ shop: 1, 'seoStatus.optimized': 1 });
productSchema.index({ shop: 1, 'seoStatus.aiEnhanced': 1 }); // Index for AI-enhanced products
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