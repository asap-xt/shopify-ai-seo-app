/**
 * Domain-specific attribute extractor.
 * Given a product domain and product data, extracts only the attributes
 * relevant to that domain. No nulls in output.
 * Multilingual: EN, BG, RO.
 */

// ============================================================
// Shared keyword dictionaries
// ============================================================

const FIT_KEYWORDS = {
  slim:       ['slim', 'slim fit', 'fitted', 'тесен', 'тясна', 'тясно', 'slim'],
  regular:    ['regular', 'regular fit', 'стандартен', 'стандартна', 'regulat'],
  relaxed:    ['relaxed', 'loose', 'свободен', 'свободна', 'свободно', 'larg'],
  oversized:  ['oversized', 'oversize', 'оувърсайз', 'supradimensionat'],
  bodycon:    ['bodycon', 'body-con', 'боди кон', 'по тялото'],
  a_line:     ['a-line', 'a line', 'а-линия', 'linie a'],
  wide_leg:   ['wide leg', 'wide-leg', 'широк крачол', 'широки крачоли', 'picior larg'],
  straight:   ['straight', 'straight fit', 'прав', 'права', 'право', 'drept'],
  skinny:     ['skinny', 'тесни', 'тесен', 'skinny'],
  flared:     ['flared', 'flare', 'разкроен', 'разкроена', 'evazat'],
  tapered:    ['tapered', 'taper', 'конусовиден', 'conic'],
};

const SLEEVE_LENGTH_KEYWORDS = {
  sleeveless:    ['sleeveless', 'strapless', 'без ръкави', 'fără mâneci'],
  short_sleeve:  ['short sleeve', 'short-sleeve', 'къс ръкав', 'къси ръкави', 'mânecă scurtă'],
  three_quarter: ['3/4 sleeve', 'three quarter', '3/4 ръкав', 'trei sferturi'],
  long_sleeve:   ['long sleeve', 'long-sleeve', 'дълъг ръкав', 'дълги ръкави', 'mânecă lungă'],
  cap_sleeve:    ['cap sleeve', 'cap-sleeve', 'ръкавче'],
};

const NECKLINE_KEYWORDS = {
  v_neck:       ['v-neck', 'v neck', 'v-образно', 'деколте v', 'decolteu v'],
  round_neck:   ['round neck', 'crew neck', 'crew-neck', 'кръгло деколте', 'gât rotund'],
  off_shoulder: ['off shoulder', 'off-shoulder', 'паднали рамене', 'паднало рамо', 'umeri goi'],
  halter:       ['halter', 'холтър'],
  turtleneck:   ['turtleneck', 'turtle neck', 'turtle-neck', 'поло', 'guler înalt'],
  square_neck:  ['square neck', 'square-neck', 'квадратно деколте'],
  sweetheart:   ['sweetheart', 'сърцевидно'],
  boat_neck:    ['boat neck', 'bateau', 'деколте лодка'],
  scoop_neck:   ['scoop neck', 'scoop', 'широко деколте'],
  collared:     ['collared', 'collar', 'яка', 'с яка', 'guler'],
  mock_neck:    ['mock neck', 'mock-neck', 'полу-поло'],
};

const CLOSURE_KEYWORDS = {
  zipper:   ['zipper', 'zip', 'цип', 'ципче', 'fermoar'],
  lace_up:  ['lace up', 'lace-up', 'връзки', 'cu șireturi'],
  buckle:   ['buckle', 'катарама', 'cataramă'],
  slip_on:  ['slip on', 'slip-on', 'без закопчаване', 'fără închidere'],
  velcro:   ['velcro', 'велкро'],
  button:   ['button', 'buttons', 'копче', 'копчета', 'nasture'],
  snap:     ['snap', 'magnetic', 'тик-так', 'магнитна', 'магнитно'],
  hook:     ['hook', 'кукичка', 'cârlig'],
  drawstring: ['drawstring', 'връзка', 'шнур'],
};

// ============================================================
// Fashion Dress-specific
// ============================================================

const DRESS_LENGTH_KEYWORDS = {
  mini:         ['mini', 'мини'],
  midi:         ['midi', 'миди'],
  maxi:         ['maxi', 'макси'],
  knee_length:  ['knee length', 'knee-length', 'до коляното', 'lungime genunchi'],
  floor_length: ['floor length', 'floor-length', 'до пода', 'lungime podea'],
};

