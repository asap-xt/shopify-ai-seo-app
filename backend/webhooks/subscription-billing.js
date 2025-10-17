// backend/webhooks/subscription-billing.js
// Handle Shopify subscription billing cycle events

import TokenBalance from '../db/TokenBalance.js';
import Subscription from '../db/Subscription.js';
import { getIncludedTokens } from '../billing/tokenConfig.js';

/**
 * Handle SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS webhook
 * This fires when a recurring subscription charge is successfully billed
 * We use this to refresh monthly included tokens for Growth Extra & Enterprise
 */
export default async function handleSubscriptionBilling(req, res) {
  try {
    const shop = req.headers['x-shopify-shop-domain'];
    const webhookData = req.body;
    
    console.log('[SUBSCRIPTION-BILLING] Webhook received for:', shop);
    console.log('[SUBSCRIPTION-BILLING] Billing attempt ID:', webhookData?.app_subscription?.id);
    
    if (!shop) {
      console.error('[SUBSCRIPTION-BILLING] No shop domain in webhook headers');
      return res.status(400).json({ error: 'Missing shop domain' });
    }
    
    // Get subscription from DB
    const subscription = await Subscription.findOne({ shop });
    
    if (!subscription) {
      console.warn('[SUBSCRIPTION-BILLING] No subscription found for shop:', shop);
      return res.status(404).json({ error: 'Subscription not found' });
    }
    
    const plan = subscription.plan;
    console.log('[SUBSCRIPTION-BILLING] Shop plan:', plan);
    
    // Check if plan has included tokens (Growth Extra or Enterprise)
    const included = getIncludedTokens(plan);
    
    if (included.tokens > 0) {
      console.log('[SUBSCRIPTION-BILLING] Plan has included tokens:', included.tokens);
      
      // Get or create token balance
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      console.log('[SUBSCRIPTION-BILLING] Current balance before refresh:', {
        balance: tokenBalance.balance,
        totalUsed: tokenBalance.totalUsed,
        totalPurchased: tokenBalance.totalPurchased
      });
      
      // MONTHLY REFRESH LOGIC - SIMPLE:
      // Shopify успешно таксува клиента → нов billing cycle започва
      // 1. Reset balance = included tokens (100M or 300M)
      // 2. Reset totalUsed = 0
      // 3. Any purchased tokens from totalPurchased stay (they never expire)
      
      const currentUsed = tokenBalance.totalUsed;
      
      // Reset to included tokens + any additional purchased tokens
      tokenBalance.balance = included.tokens + (tokenBalance.totalPurchased || 0);
      tokenBalance.totalUsed = 0; // New cycle starts
      
      // Add to usage history for tracking
      tokenBalance.usage.push({
        feature: 'monthly-refresh',
        tokensUsed: -included.tokens, // Negative = added
        metadata: {
          refreshType: 'billing-cycle',
          plan: plan,
          includedTokens: included.tokens,
          previousTotalUsed: currentUsed,
          billingAttemptId: webhookData?.app_subscription?.id,
          purchasedTokensCarriedOver: tokenBalance.totalPurchased || 0
        },
        date: new Date()
      });
      
      await tokenBalance.save();
      
      console.log('[SUBSCRIPTION-BILLING] ✅ Monthly tokens refreshed:', {
        shop,
        plan,
        includedTokens: included.tokens,
        newBalance: tokenBalance.balance,
        totalUsedReset: tokenBalance.totalUsed
      });
    } else {
      console.log('[SUBSCRIPTION-BILLING] Plan has no included tokens, skipping refresh');
    }
    
    // Respond to Shopify immediately (webhooks must respond within 5 seconds)
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('[SUBSCRIPTION-BILLING] Error processing webhook:', error);
    // Still respond 200 to avoid Shopify retries
    res.status(200).json({ success: false, error: error.message });
  }
}

