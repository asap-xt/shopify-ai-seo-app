import { describe, it, expect } from 'vitest';
import { resolveProductDomain } from '../aiProductDomain.js';
import { extractSharedTaxonomy } from '../aiTaxonomyMapper.js';
import { extractDomainAttributes } from '../aiAttributeMapper.js';
import { compactObject } from '../compactObject.js';

// ===== FIXTURES =====

const DRESS_PRODUCT = {
  title: 'Елегантна макси рокля с флорален принт',
  productType: 'Рокли',
  tags: ['дамски', 'лято', 'елегантна', 'рокля', 'макси'],
  categoryFullName: 'Apparel & Accessories > Clothing > Dresses',
  categoryName: 'Dresses',
  descriptionHtml: '<p>Красива макси рокля от вискоза с V-образно деколте и дълъг ръкав. Перфектна за парти.</p>',
  vendor: 'Plamenna',
  taxonomyMetafields: { target_gender: 'Female', fabric: 'Viscose' },
  variantOptions: { 'Цвят': ['Червен', 'Син'], 'Размер': ['S', 'M', 'L'] },
};

const PANTS_PRODUCT = {
  title: 'High Waist Slim Fit Jeans',
  productType: 'Pants',
  tags: ['women', 'casual', 'denim', 'jeans'],
  categoryFullName: 'Apparel & Accessories > Clothing > Pants',
  categoryName: 'Pants',
  descriptionHtml: '<p>Classic high-rise slim fit jeans with zipper closure. Cropped ankle length.</p>',
  vendor: 'Brand X',
  taxonomyMetafields: { material: 'Denim' },
  variantOptions: { Color: ['Blue', 'Black'], Size: ['28', '30', '32'] },
};

const FOOTWEAR_PRODUCT = {
  title: 'Leather Ankle Boots with Buckle',
  productType: 'Boots',
  tags: ['women', 'autumn', 'winter', 'leather'],
  categoryFullName: 'Apparel & Accessories > Shoes > Boots',
  categoryName: 'Boots',
  descriptionHtml: '<p>Premium leather ankle boots with pointed toe, mid heel, and buckle closure.</p>',
  vendor: 'ShoeHouse',
  taxonomyMetafields: { material: 'Leather' },
  variantOptions: { Size: ['36', '37', '38', '39', '40'] },
};

const BAG_PRODUCT = {
  title: 'Crossbody Leather Bag with Chain Strap',
  productType: 'Bags',
  tags: ['accessory', 'women', 'evening', 'leather'],
  categoryFullName: 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags',
  categoryName: 'Handbags',
  descriptionHtml: '<p>Elegant crossbody bag with adjustable chain strap and magnetic snap closure.</p>',
  vendor: 'LuxBags',
  taxonomyMetafields: {},
  variantOptions: { Color: ['Black', 'Beige'] },
};

const SKINCARE_PRODUCT = {
  title: 'Hydrating Face Serum with Vitamin C',
  productType: 'Skincare',
  tags: ['skincare', 'face', 'serum', 'anti-aging', 'hydrating'],
  categoryFullName: 'Health & Beauty > Skincare > Face Moisturizer',
  categoryName: 'Face Moisturizer',
  descriptionHtml: '<p>Lightweight 30ml face serum for brightening and anti-aging. Gel texture, suitable for sensitive skin.</p>',
  vendor: 'GlowCo',
  taxonomyMetafields: {},
  variantOptions: {},
};

const FRAGRANCE_PRODUCT = {
  title: 'Floral Eau de Parfum 50ml',
  productType: 'Fragrance',
  tags: ['perfume', 'women', 'floral', 'woody'],
  categoryFullName: 'Health & Beauty > Fragrance',
  categoryName: 'Fragrance',
  descriptionHtml: '<p>A captivating 50ml eau de parfum with floral and woody notes. Rose, sandalwood, and amber.</p>',
  vendor: 'ScentHouse',
  taxonomyMetafields: {},
  variantOptions: {},
};

const AMBIGUOUS_PRODUCT = {
  title: 'Gift Card',
  productType: '',
  tags: ['gift'],
  categoryFullName: null,
  categoryName: null,
  descriptionHtml: '<p>Digital gift card.</p>',
  vendor: 'Store',
  taxonomyMetafields: {},
  variantOptions: {},
};

// ===== PRODUCT DOMAIN TESTS =====

