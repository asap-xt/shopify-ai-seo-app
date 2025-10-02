// Test file for Factual Extractor
import { extractFactualAttributes, getProductSummary } from '../utils/factualExtractor.js';

console.log('🧪 Testing Factual Extractor...\n');

// Test product data
const testProduct = {
  title: "Cotton T-Shirt",
  productType: "Clothing",
  vendor: "Fashion Brand",
  tags: ["cotton", "casual", "blue", "medium", "men"],
  description: "Soft cotton t-shirt in blue color, available in medium size. Perfect for casual wear.",
  variants: {
    edges: [
      { node: { title: "Blue / Medium", price: "29.99" } },
      { node: { title: "Blue / Large", price: "29.99" } },
      { node: { title: "Red / Medium", price: "29.99" } }
    ]
  },
  images: {
    edges: [{ node: { url: "image1.jpg" } }, { node: { url: "image2.jpg" } }]
  }
};

// Test 1: Extract material
console.log('Test 1: Extract material');
const materialResult = extractFactualAttributes(testProduct, ['material']);
console.log('✅ Material result:', materialResult.material);
console.log('Expected: cotton, Got:', materialResult.material);
console.log('');

// Test 2: Extract color
console.log('Test 2: Extract color');
const colorResult = extractFactualAttributes(testProduct, ['color']);
console.log('✅ Color result:', colorResult.color);
console.log('Expected: blue, Got:', colorResult.color);
console.log('');

// Test 3: Extract size
console.log('Test 3: Extract size');
const sizeResult = extractFactualAttributes(testProduct, ['size']);
console.log('✅ Size result:', sizeResult.size);
console.log('Expected: MEDIUM, Got:', sizeResult.size);
console.log('');

// Test 4: Extract category
console.log('Test 4: Extract category');
const categoryResult = extractFactualAttributes(testProduct, ['category']);
console.log('✅ Category result:', categoryResult.category);
console.log('Expected: Clothing, Got:', categoryResult.category);
console.log('');

// Test 5: Extract audience
console.log('Test 5: Extract audience');
const audienceResult = extractFactualAttributes(testProduct, ['audience']);
console.log('✅ Audience result:', audienceResult.audience);
console.log('Expected: men, Got:', audienceResult.audience);
console.log('');

// Test 6: Extract multiple attributes
console.log('Test 6: Extract multiple attributes');
const multipleResult = extractFactualAttributes(testProduct, ['material', 'color', 'size', 'category', 'audience']);
console.log('✅ Multiple attributes result:', multipleResult);
console.log('Expected: 5 attributes, Got:', Object.keys(multipleResult).length);
console.log('');

// Test 7: Product with no specific attributes
console.log('Test 7: Product with no specific attributes');
const genericProduct = {
  title: "Generic Product",
  productType: "Electronics",
  vendor: "Tech Brand",
  tags: ["new", "popular"],
  description: "A great electronic device for everyone.",
  variants: {
    edges: [{ node: { title: "Standard", price: "99.99" } }]
  }
};

const genericResult = extractFactualAttributes(genericProduct, ['material', 'color', 'size']);
console.log('✅ Generic product result:', genericResult);
console.log('Expected: null values, Got:', Object.values(genericResult).filter(v => v !== null).length);
console.log('');

// Test 8: Product summary
console.log('Test 8: Product summary');
const summary = getProductSummary(testProduct);
console.log('✅ Product summary:', summary);
console.log('Expected: 5 fields, Got:', Object.keys(summary).length);
console.log('');

console.log('🧪 All factual extractor tests completed!');
