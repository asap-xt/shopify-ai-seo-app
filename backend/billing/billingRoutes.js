// backend/billing/billingRoutes.js
// Billing routes using ONLY GraphQL Admin API

import express from 'express';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import TokenBalance from '../db/TokenBalance.js';
import { PLANS, TRIAL_DAYS } from '../plans.js';
import { withShopCache, CACHE_TTL } from '../utils/cacheWrapper.js';
import cacheService from '../services/cacheService.js';
import { 
  TOKEN_CONFIG, 
  getIncludedTokens,
  calculateFeatureCost,
  requiresTokens,
  TRIAL_BLOCKED_FEATURES
} from './tokenConfig.js';
import { 
  createSubscription, 
  purchaseTokens, 
  getCurrentSubscription,
  cancelSubscription 
} from './shopifyBilling.js';
import { verifyRequest } from '../middleware/verifyRequest.js';

const router = express.Router();

// Helper: Get badge text for a plan
function getPlanBadge(planKey) {
  const badges = {
    'starter': 'Best for: Boutique stores & new brands',
    'professional': 'Best for: Growing stores ready to scale',
    'professional plus': 'Best for: Stores unlocking full AI discovery',
    'growth': 'RECOMMENDED - Best value for expansion',
    'growth plus': 'Best for: Advanced AI-driven commerce',
    'growth extra': 'Best for: Large catalogs & multilingual stores',
    'enterprise': 'Best for: Global AI-powered reach'
  };
  return badges[planKey] || null;
}

// Helper: Get features for a plan
function getPlanFeatures(planKey) {
  const features = [];
  
  // Starter plan - base features
  if (planKey === 'starter') {
    features.push('Product Optimization for AI');
    features.push('AI Bot Access: Meta AI + Anthropic (Claude)');
    features.push('Sitemap generation');
    return features;
  }
  
  // Professional - all from Starter plus:
  if (planKey === 'professional') {
    features.push('All from Starter plus');
    features.push('Pay-per-use tokens');
    features.push('AI Bot Access: + Gemini (Google)');
    features.push('AI-enhanced add-ons for products (pay-per-use tokens required)');
    return features;
  }
  
  // Professional Plus - all from Professional plus:
  if (planKey === 'professional plus') {
    features.push('All from Professional plus');
    features.push('🔓 All AI Discovery features unlocked with pay-per-use tokens');
    features.push('AI Welcome Page (pay-per-use tokens)');
    features.push('Collections JSON Feed (pay-per-use tokens)');
    features.push('AI-Optimized Sitemap (pay-per-use tokens)');
    features.push('Store Metadata (pay-per-use tokens)');
    features.push('Advanced Schema Data (pay-per-use tokens)');
    return features;
  }
  
  // Growth - all from Professional plus:
  if (planKey === 'growth') {
    features.push('All from Professional plus');
    features.push('Collections optimization');
    features.push('AI Bot Access: + ChatGPT');
    features.push('AI Welcome Page (included)');
    features.push('Collections JSON Feed (included)');
    features.push('AI-enhanced add-ons for Collections (pay-per-use tokens required)');
    return features;
  }
  
  // Growth Plus - all from Growth plus:
  if (planKey === 'growth plus') {
    features.push('All from Growth plus');
    features.push('🔓 All AI Discovery features unlocked with pay-per-use tokens');
    features.push('AI-Optimized Sitemap (pay-per-use tokens)');
    features.push('Store Metadata (pay-per-use tokens)');
    features.push('Advanced Schema Data (pay-per-use tokens)');
    return features;
  }
  
  // Growth Extra - all from Growth plus:
  if (planKey === 'growth extra') {
    features.push('All from Growth plus');
    features.push('✓ 100M monthly tokens');
    features.push('AI-Optimized Sitemap');
    features.push('AI Bot Access: + Perplexity');
    features.push('AI-enhanced add-ons at no extra cost');
    return features;
  }
  
  // Enterprise - all from Growth Extra plus:
  if (planKey === 'enterprise') {
    features.push('All from Growth Extra plus');
    features.push('✓ 300M monthly tokens');
    features.push('Advanced Schema Data');
    features.push('AI Bot Access: + Deepseek, Bytespider & others');
    return features;
  }
  
  return features;
}

