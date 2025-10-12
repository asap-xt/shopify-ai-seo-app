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

