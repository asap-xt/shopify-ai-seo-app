// backend/db/Sitemap.js
import mongoose from 'mongoose';

const SitemapSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  generatedAt: {
    type: Date,
    default: Date.now
  },
  url: String,
  productCount: Number,
  size: Number,
  plan: String,
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed'
  },
  error: String,
  isAiEnhanced: {
    type: Boolean,
    default: false
  },
  content: {
    type: String,
    select: false // Don't return content by default in queries
  }
}, {
  timestamps: true
});

export default mongoose.model('Sitemap', SitemapSchema);