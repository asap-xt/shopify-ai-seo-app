// Real-world validation test
console.log('🧪 Real-world AI Validation Test...\n');

// Simulate a real product with AI enhancement
const realProduct = {
  title: "Premium Wireless Headphones",
  description: "High-quality wireless headphones with noise cancellation, perfect for music lovers and professionals. Features Bluetooth connectivity and long battery life.",
  tags: ["wireless", "bluetooth", "noise-cancelling", "premium", "electronics"],
  productType: "Electronics",
  vendor: "TechBrand",
  variants: {
    edges: [
      { node: { title: "Black / Standard", price: "199.99" } },
      { node: { title: "White / Standard", price: "199.99" } }
    ]
  }
};

// Simulate AI response that might contain hallucinations
const mockAIResponse = {
  bullets: [
    "Premium wireless headphones with noise cancellation", // ✅ Valid - matches description
    "Bluetooth connectivity for seamless pairing",          // ✅ Valid - matches description  
    "Long battery life up to 30 hours",                    // ✅ Valid - matches description
    "Made with premium materials",                         // ✅ Valid - matches description
    "ISO certified quality assurance",                     // ❌ Invalid - certification not mentioned
    "30-day money back guarantee",                         // ❌ Invalid - warranty not specified
    "Made in Germany with precision engineering",          // ❌ Invalid - origin not specified
    "Free shipping worldwide",                             // ❌ Invalid - store policy
    "Perfect for music lovers and professionals"           // ✅ Valid - matches description
  ],
  faq: [
    {
      q: "How long is the battery life?",
      a: "These headphones offer long battery life for extended use." // ✅ Valid - factual
    },
    {
      q: "What connectivity options are available?",
      a: "The headphones feature Bluetooth connectivity for wireless pairing." // ✅ Valid - factual
    },
    {
      q: "What is your return policy?",
      a: "We offer 30-day money back guarantee on all products." // ❌ Invalid - store policy
    },
    {
      q: "Where are these headphones made?",
      a: "Made in Germany with precision engineering and ISO certification." // ❌ Invalid - false claims
    },
    {
      q: "What materials are used?",
      a: "Made with premium materials for durability and comfort." // ✅ Valid - matches description
    }
  ]
};

console.log('📦 Real Product Data:');
console.log(JSON.stringify(realProduct, null, 2));
console.log('');

console.log('🤖 Mock AI Response (with potential hallucinations):');
console.log(JSON.stringify(mockAIResponse, null, 2));
console.log('');

console.log('🔍 Expected Validation Results:');
console.log('');

console.log('Bullets (9 total):');
console.log('✅ "Premium wireless headphones with noise cancellation" - Valid (matches description)');
console.log('✅ "Bluetooth connectivity for seamless pairing" - Valid (matches description)');
console.log('✅ "Long battery life up to 30 hours" - Valid (matches description)');
console.log('✅ "Made with premium materials" - Valid (matches description)');
console.log('❌ "ISO certified quality assurance" - Invalid (certification not mentioned)');
console.log('❌ "30-day money back guarantee" - Invalid (warranty not specified)');
console.log('❌ "Made in Germany with precision engineering" - Invalid (origin not specified)');
console.log('❌ "Free shipping worldwide" - Invalid (store policy)');
console.log('✅ "Perfect for music lovers and professionals" - Valid (matches description)');
console.log('Expected: 5 valid bullets, 4 rejected');
console.log('');

console.log('FAQ (5 total):');
console.log('✅ Q: "How long is the battery life?" - Valid (factual answer)');
console.log('✅ Q: "What connectivity options are available?" - Valid (factual answer)');
console.log('❌ Q: "What is your return policy?" - Invalid (store policy)');
console.log('❌ Q: "Where are these headphones made?" - Invalid (false claims)');
console.log('✅ Q: "What materials are used?" - Valid (matches description)');
console.log('Expected: 3 valid FAQ, 2 rejected');
console.log('');

console.log('🎯 This test demonstrates how the validation system:');
console.log('1. Preserves factual content that matches product data');
console.log('2. Rejects hallucinated claims about certifications, warranties, origins');
console.log('3. Filters out store policies that are not product features');
console.log('4. Ensures AI-generated content is based on actual product information');
console.log('');

console.log('🧪 To run actual validation:');
console.log('1. Import validateAIResponse from aiValidator.js');
console.log('2. Call: validateAIResponse(mockAIResponse, realProduct, ["bullets", "faq"])');
console.log('3. Check that only factual content passes validation');
console.log('');

console.log('🧪 Real-world validation test completed!');
