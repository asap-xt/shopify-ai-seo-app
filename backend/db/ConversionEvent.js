import mongoose from 'mongoose';

const conversionEventSchema = new mongoose.Schema({
  shop: { type: String, required: true },
  eventType: {
    type: String,
    required: true,
    enum: ['page_viewed', 'add_to_cart', 'checkout_completed']
  },
  productId: { type: String, default: '' },
  productHandle: { type: String, default: '' },
  productTitle: { type: String, default: '' },
  variantId: { type: String, default: '' },
  quantity: { type: Number, default: 1 },
  price: { type: String, default: '0' },
  currency: { type: String, default: 'USD' },
  totalPrice: { type: String, default: '0' },
  orderId: { type: String, default: '' },
  aiSource: { type: String, default: null },
  referrerUrl: { type: String, default: '' },
  sessionId: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

conversionEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
conversionEventSchema.index({ shop: 1, createdAt: -1 });
conversionEventSchema.index({ shop: 1, eventType: 1, createdAt: -1 });
conversionEventSchema.index({ shop: 1, aiSource: 1, createdAt: -1 });

export default mongoose.model('ConversionEvent', conversionEventSchema);
