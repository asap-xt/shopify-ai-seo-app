// backend/token-exchange.js
import express from 'express';
import {
  exchangeIdTokenForOfflineToken,
  retireLegacyOfflineToken,
  saveTokenResponse
} from './utils/tokenResolver.js';

const router = express.Router();

/**
 * POST /token-exchange
 * Body: { shop: string, id_token: string }
 */
router.post('/', async (req, res) => {
  try {
    const { shop, id_token } = req.body;
    
    if (!shop || !id_token) {
      return res.status(400).json({ error: 'Missing required parameters: shop and id_token' });
    }

    // One-time: retire any non-expiring token Shopify still holds for this shop (saves an
    // expiring pair). Otherwise request a fresh EXPIRING offline token.
    let accessToken = await retireLegacyOfflineToken(shop, id_token);
    if (!accessToken) {
      let tokenData;
      try {
        tokenData = await exchangeIdTokenForOfflineToken(shop, id_token);
      } catch (exchangeError) {
        console.error('[TOKEN_EXCHANGE] Failed:', exchangeError.status, exchangeError.message);
        return res.status(exchangeError.status || 500).json({ error: 'Token exchange failed', details: exchangeError.message });
      }
      try {
        accessToken = await saveTokenResponse(shop, tokenData, { useJWT: true, installedAt: new Date() });
      } catch (dbError) {
        console.error(`❌ Failed to save token to database for ${shop}:`, dbError);
        throw new Error(`Database save failed: ${dbError.message}`);
      }
    }

    // Регистрирай webhook-ите след успешното запазване на токена
    try {
      const { registerAllWebhooks } = await import('./utils/webhookRegistration.js');
      const mockReq = {
        session: { accessToken },
        shopDomain: shop
      };
      await registerAllWebhooks(mockReq, shop, process.env.APP_URL);
    } catch (webhookError) {
      console.error('[TOKEN_EXCHANGE] Webhook registration failed:', webhookError.message);
      // Не блокираме token exchange-а ако webhook регистрацията се провали
    }

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
