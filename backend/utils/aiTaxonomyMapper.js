/**
 * Shared cross-category taxonomy extractor.
 * Extracts normalized AI-friendly taxonomy facets from product data.
 * Multilingual: EN, BG, RO.
 *
 * Returns only fields that have values — caller should run compactObject() on result.
 */

// ============================================================
// Keyword dictionaries: canonical_value → [multilingual keywords]
// ============================================================

const GENDER_KEYWORDS = {
  women:  ['women', 'woman', 'female', 'ladies', 'lady', 'жени', 'дами', 'дамска', 'дамски', 'дамско', 'femei', 'doamne', 'damă'],
  men:    ['men', 'man', 'male', 'gents', 'gentleman', 'мъже', 'мъжки', 'мъжка', 'мъжко', 'bărbați', 'barbati', 'bărbătesc'],
  unisex: ['unisex', 'унисекс'],
  boys:   ['boys', 'boy', 'момчета', 'момче', 'băieți', 'băiat'],
  girls:  ['girls', 'girl', 'момичета', 'момиче', 'fete', 'fată'],
};

const AGE_GROUP_KEYWORDS = {
  adult:    ['adult', 'adults', 'възрастен', 'възрастни', 'adulți', 'adult'],
  teen:     ['teen', 'teenager', 'junior', 'тийнейджър', 'юноша', 'adolescent'],
  kids:     ['kids', 'children', 'child', 'деца', 'дете', 'детски', 'copii', 'copil'],
  baby:     ['baby', 'infant', 'toddler', 'бебе', 'бебешки', 'бебешка', 'bebeluș', 'bebelus'],
  all_ages: ['all ages', 'за всички възрасти'],
};

const SEASON_KEYWORDS = {
  spring: ['spring', 'пролет', 'пролетен', 'пролетна', 'пролетно', 'primăvară', 'primavara'],
  summer: ['summer', 'лято', 'летен', 'летна', 'летно', 'vară', 'vara'],
  autumn: ['autumn', 'fall', 'есен', 'есенен', 'есенна', 'есенно', 'toamnă', 'toamna'],
  winter: ['winter', 'зима', 'зимен', 'зимна', 'зимно', 'iarnă', 'iarna'],
};

const OCCASION_KEYWORDS = {
  casual:  ['casual', 'ежедневен', 'ежедневна', 'ежедневно', 'casual'],
  formal:  ['formal', 'официален', 'официална', 'официално', 'formal'],
  party:   ['party', 'cocktail', 'парти', 'коктейл', 'petrecere'],
  work:    ['work', 'office', 'business', 'работа', 'офис', 'делови', 'birou', 'serviciu'],
  sport:   ['sport', 'athletic', 'gym', 'fitness', 'спорт', 'фитнес', 'sport', 'atletism'],
  wedding: ['wedding', 'bridal', 'сватба', 'сватбен', 'сватбена', 'булка', 'nuntă', 'nunta', 'mireasă'],
  beach:   ['beach', 'swim', 'swimwear', 'плаж', 'плажен', 'плажна', 'бански', 'plajă', 'plaja'],
  evening: ['evening', 'gala', 'вечерен', 'вечерна', 'вечерно', 'seară', 'seara', 'gală'],
};

const STYLE_KEYWORDS = {
  bohemian:   ['bohemian', 'boho', 'бохо', 'boem'],
  classic:    ['classic', 'traditional', 'класически', 'класическа', 'класическо', 'clasic', 'tradițional'],
  minimalist: ['minimalist', 'minimal', 'минималист', 'минималистичен', 'минималистична', 'minimalist'],
  streetwear: ['streetwear', 'street', 'urban', 'стрийт', 'стрийтуеър', 'urban'],
  vintage:    ['vintage', 'retro', 'винтидж', 'ретро', 'vintage', 'retro'],
  elegant:    ['elegant', 'елегантен', 'елегантна', 'елегантно', 'elegant'],
  sporty:     ['sporty', 'спортен', 'спортна', 'спортно', 'sportiv'],
  romantic:   ['romantic', 'романтичен', 'романтична', 'романтично', 'romantic'],
  glamorous:  ['glamorous', 'glam', 'luxury', 'луксозен', 'луксозна', 'гламурен', 'glamour'],
};

const PATTERN_KEYWORDS = {
  solid:        ['solid', 'plain', 'едноцветен', 'едноцветна', 'едноцветно', 'uni'],
  floral:       ['floral', 'flower', 'flowers', 'цветя', 'цветен', 'цветна', 'флорален', 'флорална', 'на цветя', 'floral'],
  striped:      ['striped', 'stripe', 'stripes', 'раирана', 'раирано', 'райе', 'на райе', 'dungat', 'dungi'],
  plaid:        ['plaid', 'check', 'checked', 'checkered', 'каре', 'карирана', 'карирано', 'на каре', 'carouri'],
  polka_dot:    ['polka dot', 'polka dots', 'dotted', 'точки', 'на точки', 'buline'],
  animal_print: ['animal print', 'leopard', 'zebra', 'snake', 'snakeskin', 'леопардов', 'леопардова', 'животински принт', 'print animal'],
  geometric:    ['geometric', 'геометричен', 'геометрична', 'geometric'],
  abstract:     ['abstract', 'абстрактен', 'абстрактна', 'abstract'],
  lace:         ['lace', 'дантела', 'дантелен', 'дантелена', 'dantelă'],
  paisley:      ['paisley', 'пейсли'],
  camouflage:   ['camouflage', 'camo', 'камуфлаж', 'camuflaj'],
};