describe('resolveProductDomain', () => {
  it('classifies dress from category path', () => {
    expect(resolveProductDomain(DRESS_PRODUCT)).toBe('fashion_dress');
  });

  it('classifies pants from category path', () => {
    expect(resolveProductDomain(PANTS_PRODUCT)).toBe('fashion_pants');
  });

  it('classifies footwear from category path', () => {
    expect(resolveProductDomain(FOOTWEAR_PRODUCT)).toBe('footwear');
  });

  it('classifies bag from category path', () => {
    expect(resolveProductDomain(BAG_PRODUCT)).toBe('accessory_bag');
  });

  it('classifies skincare from category path', () => {
    expect(resolveProductDomain(SKINCARE_PRODUCT)).toBe('beauty_skincare');
  });

  it('classifies fragrance from category path', () => {
    expect(resolveProductDomain(FRAGRANCE_PRODUCT)).toBe('beauty_fragrance');
  });

  it('returns null for ambiguous product', () => {
    expect(resolveProductDomain(AMBIGUOUS_PRODUCT)).toBeNull();
  });

  it('falls back to productType when no category', () => {
    expect(resolveProductDomain({
      title: 'Something nice',
      productType: 'Dress',
      tags: [],
      categoryFullName: null,
      descriptionHtml: '',
    })).toBe('fashion_dress');
  });

  it('falls back to tags when no category or productType', () => {
    expect(resolveProductDomain({
      title: 'Something nice',
      productType: '',
      tags: ['рокля', 'лятна'],
      categoryFullName: null,
      descriptionHtml: '',
    })).toBe('fashion_dress');
  });

  it('classifies Bulgarian product type', () => {
    expect(resolveProductDomain({
      title: 'Кожена чанта',
      productType: 'Чанти',
      tags: [],
      categoryFullName: null,
      descriptionHtml: '',
    })).toBe('accessory_bag');
  });
});

// ===== SHARED TAXONOMY TESTS =====

describe('extractSharedTaxonomy', () => {
  it('extracts gender from metafield', () => {
    const result = extractSharedTaxonomy(DRESS_PRODUCT);
    expect(result.gender).toBe('women');
  });

  it('extracts gender from tags', () => {
    const result = extractSharedTaxonomy(PANTS_PRODUCT);
    expect(result.gender).toBe('women');
  });

  it('extracts season from tags', () => {
    const result = extractSharedTaxonomy(DRESS_PRODUCT);
    expect(result.season).toContain('summer');
  });

  it('extracts multiple seasons', () => {
    const result = extractSharedTaxonomy(FOOTWEAR_PRODUCT);
    expect(result.season).toContain('autumn');
    expect(result.season).toContain('winter');
  });

  it('extracts materialFamily from metafield', () => {
    const result = extractSharedTaxonomy(DRESS_PRODUCT);
    expect(result.materialFamily).toContain('viscose');
  });

  it('extracts materialFamily denim', () => {
    const result = extractSharedTaxonomy(PANTS_PRODUCT);
    expect(result.materialFamily).toContain('denim');
  });

  it('extracts colorFamily from variant options', () => {
    const result = extractSharedTaxonomy(PANTS_PRODUCT);
    expect(result.colorFamily).toEqual(expect.arrayContaining(['blue', 'black']));
  });

  it('extracts pattern from text', () => {
    const result = extractSharedTaxonomy(DRESS_PRODUCT);
    expect(result.pattern).toContain('floral');
  });

  it('extracts occasion from text', () => {
    const result = extractSharedTaxonomy(DRESS_PRODUCT);
    expect(result.occasion).toContain('party');
  });

  it('extracts style from tags', () => {
    const result = extractSharedTaxonomy(DRESS_PRODUCT);
    expect(result.style).toContain('elegant');
  });

  it('returns undefined for absent fields', () => {
    const result = extractSharedTaxonomy(SKINCARE_PRODUCT);
    expect(result.season).toBeUndefined();
    expect(result.pattern).toBeUndefined();
  });

  it('returns occasion casual from tags', () => {
    const result = extractSharedTaxonomy(PANTS_PRODUCT);
    expect(result.occasion).toContain('casual');
  });
});

// ===== DOMAIN ATTRIBUTES TESTS =====

