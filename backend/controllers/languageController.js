// backend/controllers/languageController.js
// Mounted at /api/languages
// Routes:
//   GET /api/languages/shop/:shop
//   GET /api/languages/product/:shop/:productId

import { Router } from 'express';
const router = Router();

const uniq = (arr) => Array.from(new Set(arr));
const baseLang = (loc) => (loc || '').toLowerCase().split('-')[0];
const toGID = (id) => (/^\d+$/.test(String(id)) ? `gid://shopify/Product/${id}` : String(id));

function getGraphQL(res) {
  const api = res.locals?.shopify?.api;
  const session = res.locals?.shopify?.session;
  if (!api || !session) return { error: 'Unauthorized: missing Shopify session' };
  const Graphql = api.clients?.Graphql || api.clients?.graphql;
  if (!Graphql) return { error: 'Shopify GraphQL client not available' };
  return { client: new Graphql({ session }), session };
}

// GET /api/languages/shop/:shop
router.get('/shop/:shop', async (req, res) => {
  try {
    const { client, error } = getGraphQL(res);
    if (error) return res.status(401).json({ error });

    const q = /* GraphQL */ `
      query ShopLocales {
        shopLocales(published: true) {
          locale
          primary
          published
        }
      }
    `;
    const data = await client.request(q);
    const published = (data?.data?.shopLocales || []).filter(l => l.published);
    const locales = published.map(l => l.locale);
    const shopLanguages = uniq(locales.map(baseLang));
    const primaryLanguage = baseLang(published.find(l => l.primary)?.locale || locales[0] || 'en');
    res.json({ shopLanguages, primaryLanguage });
  } catch (err) {
    console.error('GET /api/languages/shop error:', err);
    res.status(500).json({ error: 'Failed to load shop languages' });
  }
});

// GET /api/languages/product/:shop/:productId
router.get('/product/:shop/:productId', async (req, res) => {
  try {
    const { client, error } = getGraphQL(res);
    if (error) return res.status(401).json({ error });

    const { productId } = req.params;
    const gid = toGID(productId);

    const qLocales = /* GraphQL */ `
      query ShopLocales {
        shopLocales(published: true) {
          locale
          primary
          published
        }
      }
    `;
    const localesData = await client.request(qLocales);
    const publishedLocales = (localesData?.data?.shopLocales || [])
      .filter(l => l.published)
      .map(l => l.locale);

    const withContent = [];
    for (const loc of publishedLocales) {
      const qProd = /* GraphQL */ `
        query ProductInLocale($id: ID!) @inContext(language: ${JSON.stringify(loc)}) {
          product(id: $id) {
            id
            title
            descriptionHtml
          }
        }
      `;
      const p = await client.request(qProd, { variables: { id: gid } });
      const prod = p?.data?.product;
      const textFromHtml = (html) => (html || '').replace(/<[^>]*>/g, '').trim();
      const hasContent =
        prod && ((prod.title && prod.title.trim().length > 0) ||
                 (prod.descriptionHtml && textFromHtml(prod.descriptionHtml).length > 0));
      if (hasContent) withContent.push(loc);
    }

    const productLanguages = uniq(withContent.map(baseLang));
    const shopLanguages = uniq(publishedLocales.map(baseLang));
    const primaryLanguage = baseLang(publishedLocales[0] || 'en');
    const effective = productLanguages.length ? productLanguages : shopLanguages;

    res.json({
      shopLanguages,
      productLanguages,
      primaryLanguage,
      shouldShowSelector: effective.length > 1,
      allLanguagesOption: effective.length > 1,
    });
  } catch (err) {
    console.error('GET /api/languages/product error:', err);
    res.status(500).json({ error: 'Failed to load product languages' });
  }
});

export default router;