const COLOR_FAMILY_MAP = {
  red:      ['red', 'scarlet', 'crimson', 'cherry', 'червен', 'червено', 'червена', 'roșu', 'rosu'],
  pink:     ['pink', 'fuchsia', 'magenta', 'blush', 'розов', 'розово', 'розова', 'roz'],
  orange:   ['orange', 'coral', 'peach', 'оранжев', 'оранжево', 'оранжева', 'корал', 'portocaliu'],
  yellow:   ['yellow', 'gold', 'mustard', 'жълт', 'жълто', 'жълта', 'златист', 'galben', 'auriu'],
  green:    ['green', 'olive', 'emerald', 'khaki', 'mint', 'sage', 'зелен', 'зелено', 'зелена', 'каки', 'маслинен', 'verde'],
  blue:     ['blue', 'navy', 'cobalt', 'royal blue', 'azure', 'teal', 'син', 'синьо', 'синя', 'тъмносин', 'albastru', 'bleumarin'],
  purple:   ['purple', 'violet', 'lavender', 'plum', 'лилав', 'лилаво', 'лилава', 'mov', 'violet'],
  brown:    ['brown', 'tan', 'chocolate', 'camel', 'cognac', 'кафяв', 'кафяво', 'кафява', 'камел', 'maro'],
  black:    ['black', 'черен', 'черно', 'черна', 'negru'],
  white:    ['white', 'ivory', 'cream', 'бял', 'бяло', 'бяла', 'кремав', 'alb', 'crem'],
  grey:     ['gray', 'grey', 'silver', 'charcoal', 'сив', 'сиво', 'сива', 'сребрист', 'gri', 'argintiu'],
  beige:    ['beige', 'nude', 'бежов', 'бежово', 'бежова', 'нюд', 'bej'],
  bordeaux: ['bordeaux', 'burgundy', 'maroon', 'wine', 'бордо', 'бордо', 'bordo', 'vișiniu'],
};

const MATERIAL_FAMILY_MAP = {
  cotton:    ['cotton', 'памук', 'памучен', 'памучна', 'bumbac'],
  polyester: ['polyester', 'полиестер', 'poliester'],
  wool:      ['wool', 'merino', 'cashmere', 'вълна', 'вълнен', 'мерино', 'кашмир', 'lână'],
  silk:      ['silk', 'коприна', 'копринен', 'mătase'],
  leather:   ['leather', 'кожа', 'кожен', 'кожена', 'piele'],
  denim:     ['denim', 'деним', 'jeans', 'дънки', 'denim'],
  linen:     ['linen', 'лен', 'ленен', 'ленена', 'in'],
  synthetic: ['nylon', 'spandex', 'elastane', 'lycra', 'acrylic', 'найлон', 'еластан', 'лайкра', 'акрил'],
  viscose:   ['viscose', 'rayon', 'modal', 'вискоза', 'модал', 'viscoză'],
  velvet:    ['velvet', 'кадифе', 'кадифен', 'catifea'],
  satin:     ['satin', 'сатен', 'сатенен', 'satin'],
  chiffon:   ['chiffon', 'шифон', 'шифонен', 'sifon'],
  lace:      ['lace', 'дантела', 'дантелен', 'dantelă'],
  suede:     ['suede', 'велур', 'велурен', 'catifea'],
};

const USE_CASE_KEYWORDS = {
  everyday: ['everyday', 'daily', 'ежедневен', 'ежедневна', 'ежедневно', 'zilnic'],
  office:   ['office', 'work', 'business', 'офис', 'birou'],
  evening:  ['evening', 'night out', 'вечерен', 'вечерна', 'вечерно', 'seară'],
  outdoor:  ['outdoor', 'hiking', 'camping', 'на открито', 'outdoor'],
  travel:   ['travel', 'пътуване', 'călătorie'],
  lounge:   ['lounge', 'home', 'homewear', 'домашен', 'домашна', 'домашно', 'acasă'],
  workout:  ['workout', 'training', 'gym', 'тренировка', 'antrenament'],
};

// ============================================================
// Helpers
// ============================================================

function buildTextCorpus({ title, productType, tags, descriptionHtml }) {
  const parts = [
    descriptionHtml || '',
    title || '',
    productType || '',
    ...(tags || []),
  ];
  return parts.join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

/** Single-match: returns first matching canonical key, or null */
function matchSingle(text, keywordMap) {
  for (const [canonical, keywords] of Object.entries(keywordMap)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) return canonical;
    }
  }
  return null;
}

