// Test endpoint for live validation testing
import express from 'express';
import { validateAIResponse } from '../utils/aiValidator.js';
import { extractFactualAttributes } from '../utils/factualExtractor.js';

const router = express.Router();

// Test endpoint for validation
router.post('/test-validation', async (req, res) => {
  try {
    const { productData, aiResponse, requestedAttributes } = req.body;
    
    console.log('🧪 [TEST-VALIDATION] Received test request');
    console.log('Product:', productData?.title || 'Unknown');
    console.log('AI Response fields:', Object.keys(aiResponse || {}));
    console.log('Requested attributes:', requestedAttributes || []);
    
    // Validate AI response
    const validated = validateAIResponse(
      aiResponse, 
      productData, 
      requestedAttributes || ['bullets', 'faq']
    );
    
    // Extract factual attributes if requested
    let extractedAttributes = {};
    if (requestedAttributes && requestedAttributes.includes('attributes')) {
      extractedAttributes = extractFactualAttributes(
        productData, 
        ['material', 'color', 'size', 'category', 'audience']
      );
    }
    
    const result = {
      success: true,
      original: {
        bullets: aiResponse?.bullets?.length || 0,
        faq: aiResponse?.faq?.length || 0
      },
      validated: {
        bullets: validated?.bullets?.length || 0,
        faq: validated?.faq?.length || 0
      },
      rejected: {
        bullets: (aiResponse?.bullets?.length || 0) - (validated?.bullets?.length || 0),
        faq: (aiResponse?.faq?.length || 0) - (validated?.faq?.length || 0)
      },
      validatedContent: validated,
      extractedAttributes: Object.keys(extractedAttributes).length > 0 ? extractedAttributes : null
    };
    
    console.log('✅ [TEST-VALIDATION] Validation completed');
    console.log(`Bullets: ${result.original.bullets} → ${result.validated.bullets} (${result.rejected.bullets} rejected)`);
    console.log(`FAQ: ${result.original.faq} → ${result.validated.faq} (${result.rejected.faq} rejected)`);
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ [TEST-VALIDATION] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint for factual extraction
router.post('/test-extraction', async (req, res) => {
  try {
    const { productData, requestedAttributes } = req.body;
    
    console.log('🔍 [TEST-EXTRACTION] Extracting attributes for:', productData?.title);
    
    const extracted = extractFactualAttributes(
      productData, 
      requestedAttributes || ['material', 'color', 'size', 'category', 'audience']
    );
    
    const result = {
      success: true,
      productTitle: productData?.title,
      extractedAttributes: extracted,
      foundCount: Object.values(extracted).filter(v => v !== null).length,
      totalRequested: requestedAttributes?.length || 5
    };
    
    console.log('✅ [TEST-EXTRACTION] Extraction completed');
    console.log(`Found ${result.foundCount}/${result.totalRequested} attributes`);
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ [TEST-EXTRACTION] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