describe('extractDomainAttributes', () => {
  it('extracts dress attributes', () => {
    const attrs = compactObject(extractDomainAttributes('fashion_dress', DRESS_PRODUCT));
    expect(attrs.dressLength).toBe('maxi');
    expect(attrs.neckline).toBe('v_neck');
    expect(attrs.sleeveLength).toBe('long_sleeve');
    expect(attrs).not.toHaveProperty('shoeStyle');
    expect(attrs).not.toHaveProperty('bagType');
  });

  it('extracts pants attributes', () => {
    const attrs = compactObject(extractDomainAttributes('fashion_pants', PANTS_PRODUCT));
    expect(attrs.fit).toBe('slim');
    expect(attrs.rise).toBe('high');
    expect(attrs.length).toBe('cropped');
  });

  it('extracts footwear attributes', () => {
    const attrs = compactObject(extractDomainAttributes('footwear', FOOTWEAR_PRODUCT));
    expect(attrs.shoeStyle).toBe('boot');
    expect(attrs.toeStyle).toBe('pointed');
    expect(attrs.heelHeight).toBe('mid');
    expect(attrs.closure).toBe('buckle');
  });

  it('extracts bag attributes', () => {
    const attrs = compactObject(extractDomainAttributes('accessory_bag', BAG_PRODUCT));
    expect(attrs.bagType).toBe('crossbody');
    expect(attrs.closure).toBe('snap');
    expect(attrs.strapType).toBe('chain');
  });

  it('extracts skincare attributes', () => {
    const attrs = compactObject(extractDomainAttributes('beauty_skincare', SKINCARE_PRODUCT));
    expect(attrs.targetArea).toBe('face');
    expect(attrs.skinConcern).toEqual(expect.arrayContaining(['anti_aging', 'hydration']));
    expect(attrs.texture).toBe('gel');
  });

  it('extracts fragrance attributes', () => {
    const attrs = compactObject(extractDomainAttributes('beauty_fragrance', FRAGRANCE_PRODUCT));
    expect(attrs.scentFamily).toEqual(expect.arrayContaining(['floral', 'woody']));
    expect(attrs.volumeMl).toBe(50);
  });

  it('returns empty for null domain', () => {
    const attrs = extractDomainAttributes(null, DRESS_PRODUCT);
    expect(Object.keys(attrs)).toHaveLength(0);
  });

  it('returns empty for unknown domain', () => {
    const attrs = extractDomainAttributes('unknown_domain', DRESS_PRODUCT);
    expect(Object.keys(attrs)).toHaveLength(0);
  });

  it('does not include irrelevant attributes', () => {
    const attrs = compactObject(extractDomainAttributes('fashion_dress', DRESS_PRODUCT));
    expect(attrs).not.toHaveProperty('shoeStyle');
    expect(attrs).not.toHaveProperty('bagType');
    expect(attrs).not.toHaveProperty('skinConcern');
    expect(attrs).not.toHaveProperty('scentFamily');
  });
});

// ===== COMPACT OBJECT TESTS =====

describe('compactObject', () => {
  it('removes null and undefined', () => {
    expect(compactObject({ a: 1, b: null, c: undefined })).toEqual({ a: 1 });
  });

  it('removes empty arrays', () => {
    expect(compactObject({ a: [1], b: [] })).toEqual({ a: [1] });
  });

  it('removes empty strings', () => {
    expect(compactObject({ a: 'ok', b: '' })).toEqual({ a: 'ok' });
  });

  it('removes empty nested objects', () => {
    expect(compactObject({ a: { b: null }, c: 1 })).toEqual({ c: 1 });
  });

  it('keeps non-empty nested objects', () => {
    expect(compactObject({ a: { b: 'value' }, c: 1 })).toEqual({ a: { b: 'value' }, c: 1 });
  });

  it('handles already clean objects', () => {
    const input = { x: 'hello', y: [1, 2] };
    expect(compactObject(input)).toEqual(input);
  });

  it('preserves numbers including zero', () => {
    expect(compactObject({ a: 0, b: 1, c: null })).toEqual({ a: 0, b: 1 });
  });

  it('preserves booleans', () => {
    expect(compactObject({ a: false, b: true, c: null })).toEqual({ a: false, b: true });
  });
});

// ===== INTEGRATION: FULL PIPELINE =====

describe('full pipeline integration', () => {
  function processProduct(product) {
    const domain = resolveProductDomain(product);
    const taxonomy = compactObject(extractSharedTaxonomy(product));
    const attributes = compactObject(extractDomainAttributes(domain, product));
    return { productDomain: domain, taxonomy, attributes };
  }

  it('processes dress product end-to-end', () => {
    const result = processProduct(DRESS_PRODUCT);
    expect(result.productDomain).toBe('fashion_dress');
    expect(result.taxonomy.gender).toBe('women');
    expect(result.taxonomy.materialFamily).toContain('viscose');
    expect(result.attributes.dressLength).toBe('maxi');
    // No null values anywhere
    for (const val of Object.values(result.taxonomy)) {
      expect(val).not.toBeNull();
      expect(val).not.toBeUndefined();
    }
  });

  it('processes skincare product end-to-end', () => {
    const result = processProduct(SKINCARE_PRODUCT);
    expect(result.productDomain).toBe('beauty_skincare');
    expect(result.attributes.targetArea).toBe('face');
    expect(result.attributes.texture).toBe('gel');
    expect(result.attributes).not.toHaveProperty('dressLength');
  });

  it('ambiguous product produces minimal output', () => {
    const result = processProduct(AMBIGUOUS_PRODUCT);
    expect(result.productDomain).toBeNull();
    expect(Object.keys(result.attributes)).toHaveLength(0);
  });

  it('produces no seoMetafields in default output', () => {
    const result = processProduct(DRESS_PRODUCT);
    expect(result).not.toHaveProperty('seoMetafields');
  });
});
