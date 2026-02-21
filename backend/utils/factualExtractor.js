// Factual Data Extractor — Hybrid approach:
// 1. Shopify product options & variants (Color, Size — always reliable)
// 2. Shopify category metafields (structured data from taxonomy)
// 3. Text extraction from description/tags (multilingual fallback)

/**
 * Extract factual attributes from product data
 * @param {Object} productData - Product data from Shopify (with options, variants, metafields, descriptionHtml)
 * @param {Array} requestedAttributes - Attributes to extract
 * @returns {Object} Extracted factual attributes
 */
export function extractFactualAttributes(productData, requestedAttributes = []) {
  const extracted = {};
  const textCorpus = buildTextCorpus(productData);
  const optionsMap = buildOptionsMap(productData);
  const metafieldsMap = productData._allMetafields || {};

  for (const attribute of requestedAttributes) {
    switch (attribute) {
      case 'material':
        extracted.material = extractMaterial(metafieldsMap, textCorpus, productData);
        break;
      case 'color':
        extracted.color = extractColor(optionsMap, metafieldsMap, textCorpus);
        break;
      case 'size':
        extracted.size = extractSize(optionsMap, productData);
        break;
      case 'weight':
        extracted.weight = extractWeight(productData, textCorpus);
        break;
      case 'dimensions':
        extracted.dimensions = extractDimensions(textCorpus);
        break;
      case 'category':
        extracted.category = extractCategory(productData);
        break;
      case 'audience':
        extracted.audience = extractAudience(metafieldsMap, textCorpus, productData);
        break;
    }
  }

  return extracted;
}