/**
 * DEBUG: Get full subscription and token data
 * GET /api/billing/debug?shop={shop}
 */
router.get('/debug', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    const subscription = await Subscription.findOne({ shop });
    const tokenBalance = await TokenBalance.findOne({ shop });
    
    res.json({
      shop,
      subscription: subscription ? subscription.toObject() : null,
      tokenBalance: tokenBalance ? tokenBalance.toObject() : null,
      includedTokensForPlan: subscription ? getIncludedTokens(subscription.plan) : null
    });
  } catch (error) {
    console.error('[Billing Debug] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DEBUG: Reset token balance (for development only)
 * GET /billing/debug/reset-tokens?shop={shop}
 * WARNING: No auth for easier testing - remove in production!
 */
router.get('/debug/reset-tokens', async (req, res) => {
  try {
    const shop = req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }
    
    // Delete and recreate token balance
    const deleted = await TokenBalance.deleteOne({ shop });
    const newBalance = await TokenBalance.getOrCreate(shop);
    
    res.json({
      success: true,
      message: 'Token balance reset',
      shop,
      deletedCount: deleted.deletedCount,
      newBalance: {
        balance: newBalance.balance,
        totalPurchased: newBalance.totalPurchased,
        totalUsed: newBalance.totalUsed
      }
    });
  } catch (error) {
    console.error('[Billing Debug] Error resetting tokens:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get billing info for current shop
 * GET /api/billing/info?shop={shop}
 */
router.get('/info', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    // Cache billing info for 5 minutes (PHASE 3: Caching)
    const billingInfo = await withShopCache(shop, 'billing:info', CACHE_TTL.SHORT, async () => {
      const subscription = await Subscription.findOne({ shop });
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      const now = new Date();
      const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
      
      // Note: subscription.price is now a virtual property that auto-computes from plans.js
      
      return {
        subscription: subscription ? {
          plan: subscription.plan,
          status: subscription.status || 'active',
          price: subscription.price, // Virtual property from Subscription model
          trialEndsAt: subscription.trialEndsAt,
          inTrial,
          shopifySubscriptionId: subscription.shopifySubscriptionId
        } : null,
        tokens: {
          balance: tokenBalance.balance,
          totalPurchased: tokenBalance.totalPurchased,
          totalUsed: tokenBalance.totalUsed,
          lastPurchase: tokenBalance.lastPurchase
        },
        plans: Object.keys(PLANS).map(key => {
          const included = getIncludedTokens(key);
          return {
            key,
            name: PLANS[key].name,
            price: PLANS[key].priceUsd,
            productLimit: PLANS[key].productLimit,
            queryLimit: PLANS[key].queryLimit,
            providersAllowed: PLANS[key].providersAllowed?.length || 0,
            languageLimit: PLANS[key].languageLimit || 1,
            includedTokens: included.tokens || 0,
            badge: getPlanBadge(key),
            features: getPlanFeatures(key)
          };
        })
      };
    });
    
    res.json(billingInfo);
  } catch (error) {
    console.error('[Billing] Error getting info:', error);
    res.status(500).json({ error: 'Failed to get billing info' });
  }
});

/**
 * Create/activate subscription
 * POST /api/billing/subscribe
 * Body: { plan: 'professional', endTrial: false }
 */
router.post('/subscribe', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { plan, endTrial } = req.body;
    
    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    
    // Get shop access token
    const shopDoc = await Shop.findOne({ shop });
    if (!shopDoc || !shopDoc.accessToken) {
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    // Create subscription with Shopify
    const trialDays = endTrial ? 0 : TRIAL_DAYS;
    const { confirmationUrl, subscription: shopifySubscription } = await createSubscription(
      shop,
      plan,
      shopDoc.accessToken,
      { trialDays }
    );
    
    // Save subscription to MongoDB
    const now = new Date();
    const trialEndsAt = trialDays > 0 ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null;
    
    // TEST MODE DETECTION:
    // - Shopify subscriptions created with test:true should activate immediately
    // - For Railway/dev environments, always activate immediately for convenience
    const isTestMode = shopifySubscription.test === true;
    
    // In TEST MODE: Activate immediately for development convenience
    // In PRODUCTION: Wait for APP_SUBSCRIPTIONS_UPDATE webhook to confirm payment
    const initialStatus = isTestMode ? 'active' : 'pending';
    
    // CRITICAL: Get existing subscription to preserve current plan if exists
    const existingSub = await Subscription.findOne({ shop });
    
    // LOGIC:
    // - If new subscription (no existing): plan = plan (first install)
    // - If upgrade/downgrade: pendingPlan = new plan, plan = old plan (until approval)
    const updateData = {
      shop,
      shopifySubscriptionId: shopifySubscription.id,
      status: initialStatus,
      trialEndsAt,
      pendingActivation: !isTestMode,
      activatedAt: isTestMode ? now : null,
      updatedAt: now
    };
    
    if (existingSub) {
      // Plan change: Keep old plan, set new plan as pending
      updateData.pendingPlan = plan;
      // Don't update 'plan' field - it stays as old plan until approval
    } else {
      // First install: Set plan immediately
      updateData.plan = plan;
      updateData.pendingPlan = null;
    }
    
    const subscription = await Subscription.findOneAndUpdate(
      { shop },
      updateData,
      { upsert: true, new: true }
    );
    
    // Invalidate cache after subscription change (PHASE 3: Caching)
    await cacheService.invalidateShop(shop);
    
    // In TEST MODE: Set included tokens immediately ONLY for new subscriptions
    // For plan changes, tokens are set in callback after approval
    if (isTestMode && !existingSub) {
      const included = getIncludedTokens(subscription.plan);
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      // Use setIncludedTokens instead of addIncludedTokens to avoid accumulation
      await tokenBalance.setIncludedTokens(
        included.tokens, 
        subscription.plan, 
        shopifySubscription.id
      );
    }
    
    res.json({
      confirmationUrl,
      subscriptionId: shopifySubscription.id,
      message: 'Redirecting to Shopify for approval...'
    });
  } catch (error) {
    console.error('[Billing] Error creating subscription:', error);
    res.status(500).json({ error: error.message || 'Failed to create subscription' });
  }
});

/**
 * Callback after subscription approval
 * GET /billing/callback?shop={shop}&plan={plan}&charge_id={id}
 */
router.get('/callback', async (req, res) => {
  try {
    const { shop, plan, charge_id } = req.query;
    
    if (!shop) {
      return res.status(400).send('Missing shop parameter');
    }
    
    // CRITICAL FIX: Activate pending plan (if user approved subscription)
    // Get current subscription to check for pendingPlan
    const currentSub = await Subscription.findOne({ shop });
    
    const updateData = {
      status: 'active',
      pendingActivation: false,
      activatedAt: new Date()
    };
    
    // If there's a pendingPlan, activate it now (user approved!)
    if (currentSub?.pendingPlan) {
      updateData.plan = currentSub.pendingPlan;
      updateData.pendingPlan = null; // Clear pending
    } else if (plan && PLANS[plan]) {
      // Fallback: If plan is provided in callback, ensure it's updated
      updateData.plan = plan;
    }
    
    const subscription = await Subscription.findOneAndUpdate(
      { shop },
      updateData,
      { new: true }
    );
    
    // Invalidate cache after subscription change (PHASE 3: Caching)
    await cacheService.invalidateShop(shop);
    
    // If plan was activated (pendingPlan → plan), set included tokens
    if (currentSub?.pendingPlan && subscription.plan) {
      const included = getIncludedTokens(subscription.plan);
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      // Use setIncludedTokens to replace old included tokens (keeps purchased)
      await tokenBalance.setIncludedTokens(
        included.tokens, 
        subscription.plan, 
        subscription.shopifySubscriptionId
      );
    }
    
    // NOTE: For production mode (real webhooks), tokens would also be added by APP_SUBSCRIPTIONS_UPDATE webhook
    // This callback handles test mode and user-approved subscriptions
    
    // Redirect back to app
    res.redirect(`/apps/new-ai-seo/billing?shop=${shop}&success=true`);
  } catch (error) {
    console.error('[Billing] Callback error:', error);
    res.status(500).send('Failed to process subscription');
  }
});

/**
 * Purchase tokens
 * POST /api/billing/tokens/purchase
 * Body: { amount: 10 }
 */
router.post('/tokens/purchase', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { amount } = req.body;
    
    const usdAmount = parseFloat(amount);
    
    if (isNaN(usdAmount) || !TOKEN_CONFIG.isValidAmount(usdAmount)) {
      return res.status(400).json({
        error: `Invalid amount. Must be between $${TOKEN_CONFIG.minimumPurchase} and $${TOKEN_CONFIG.maximumPurchase}, in increments of $${TOKEN_CONFIG.increment}`
      });
    }
    
    // Get shop access token
    const shopDoc = await Shop.findOne({ shop });
    if (!shopDoc || !shopDoc.accessToken) {
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    // Create token purchase with Shopify
    const { confirmationUrl, charge, tokens } = await purchaseTokens(
      shop,
      usdAmount,
      shopDoc.accessToken
    );
    
    // Save pending purchase
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    tokenBalance.purchases.push({
      usdAmount,
      appRevenue: usdAmount * TOKEN_CONFIG.appRevenuePercent,
      tokenBudget: usdAmount * TOKEN_CONFIG.tokenBudgetPercent,
      tokensReceived: tokens,
      shopifyChargeId: charge.id,
      status: 'pending',
      date: new Date()
    });
    await tokenBalance.save();
    
    res.json({
      confirmationUrl,
      chargeId: charge.id,
      tokens,
      message: 'Redirecting to Shopify for approval...'
    });
  } catch (error) {
    console.error('[Billing] Error purchasing tokens:', error);
    res.status(500).json({ error: error.message || 'Failed to purchase tokens' });
  }
});

/**
 * Callback after token purchase approval
 * GET /billing/tokens/callback?shop={shop}&amount={amount}&charge_id={id}
 */
router.get('/tokens/callback', async (req, res) => {
  try {
    const { shop, amount, charge_id } = req.query;
    
    if (!shop || !amount) {
      return res.status(400).send('Missing parameters');
    }
    
    const usdAmount = parseFloat(amount);
    // Use dynamic pricing from OpenRouter to calculate accurate token count
    const { calculateTokensWithDynamicPricing } = await import('./tokenConfig.js');
    const tokens = await calculateTokensWithDynamicPricing(usdAmount);
    
    // Add tokens to balance
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    await tokenBalance.addTokens(usdAmount, tokens, charge_id || 'completed');
    
    // CRITICAL: Invalidate cache so new token balance is immediately visible
    await cacheService.invalidateShop(shop);
    
    // Redirect back to app
    res.redirect(`/apps/new-ai-seo/billing?shop=${shop}&tokens_purchased=true&amount=${tokens}`);
  } catch (error) {
    console.error('[Billing] Token callback error:', error);
    res.status(500).send('Failed to process token purchase');
  }
});

/**
 * Get token balance
 * GET /api/billing/tokens/balance?shop={shop}
 */
router.get('/tokens/balance', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    
    res.json({
      balance: tokenBalance.balance,
      totalPurchased: tokenBalance.totalPurchased,
      totalUsed: tokenBalance.totalUsed,
      lastPurchase: tokenBalance.lastPurchase,
      recentUsage: tokenBalance.usage.slice(-10).reverse() // Last 10 uses
    });
  } catch (error) {
    console.error('[Billing] Error getting token balance:', error);
    res.status(500).json({ error: 'Failed to get token balance' });
  }
});