const SILHOUETTE_KEYWORDS = {
  a_line:        ['a-line', 'a line', 'а-линия'],
  sheath:        ['sheath', 'shift', 'шийт'],
  wrap:          ['wrap', 'прегърни', 'inalit', 'înfășurat'],
  empire:        ['empire', 'ампир'],
  mermaid:       ['mermaid', 'русалка', 'sirenă'],
  fit_and_flare: ['fit and flare', 'fit-and-flare', 'фит енд флеър'],
  straight:      ['straight', 'прав', 'права', 'drept'],
  flowy:         ['flowy', 'flowing', 'свободно падаща', 'fluid'],
  bodycon:       ['bodycon', 'по тялото'],
  skater:        ['skater', 'скейтър'],
};

// ============================================================
// Pants-specific
// ============================================================

const RISE_KEYWORDS = {
  high:  ['high rise', 'high-rise', 'high waist', 'high-waist', 'висока талия', 'talie înaltă'],
  mid:   ['mid rise', 'mid-rise', 'mid waist', 'средна талия', 'talie medie'],
  low:   ['low rise', 'low-rise', 'low waist', 'ниска талия', 'talie joasă'],
};

const PANT_LENGTH_KEYWORDS = {
  full_length: ['full length', 'full-length', 'дълги', 'lungime completă'],
  cropped:     ['cropped', 'crop', '7/8', 'scurt'],
  ankle:       ['ankle', 'ankle-length', 'до глезена', 'lungime gleznă'],
  knee:        ['knee', 'bermuda', 'до коляното'],
  short:       ['short', 'shorts', 'къси', 'pantaloni scurți'],
};

// ============================================================
// Footwear-specific
// ============================================================

const SHOE_STYLE_KEYWORDS = {
  sneaker:     ['sneaker', 'sneakers', 'trainer', 'кецове', 'маратонки', 'adidași'],
  boot:        ['boot', 'boots', 'ankle boot', 'боти', 'ботуши', 'cizme', 'ghete'],
  sandal:      ['sandal', 'sandals', 'сандали', 'sandale'],
  pump:        ['pump', 'pumps', 'heel', 'heels', 'обувки на ток', 'pantofi cu toc'],
  loafer:      ['loafer', 'loafers', 'мокасини', 'mocasini'],
  flat:        ['flat', 'flats', 'ballet', 'балеринки', 'balerini'],
  mule:        ['mule', 'mules', 'мюл', 'мюли'],
  espadrille:  ['espadrille', 'espadrilles', 'еспадрили', 'espadrile'],
  oxford:      ['oxford', 'oxfords', 'оксфорд'],
  slipper:     ['slipper', 'slippers', 'чехли', 'papuci'],
  platform:    ['platform', 'платформа', 'platformă'],
  wedge:       ['wedge', 'wedges', 'клин', 'pană'],
};

const TOE_STYLE_KEYWORDS = {
  pointed:  ['pointed', 'pointed toe', 'остър', 'остри', 'ascuțit'],
  round:    ['round', 'round toe', 'кръгъл', 'кръгли', 'rotund'],
  square:   ['square', 'square toe', 'квадратен', 'квадратни', 'pătrat'],
  open:     ['open toe', 'open-toe', 'отворени', 'отворен', 'vârf deschis'],
  peep:     ['peep toe', 'peep-toe'],
  almond:   ['almond', 'almond toe', 'бадемовиден', 'migdală'],
};

const HEEL_HEIGHT_KEYWORDS = {
  flat:     ['flat', 'no heel', 'без ток', 'fără toc'],
  low:      ['low heel', 'kitten heel', 'kitten', 'нисък ток', 'toc jos'],
  mid:      ['mid heel', 'medium heel', 'среден ток', 'toc mediu'],
  high:     ['high heel', 'stiletto', 'висок ток', 'toc înalt'],
  platform: ['platform', 'платформа', 'platformă'],
  wedge:    ['wedge', 'клин', 'pană'],
};

// ============================================================
// Bag-specific
// ============================================================

const BAG_TYPE_KEYWORDS = {
  tote:      ['tote', 'тоут', 'geantă tote'],
  crossbody: ['crossbody', 'cross-body', 'кросбоди', 'cross body'],
  clutch:    ['clutch', 'клъч', 'plic'],
  backpack:  ['backpack', 'раница', 'rucsac'],
  shoulder:  ['shoulder bag', 'shoulder', 'чанта за рамо', 'geantă de umăr'],
  hobo:      ['hobo', 'хобо'],
  bucket:    ['bucket', 'кофа'],
  satchel:   ['satchel', 'сатчел'],
  wallet:    ['wallet', 'портфейл', 'portofel'],
  cosmetic:  ['cosmetic bag', 'makeup bag', 'несесер', 'portfard'],
  messenger: ['messenger', 'месинджър'],
};

