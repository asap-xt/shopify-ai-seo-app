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
    
    // Find subscription in our DB
    // First try to find by shopifySubscriptionId (normal case)
    // CRITICAL: Use lean() to ensure all fields are returned, especially activatedAt
    let subscription = await Subscription.findOne({ 
      shop, 
      shopifySubscriptionId: admin_graphql_api_id 
    }).lean();
    
    // If not found, try to find by shop + pendingActivation or pendingPlan
    // This handles cases where:
    // 1. Webhook arrives before shopifySubscriptionId is saved (race condition)
    // 2. User clicked "back" and subscription was cancelled/declined
    // 3. shopifySubscriptionId doesn't match (shouldn't happen, but safety net)
    let foundByFallback = false;
    if (!subscription) {
      // CRITICAL FIX: Use lean() to ensure all fields are returned, especially activatedAt
      // This is the root cause - Mongoose might not return all fields without lean()
      // Try pendingActivation first (for /activate endpoint)
      subscription = await Subscription.findOne({ 
        shop, 
        pendingActivation: true 
      }).lean();
      
      // If not found, try pendingPlan (for /subscribe endpoint)
      if (!subscription) {
        subscription = await Subscription.findOne({ 
          shop, 
          pendingPlan: { $exists: true, $ne: null }
        }).lean();
      }
      
      // If still not found, try by shop only (for upgrade after activation)
      // This handles the case where upgrade happens after activation and webhook arrives before callback
      if (!subscription) {
        subscription = await Subscription.findOne({ shop }).lean();
      }
      
      if (subscription) {
        foundByFallback = true; // Mark that subscription was found by fallback search
        
        // CRITICAL: Only update shopifySubscriptionId if:
        // 1. It doesn't match AND
        // 2. This is NOT a CANCELLED webhook for an old subscription when we have a new one pending
        // This prevents overwriting the new subscription ID with an old one
        const hasPendingNewSubscription = subscription.pendingActivation && subscription.shopifySubscriptionId && subscription.shopifySubscriptionId !== admin_graphql_api_id;
        const isCancelledOldSubscription = status === 'CANCELLED' && hasPendingNewSubscription;
        
        if (subscription.shopifySubscriptionId !== admin_graphql_api_id && !isCancelledOldSubscription) {
          subscription.shopifySubscriptionId = admin_graphql_api_id;
        }
      }
    }
    
    if (!subscription) {
      // Respond 200 to avoid retries
      return res.status(200).json({ success: false, error: 'Subscription not found' });
    }
    
    // CRITICAL: Store original activatedAt BEFORE any processing!
    // This is essential to preserve activatedAt during upgrades after activation
    // IMPORTANT: Since we're using lean(), subscription is a plain object, so we can safely access activatedAt
    const originalActivatedAt = subscription.activatedAt;
    const hasBeenActivated = !!originalActivatedAt;
    
    // Handle status transitions
    // CRITICAL: Handle ACTIVE status even if subscription is already 'active'
    // This is needed when subscription.status is 'active' but has pendingPlan or pendingActivation
    if (status === 'ACTIVE') {
      // 🎉 SUBSCRIPTION ACTIVATED - Shopify confirmed payment!
      // CRITICAL: Activate if:
      // 1. pendingActivation is true (user approved via /activate endpoint)
      // 2. OR pendingPlan exists (user approved via /subscribe endpoint)
      // 3. OR activatedAt is not set yet (callback might not have run yet, but webhook confirms activation)
      // This handles race conditions where webhook arrives before or after callback
      // Use originalActivatedAt instead of subscription.activatedAt since we're using lean()
      const shouldActivate = subscription.pendingActivation || subscription.pendingPlan || !originalActivatedAt;
      
      if (!shouldActivate && subscription.status === 'active') {
        // Just update status, but don't activate (already activated)
        await Subscription.findByIdAndUpdate(
          subscription._id,
          { status: 'active', shopifySubscriptionId: admin_graphql_api_id },
          { new: true }
        );
        return res.status(200).json({ success: true, skipped: 'already activated' });
      }
      
      // If subscription.status is not 'active' OR shouldActivate is true, proceed with activation
      
      // CRITICAL: Define now at the start of activation block
      const now = new Date();
      
      // CRITICAL: Store pendingActivation and pendingPlan BEFORE we clear them!
      // This is needed to determine if this is from /activate (end trial) or /subscribe (preserve trial)
      const wasPendingActivation = subscription.pendingActivation;
      const hadPendingPlan = !!subscription.pendingPlan;
      
      // Build update data object
      // CRITICAL: Since we're using lean(), subscription is a plain object, so we use findByIdAndUpdate
      const updateData = {
        status: 'active',
        shopifySubscriptionId: admin_graphql_api_id
      };
      
      // Handle plan change
      if (subscription.pendingPlan) {
        updateData.plan = subscription.pendingPlan;
        updateData.pendingPlan = null;
        console.log('[SUBSCRIPTION-UPDATE] Activating pendingPlan:', subscription.pendingPlan);
      }
      
      // Handle activation
      if (subscription.pendingActivation) {
        updateData.pendingActivation = false;
        
        // Only set activatedAt if this is the first activation
        if (!hasBeenActivated) {
          updateData.activatedAt = now;
          updateData.trialEndsAt = null; // End trial on activation
          console.log('[SUBSCRIPTION-UPDATE] First activation - setting activatedAt');
        }
      }
      
      // CRITICAL: Handle upgrade after activation
      // This is the KEY FIX - preserve originalActivatedAt when it exists
      if (hasBeenActivated) {
        // Preserve the original activation date
        updateData.activatedAt = originalActivatedAt;
        updateData.trialEndsAt = null; // No trial for upgrades after activation
        console.log('[SUBSCRIPTION-UPDATE] Upgrade after activation - preserving activatedAt:', originalActivatedAt);
      } else if (!subscription.pendingActivation && !subscription.trialEndsAt) {
        // Only set trial for brand new subscriptions (not activated, no existing trial)
        const { TRIAL_DAYS } = await import('../plans.js');
        const trialDays = trial_days || TRIAL_DAYS;
        updateData.trialEndsAt = new Date(now.getTime() + (trialDays * 24 * 60 * 60 * 1000));
        console.log('[SUBSCRIPTION-UPDATE] New subscription - setting trial period');
      } else if (subscription.trialEndsAt && !hasBeenActivated) {
        // Preserve existing trial if still in trial period
        updateData.trialEndsAt = subscription.trialEndsAt;
        console.log('[SUBSCRIPTION-UPDATE] Preserving existing trial period');
      }
      
      // CRITICAL: Log update data before applying
      console.log('[SUBSCRIPTION-UPDATE] Trial logic check:', {
        originalActivatedAt,
        hasBeenActivated,
        updateDataActivatedAt: updateData.activatedAt,
        updateDataTrialEndsAt: updateData.trialEndsAt,
        hadPendingPlan,
        wasPendingActivation,
        plan: updateData.plan || subscription.plan
      });
      
      // CRITICAL: Use findByIdAndUpdate since we're using lean() (subscription is plain object)
      const updatedSubscription = await Subscription.findByIdAndUpdate(
        subscription._id,
        updateData,
        { new: true, runValidators: true }
      );
      
      console.log('[SUBSCRIPTION-UPDATE] Updated subscription:', {
        plan: updatedSubscription.plan,
        status: updatedSubscription.status,
        activatedAt: updatedSubscription.activatedAt,
        trialEndsAt: updatedSubscription.trialEndsAt
      });
      
      // Set included tokens for the plan (replaces old, keeps purchased)
      // CRITICAL: Only add included tokens if trial has ended (activatedAt is set and trialEndsAt is null or past)
      // Use updatedSubscription instead of subscription since we've already updated it
      const inTrial = updatedSubscription.trialEndsAt && now < new Date(updatedSubscription.trialEndsAt);
      const isFullyActivated = updatedSubscription.activatedAt && !inTrial;
      
      if (isFullyActivated) {
        // Trial ended and plan is activated → set included tokens (or zero them if plan has none)
        // CRITICAL: Always call setIncludedTokens, even if tokens is 0, to zero out included tokens on downgrade
        const included = getIncludedTokens(updatedSubscription.plan);
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        
        // Use setIncludedTokens to replace old included tokens (keeps purchased)
        // IMPORTANT: This will zero out included tokens if new plan has none (downgrade)
        await tokenBalance.setIncludedTokens(
          included.tokens, 
          updatedSubscription.plan, 
          admin_graphql_api_id
        );
      }
      
    } else if (status === 'CANCELLED' || status === 'DECLINED') {
      // ❌ Subscription cancelled/declined by merchant or Shopify (or user clicked "back" without approving)
      
      // CRITICAL: Only clear pendingActivation if shopifySubscriptionId matches
      // This prevents clearing pendingActivation for a NEW subscription when an OLD one is cancelled
      // When /activate is called, a new subscription is created, and the old one is cancelled
      // We should only clear pendingActivation if the cancelled subscription matches the current one
      const subscriptionIdMatches = subscription.shopifySubscriptionId === admin_graphql_api_id;
      
      // CRITICAL: If pendingActivation OR pendingPlan exists AND subscriptionId matches, user clicked "back" without approving
      const hasPendingState = subscription.pendingActivation || subscription.pendingPlan;
      const shouldClearPending = subscriptionIdMatches; // CRITICAL: Only clear if IDs match!
      
      if (hasPendingState && shouldClearPending) {
        console.log('[SUBSCRIPTION-UPDATE] User clicked "back" - clearing pending state but keeping previous plan status');
        const updateData = {
          pendingPlan: null,
          pendingActivation: false
        };
        
        // CRITICAL: Preserve activatedAt even when cancelled (if it was set before)
        // IMPORTANT: Only clear activatedAt if this is a first install that wasn't approved
        if (originalActivatedAt) {
          updateData.activatedAt = originalActivatedAt;
        } else if (subscription.status === 'pending') {
          // First install that wasn't approved - clear activatedAt and trialEndsAt
          updateData.activatedAt = undefined;
          updateData.trialEndsAt = undefined;
        }
        
        // DON'T change status - keep previous plan (starter/trial)
        await Subscription.findByIdAndUpdate(subscription._id, updateData, { new: true });
      } else if (hasPendingState && !subscriptionIdMatches) {
        // This is a CANCELLED webhook for an OLD subscription
        // CRITICAL: When /activate is called, old subscription is cancelled and new one is created
        // The new subscription has a NEW shopifySubscriptionId, so subscriptionIdMatches is false
        // We should NOT clear pendingActivation here - it's for the NEW subscription, not the old one!
        // DON'T clear pendingActivation - it's for the NEW subscription that's waiting for approval
      } else {
        // Subscription was active and now cancelled by merchant
        const updateData = {
          status: 'cancelled',
          cancelledAt: new Date(),
          pendingPlan: null,
          pendingActivation: false
        };
        
        // IMPORTANT: Preserve activatedAt even when cancelled (if it was set before)
        if (originalActivatedAt) {
          updateData.activatedAt = originalActivatedAt;
        } else {
          updateData.activatedAt = undefined;
        }
        
        await Subscription.findByIdAndUpdate(subscription._id, updateData, { new: true });
      }
      
    } else if (status === 'EXPIRED') {
      // ⏰ Subscription expired (payment failed)
      const updateData = {
        status: 'expired',
        expiredAt: new Date()
      };
      
      // IMPORTANT: Preserve activatedAt even when expired (if it was set before)
      if (originalActivatedAt) {
        updateData.activatedAt = originalActivatedAt;
      }
      
      await Subscription.findByIdAndUpdate(subscription._id, updateData, { new: true });
      
    } else if (status === 'PENDING') {
      // ⏳ Still pending approval
      const updateData = {
        status: 'pending'
      };
      
      // IMPORTANT: Preserve activatedAt even when pending (if it was set before)
      if (originalActivatedAt) {
        updateData.activatedAt = originalActivatedAt;
      }
      
      await Subscription.findByIdAndUpdate(subscription._id, updateData, { new: true });
    }
    
    // Respond to Shopify immediately (webhooks must respond within 5 seconds)
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('[SUBSCRIPTION-UPDATE] Error processing webhook:', error);
    // Still respond 200 to avoid Shopify retries
    res.status(200).json({ success: false, error: error.message });
  }
}

