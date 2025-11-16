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
    // Shopify sends data in app_subscription object
    const appSubscription = webhookData.app_subscription || webhookData;
    const {
      admin_graphql_api_id,
      name,
      status,
      test,
      trial_days
    } = appSubscription;
    
    console.log('[SUBSCRIPTION-UPDATE] Status:', status, '| Test:', test, '| Trial:', trial_days);
    console.log('[SUBSCRIPTION-UPDATE] Admin GraphQL API ID:', admin_graphql_api_id);
    
    // Find subscription in our DB
    // First try to find by shopifySubscriptionId (normal case)
    let subscription = await Subscription.findOne({ 
      shop, 
      shopifySubscriptionId: admin_graphql_api_id 
    });
    
    // If not found, try to find by shop + pendingActivation or pendingPlan
    // This handles cases where:
    // 1. Webhook arrives before shopifySubscriptionId is saved (race condition)
    // 2. User clicked "back" and subscription was cancelled/declined
    // 3. shopifySubscriptionId doesn't match (shouldn't happen, but safety net)
    if (!subscription) {
      console.log('[SUBSCRIPTION-UPDATE] Subscription not found by ID, trying to find by shop + pendingActivation or pendingPlan');
      
      // Try pendingActivation first (for /activate endpoint)
      subscription = await Subscription.findOne({ 
        shop, 
        pendingActivation: true 
      });
      
      // If not found, try pendingPlan (for /subscribe endpoint)
      if (!subscription) {
        subscription = await Subscription.findOne({ 
          shop, 
          pendingPlan: { $exists: true, $ne: null }
        });
      }
      
      if (subscription) {
        console.log('[SUBSCRIPTION-UPDATE] Found subscription by shop + pendingActivation/pendingPlan:', {
          shop,
          plan: subscription.plan,
          pendingPlan: subscription.pendingPlan,
          shopifySubscriptionId: subscription.shopifySubscriptionId,
          webhookSubscriptionId: admin_graphql_api_id,
          status
        });
        
        // CRITICAL: Update shopifySubscriptionId if it doesn't match
        // This handles race condition where webhook arrives before MongoDB update
        if (subscription.shopifySubscriptionId !== admin_graphql_api_id) {
          console.log('[SUBSCRIPTION-UPDATE] Updating shopifySubscriptionId to match webhook:', {
            old: subscription.shopifySubscriptionId,
            new: admin_graphql_api_id
          });
          subscription.shopifySubscriptionId = admin_graphql_api_id;
        }
      }
    }
    
    if (!subscription) {
      console.warn('[SUBSCRIPTION-UPDATE] Subscription not found in DB:', {
        shop,
        shopifySubscriptionId: admin_graphql_api_id,
        status
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
      // CRITICAL: Activate if:
      // 1. pendingActivation is true (user approved via /activate endpoint)
      // 2. OR pendingPlan exists (user approved via /subscribe endpoint)
      // 3. OR activatedAt is not set yet (callback might not have run yet, but webhook confirms activation)
      // This handles race conditions where webhook arrives before or after callback
      const shouldActivate = subscription.pendingActivation || subscription.pendingPlan || !subscription.activatedAt;
      
      if (!shouldActivate) {
        console.log('[SUBSCRIPTION-UPDATE] ⚠️ Webhook ACTIVE but subscription already activated - just updating status:', {
          shop,
          plan: subscription.plan,
          shopifySubscriptionId: subscription.shopifySubscriptionId,
          activatedAt: subscription.activatedAt
        });
        // Just update status, but don't activate (already activated)
        subscription.status = 'active';
        await subscription.save();
        return res.status(200).json({ success: true, skipped: 'already activated' });
      }
      
      console.log('[SUBSCRIPTION-UPDATE] 🎉 Activating subscription for:', shop);
      
      // Update subscription to active
      subscription.status = 'active';
      subscription.pendingActivation = false;
      subscription.activatedAt = new Date();
      
      // CRITICAL: If pendingPlan exists, activate it now (user approved via /subscribe)
      if (subscription.pendingPlan) {
        subscription.plan = subscription.pendingPlan;
        subscription.pendingPlan = null; // Clear pending
        console.log('[SUBSCRIPTION-UPDATE] Activated pendingPlan:', subscription.plan);
      }
      
      await subscription.save();
      
      // Set included tokens for the plan (replaces old, keeps purchased)
      const included = getIncludedTokens(subscription.plan);
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      console.log('[SUBSCRIPTION-UPDATE] Current token balance:', {
        balance: tokenBalance.balance,
        totalPurchased: tokenBalance.totalPurchased,
        totalUsed: tokenBalance.totalUsed
      });
      
      // Use setIncludedTokens to replace old included tokens (keeps purchased)
      await tokenBalance.setIncludedTokens(
        included.tokens, 
        subscription.plan, 
        admin_graphql_api_id
      );
      
      console.log('[SUBSCRIPTION-UPDATE] ✅ Set included tokens:', {
        shop,
        plan: subscription.plan,
        includedTokens: included.tokens,
        newBalance: tokenBalance.balance
      });
      
    } else if (status === 'CANCELLED' || status === 'DECLINED') {
      // ❌ Subscription cancelled/declined by merchant or Shopify (or user clicked "back" without approving)
      console.log('[SUBSCRIPTION-UPDATE] ❌ Subscription cancelled/declined for:', shop);
      
      // CRITICAL: Only clear pendingActivation if shopifySubscriptionId matches
      // This prevents clearing pendingActivation for a NEW subscription when an OLD one is cancelled
      // When /activate is called, a new subscription is created, and the old one is cancelled
      // We should only clear pendingActivation if the cancelled subscription matches the current one
      const subscriptionIdMatches = subscription.shopifySubscriptionId === admin_graphql_api_id;
      
      // CRITICAL: If pendingActivation is true AND subscriptionId matches, user clicked "back" without approving
      // In this case, DON'T change status - just clear pendingActivation and activatedAt
      // This keeps the previous plan (starter/trial) visible to the user
      if (subscription.pendingActivation && subscriptionIdMatches) {
        console.log('[SUBSCRIPTION-UPDATE] User clicked "back" - clearing pending activation but keeping previous plan status');
        subscription.pendingPlan = null; // Clear pending plan (user didn't approve)
        subscription.pendingActivation = false; // CRITICAL: Clear pending activation flag
        subscription.activatedAt = undefined; // CRITICAL: Clear activatedAt if it was set
        // DON'T change status - keep previous plan (starter/trial)
        await subscription.save();
        console.log('[SUBSCRIPTION-UPDATE] ✅ Cleared pending activation, kept previous plan:', subscription.plan, 'status:', subscription.status);
      } else if (subscription.pendingActivation && !subscriptionIdMatches) {
        // This is a CANCELLED webhook for an OLD subscription, but we have a NEW one pending
        // Don't clear pendingActivation - it's for a different subscription!
        console.log('[SUBSCRIPTION-UPDATE] ⚠️ CANCELLED webhook for old subscription, but new subscription is pending. Ignoring.');
        // Just update the shopifySubscriptionId if it was updated by fallback search
        if (subscription.shopifySubscriptionId !== admin_graphql_api_id) {
          // This shouldn't happen, but if it does, we already updated it in the fallback search
          await subscription.save();
        }
      } else {
        // Subscription was active and now cancelled by merchant
        console.log('[SUBSCRIPTION-UPDATE] Active subscription cancelled by merchant');
        subscription.status = 'cancelled';
        subscription.cancelledAt = new Date();
        subscription.pendingPlan = null;
        subscription.pendingActivation = false;
        subscription.activatedAt = undefined;
        await subscription.save();
        console.log('[SUBSCRIPTION-UPDATE] ✅ Subscription cancelled');
      }
      
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

