// controllers/debugRouter.js
import express from 'express';
import shopify from '@shopify/shopify-api';

const router = express.Router();

/**
 * GET /debug/locales
 * Returns active locales for the current shop
 */
router.get('/locales', async (req, res) => {
  try {
    const session = await shopify.utils.loadCurrentSession(req, res, true);
    if (!session) return res.status(401).json({ error: 'Unauthorized (no session)' });

    const client = new shopify.api.clients.Graphql({ session });
    const query = `{
      shopLocales {
        locale
        name
        primary
        published
      }
    }`;

    const rsp = await client.request(query);
    res.json(rsp?.data?.shopLocales || []);
  } catch (err) {
    console.error('Debug /locales error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /debug/product-locales/:productId
 * Returns translations of a product for all locales
 */
router.get('/product-locales/:productId', async (req, res) => {
  try {
    const session = await shopify.utils.loadCurrentSession(req, res, true);
    if (!session) return res.status(401).json({ error: 'Unauthorized (no session)' });

    const client = new shopify.api.clients.Graphql({ session });
    const { productId } = req.params;

    const query = `query getProductTranslations($id: ID!) {
      translatableResource(resourceId: $id) {
        resourceId
        resourceType
        translations {
          locale
          key
          value
          outdated
        }
      }
    }`;

    const rsp = await client.request(query, { variables: { id: `gid://shopify/Product/${productId}` } });
    res.json(rsp?.data?.translatableResource || {});
  } catch (err) {
    console.error('Debug /product-locales error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