/** Multi-match: returns array of all matching canonical keys, or null */
function matchMultiple(text, keywordMap) {
  const results = [];
  for (const [canonical, keywords] of Object.entries(keywordMap)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        results.push(canonical);
        break;
      }
    }
  }
  return results.length > 0 ? results : null;
}

/** Normalize a color string to a color family using COLOR_FAMILY_MAP */
function normalizeColorToFamily(colorStr) {
  const lower = colorStr.toLowerCase().trim();
  for (const [family, keywords] of Object.entries(COLOR_FAMILY_MAP)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return family;
    }
  }
  return null;
}

// ============================================================
// Main export
// ============================================================

/**
 * Extract shared cross-category taxonomy.
 * @param {Object} input
 * @param {string} input.title
 * @param {string|null} input.productType
 * @param {string[]} input.tags
 * @param {string|null} input.descriptionHtml
 * @param {Object} input.taxonomyMetafields - raw { key: value } from taxonomy namespace
 * @param {Object} input.variantOptions - { optionName: string[] } from variant selectedOptions
 * @returns {Object} Taxonomy object — run compactObject() to strip empties
 */
export function extractSharedTaxonomy({ title, productType, tags, descriptionHtml, taxonomyMetafields, variantOptions }) {
  const meta = taxonomyMetafields || {};
  const opts = variantOptions || {};
  const corpus = buildTextCorpus({ title, productType, tags, descriptionHtml });
  const tagText = (tags || []).join(' ').toLowerCase();

  // --- gender ---
  let gender = null;
  const metaGender = (meta.target_gender || meta.gender || '').toLowerCase();
  if (metaGender) {
    gender = matchSingle(metaGender, GENDER_KEYWORDS);
  }
  if (!gender) gender = matchSingle(tagText, GENDER_KEYWORDS);
  if (!gender) gender = matchSingle(corpus, GENDER_KEYWORDS);

  // --- ageGroup ---
  let ageGroup = null;
  const metaAge = (meta.age_group || meta.ageGroup || '').toLowerCase();
  if (metaAge) {
    ageGroup = matchSingle(metaAge, AGE_GROUP_KEYWORDS);
  }
  if (!ageGroup) ageGroup = matchSingle(tagText, AGE_GROUP_KEYWORDS);
  if (!ageGroup) ageGroup = matchSingle(corpus, AGE_GROUP_KEYWORDS);

  // --- season ---
  const season = matchMultiple(tagText, SEASON_KEYWORDS) || matchMultiple(corpus, SEASON_KEYWORDS);

  // --- occasion ---
  const occasion = matchMultiple(tagText, OCCASION_KEYWORDS) || matchMultiple(corpus, OCCASION_KEYWORDS);

  // --- style ---
  const style = matchMultiple(tagText, STYLE_KEYWORDS) || matchMultiple(corpus, STYLE_KEYWORDS);

  // --- colorFamily ---
  let colorFamily = null;
  // Variant options first (most reliable for actual product colors)
  const colorValues = opts['Color'] || opts['Colour'] || opts['color'] || opts['colour'] || opts['Цвят'] || opts['цвят'] || opts['Culoare'] || [];
  if (colorValues.length > 0) {
    const families = new Set();
    for (const cv of colorValues) {
      const f = normalizeColorToFamily(cv);
      if (f) families.add(f);
    }
    if (families.size > 0) colorFamily = [...families];
  }
  // Taxonomy metafield fallback
  if (!colorFamily) {
    const metaColor = (meta.color || meta.colour || '').toLowerCase();
    if (metaColor) {
      const f = normalizeColorToFamily(metaColor);
      if (f) colorFamily = [f];
    }
  }
  // Text fallback (only pick up to 3 to avoid noise)
  if (!colorFamily) {
    const fromText = matchMultiple(corpus, COLOR_FAMILY_MAP);
    if (fromText) colorFamily = fromText.slice(0, 3);
  }

  // --- pattern ---
  const pattern = matchMultiple(tagText, PATTERN_KEYWORDS) || matchMultiple(corpus, PATTERN_KEYWORDS);

  // --- materialFamily ---
  let materialFamily = null;
  // Taxonomy metafields first
  const metaMaterial = (meta.fabric || meta.material || '').toLowerCase();
  if (metaMaterial) {
    const fromMeta = matchMultiple(metaMaterial, MATERIAL_FAMILY_MAP);
    if (fromMeta) materialFamily = fromMeta;
  }
  if (!materialFamily) {
    materialFamily = matchMultiple(tagText, MATERIAL_FAMILY_MAP) || matchMultiple(corpus, MATERIAL_FAMILY_MAP);
  }

  // --- useCase ---
  const useCase = matchMultiple(tagText, USE_CASE_KEYWORDS) || matchMultiple(corpus, USE_CASE_KEYWORDS);

  return {
    ageGroup: ageGroup || undefined,
    gender: gender || undefined,
    season: season || undefined,
    occasion: occasion || undefined,
    style: style || undefined,
    colorFamily: colorFamily || undefined,
    pattern: pattern || undefined,
    materialFamily: materialFamily || undefined,
    useCase: useCase || undefined,
  };
}
