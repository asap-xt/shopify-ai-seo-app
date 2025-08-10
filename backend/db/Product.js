import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  shop: { type: String, required: true },
  productId: { type: Number, required: true },
  title: String,
  description: String,
  price: String,
  tags: [String],
  images: [String],
  available: Boolean,
  aiOptimized: {
    title: String,
    description: String,
    altText: String,
    keywords: [String],
  },
  syncedAt: Date
});

productSchema.index({ shop: 1, productId: 1 }, { unique: true });

export default mongoose.model('Product', productSchema);
