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
