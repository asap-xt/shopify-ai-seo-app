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
    
    if (!shop || !id_token) {
      return res.status(400).json({ error: 'Missing required parameters: shop and id_token' });
    }

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
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token', // SHOPIFY-специфичен!
        expiring: '1' // Request an EXPIRING offline token (non-expiring tokens are deprecated by Shopify)
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TOKEN_EXCHANGE] Failed:', response.status, errorText);
      return res.status(response.status).json({ error: 'Token exchange failed', details: errorText });
    }

    const tokenData = await response.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error('No access_token in response');
    }

    // Build update, including expiring-token fields when Shopify returns them.
    const now = Date.now();
    const tokenUpdate = {
      shop,
      accessToken,
      appApiKey: process.env.SHOPIFY_API_KEY,
      useJWT: true,
      needsTokenExchange: false,
      installedAt: new Date(),
      updatedAt: new Date()
    };
    if (tokenData.expires_in) {
      tokenUpdate.tokenExpiresAt = new Date(now + Number(tokenData.expires_in) * 1000);
    }
    if (tokenData.refresh_token) {
      tokenUpdate.refreshToken = tokenData.refresh_token;
    }
    if (tokenData.refresh_token_expires_in) {
      tokenUpdate.refreshTokenExpiresAt = new Date(now + Number(tokenData.refresh_token_expires_in) * 1000);
    }

    // Запази в базата данни
    try {
      await Shop.findOneAndUpdate(
        { shop },
        tokenUpdate,
        { upsert: true, new: true }
      );
      
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
    } catch (dbError) {
      console.error(`❌ Failed to save token to database for ${shop}:`, dbError);
      throw new Error(`Database save failed: ${dbError.message}`);
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
