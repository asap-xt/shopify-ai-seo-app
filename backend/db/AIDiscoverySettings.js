// backend/db/AIDiscoverySettings.js
import mongoose from 'mongoose';

const AIDiscoverySettingsSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    unique: true
  },
  enabled: {
    type: Boolean,
    default: false
  },
  bots: {
    openai: {
      enabled: { type: Boolean, default: false },
      name: { type: String, default: 'OpenAI (ChatGPT, SearchGPT)' }
    },
    anthropic: {
      enabled: { type: Boolean, default: false },
      name: { type: String, default: 'Anthropic (Claude)' }
    },
    google: {
      enabled: { type: Boolean, default: false },
      name: { type: String, default: 'Google (Gemini, Bard)' }
    },
    perplexity: {
      enabled: { type: Boolean, default: false },
      name: { type: String, default: 'Perplexity AI' }
    },
    meta: {
      enabled: { type: Boolean, default: false },
      name: { type: String, default: 'Meta AI' }
    },
    others: {
      enabled: { type: Boolean, default: false },
      name: { type: String, default: 'Other AI Bots' }
    }
  },
  features: {
    productsJson: { type: Boolean, default: false },
    aiSitemap: { type: Boolean, default: false },
    welcomePage: { type: Boolean, default: false },
    collectionsJson: { type: Boolean, default: false },
    storeMetadata: { type: Boolean, default: false },
    schemaData: { type: Boolean, default: false }
  },
  richAttributes: {
    material: { type: Boolean, default: false },
    color: { type: Boolean, default: false },
    size: { type: Boolean, default: false },
    weight: { type: Boolean, default: false },
    dimensions: { type: Boolean, default: false },
    category: { type: Boolean, default: false },
    audience: { type: Boolean, default: false },
    reviews: { type: Boolean, default: false },
    ratings: { type: Boolean, default: false },
    enhancedDescription: { type: Boolean, default: false },
    organization: { type: Boolean, default: false }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

AIDiscoverySettingsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const AIDiscoverySettings = mongoose.model('AIDiscoverySettings', AIDiscoverySettingsSchema);

export default AIDiscoverySettings;
