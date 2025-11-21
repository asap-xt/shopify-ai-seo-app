import mongoose from 'mongoose';

const emailLogSchema = new mongoose.Schema({
  storeId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Shop', 
    required: true 
  },
  shop: {
    type: String,
    required: true,
    index: true
  },
  type: { 
    type: String, 
    enum: [
      'welcome', 
      'onboarding-day1', 
      'onboarding-day3', 
      'onboarding-day7', 
      'trial-expiring', 
      'uninstall-followup', 
      'weekly-digest', 
      'upgrade-success', 
      'reengagement'
    ],
    required: true,
    index: true
  },
  status: { 
    type: String, 
    enum: ['sent', 'failed', 'bounced', 'opened', 'clicked'], 
    default: 'sent',
    index: true
  },
  recipient: String,
  error: String,
  openedAt: Date,
  clickedAt: Date,
  sentAt: { 
    type: Date, 
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
emailLogSchema.index({ shop: 1, type: 1, sentAt: -1 });
emailLogSchema.index({ storeId: 1, status: 1 });

export default mongoose.model('EmailLog', emailLogSchema);