/**
 * Get purchase history
 * GET /api/billing/history?shop={shop}
 */
router.get('/history', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    const tokenBalance = await TokenBalance.findOne({ shop });
    
    if (!tokenBalance) {
      return res.json({ purchases: [], usage: [] });
    }
    
    res.json({
      purchases: tokenBalance.purchases.slice().reverse(), // Most recent first
      usage: tokenBalance.usage.slice(-50).reverse() // Last 50 uses
    });
  } catch (error) {
    console.error('[Billing] Error getting history:', error);
    res.status(500).json({ error: 'Failed to get billing history' });
  }
});

/**
 * Check feature access (trial + token validation)
 * POST /api/billing/check-feature-access
 * Body: { feature: 'ai-seo-product-basic', options: {} }
 */
router.post('/check-feature-access', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { feature, options = {} } = req.body;
    
    if (!feature) {
      return res.status(400).json({ error: 'Feature parameter required' });
    }
    
    // Get subscription and check trial status
    const subscription = await Subscription.findOne({ shop });
    const now = new Date();
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
    
    // If in trial and feature is blocked, return restriction
    if (inTrial && TRIAL_BLOCKED_FEATURES.includes(feature)) {
      return res.status(402).json({
        error: 'Feature not available during trial',
        trialRestriction: true,
        requiresActivation: true,
        trialEndsAt: subscription.trialEndsAt,
        currentPlan: subscription.plan,
        feature,
        message: 'This AI-enhanced feature requires plan activation or token purchase'
      });
    }
    
    // Check if feature requires tokens
    if (!requiresTokens(feature)) {
      return res.json({ allowed: true, message: 'Feature does not require tokens' });
    }
    
    // Get token balance and calculate required tokens
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    const requiredTokens = calculateFeatureCost(feature, options);
    
    // Check if sufficient balance
    if (!tokenBalance.hasBalance(requiredTokens)) {
      return res.status(402).json({
        error: 'Insufficient token balance',
        requiresPurchase: true,
        tokensRequired: requiredTokens,
        tokensAvailable: tokenBalance.balance,
        tokensNeeded: requiredTokens - tokenBalance.balance,
        feature,
        message: 'You need more tokens to use this feature'
      });
    }
    
    // All checks passed
    res.json({
      allowed: true,
      tokensRequired: requiredTokens,
      tokensAvailable: tokenBalance.balance,
      message: 'Feature access granted'
    });
  } catch (error) {
    console.error('[Billing] Error checking feature access:', error);
    res.status(500).json({ error: 'Failed to check feature access' });
  }
});

/**
 * Cancel subscription
 * POST /api/billing/cancel
 */
router.post('/cancel', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    const subscription = await Subscription.findOne({ shop });
    if (!subscription || !subscription.shopifySubscriptionId) {
      return res.status(404).json({ error: 'No active subscription' });
    }
    
    // Get shop access token
    const shopDoc = await Shop.findOne({ shop });
    if (!shopDoc || !shopDoc.accessToken) {
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    // Cancel with Shopify
    const success = await cancelSubscription(
      shop,
      subscription.shopifySubscriptionId,
      shopDoc.accessToken
    );
    
    if (!success) {
      return res.status(500).json({ error: 'Failed to cancel subscription' });
    }
    
    // Update MongoDB
    await Subscription.findOneAndUpdate(
      { shop },
      {
        status: 'cancelled',
        cancelledAt: new Date()
      }
    );
    
    res.json({
      success: true,
      message: 'Subscription cancelled. Access remains until end of billing period.'
    });
  } catch (error) {
    console.error('[Billing] Error cancelling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

export default router;

