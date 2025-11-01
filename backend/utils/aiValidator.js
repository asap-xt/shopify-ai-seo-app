// AI Validation System - Prevent hallucinations and ensure factual content

/**
 * Validate AI response against product data to prevent hallucinations
 * @param {Object} aiResponse - AI generated content
 * @param {Object} productData - Actual product data
 * @param {Array} allowedFields - Fields that AI is allowed to generate
 * @returns {Object} Validated and filtered response
 */
export function validateAIResponse(aiResponse, productData, allowedFields = []) {
  console.log('[AI-VALIDATOR] Validating AI response...');
  console.log('[AI-VALIDATOR] AI Response:', JSON.stringify(aiResponse, null, 2));
  console.log('[AI-VALIDATOR] Product Data:', JSON.stringify(productData, null, 2));
  
  const validated = {};
  
  // Validate bullets
  if (aiResponse.bullets && Array.isArray(aiResponse.bullets)) {
    validated.bullets = validateBullets(aiResponse.bullets, productData);
  }
  
  // Validate FAQ
  if (aiResponse.faq && Array.isArray(aiResponse.faq)) {
    validated.faq = validateFAQ(aiResponse.faq, productData);
  }
  
  // Validate attributes
  if (aiResponse.attributes) {
    validated.attributes = validateAttributes(aiResponse.attributes, productData, allowedFields);
  }
  
  console.log('[AI-VALIDATOR] Validated response:', JSON.stringify(validated, null, 2));
  return validated;
}

/**
 * Validate bullet points against product data
 */
function validateBullets(bullets, productData) {
  const suspiciousPatterns = [
    // Specific claims that might be hallucinations
    { pattern: /\d+\s*(year|month|day)s?\s*(warranty|guarantee|money back)/i, reason: 'Specific timeframes not in product data' },
    { pattern: /made in (italy|france|germany|japan|china|usa)/i, reason: 'Country of origin not specified' },
    { pattern: /(iso|ce|fda|organic|certified)/i, reason: 'Certifications not mentioned' },
    { pattern: /\d+%\s*(cotton|wool|silk|organic)/i, reason: 'Material percentages not specified' },
    { pattern: /(free shipping|free returns|money back guarantee)/i, reason: 'Store policies, not product features' }
  ];
  
  return bullets.filter(bullet => {
    // Check against suspicious patterns
    for (const { pattern, reason } of suspiciousPatterns) {
      if (pattern.test(bullet)) {
        console.log(`[AI-VALIDATOR] Rejected bullet: "${bullet}" - ${reason}`);
        return false;
      }
    }
    
    // Check if bullet is too generic (but allow short valid ones)
    if (bullet.length < 10 || bullet.length > 200) {
      console.log(`[AI-VALIDATOR] Rejected bullet (length): "${bullet}"`);
      return false;
    }
    
    return true;
  });
}

/**
 * Validate FAQ items against product data
 */
function validateFAQ(faq, productData) {
  const validFaqs = faq.filter(item => {
    // Ensure FAQ has both question and answer
    if (!item.q || !item.a) {
      console.log('[AI-VALIDATOR] Rejected FAQ (missing q/a):', item);
      return false;
    }
    
    // Check for specific claims in answers (only critical hallucinations)
    const suspiciousAnswers = [
      /\d+\s*(day|week|month|year)s?\s*(money\s*back|return|warranty|guarantee)/i,
      /made in (italy|france|germany|japan|china|usa)/i,
      /(iso|ce|fda|organic|certified)/i,
      /(money back guarantee|free shipping|free returns)/i
    ];
    
    for (const pattern of suspiciousAnswers) {
      if (pattern.test(item.a)) {
        console.log(`[AI-VALIDATOR] Rejected FAQ answer (hallucination): "${item.a}"`);
        return false;
      }
    }
    
    // Check length constraints
    if (item.q.length < 3 || item.q.length > 160 || item.a.length < 3 || item.a.length > 400) {
      console.log(`[AI-VALIDATOR] Rejected FAQ (length): q=${item.q.length}, a=${item.a.length}`);
      return false;
    }
    
    return true;
  });
  
  // FALLBACK: If all FAQs were rejected, create a generic one to meet schema requirements
  if (validFaqs.length === 0 && productData.title) {
    console.log('[AI-VALIDATOR] All FAQs rejected, adding fallback generic FAQ');
    validFaqs.push({
      q: `What is ${productData.title}?`,
      a: productData.description || productData.existingSeo?.metaDescription || 'A quality product designed to meet your needs.'
    });
  }
  
  return validFaqs;
}

