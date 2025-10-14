// backend/db/TokenBalance.js
import mongoose from 'mongoose';

const tokenBalanceSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Current balance
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Lifetime stats
  totalPurchased: {
    type: Number,
    default: 0
  },
  
  totalUsed: {
    type: Number,
    default: 0
  },
  
  // Last purchase info
  lastPurchase: {
    amount: Number,
    tokens: Number,
    date: Date,
    shopifyChargeId: String
  },
  
  // Purchase history
  purchases: [{
    usdAmount: {
      type: Number,
      required: true
    },
    appRevenue: {
      type: Number,
      required: true
    },
    tokenBudget: {
      type: Number,
      required: true
    },
    tokensReceived: {
      type: Number,
      required: true
    },
    date: {
      type: Date,
      default: Date.now
    },
    shopifyChargeId: String,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    }
  }],
  
  // Usage history
  usage: [{
    feature: {
      type: String,
      required: true
    },
    tokensUsed: {
      type: Number,
      required: true
    },
    productId: String,
    collectionId: String,
    metadata: mongoose.Schema.Types.Mixed,
    date: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Methods
tokenBalanceSchema.methods.hasBalance = function(requiredTokens) {
  return this.balance >= requiredTokens;
};

// Reserve tokens temporarily (with safety margin)
// Returns reservation ID for later adjustment
tokenBalanceSchema.methods.reserveTokens = function(estimatedAmount, feature, metadata = {}) {
  if (!this.hasBalance(estimatedAmount)) {
    throw new Error('Insufficient token balance');
  }
  
  // Temporarily deduct the estimated amount (with margin)
  this.balance -= estimatedAmount;
  
  const reservationId = new Date().getTime().toString() + Math.random().toString(36).substr(2, 9);
  
  this.usage.push({
    feature,
    tokensUsed: estimatedAmount,
    productId: metadata.productId,
    collectionId: metadata.collectionId,
    metadata: {
      ...metadata,
      reservationId,
      status: 'reserved',
      estimatedAmount
    },
    date: new Date()
  });
  
  return { reservationId, save: () => this.save() };
};

// Adjust reservation to actual usage
// If actual < estimated, refund the difference
// If actual > estimated, deduct more (should not happen with 10% margin)
tokenBalanceSchema.methods.finalizeReservation = function(reservationId, actualTokensUsed) {
  const reservationIndex = this.usage.findIndex(
    u => u.metadata?.reservationId === reservationId && u.metadata?.status === 'reserved'
  );
  
  if (reservationIndex === -1) {
    console.warn(`[TokenBalance] Reservation ${reservationId} not found`);
    return this.save();
  }
  
  const reservation = this.usage[reservationIndex];
  const estimatedAmount = reservation.metadata.estimatedAmount || reservation.tokensUsed;
  const difference = estimatedAmount - actualTokensUsed;
  
  // Update the usage record
  this.usage[reservationIndex].tokensUsed = actualTokensUsed;
  this.usage[reservationIndex].metadata.status = 'finalized';
  this.usage[reservationIndex].metadata.actualTokensUsed = actualTokensUsed;
  this.usage[reservationIndex].metadata.refunded = difference > 0 ? difference : 0;
  
  // Refund or deduct the difference
  if (difference > 0) {
    // Refund: actual was less than estimated
    this.balance += difference;
    console.log(`[TokenBalance] Refunded ${difference} tokens from reservation ${reservationId}`);
  } else if (difference < 0) {
    // Deduct more: actual was more than estimated (should rarely happen with 10% margin)
    this.balance += difference; // difference is negative, so this deducts
    this.totalUsed += Math.abs(difference);
    console.warn(`[TokenBalance] Extra ${Math.abs(difference)} tokens deducted (exceeded estimate)`);
  }
  
  // Update total used to reflect actual
  this.totalUsed += actualTokensUsed;
  
  return this.save();
};

// Original method for backward compatibility (immediate deduction)
tokenBalanceSchema.methods.deductTokens = function(amount, feature, metadata = {}) {
  if (!this.hasBalance(amount)) {
    throw new Error('Insufficient token balance');
  }
  
  this.balance -= amount;
  this.totalUsed += amount;
  this.usage.push({
    feature,
    tokensUsed: amount,
    productId: metadata.productId,
    collectionId: metadata.collectionId,
    metadata,
    date: new Date()
  });
  
  return this.save();
};

tokenBalanceSchema.methods.addTokens = function(usdAmount, tokensReceived, shopifyChargeId) {
  const appRevenue = usdAmount * 0.40;
  const tokenBudget = usdAmount * 0.60;
  
  this.balance += tokensReceived;
  this.totalPurchased += tokensReceived;
  
  const purchase = {
    usdAmount,
    appRevenue,
    tokenBudget,
    tokensReceived,
    shopifyChargeId,
    status: 'completed',
    date: new Date()
  };
  
  this.purchases.push(purchase);
  this.lastPurchase = {
    amount: usdAmount,
    tokens: tokensReceived,
    date: new Date(),
    shopifyChargeId
  };
  
  return this.save();
};

// Static methods
tokenBalanceSchema.statics.getOrCreate = async function(shop) {
  let balance = await this.findOne({ shop });
  if (!balance) {
    balance = await this.create({ shop });
  }
  return balance;
};

export default mongoose.model('TokenBalance', tokenBalanceSchema);

