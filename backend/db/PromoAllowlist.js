import mongoose from 'mongoose';

/**
 * PromoAllowlist Schema
 * Manual allowlist for shops that get special promo treatment
 * 
 * Use cases:
 * - Partner agencies getting free access for clients
 * - Beta testers
 * - Influencer partnerships
 * - Support cases (free trial extension)
 */
const promoAllowlistSchema = new mongoose.Schema({
  shop: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    trim: true
  },
  
  // Promo type (same as PromoCode types)
  promoType: { 
    type: String, 
    required: true,
    enum: [
      'free_trial_extended',  // Extended trial
      'free_month',           // 30 days free
      'free_enterprise',      // Free Enterprise access (no billing)
      'discount_percent'      // Percentage discount
    ]
  },
  
  // Configuration
  trialDays: { type: Number, default: 30 },
  discountPercent: { type: Number, default: 0 },
  
  // Validity
  expiresAt: { type: Date, required: true },
  addedAt: { type: Date, default: () => new Date() },
  
  // Metadata
  reason: String,      // Why this shop is on allowlist
  campaign: String,    // Campaign source
  addedBy: String,     // Admin who added
  notes: String        // Internal notes
});

// Virtual: is allowlist entry still valid?
promoAllowlistSchema.virtual('isValid').get(function() {
  return new Date() < this.expiresAt;
});

// Static: Check if shop is on allowlist
promoAllowlistSchema.statics.checkShop = async function(shop) {
  const normalizedShop = shop.toLowerCase().trim();
  
  const entry = await this.findOne({
    shop: normalizedShop,
    expiresAt: { $gt: new Date() }
  });
  
  if (!entry) {
    return { onAllowlist: false };
  }
  
  return {
    onAllowlist: true,
    promo: {
      type: entry.promoType,
      trialDays: entry.trialDays,
      discountPercent: entry.discountPercent,
      expiresAt: entry.expiresAt,
      campaign: entry.campaign,
      reason: entry.reason
    }
  };
};

// Static: Add shop to allowlist
promoAllowlistSchema.statics.addShop = async function(shop, options = {}) {
  const {
    promoType = 'free_month',
    trialDays = 30,
    discountPercent = 0,
    expiresInDays = 30,
    reason = null,
    campaign = null,
    addedBy = 'system',
    notes = null
  } = options;
  
  const normalizedShop = shop.toLowerCase().trim();
  
  // Upsert to allow updating existing entries
  const entry = await this.findOneAndUpdate(
    { shop: normalizedShop },
    {
      shop: normalizedShop,
      promoType,
      trialDays,
      discountPercent,
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      addedAt: new Date(),
      reason,
      campaign,
      addedBy,
      notes
    },
    { upsert: true, new: true }
  );
  
  return entry;
};

// Static: Remove shop from allowlist
promoAllowlistSchema.statics.removeShop = async function(shop) {
  const normalizedShop = shop.toLowerCase().trim();
  const result = await this.deleteOne({ shop: normalizedShop });
  return result.deletedCount > 0;
};

// Enable virtuals
promoAllowlistSchema.set('toJSON', { virtuals: true });
promoAllowlistSchema.set('toObject', { virtuals: true });

export default mongoose.model('PromoAllowlist', promoAllowlistSchema);