/**
 * Validate product attributes against actual product data
 */
function validateAttributes(attributes, productData, allowedFields) {
  const validated = {};
  
  for (const [key, value] of Object.entries(attributes)) {
    if (!allowedFields.includes(key)) {
      console.log(`[AI-VALIDATOR] Rejected attribute (not allowed): ${key}`);
      continue;
    }
    
    // Validate specific attributes
    switch (key) {
      case 'material':
        if (validateMaterial(value, productData)) {
          validated[key] = value;
        }
        break;
      case 'color':
        if (validateColor(value, productData)) {
          validated[key] = value;
        }
        break;
      case 'size':
        if (validateSize(value, productData)) {
          validated[key] = value;
        }
        break;
      default:
        // For other attributes, basic validation
        if (value && typeof value === 'string' && value.length > 0) {
          validated[key] = value;
        }
    }
  }
  
  return validated;
}

/**
 * Validate material attribute against product data
 */
function validateMaterial(material, productData) {
  // Extract materials from product tags or description
  const productText = [
    productData.tags?.join(' ') || '',
    productData.description || '',
    productData.productType || ''
  ].join(' ').toLowerCase();
  
  // Check if material is mentioned in product data
  const materialKeywords = ['cotton', 'polyester', 'wool', 'silk', 'leather', 'plastic', 'metal', 'wood', 'glass'];
  const foundMaterial = materialKeywords.find(keyword => productText.includes(keyword));
  
  if (!foundMaterial) {
    console.log(`[AI-VALIDATOR] Rejected material (not in product data): ${material}`);
    return false;
  }
  
  return true;
}

/**
 * Validate color attribute against product data
 */
function validateColor(color, productData) {
  // Extract colors from product tags, variants, or description
  const productText = [
    productData.tags?.join(' ') || '',
    productData.description || '',
    productData.variants?.map(v => v.title).join(' ') || ''
  ].join(' ').toLowerCase();
  
  const colorKeywords = ['red', 'blue', 'green', 'black', 'white', 'yellow', 'pink', 'purple', 'orange', 'brown', 'gray', 'grey'];
  const foundColor = colorKeywords.find(keyword => productText.includes(keyword));
  
  if (!foundColor) {
    console.log(`[AI-VALIDATOR] Rejected color (not in product data): ${color}`);
    return false;
  }
  
  return true;
}

/**
 * Validate size attribute against product data
 */
function validateSize(size, productData) {
  // Extract sizes from product variants
  const variantTitles = productData.variants?.map(v => v.title).join(' ') || '';
  
  const sizeKeywords = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'small', 'medium', 'large', 'extra large'];
  const foundSize = sizeKeywords.find(keyword => variantTitles.toLowerCase().includes(keyword));
  
  if (!foundSize) {
    console.log(`[AI-VALIDATOR] Rejected size (not in product data): ${size}`);
    return false;
  }
  
  return true;
}

/**
 * Create factual prompt for AI to prevent hallucinations
 */
export function createFactualPrompt(productData, requestedFields) {
  return `Based on this EXACT product data, generate ONLY the requested fields: ${requestedFields.join(', ')}.

PRODUCT DATA:
${JSON.stringify(productData, null, 2)}

CRITICAL RULES:
- Use ONLY information present in the product data
- Do NOT add certifications, warranties, or guarantees not mentioned
- Do NOT specify countries of origin unless stated
- Do NOT add material percentages unless specified
- Do NOT add store policies (shipping, returns, etc.)
- Keep responses factual and based on provided data only

Return JSON with only the requested fields.`;
}
