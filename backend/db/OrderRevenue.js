import mongoose from 'mongoose';

const lineItemSchema = new mongoose.Schema({
  productId: String,
  handle: String,
  title: String,
  quantity: Number,
  price: String,
  variantId: String
}, { _id: false });

const orderRevenueSchema = new mongoose.Schema({
  shop: { type: String, required: true },
  shopifyOrderId: { type: String, required: true },
  orderNumber: { type: String, default: '' },
  totalPrice: { type: String, default: '0' },
  subtotalPrice: { type: String, default: '0' },
  currency: { type: String, default: 'USD' },
  lineItems: [lineItemSchema],
  referringDomain: { type: String, default: '' },
  landingPageUrl: { type: String, default: '' },
  customerJourney: {
    firstVisitReferrer: { type: String, default: '' },
    lastVisitReferrer: { type: String, default: '' },
    source: { type: String, default: '' }
  },
  attributionType: {
    type: String,
    enum: ['direct_ai', 'ai_influenced', 'organic'],
    default: 'organic'
  },
  aiSource: { type: String, default: null },
  orderCreatedAt: { type: Date },
  processedAt: { type: Date, default: Date.now }
});

orderRevenueSchema.index({ shop: 1, shopifyOrderId: 1 }, { unique: true });
orderRevenueSchema.index({ shop: 1, orderCreatedAt: -1 });
orderRevenueSchema.index({ shop: 1, attributionType: 1, orderCreatedAt: -1 });

export default mongoose.model('OrderRevenue', orderRevenueSchema);