function buildTextCorpus(productData) {
  const parts = [
    productData.descriptionHtml || '',
    productData.title || '',
    productData.productType || '',
    ...(productData.tags || [])
  ];
  const raw = parts.join(' ');
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function buildOptionsMap(productData) {
  const map = {};
  if (productData.options) {
    for (const opt of productData.options) {
      const name = (opt.name || '').toLowerCase();
      map[name] = opt.values || [];
    }
  }
  return map;
}

function findMetafield(metafieldsMap, keywords) {
  for (const [fullKey, meta] of Object.entries(metafieldsMap)) {
    const key = fullKey.toLowerCase();
    for (const kw of keywords) {
      if (key.includes(kw)) {
        try {
          const parsed = JSON.parse(meta.value);
          if (Array.isArray(parsed)) {
            const simple = parsed.filter(v => typeof v === 'string' && !v.startsWith('gid://'));
            if (simple.length) return simple.join(', ');
          }
          if (typeof parsed === 'string') return parsed;
        } catch {
          if (meta.value && !meta.value.startsWith('gid://') && !meta.value.startsWith('[')) {
            return meta.value;
          }
        }
      }
    }
  }
  return null;
}

// ==================== MATERIAL / FABRIC ====================

const MATERIAL_KEYWORDS = {
  'cotton': ['cotton', 'памук', 'bumbac'],
  'polyester': ['polyester', 'полиестер', 'poliester'],
  'wool': ['wool', 'merino', 'cashmere', 'вълна', 'мерино', 'кашмир', 'lână'],
  'silk': ['silk', 'коприна', 'mătase'],
  'leather': ['leather', 'кожа', 'piele'],
  'denim': ['denim', 'деним', 'jeans', 'дънки'],
  'linen': ['linen', 'лен', 'in'],
  'nylon': ['nylon', 'найлон'],
  'spandex': ['spandex', 'еластан', 'elastane', 'lycra', 'лайкра'],
  'viscose': ['viscose', 'вискоза', 'viscoză'],
  'modal': ['modal', 'модал'],
  'velvet': ['velvet', 'кадифе', 'catifea'],
  'satin': ['satin', 'сатен'],
  'chiffon': ['chiffon', 'шифон'],
  'lace': ['lace', 'дантела', 'dantelă'],
  'tulle': ['tulle', 'тюл'],
  'gabardine': ['gabardine', 'габардин', 'gabardină'],
};

function extractMaterial(metafieldsMap, textCorpus, productData) {
  // 1. Metafields
  const fromMeta = findMetafield(metafieldsMap, ['fabric', 'material', 'composition', 'състав', 'материал']);
  if (fromMeta) return fromMeta;

  // 2. Tags with fabric prefix
  const fabricTag = (productData.tags || []).find(t =>
    /^(fabric|material|състав)/i.test(t)
  );
  if (fabricTag) return fabricTag.replace(/^(fabric|material|състав)[:\-_]\s*/i, '');

  // 3. Text extraction (multilingual)
  const found = [];
  for (const [material, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
    for (const kw of keywords) {
      if (textCorpus.includes(kw)) {
        found.push(material.charAt(0).toUpperCase() + material.slice(1));
        break;
      }
    }
  }
  return found.length ? found.join(', ') : null;
}

// ==================== COLOR ====================

const COLOR_KEYWORDS = {
  'Red': ['red', 'червен', 'червено', 'roșu', 'rosu'],
  'Blue': ['blue', 'син', 'синьо', 'синя', 'albastru'],
  'Green': ['green', 'зелен', 'зелено', 'verde'],
  'Black': ['black', 'черен', 'черно', 'negru'],
  'White': ['white', 'бял', 'бяло', 'alb'],
  'Yellow': ['yellow', 'жълт', 'жълто', 'galben'],
  'Pink': ['pink', 'розов', 'розово', 'roz'],
  'Purple': ['purple', 'лилав', 'лилаво', 'mov'],
  'Orange': ['orange', 'оранжев', 'оранжево', 'portocaliu'],
  'Brown': ['brown', 'кафяв', 'кафяво', 'maro'],
  'Gray': ['gray', 'grey', 'сив', 'сиво', 'gri'],
  'Navy': ['navy', 'тъмносин', 'bleumarin'],
  'Beige': ['beige', 'бежов', 'бежово', 'bej'],
  'Cream': ['cream', 'кремав', 'кремово', 'crem'],
  'Gold': ['gold', 'златист', 'златно', 'auriu'],
  'Silver': ['silver', 'сребрист', 'сребърно', 'argintiu'],
  'Bordeaux': ['bordeaux', 'бордо', 'bordo'],
  'Khaki': ['khaki', 'каки'],
  'Coral': ['coral', 'корал'],
  'Turquoise': ['turquoise', 'тюркоаз', 'turcoaz'],
};

function extractColor(optionsMap, metafieldsMap, textCorpus) {
  // 1. Product options (most reliable for color)
  const colorOption = optionsMap['color'] || optionsMap['colour'] || optionsMap['цвят'];
  if (colorOption?.length) return colorOption.join(', ');

  // 2. Metafields
  const fromMeta = findMetafield(metafieldsMap, ['color', 'colour', 'цвят']);
  if (fromMeta) return fromMeta;

  // 3. Text extraction
  for (const [color, keywords] of Object.entries(COLOR_KEYWORDS)) {
    for (const kw of keywords) {
      if (textCorpus.includes(kw)) return color;
    }
  }
  return null;
}

// ==================== SIZE ====================

function extractSize(optionsMap, productData) {
  // 1. Product options
  const sizeOption = optionsMap['size'] || optionsMap['размер'] || optionsMap['mărime'];
  if (sizeOption?.length) return sizeOption.join(', ');

  // 2. Variants selectedOptions
  const sizes = new Set();
  const variants = productData.variants?.edges || [];
  for (const edge of variants) {
    const opts = edge.node.selectedOptions || [];
    for (const opt of opts) {
      const name = (opt.name || '').toLowerCase();
      if (name === 'size' || name === 'размер' || name === 'mărime') {
        sizes.add(opt.value);
      }
    }
  }
  if (sizes.size) return [...sizes].join(', ');

  // 3. "ONE SIZE" / "ONE SIZE FITS ALL" detection
  const allTitles = variants.map(e => (e.node.title || '').toLowerCase());
  if (allTitles.some(t => t.includes('one size') || t.includes('един размер') || t === 'os')) {
    return 'One Size';
  }

  return null;
}

// ==================== WEIGHT ====================

function extractWeight(productData, textCorpus) {
  // 1. Variant weight from Shopify
  const firstVariant = productData.variants?.edges?.[0]?.node;
  if (firstVariant?.weight && parseFloat(firstVariant.weight) > 0) {
    const unit = (firstVariant.weightUnit || 'kg').toLowerCase();
    return `${firstVariant.weight} ${unit}`;
  }

  // 2. Text extraction
  const weightRegex = /(\d+(?:[.,]\d+)?)\s*(kg|g|lb|lbs|oz|гр|кг)/i;
  const match = textCorpus.match(weightRegex);
  if (match) return `${match[1]} ${match[2].toLowerCase()}`;

  return null;
}

// ==================== DIMENSIONS ====================

function extractDimensions(textCorpus) {
  const dimRegex = /(\d+(?:[.,]\d+)?)\s*[x×х]\s*(\d+(?:[.,]\d+)?)\s*(?:[x×х]\s*(\d+(?:[.,]\d+)?))?\s*(cm|мм|mm|in|inch|см)/i;
  const match = textCorpus.match(dimRegex);
  if (match) {
    const unit = match[4].toLowerCase();
    if (match[3]) return `${match[1]} x ${match[2]} x ${match[3]} ${unit}`;
    return `${match[1]} x ${match[2]} ${unit}`;
  }
  return null;
}

// ==================== CATEGORY ====================

function extractCategory(productData) {
  // 1. Shopify taxonomy category
  if (productData.category?.name) return productData.category.name;
  if (productData.category?.fullName) return productData.category.fullName;

  // 2. productType
  if (productData.productType) return productData.productType;

  // 3. First collection
  if (productData.collections?.edges?.[0]?.node?.title) {
    return productData.collections.edges[0].node.title;
  }

  return null;
}

// ==================== AUDIENCE ====================

const AUDIENCE_KEYWORDS = {
  'Women': ['women', 'female', 'ladies', 'жени', 'дами', 'момичета', 'femei', 'doamne'],
  'Men': ['men', 'male', 'gents', 'мъже', 'bărbați', 'barbati'],
  'Kids': ['kids', 'children', 'baby', 'toddler', 'деца', 'бебе', 'copii'],
  'Unisex': ['unisex'],
  'Adults': ['adults', 'adult', 'възрастни', 'adulți'],
};

function extractAudience(metafieldsMap, textCorpus, productData) {
  // 1. Metafields
  const fromMeta = findMetafield(metafieldsMap, ['audience', 'gender', 'target', 'аудитория', 'пол']);
  if (fromMeta) return fromMeta;

  // 2. Tags
  const audienceTags = (productData.tags || []).map(t => t.toLowerCase());
  for (const [audience, keywords] of Object.entries(AUDIENCE_KEYWORDS)) {
    for (const kw of keywords) {
      if (audienceTags.includes(kw)) return audience;
    }
  }

  // 3. Text extraction
  for (const [audience, keywords] of Object.entries(AUDIENCE_KEYWORDS)) {
    for (const kw of keywords) {
      if (textCorpus.includes(kw)) return audience;
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
    description: productData.descriptionHtml
      ? productData.descriptionHtml.replace(/<[^>]+>/g, ' ').substring(0, 500)
      : '',
    variants: productData.variants?.edges?.map(e => ({
      title: e.node.title,
      price: e.node.price
    })) || [],
    images: productData.images?.edges?.length || 0
  };
}
