import mongoose from 'mongoose';

/**
 * PromoCode Schema
 * Supports marketing campaigns with unique codes
 * 
 * Types:
 * - 'free_trial_extended': Extended trial period (e.g., 30 days instead of 5)
 * - 'free_month': 1 month free (30 day trial)
 * - 'free_enterprise': Free Enterprise access (like EXEMPT_SHOPS but with code)
 * - 'discount_percent': Percentage discount (not directly supported by Shopify, but tracked)
 */
const promoCodeSchema = new mongoose.Schema({
  code: { 
    type: String, 
    required: true, 
    unique: true,
    uppercase: true,
    trim: true
  },
  
  // Promo type
  type: { 
    type: String, 
    required: true,
    enum: [
      'free_trial_extended',  // Extended trial (e.g., 30 days)
      'free_month',           // 30 days free trial
      'free_enterprise',      // Free Enterprise access (no billing)
      'discount_percent'      // Percentage discount (tracked, not applied)
    ]
  },
  
  // Configuration based on type
  trialDays: { type: Number, default: 30 },  // For trial extensions
  discountPercent: { type: Number, default: 0 },  // For discount type
  
  // Usage limits
  maxUses: { type: Number, default: 100 },
  currentUses: { type: Number, default: 0 },
  
  // Validity period
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: () => new Date() },
  
  // Metadata
  campaign: String,  // e.g., 'launch2025', 'partner_agency_x'
  notes: String,     // Internal notes
  createdBy: String  // Admin who created it
});

// Virtual: is code still valid?
promoCodeSchema.virtual('isValid').get(function() {
  const now = new Date();
  return (
    now < this.expiresAt &&
    this.currentUses < this.maxUses
  );
});

// Static: Validate and use a promo code
promoCodeSchema.statics.validateAndUse = async function(code) {
  const promo = await this.findOne({
    code: code.toUpperCase().trim(),
    expiresAt: { $gt: new Date() }
  });
  
  if (!promo) {
    return { valid: false, error: 'Invalid or expired promo code' };
  }
  
  if (promo.currentUses >= promo.maxUses) {
    return { valid: false, error: 'Promo code has reached maximum uses' };
  }
  
  // Increment usage
  promo.currentUses += 1;
  await promo.save();
  
  return {
    valid: true,
    promo: {
      code: promo.code,
      type: promo.type,
      trialDays: promo.trialDays,
      discountPercent: promo.discountPercent,
      campaign: promo.campaign
    }
  };
};

// Static: Check if code is valid (without using it)
promoCodeSchema.statics.checkValidity = async function(code) {
  const promo = await this.findOne({
    code: code.toUpperCase().trim(),
    expiresAt: { $gt: new Date() }
  });
  
  if (!promo) {
    return { valid: false, error: 'Invalid or expired promo code' };
  }
  
  if (promo.currentUses >= promo.maxUses) {
    return { valid: false, error: 'Promo code has reached maximum uses' };
  }
  
  return {
    valid: true,
    promo: {
      code: promo.code,
      type: promo.type,
      trialDays: promo.trialDays,
      discountPercent: promo.discountPercent,
      campaign: promo.campaign
    }
  };
};

// Static: Generate unique promo codes
promoCodeSchema.statics.generateCodes = async function(count, options = {}) {
  const crypto = await import('crypto');
  const codes = [];
  
  const {
    prefix = 'PROMO',
    type = 'free_month',
    trialDays = 30,
    maxUses = 1,
    expiresInDays = 90,
    campaign = null,
    notes = null,
    createdBy = 'system'
  } = options;
  
  for (let i = 0; i < count; i++) {
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = `${prefix}-${randomPart}`;
    
    try {
      const promo = await this.create({
        code,
        type,
        trialDays,
        maxUses,
        currentUses: 0,
        expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
        campaign,
        notes,
        createdBy
      });
      codes.push(promo.code);
    } catch (error) {
      // Code collision, try again
      if (error.code === 11000) {
        i--;
        continue;
      }
      throw error;
    }
  }
  
  return codes;
};

// Enable virtuals
promoCodeSchema.set('toJSON', { virtuals: true });
promoCodeSchema.set('toObject', { virtuals: true });

export default mongoose.model('PromoCode', promoCodeSchema);