const STRAP_TYPE_KEYWORDS = {
  chain:       ['chain', 'chain strap', 'верижка', 'lanț'],
  leather:     ['leather strap', 'кожена дръжка', 'curea din piele'],
  adjustable:  ['adjustable', 'adjustable strap', 'регулируема', 'curea reglabilă'],
  removable:   ['removable', 'removable strap', 'сваляема', 'curea detașabilă'],
  handle:      ['top handle', 'handle', 'дръжка', 'mâner'],
  wrist:       ['wrist strap', 'wristlet', 'за китка'],
};

// ============================================================
// Jewelry-specific
// ============================================================

const JEWELRY_TYPE_KEYWORDS = {
  necklace:  ['necklace', 'chain', 'pendant', 'choker', 'колие', 'висулка', 'colier'],
  bracelet:  ['bracelet', 'bangle', 'cuff', 'гривна', 'brățară'],
  earrings:  ['earring', 'earrings', 'stud', 'hoop', 'drop earring', 'обеци', 'обица', 'cercei'],
  ring:      ['ring', 'band', 'пръстен', 'inel'],
  brooch:    ['brooch', 'pin', 'брошка', 'broșă'],
  anklet:    ['anklet', 'гривна за глезен'],
};

// ============================================================
// Beauty-specific
// ============================================================

const TARGET_AREA_KEYWORDS = {
  face:  ['face', 'facial', 'лице', 'față'],
  eyes:  ['eye', 'eyes', 'очи', 'ochi'],
  lips:  ['lip', 'lips', 'устни', 'buze'],
  body:  ['body', 'тяло', 'corp'],
  hands: ['hand', 'hands', 'ръце', 'mâini'],
  neck:  ['neck', 'шия', 'gât'],
  hair:  ['hair', 'коса', 'păr'],
};

const SKIN_CONCERN_KEYWORDS = {
  anti_aging:   ['anti-aging', 'anti aging', 'wrinkle', 'fine lines', 'антиейдж', 'бръчки', 'anti-îmbătrânire'],
  hydration:    ['hydrating', 'hydration', 'moisturizing', 'moisture', 'хидратиране', 'хидратиращ', 'овлажняване', 'hidratare'],
  acne:         ['acne', 'blemish', 'breakout', 'pore', 'акне', 'пори', 'acnee'],
  brightening:  ['brightening', 'radiance', 'glow', 'luminous', 'сияние', 'сияйна', 'luminozitate'],
  sensitive:    ['sensitive', 'calming', 'soothing', 'чувствителна', 'успокояващ', 'sensibilă'],
  dark_spots:   ['dark spot', 'hyperpigmentation', 'pigmentation', 'тъмни петна', 'пигментация', 'pete întunecate'],
  firming:      ['firming', 'lifting', 'стягащ', 'стягане', 'fermitate'],
  oil_control:  ['oil control', 'mattifying', 'matte', 'матиращ', 'control sebum'],
};

const TEXTURE_KEYWORDS = {
  cream:   ['cream', 'crème', 'крем', 'cremă'],
  gel:     ['gel', 'гел'],
  serum:   ['serum', 'серум', 'ser'],
  oil:     ['oil', 'масло', 'олио', 'ulei'],
  foam:    ['foam', 'mousse', 'пяна', 'spumă'],
  mist:    ['mist', 'spray', 'спрей'],
  balm:    ['balm', 'балсам', 'balsam'],
  powder:  ['powder', 'пудра', 'pudră'],
  lotion:  ['lotion', 'лосион', 'loțiune'],
  paste:   ['paste', 'паста', 'pastă'],
  stick:   ['stick', 'стик'],
};

const SCENT_FAMILY_KEYWORDS = {
  floral:   ['floral', 'flower', 'rose', 'jasmine', 'lily', 'цветен', 'роза', 'жасмин', 'floral'],
  woody:    ['woody', 'wood', 'cedar', 'sandalwood', 'oud', 'дървесен', 'кедър', 'сандалово', 'lemnos'],
  oriental: ['oriental', 'amber', 'vanilla', 'incense', 'ориенталски', 'амбър', 'ванилия', 'oriental'],
  fresh:    ['fresh', 'citrus', 'aquatic', 'marine', 'свеж', 'цитрусов', 'proaspăt', 'citric'],
  gourmand: ['gourmand', 'sweet', 'caramel', 'chocolate', 'coffee', 'гурме', 'карамел', 'dulce'],
  musk:     ['musk', 'musky', 'муск', 'mosc'],
  spicy:    ['spicy', 'cinnamon', 'pepper', 'cardamom', 'подправки', 'канела', 'condimentat'],
  green:    ['green', 'herbal', 'tea', 'тревист', 'зелен', 'verde'],
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

function matchFirst(text, keywordMap) {
  for (const [canonical, keywords] of Object.entries(keywordMap)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) return canonical;
    }
  }
  return null;
}

