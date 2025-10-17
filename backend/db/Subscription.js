import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },
  plan: { type: String, required: true }, // starter, professional, growth, growth extra, enterprise
  
  // Shopify billing
  shopifySubscriptionId: String,
  status: { type: String, enum: ['pending', 'active', 'cancelled', 'expired'], default: 'active' },
  pendingActivation: { type: Boolean, default: false },
  
  // Dates
  startedAt: { type: Date, default: () => new Date() },
  activatedAt: Date,
  cancelledAt: Date,
  expiredAt: Date,
  trialEndsAt: Date,
  updatedAt: { type: Date, default: () => new Date() },
  
  // Legacy fields (kept for backwards compatibility, but not used)
  expiresAt: Date,
  aiProviders: [String]
});

export default mongoose.model('Subscription', subscriptionSchema);
