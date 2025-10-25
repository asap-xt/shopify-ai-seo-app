// backend/token-exchange.js
import express from 'express';
import Shop from './db/Shop.js';

const router = express.Router();

/**
 * POST /token-exchange
 * Body: { shop: string, id_token: string }
 */
router.post('/', async (req, res) => {
  try {
    const { shop, id_token } = req.body;
    console.log('[TOKEN_EXCHANGE] Starting for shop:', shop);
    console.log('[TOKEN_EXCHANGE] Has id_token:', !!id_token);
    
    if (!shop || !id_token) {
      return res.status(400).json({ error: 'Missing required parameters: shop and id_token' });
    }

    console.log('[TOKEN_EXCHANGE] Exchanging JWT for access token:', shop);
    console.log('[TOKEN_EXCHANGE] Request URL:', `https://${shop}/admin/oauth/access_token`);

    // КРИТИЧНО: Правилните Shopify параметри според документацията
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: id_token,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token' // SHOPIFY-специфичен!
      }),
    });

    console.log('[TOKEN_EXCHANGE] Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('[TOKEN_EXCHANGE] Response text:', errorText);
      return res.status(response.status).json({ error: 'Token exchange failed', details: errorText });
    }

    const tokenData = await response.json();
    const accessToken = tokenData.access_token;
    
    if (!accessToken) {
      throw new Error('No access_token in response');
    }

    // Запази в базата данни
    try {
      await Shop.findOneAndUpdate(
        { shop },
        { 
          shop, 
          accessToken,
          appApiKey: process.env.SHOPIFY_API_KEY,
          useJWT: true,
          installedAt: new Date(),
          updatedAt: new Date() 
        },
        { upsert: true, new: true }
      );
      console.log(`✅ Token saved to database for shop: ${shop}`);
      
      // Регистрирай webhook-ите след успешното запазване на токена
      try {
        const { registerAllWebhooks } = await import('./utils/webhookRegistration.js');
        const mockReq = {
          session: { accessToken },
          shopDomain: shop
        };
        const webhookResults = await registerAllWebhooks(mockReq, shop, process.env.APP_URL);
        console.log('[TOKEN_EXCHANGE] Webhook registration results:', JSON.stringify(webhookResults, null, 2));
      } catch (webhookError) {
        console.error('[TOKEN_EXCHANGE] Webhook registration failed:', webhookError.message);
        // Не блокираме token exchange-а ако webhook регистрацията се провали
      }
    } catch (dbError) {
      console.error(`❌ Failed to save token to database for ${shop}:`, dbError);
      throw new Error(`Database save failed: ${dbError.message}`);
    }

    console.log(`✅ Token exchange successful for shop: ${shop}`);
    return res.status(200).json({ 
      status: 'ok', 
      shop,
      tokenSaved: true 
    });
  } catch (error) {
    console.error('❌ Token exchange error:', error);
    return res.status(500).json({ error: 'Token exchange failed', message: error.message });
  }
});

export default router;
