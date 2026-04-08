/**
 * Product domain classifier.
 * Classifies a Shopify product into one of 13 product domains
 * using Shopify category path, productType, tags, and text extraction.
 * Multilingual: EN, BG, RO.
 */

const DOMAIN_RULES = [
  // Fashion — order matters: more specific before generic
  // Note: no \b word boundaries — they don't work with Cyrillic/Romanian characters
  { domain: 'fashion_dress',     pattern: /dress|рокля|рокли|rochie|rochii/i },
  { domain: 'fashion_top',       pattern: /(?:^|\s|>)(top|tops|blouse|shirt|t-?shirt|sweater|cardigan|hoodie|pullover|tunic|camisole|tank.?top|блуза|блузи|пуловер|суитчър|bluză|tricou|pulover)(?:\s|$|<)/i },
  { domain: 'fashion_pants',     pattern: /pants|pant|trousers|jeans|leggings|shorts|skirt|skorts|панталон|панталони|дънки|клин|пола|pantaloni|fustă|jeanși/i },
  { domain: 'fashion_outerwear', pattern: /jacket|coat|blazer|outerwear|parka|poncho|cape|windbreaker|яке|палто|сако|пончо|jachetă|palton|sacou/i },

  // Footwear
  { domain: 'footwear',          pattern: /shoe|shoes|boot|boots|sneaker|sneakers|sandal|sandals|slipper|slippers|footwear|pump|pumps|loafer|loafers|mule|mules|espadrille|обувки|ботуши|боти|сандали|маратонки|кецове|чехли|pantofi|cizme|ghete|sandale|adidași/i },

  // Accessories
  { domain: 'accessory_bag',     pattern: /bag|bags|handbag|backpack|clutch|tote|purse|wallet|чанта|чанти|раница|портфейл|клъч|geantă|geanți|rucsac|portofel|plic/i },
  { domain: 'accessory_jewelry', pattern: /jewel|jewelry|jewellery|necklace|bracelet|earring|earrings|ring|pendant|brooch|бижу|бижута|гривна|колие|обеци|пръстен|bijuterii|brățară|colier|cercei|inel/i },
  { domain: 'accessory_other',   pattern: /hat|hats|scarf|scarves|belt|belts|sunglasses|watch|watches|glove|gloves|headband|hair.?clip|шапка|шал|колан|очила|часовник|ръкавици|вратовръзка|pălărie|eșarfă|curea|ochelari|ceas|mănuși|cravată/i },

  // Beauty — more specific before generic
  { domain: 'beauty_fragrance',  pattern: /fragrance|perfume|parfum|eau.?de|cologne|тоалетна вода|парфюм|apă de toaletă/i },
  { domain: 'beauty_skincare',   pattern: /skincare|skin.?care|serum|moisturiz|cleanser|toner|face.?mask|eye.?cream|sunscreen|spf|грижа за кожата|серум|крем за лице|тоник|îngrijire|ser|cremă de față/i },
  { domain: 'beauty_bodycare',   pattern: /body.?care|body.?lotion|body.?wash|body.?scrub|deodorant|soap|shower.?gel|bath|лосион за тяло|душ гел|сапун|грижа за тялото|gel de duș|săpun|loțiune de corp/i },
  { domain: 'beauty_makeup',     pattern: /makeup|make-?up|lipstick|foundation|mascara|eyeshadow|blush|concealer|powder|eyeliner|lip.?gloss|грим|червило|фон дьо тен|спирала|сенки|руж|коректор|пудра|machiaj|ruj|fond de ten|rimel|fard/i },
  { domain: 'beauty_other',      pattern: /beauty|cosmetic|козметика|frumusețe|cosmetice/i },
];

/**
 * Resolve product domain from available product data.
 * @param {Object} input
 * @param {string} input.title
 * @param {string|null} input.productType
 * @param {string[]} input.tags
 * @param {string|null} input.categoryFullName - Shopify taxonomy category path
 * @param {string|null} input.categoryName
 * @param {string|null} input.descriptionHtml
 * @returns {string|null} One of 13 domain strings or null
 */
export function resolveProductDomain({ title, productType, tags, categoryFullName, categoryName, descriptionHtml }) {
  // 1. Shopify category path (most reliable)
  if (categoryFullName) {
    const match = matchDomain(categoryFullName);
    if (match) return match;
  }
  if (categoryName) {
    const match = matchDomain(categoryName);
    if (match) return match;
  }

  // 2. productType
  if (productType) {
    const match = matchDomain(productType);
    if (match) return match;
  }

  // 3. Tags (joined)
  if (tags && tags.length > 0) {
    const tagText = tags.join(' ');
    const match = matchDomain(tagText);
    if (match) return match;
  }

  // 4. Title
  if (title) {
    const match = matchDomain(title);
    if (match) return match;
  }

  // 5. Description (last resort — strip HTML first)
  if (descriptionHtml) {
    const plainText = descriptionHtml.replace(/<[^>]+>/g, ' ');
    const match = matchDomain(plainText);
    if (match) return match;
  }

  return null;
}

function matchDomain(text) {
  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(text)) return rule.domain;
  }
  return null;
}
