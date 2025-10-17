// backend/webhooks/subscription-update.js
// Handle APP_SUBSCRIPTIONS_UPDATE webhook
// This fires when subscription status changes (PENDING → ACTIVE, ACTIVE → CANCELLED, etc.)

import Subscription from '../db/Subscription.js';
import TokenBalance from '../db/TokenBalance.js';
import { getIncludedTokens } from '../billing/tokenConfig.js';

/**
 * Handle APP_SUBSCRIPTIONS_UPDATE webhook
 * This is the SECURE way to activate subscriptions and add included tokens
 * Only when Shopify confirms payment (status = ACTIVE)
 */
export default async function handleSubscriptionUpdate(req, res) {
  try {
    const shop = req.headers['x-shopify-shop-domain'];
    const webhookData = req.body;
    
    console.log('[SUBSCRIPTION-UPDATE] Webhook received for:', shop);
    console.log('[SUBSCRIPTION-UPDATE] Subscription data:', JSON.stringify(webhookData, null, 2));
    
    if (!shop) {
      console.error('[SUBSCRIPTION-UPDATE] No shop domain in webhook headers');
      return res.status(400).json({ error: 'Missing shop domain' });
    }
    
    // Extract subscription details from webhook
    const {
      admin_graphql_api_id,
      name,
      status,
      test,
      trial_days
    } = webhookData;
    
    console.log('[SUBSCRIPTION-UPDATE] Status:', status, '| Test:', test, '| Trial:', trial_days);
    
    // Find subscription in our DB
    const subscription = await Subscription.findOne({ 
      shop, 
      shopifySubscriptionId: admin_graphql_api_id 
    });
    
    if (!subscription) {
      console.warn('[SUBSCRIPTION-UPDATE] Subscription not found in DB:', {
        shop,
        shopifySubscriptionId: admin_graphql_api_id
      });
      // Respond 200 to avoid retries
      return res.status(200).json({ success: false, error: 'Subscription not found' });
    }
    
    console.log('[SUBSCRIPTION-UPDATE] Found subscription:', {
      shop,
      plan: subscription.plan,
      currentStatus: subscription.status,
      newStatus: status
    });
    
    // Handle status transitions
    if (status === 'ACTIVE' && subscription.status !== 'active') {
      // 🎉 SUBSCRIPTION ACTIVATED - Shopify confirmed payment!
      console.log('[SUBSCRIPTION-UPDATE] 🎉 Activating subscription for:', shop);
      
      // Update subscription to active
      subscription.status = 'active';
      subscription.pendingActivation = false;
      subscription.activatedAt = new Date();
      await subscription.save();
      
      // Add included tokens for Growth Extra & Enterprise plans
      const included = getIncludedTokens(subscription.plan);
      
      if (included.tokens > 0) {
        console.log('[SUBSCRIPTION-UPDATE] Plan has included tokens:', included.tokens);
        
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        
        console.log('[SUBSCRIPTION-UPDATE] Current token balance:', {
          balance: tokenBalance.balance,
          totalPurchased: tokenBalance.totalPurchased,
          totalUsed: tokenBalance.totalUsed
        });
        
        // Add included tokens (this is the FIRST time for this billing cycle)
        await tokenBalance.addIncludedTokens(
          included.tokens, 
          subscription.plan, 
          admin_graphql_api_id
        );
        
        console.log('[SUBSCRIPTION-UPDATE] ✅ Added included tokens:', {
          shop,
          plan: subscription.plan,
          tokensAdded: included.tokens,
          newBalance: tokenBalance.balance
        });
      } else {
        console.log('[SUBSCRIPTION-UPDATE] Plan has no included tokens (Starter/Professional/Growth)');
      }
      
    } else if (status === 'CANCELLED') {
      // ❌ Subscription cancelled by merchant or Shopify
      console.log('[SUBSCRIPTION-UPDATE] ❌ Subscription cancelled for:', shop);
      
      subscription.status = 'cancelled';
      subscription.cancelledAt = new Date();
      await subscription.save();
      
    } else if (status === 'EXPIRED') {
      // ⏰ Subscription expired (payment failed)
      console.log('[SUBSCRIPTION-UPDATE] ⏰ Subscription expired for:', shop);
      
      subscription.status = 'expired';
      subscription.expiredAt = new Date();
      await subscription.save();
      
    } else if (status === 'PENDING') {
      // ⏳ Still pending approval
      console.log('[SUBSCRIPTION-UPDATE] ⏳ Subscription still pending for:', shop);
      
      subscription.status = 'pending';
      await subscription.save();
      
    } else {
      console.log('[SUBSCRIPTION-UPDATE] Unknown status transition:', {
        from: subscription.status,
        to: status
      });
    }
    
    // Respond to Shopify immediately (webhooks must respond within 5 seconds)
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('[SUBSCRIPTION-UPDATE] Error processing webhook:', error);
    // Still respond 200 to avoid Shopify retries
    res.status(200).json({ success: false, error: error.message });
  }
}

