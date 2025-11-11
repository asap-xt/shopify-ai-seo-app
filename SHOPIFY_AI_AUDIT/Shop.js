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
    status: { type: String, default: 'idle' }, // idle, queued, processing, completed, failed, retrying
    message: { type: String, default: null },
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    updatedAt: { type: Date, default: null }
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
  updatedAt: {
    type: Date,
    default: () => new Date()
  }
});

export default mongoose.model('Shop', shopSchema);
