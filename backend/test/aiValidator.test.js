// Test file for AI Validator
import { validateAIResponse, createFactualPrompt } from '../utils/aiValidator.js';

console.log('🧪 Testing AI Validator...\n');

// Test 1: Valid bullets should pass
console.log('Test 1: Valid bullets');
const validBullets = [
  "High-quality materials for durability",
  "Easy to use and maintain",
  "Perfect for everyday use"
];

const productData = {
  title: "Test Product",
  description: "A high-quality product made with durable materials",
  tags: ["quality", "durable"]
};

const result1 = validateAIResponse(
  { bullets: validBullets },
  productData,
  ['bullets']
);

console.log('✅ Valid bullets result:', result1.bullets);
console.log('Expected: 3 bullets, Got:', result1.bullets?.length);
console.log('');

// Test 2: Hallucinated bullets should be rejected
console.log('Test 2: Hallucinated bullets (should be rejected)');
const hallucinatedBullets = [
  "Made with 100% organic cotton", // Not in product data
  "ISO 9001 certified quality",     // Certification not mentioned
  "30-day money back guarantee",    // Warranty not specified
  "Made in Italy",                  // Origin not specified
  "Free shipping worldwide"         // Store policy, not product feature
];

const result2 = validateAIResponse(
  { bullets: hallucinatedBullets },
  productData,
  ['bullets']
);

console.log('❌ Hallucinated bullets result:', result2.bullets);
console.log('Expected: 0 bullets (all rejected), Got:', result2.bullets?.length);
console.log('');

// Test 3: Valid FAQ should pass
console.log('Test 3: Valid FAQ');
const validFAQ = [
  {
    q: "What is this product made of?",
    a: "This product is made with high-quality materials for durability."
  },
  {
    q: "How do I use this product?",
    a: "This product is easy to use and perfect for everyday use."
  }
];

const result3 = validateAIResponse(
  { faq: validFAQ },
  productData,
  ['faq']
);

console.log('✅ Valid FAQ result:', result3.faq);
console.log('Expected: 2 FAQ items, Got:', result3.faq?.length);
console.log('');

// Test 4: Hallucinated FAQ should be rejected
console.log('Test 4: Hallucinated FAQ (should be rejected)');
const hallucinatedFAQ = [
  {
    q: "What is your return policy?",
    a: "We offer 30-day money back guarantee" // Not in product data
  },
  {
    q: "Where is this made?",
    a: "Made in Italy with ISO certification" // Origin + cert not mentioned
  }
];

const result4 = validateAIResponse(
  { faq: hallucinatedFAQ },
  productData,
  ['faq']
);

console.log('❌ Hallucinated FAQ result:', result4.faq);
console.log('Expected: 0 FAQ items (all rejected), Got:', result4.faq?.length);
console.log('');

// Test 5: Mixed valid/invalid content
console.log('Test 5: Mixed valid/invalid content');
const mixedBullets = [
  "High-quality materials",        // Valid - matches description
  "ISO certified quality",         // Invalid - certification not mentioned
  "Easy to use",                   // Valid - matches description
  "Made in Italy",                 // Invalid - origin not mentioned
  "Perfect for daily use"          // Valid - matches description
];

const result5 = validateAIResponse(
  { bullets: mixedBullets },
  productData,
  ['bullets']
);

console.log('🔀 Mixed content result:', result5.bullets);
console.log('Expected: 3 valid bullets, Got:', result5.bullets?.length);
console.log('');

// Test 6: Factual prompt creation
console.log('Test 6: Factual prompt creation');
const prompt = createFactualPrompt(productData, ['bullets', 'faq']);
console.log('📝 Generated prompt length:', prompt.length);
console.log('Contains product data:', prompt.includes('Test Product'));
console.log('Contains rules:', prompt.includes('CRITICAL RULES'));
console.log('');

console.log('🧪 All tests completed!');
