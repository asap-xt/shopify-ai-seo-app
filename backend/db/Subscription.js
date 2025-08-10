import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },
  plan: { type: String, required: true }, // starter, growth, enterprise...
  startedAt: { type: Date, default: () => new Date() },
  expiresAt: Date,
  queryCount: { type: Number, default: 0 },
  queryLimit: { type: Number, default: 50 },
  productLimit: { type: Number, default: 150 },
  aiProviders: [String],
  trialEndsAt: Date
});

export default mongoose.model('Subscription', subscriptionSchema);