function matchAll(text, keywordMap) {
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

function extractVolumeMl(text) {
  const match = text.match(/(\d+)\s*(ml|мл)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

// ============================================================
// Domain extractors
// ============================================================

function extractDress(corpus) {
  return {
    dressLength: matchFirst(corpus, DRESS_LENGTH_KEYWORDS),
    fit: matchFirst(corpus, FIT_KEYWORDS),
    sleeveLength: matchFirst(corpus, SLEEVE_LENGTH_KEYWORDS),
    neckline: matchFirst(corpus, NECKLINE_KEYWORDS),
    silhouette: matchFirst(corpus, SILHOUETTE_KEYWORDS),
  };
}

function extractTop(corpus) {
  return {
    fit: matchFirst(corpus, FIT_KEYWORDS),
    sleeveLength: matchFirst(corpus, SLEEVE_LENGTH_KEYWORDS),
    neckline: matchFirst(corpus, NECKLINE_KEYWORDS),
  };
}

function extractPants(corpus) {
  return {
    fit: matchFirst(corpus, FIT_KEYWORDS),
    rise: matchFirst(corpus, RISE_KEYWORDS),
    length: matchFirst(corpus, PANT_LENGTH_KEYWORDS),
  };
}

function extractOuterwear(corpus) {
  return {
    fit: matchFirst(corpus, FIT_KEYWORDS),
    length: matchFirst(corpus, PANT_LENGTH_KEYWORDS),
    closure: matchFirst(corpus, CLOSURE_KEYWORDS),
  };
}

function extractFootwear(corpus) {
  return {
    shoeStyle: matchFirst(corpus, SHOE_STYLE_KEYWORDS),
    toeStyle: matchFirst(corpus, TOE_STYLE_KEYWORDS),
    heelHeight: matchFirst(corpus, HEEL_HEIGHT_KEYWORDS),
    closure: matchFirst(corpus, CLOSURE_KEYWORDS),
  };
}

function extractBag(corpus) {
  return {
    bagType: matchFirst(corpus, BAG_TYPE_KEYWORDS),
    closure: matchFirst(corpus, CLOSURE_KEYWORDS),
    strapType: matchFirst(corpus, STRAP_TYPE_KEYWORDS),
  };
}

function extractJewelry(corpus) {
  return {
    jewelryType: matchFirst(corpus, JEWELRY_TYPE_KEYWORDS),
  };
}

function extractSkincare(corpus) {
  return {
    targetArea: matchFirst(corpus, TARGET_AREA_KEYWORDS),
    skinConcern: matchAll(corpus, SKIN_CONCERN_KEYWORDS),
    texture: matchFirst(corpus, TEXTURE_KEYWORDS),
  };
}

function extractBodycare(corpus) {
  return {
    targetArea: matchFirst(corpus, TARGET_AREA_KEYWORDS),
    texture: matchFirst(corpus, TEXTURE_KEYWORDS),
  };
}

function extractFragrance(corpus) {
  return {
    scentFamily: matchAll(corpus, SCENT_FAMILY_KEYWORDS),
    volumeMl: extractVolumeMl(corpus),
  };
}

function extractMakeup(corpus) {
  return {
    targetArea: matchFirst(corpus, TARGET_AREA_KEYWORDS),
    texture: matchFirst(corpus, TEXTURE_KEYWORDS),
  };
}

const DOMAIN_EXTRACTORS = {
  fashion_dress:     extractDress,
  fashion_top:       extractTop,
  fashion_pants:     extractPants,
  fashion_outerwear: extractOuterwear,
  footwear:          extractFootwear,
  accessory_bag:     extractBag,
  accessory_jewelry: extractJewelry,
  accessory_other:   () => ({}),
  beauty_skincare:   extractSkincare,
  beauty_bodycare:   extractBodycare,
  beauty_fragrance:  extractFragrance,
  beauty_makeup:     extractMakeup,
  beauty_other:      () => ({}),
};

// ============================================================
// Main export
// ============================================================

/**
 * Extract domain-specific attributes for a product.
 * @param {string|null} domain - Product domain from resolveProductDomain()
 * @param {Object} input - Product data
 * @returns {Object} Attributes object — run compactObject() to strip nulls
 */
export function extractDomainAttributes(domain, { title, productType, tags, descriptionHtml }) {
  if (!domain) return {};
  const extractor = DOMAIN_EXTRACTORS[domain];
  if (!extractor) return {};
  const corpus = buildTextCorpus({ title, productType, tags, descriptionHtml });
  return extractor(corpus);
}
