import mongoose from 'mongoose';

const syncLogSchema = new mongoose.Schema({
  shop: { type: String, required: true },
  type: { type: String, enum: ['auto', 'manual'], default: 'manual' },
  productIds: [Number],
  status: { type: String, enum: ['success', 'partial', 'error'], default: 'success' },
  message: String,
  startedAt: { type: Date, default: () => new Date() },
  endedAt: Date
});

export default mongoose.model('SyncLog', syncLogSchema);
