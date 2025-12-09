import mongoose from 'mongoose';

const shopSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    unique: true
  },
  accessToken: {
    type: String,
    required: true
  },
  appApiKey: {  // Добавете това поле
    type: String,
    default: () => process.env.SHOPIFY_API_KEY
  },
  jwtToken: {
    type: String,
    required: false
  },
  useJWT: {
    type: Boolean,
    default: false
  },
  needsTokenExchange: {
    type: Boolean,
    default: false
  },
  scopes: {
    type: String,
    required: false
  },
  installedAt: {
    type: Date,
    required: false
  },
  plan: {
    type: String,
    default: 'starter' // default plan
  },
  aiProviders: {
    type: [String], // например: ['openai', 'llama']
    default: []
  },
  productLimit: {
    type: Number,
    default: 150
  },
  queryLimit: {
    type: Number,
    default: 50
  },
  email: {
    type: String,
    required: false
  },
  contactEmail: {
    type: String,
    required: false
  },
  shopOwner: {
    type: String,
    required: false
  },
  shopOwnerEmail: {
    type: String,
    required: false
  },
  welcomeEmailSent: {
    type: Boolean,
    default: false
  },
  welcomeEmailSentAt: {
    type: Date,
    required: false
  },
  // Dashboard sync settings
  lastSyncDate: {
    type: Date,
    required: false
  },
  autoSyncEnabled: {
    type: Boolean,
    default: false
  },
  syncStatus: {
    inProgress: { type: Boolean, default: false },
    lastError: { type: String, default: null }
  },
  // PHASE 4: Sitemap generation queue status
  sitemapStatus: {
    inProgress: { type: Boolean, default: false },
    status: { type: String, default: 'idle' }, // idle, queued, processing, completed, failed, retrying, cancelled
    message: { type: String, default: null },
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    updatedAt: { type: Date, default: null },
    cancelled: { type: Boolean, default: false },
    progress: {
      current: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
      elapsedSeconds: { type: Number, default: 0 },
      remainingSeconds: { type: Number, default: 0 },
      startedAt: { type: Date, default: null }
    }
  },
  schemaStatus: {
    inProgress: { type: Boolean, default: false },
    status: { type: String, default: 'idle' }, // idle, queued, processing, completed, failed, retrying
    message: { type: String, default: null },
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    updatedAt: { type: Date, default: null }
  },
  // SEO Job queue status (Generate + Apply combined)
  seoJobStatus: {
    inProgress: { type: Boolean, default: false },
    status: { type: String, default: 'idle' }, // idle, queued, generating, applying, completed, failed, cancelled
    phase: { type: String, default: null }, // 'generate' or 'apply'
    message: { type: String, default: null },
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    updatedAt: { type: Date, default: null },
    cancelled: { type: Boolean, default: false },
    // Progress tracking (legacy fields for compatibility)
    totalProducts: { type: Number, default: 0 },
    processedProducts: { type: Number, default: 0 },
    successfulProducts: { type: Number, default: 0 },
    failedProducts: { type: Number, default: 0 },
    skippedProducts: { type: Number, default: 0 },
    skipReasons: [{ type: String }],
    failReasons: [{ type: String }],
    // Enhanced progress tracking (like sitemap)
    progress: {
      current: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
      elapsedSeconds: { type: Number, default: 0 },
      remainingSeconds: { type: Number, default: 0 },
      startedAt: { type: Date, default: null }
    }
  },
  // AI Enhancement Job queue status (Products)
  aiEnhanceJobStatus: {
    inProgress: { type: Boolean, default: false },
    status: { type: String, default: 'idle' }, // idle, queued, processing, completed, failed, cancelled
    message: { type: String, default: null },
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    updatedAt: { type: Date, default: null },
    cancelled: { type: Boolean, default: false },
    // Progress tracking (legacy fields for compatibility)
    totalProducts: { type: Number, default: 0 },
    processedProducts: { type: Number, default: 0 },
    successfulProducts: { type: Number, default: 0 },
    failedProducts: { type: Number, default: 0 },
    skippedProducts: { type: Number, default: 0 },
    skipReasons: [{ type: String }],
    failReasons: [{ type: String }],
    // Enhanced progress tracking (like sitemap)
    progress: {
      current: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
      elapsedSeconds: { type: Number, default: 0 },
      remainingSeconds: { type: Number, default: 0 },
      startedAt: { type: Date, default: null }
    }
  },
  // Collection SEO Job queue status (Generate + Apply)
  collectionSeoJobStatus: {
    inProgress: { type: Boolean, default: false },
    status: { type: String, default: 'idle' }, // idle, queued, processing, completed, failed, cancelled
    message: { type: String, default: null },
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    updatedAt: { type: Date, default: null },
    cancelled: { type: Boolean, default: false },
    // Progress tracking (legacy)
    totalCollections: { type: Number, default: 0 },
    processedCollections: { type: Number, default: 0 },
    successfulCollections: { type: Number, default: 0 },
    failedCollections: { type: Number, default: 0 },
    skippedCollections: { type: Number, default: 0 },
    // Enhanced progress tracking
    progress: {
      current: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
      elapsedSeconds: { type: Number, default: 0 },
      remainingSeconds: { type: Number, default: 0 },
      startedAt: { type: Date, default: null }
    }
  },
  // Collection AI Enhancement Job queue status
  collectionAiEnhanceJobStatus: {
    inProgress: { type: Boolean, default: false },
    status: { type: String, default: 'idle' }, // idle, queued, processing, completed, failed, cancelled
    message: { type: String, default: null },
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    updatedAt: { type: Date, default: null },
    cancelled: { type: Boolean, default: false },
    // Progress tracking (legacy)
    totalCollections: { type: Number, default: 0 },
    processedCollections: { type: Number, default: 0 },
    successfulCollections: { type: Number, default: 0 },
    failedCollections: { type: Number, default: 0 },
    skippedCollections: { type: Number, default: 0 },
    // Enhanced progress tracking
    progress: {
      current: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
      elapsedSeconds: { type: Number, default: 0 },
      remainingSeconds: { type: Number, default: 0 },
      startedAt: { type: Date, default: null }
    }
  },
  // Delete Job queue status (for background SEO deletion)
  deleteJobStatus: {
    inProgress: { type: Boolean, default: false },
    status: { type: String, default: 'idle' }, // idle, processing, completed, failed
    message: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    // Progress tracking - count products, not metafield items
    totalProducts: { type: Number, default: 0 },
    processedProducts: { type: Number, default: 0 },
    deletedProducts: { type: Number, default: 0 },
    failedProducts: { type: Number, default: 0 }
  },
  storeLanguages: [{
    locale: String,
    name: String,
    primary: Boolean,
    published: Boolean
  }],
  storeMarkets: [{
    id: String,
    name: String,
    primary: Boolean,
    enabled: Boolean,
    regions: [{ name: String, code: String }]
  }],
  createdAt: {
    type: Date,
    default: () => new Date()
  },
  emailPreferences: {
    marketingEmails: { type: Boolean, default: true },
    unsubscribedAt: { type: Date, default: null }
  },
  updatedAt: {
    type: Date,
    default: () => new Date()
  }
});

export default mongoose.model('Shop', shopSchema);
