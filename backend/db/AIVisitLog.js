import mongoose from 'mongoose';

const aiVisitLogSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true },
  endpoint: { type: String, required: true },   // e.g. '/ai/products.json', '/llms.txt'
  botName: { type: String, default: 'Unknown' }, // parsed friendly name
  userAgent: { type: String, default: '' },      // raw User-Agent for debugging
  ipHash: { type: String, default: '' },         // SHA256 hashed IP (no PII)
  statusCode: { type: Number, default: 200 },
  responseTimeMs: { type: Number, default: 0 },
  source: { type: String, enum: ['app_proxy', 'direct'], default: 'direct' },
  createdAt: { type: Date, default: Date.now }
});

// TTL: auto-delete after 90 days
aiVisitLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Query indexes
aiVisitLogSchema.index({ shop: 1, createdAt: -1 });
aiVisitLogSchema.index({ shop: 1, botName: 1, createdAt: -1 });
aiVisitLogSchema.index({ shop: 1, endpoint: 1, createdAt: -1 });

export default mongoose.model('AIVisitLog', aiVisitLogSchema);
