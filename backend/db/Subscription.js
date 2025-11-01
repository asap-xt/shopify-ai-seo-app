import mongoose from 'mongoose';
import { getPlanConfig } from '../plans.js';

const subscriptionSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },
  plan: { type: String, required: true }, // starter, professional, growth, growth extra, enterprise
  pendingPlan: String, // Plan waiting for approval (if user hasn't approved yet)
  
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
}, {
  // Enable virtuals in JSON output
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

/**
 * Virtual property: price
 * Always computed from plans.js (single source of truth)
 * This ensures price is ALWAYS in sync with plans.js
 */
subscriptionSchema.virtual('price').get(function() {
  const planConfig = getPlanConfig(this.plan);
  return planConfig?.priceUsd || 0;
});

/**
 * Virtual property: planConfig
 * Returns full plan configuration from plans.js
 */
subscriptionSchema.virtual('planConfig').get(function() {
  return getPlanConfig(this.plan);
});

export default mongoose.model('Subscription', subscriptionSchema);
