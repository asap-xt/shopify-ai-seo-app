// Live validation test with real products from test store
import { validateAIResponse } from '../utils/aiValidator.js';
import { extractFactualAttributes } from '../utils/factualExtractor.js';

console.log('🧪 Live AI Validation Test with Real Products...\n');

// Test shop configuration
const TEST_SHOP = 'asapxt-teststore.myshopify.com';

// Real product data from our test store (we'll fetch this)
const realProducts = [
  {
    id: "gid://shopify/Product/14963354239308",
    title: "Test Product 1",
    description: "This is a test product for validation testing",
    tags: ["test", "validation", "ai"],
    productType: "Test",
    vendor: "TestBrand"
  }
  // Add more real products here
];

// Simulate AI responses that might be generated for real products
const simulateAIEnhancement = (productData) => {
  console.log(`🤖 Simulating AI enhancement for: ${productData.title}`);
  
  // Create realistic AI response that might contain hallucinations
  const aiResponse = {
    bullets: [
      `High-quality ${productData.productType?.toLowerCase() || 'product'} for everyday use`, // ✅ Should pass
      "Easy to use and maintain", // ✅ Should pass  
      "Perfect for professionals and enthusiasts", // ✅ Should pass
      "Made with premium materials", // ✅ Should pass
      "ISO 9001 certified quality", // ❌ Should be rejected - no certification in product data
      "30-day money back guarantee", // ❌ Should be rejected - warranty not specified
      "Made in Italy with precision", // ❌ Should be rejected - origin not specified
      "Free shipping worldwide" // ❌ Should be rejected - store policy
    ],
    faq: [
      {
        q: `What is this ${productData.productType?.toLowerCase() || 'product'} made for?`,
        a: `This ${productData.productType?.toLowerCase() || 'product'} is perfect for everyday use and professional applications.` // ✅ Should pass
      },
      {
        q: "How do I use this product?",
        a: "This product is easy to use and maintain for optimal performance." // ✅ Should pass
      },
      {
        q: "What is your return policy?",
        a: "We offer 30-day money back guarantee on all products." // ❌ Should be rejected
      },
      {
        q: "Where is this product made?",
        a: "Made in Italy with ISO certified precision engineering." // ❌ Should be rejected
      }
    ]
  };
  
  return aiResponse;
};

// Test validation with real product data
const testRealProductValidation = async (productData) => {
  console.log(`\n📦 Testing validation for: ${productData.title}`);
  console.log('Product data:', JSON.stringify(productData, null, 2));
  
  // Simulate AI enhancement
  const aiResponse = simulateAIEnhancement(productData);
  console.log('\n🤖 AI Response:', JSON.stringify(aiResponse, null, 2));
  
  // Validate AI response
  console.log('\n🔍 Running validation...');
  const validated = validateAIResponse(aiResponse, productData, ['bullets', 'faq']);
  
  console.log('\n✅ Validation Results:');
  console.log(`Bullets: ${aiResponse.bullets.length} → ${validated.bullets?.length || 0} (${aiResponse.bullets.length - (validated.bullets?.length || 0)} rejected)`);
  console.log(`FAQ: ${aiResponse.faq.length} → ${validated.faq?.length || 0} (${aiResponse.faq.length - (validated.faq?.length || 0)} rejected)`);
  
  console.log('\n📋 Validated Bullets:');
  (validated.bullets || []).forEach((bullet, i) => {
    console.log(`  ${i + 1}. ${bullet}`);
  });
  
  console.log('\n📋 Validated FAQ:');
  (validated.faq || []).forEach((faq, i) => {
    console.log(`  ${i + 1}. Q: ${faq.q}`);
    console.log(`     A: ${faq.a}`);
  });
  
  return validated;
};

// Test factual extraction with real product data
const testFactualExtraction = async (productData) => {
  console.log(`\n🔍 Testing factual extraction for: ${productData.title}`);
  
  const extracted = extractFactualAttributes(productData, ['material', 'color', 'size', 'category', 'audience']);
  
  console.log('📋 Extracted Attributes:');
  Object.entries(extracted).forEach(([key, value]) => {
    console.log(`  ${key}: ${value || 'Not found'}`);
  });
  
  return extracted;
};

// Main test function
const runLiveValidationTest = async () => {
  console.log('🚀 Starting live validation test...\n');
  
  try {
    // Test with real products
    for (const product of realProducts) {
      await testRealProductValidation(product);
      await testFactualExtraction(product);
      console.log('\n' + '='.repeat(80) + '\n');
    }
    
    console.log('✅ Live validation test completed successfully!');
    
  } catch (error) {
    console.error('❌ Live validation test failed:', error);
  }
};

// Instructions for running with real data
console.log('📋 Instructions for Live Testing:');
console.log('');
console.log('1. Update realProducts array with actual product data from your test store');
console.log('2. Run: node backend/test/liveValidationTest.js');
console.log('3. Check console output for validation results');
console.log('4. Verify that hallucinations are rejected and factual content is preserved');
console.log('');
console.log('💡 To get real product data:');
console.log('- Use Shopify Admin API or GraphQL');
console.log('- Copy product data from your test store');
console.log('- Update the realProducts array');
console.log('');

// Export for use in other tests
export { runLiveValidationTest, testRealProductValidation, testFactualExtraction };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runLiveValidationTest();
}
