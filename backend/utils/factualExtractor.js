// Factual Data Extractor - Extract real product attributes from product data

/**
 * Extract factual attributes from product data
 * @param {Object} productData - Product data from Shopify
 * @param {Array} requestedAttributes - Attributes to extract
 * @returns {Object} Extracted factual attributes
 */
export function extractFactualAttributes(productData, requestedAttributes = []) {
  // console.log('[FACTUAL-EXTRACTOR] Extracting attributes:', requestedAttributes);
  // console.log('[FACTUAL-EXTRACTOR] Product data:', JSON.stringify(productData, null, 2));
  
  const extracted = {};
  
  for (const attribute of requestedAttributes) {
    switch (attribute) {
      case 'material':
        extracted.material = extractMaterial(productData);
        break;
      case 'color':
        extracted.color = extractColor(productData);
        break;
      case 'size':
        extracted.size = extractSize(productData);
        break;
      case 'weight':
        extracted.weight = extractWeight(productData);
        break;
      case 'dimensions':
        extracted.dimensions = extractDimensions(productData);
        break;
      case 'category':
        extracted.category = extractCategory(productData);
        break;
      case 'audience':
        extracted.audience = extractAudience(productData);
        break;
    }
  }
  
  // console.log('[FACTUAL-EXTRACTOR] Extracted attributes:', JSON.stringify(extracted, null, 2));
  return extracted;
}

/**
 * Extract material information from product data
 */
function extractMaterial(productData) {
  const sources = [
    productData.tags || [],
    productData.description || '',
    productData.productType || '',
    productData.variants?.edges?.map(e => e.node.title).join(' ') || productData.variants?.map(v => v.title).join(' ') || ''
  ];
  
  const materialKeywords = {
    'cotton': ['cotton', '100% cotton', 'organic cotton'],
    'polyester': ['polyester', 'poly', 'poly blend'],
    'wool': ['wool', 'merino', 'cashmere'],
    'silk': ['silk', 'silk blend'],
    'leather': ['leather', 'genuine leather', 'faux leather'],
    'denim': ['denim', 'jeans'],
    'linen': ['linen'],
    'nylon': ['nylon'],
    'spandex': ['spandex', 'stretch'],
    'bamboo': ['bamboo'],
    'modal': ['modal']
  };
  
  const text = sources.join(' ').toLowerCase();
  
  for (const [material, keywords] of Object.entries(materialKeywords)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return material;
      }
    }
  }
  
  return null;
}

/**
 * Extract color information from product data
 */
function extractColor(productData) {
  const sources = [
    productData.tags || [],
    productData.variants?.edges?.map(e => e.node.title).join(' ') || productData.variants?.map(v => v.title).join(' ') || '',
    productData.description || ''
  ];
  
  const colorKeywords = [
    'red', 'blue', 'green', 'black', 'white', 'yellow', 'pink', 'purple', 
    'orange', 'brown', 'gray', 'grey', 'navy', 'maroon', 'beige', 'cream',
    'gold', 'silver', 'copper', 'bronze', 'rose gold'
  ];
  
  const text = sources.join(' ').toLowerCase();
  
  for (const color of colorKeywords) {
    if (text.includes(color)) {
      return color;
    }
  }
  
  return null;
}

/**
 * Extract size information from product data
 */
function extractSize(productData) {
  const variantTitles = productData.variants?.edges?.map(e => e.node.title) || productData.variants?.map(v => v.title) || [];
  
  const sizeKeywords = [
    'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl',
    'small', 'medium', 'large', 'extra large',
    'one size', 'free size', 'os',
    '0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20'
  ];
  
  for (const variant of variantTitles) {
    const title = variant.toLowerCase();
    for (const size of sizeKeywords) {
      if (title.includes(size)) {
        return size.toUpperCase();
      }
    }
  }
  
  return null;
}

/**
 * Extract weight information from product data
 */
function extractWeight(productData) {
  const sources = [
    productData.description || '',
    productData.tags || []
  ];
  
  const text = sources.join(' ').toLowerCase();
  const weightRegex = /(\d+(?:\.\d+)?)\s*(kg|g|lb|lbs|pound|pounds|ounce|ounces|oz)/i;
  const match = text.match(weightRegex);
  
  if (match) {
    return `${match[1]} ${match[2].toLowerCase()}`;
  }
  
  return null;
}

/**
 * Extract dimensions information from product data
 */
function extractDimensions(productData) {
  const sources = [
    productData.description || '',
    productData.tags || []
  ];
  
  const text = sources.join(' ').toLowerCase();
  const dimensionRegex = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]?\s*(\d+(?:\.\d+)?)?\s*(cm|mm|in|inch|inches)/i;
  const match = text.match(dimensionRegex);
  
  if (match) {
    const unit = match[4].toLowerCase();
    if (match[3]) {
      return `${match[1]} x ${match[2]} x ${match[3]} ${unit}`;
    } else {
      return `${match[1]} x ${match[2]} ${unit}`;
    }
  }
  
  return null;
}

/**
 * Extract category information from product data
 */
function extractCategory(productData) {
  // Use productType as primary category
  if (productData.productType) {
    return productData.productType;
  }
  
  // Fallback to first collection if available
  if (productData.collections?.edges?.[0]?.node?.title) {
    return productData.collections.edges[0].node.title;
  }
  
  return null;
}

/**
 * Extract audience information from product data
 */
function extractAudience(productData) {
  const sources = [
    productData.tags || [],
    productData.description || '',
    productData.productType || ''
  ];
  
  const text = sources.join(' ').toLowerCase();
  
  const audienceKeywords = {
    'men': ['men', 'male', 'gents', 'boys'],
    'women': ['women', 'female', 'ladies', 'girls'],
    'kids': ['kids', 'children', 'baby', 'toddler', 'infant'],
    'unisex': ['unisex', 'unified', 'both'],
    'adults': ['adults', 'adult'],
    'teenagers': ['teen', 'teenager', 'youth']
  };
  
  for (const [audience, keywords] of Object.entries(audienceKeywords)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return audience;
      }
    }
  }
  
  return null;
}

/**
 * Get product summary for AI context
 */
export function getProductSummary(productData) {
  return {
    title: productData.title,
    productType: productData.productType,
    vendor: productData.vendor,
    tags: productData.tags || [],
    description: productData.description ? productData.description.substring(0, 500) : '',
    variants: productData.variants?.edges?.map(e => ({
      title: e.node.title,
      price: e.node.price
    })) || [],
    images: productData.images?.edges?.length || 0
  };
}
