import mongoose from 'mongoose';

const advancedSchemaSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  schemas: {
    type: Array,
    default: []
  },
  siteFAQ: {
    type: Object,
    default: null
  },
  generatedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('AdvancedSchema', advancedSchemaSchema);