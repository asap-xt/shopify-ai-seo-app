// backend/billing/billingRoutes.js
// Billing routes using ONLY GraphQL Admin API

import express from 'express';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import TokenBalance from '../db/TokenBalance.js';
import { PLANS, TRIAL_DAYS } from '../plans.js';
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
    features.push('All from Starter plus:');
    features.push('AI Bot Access: + Gemini (Google)');
    features.push('Store Metadata for AI Search');
    features.push('AI-enhanced add ons for products (requires tokens)');
    return features;
  }
  
  // Growth - all from Professional plus:
  if (planKey === 'growth') {
    features.push('All from Professional plus:');
    features.push('Collections optimization');
    features.push('AI Bot Access: + ChatGPT');
    features.push('AI Welcome Page');
    features.push('AI-enhanced add ons for Collections (requires tokens)');
    return features;
  }
  
  // Growth Extra - all from Growth plus:
  if (planKey === 'growth extra') {
    features.push('All from Growth plus:');
    features.push('AI-Optimized Sitemap');
    features.push('AI Bot Access: + Perplexity');
    features.push('AI-enhanced add ons (tokens included)');
    return features;
  }
  
  // Enterprise - all from Growth Extra plus:
  if (planKey === 'enterprise') {
    features.push('All from Growth Extra plus:');
    features.push('Advanced Schema Data');
    features.push('AI Bot Access: + Deepseek, Bytespider & others');
    return features;
  }
  
  return features;
}

/**
 * Get billing info for current shop
 * GET /api/billing/info?shop={shop}
 */
router.get('/info', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    
    const subscription = await Subscription.findOne({ shop });
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    
    const now = new Date();
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt);
    
    res.json({
      subscription: subscription ? {
        plan: subscription.plan,
        status: subscription.status || 'active',
        price: PLANS[subscription.plan]?.priceUsd || 0,
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
          features: getPlanFeatures(key)
        };
      })
    });
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
    
    // Save pending subscription to MongoDB
    const now = new Date();
    const trialEndsAt = trialDays > 0 ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null;
    
    await Subscription.findOneAndUpdate(
      { shop },
      {
        shop,
        plan,
        shopifySubscriptionId: shopifySubscription.id,
        status: 'pending',
        trialEndsAt,
        pendingActivation: true,
        updatedAt: now
      },
      { upsert: true, new: true }
    );
    
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
    
    console.log('[Billing] Callback received:', { shop, plan, charge_id });
    
    if (!shop) {
      return res.status(400).send('Missing shop parameter');
    }
    
    // Update subscription to active
    const subscription = await Subscription.findOneAndUpdate(
      { shop },
      {
        status: 'active',
        pendingActivation: false,
        activatedAt: new Date()
      },
      { new: true }
    );
    
    // Add included tokens for Growth Extra+ plans
    if (subscription) {
      const included = getIncludedTokens(subscription.plan);
      if (included.tokens > 0) {
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        
        // Add included tokens (NOT purchased, just added to balance)
        await tokenBalance.addIncludedTokens(included.tokens, subscription.plan, charge_id || 'included');
        
        console.log('[Billing] Added included tokens:', {
          shop,
          plan: subscription.plan,
          tokens: included.tokens,
          newBalance: tokenBalance.balance
        });
      }
    }
    
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
    
    console.log('[Billing] Token callback received:', { shop, amount, charge_id });
    
    if (!shop || !amount) {
      return res.status(400).send('Missing parameters');
    }
    
    const usdAmount = parseFloat(amount);
    const tokens = TOKEN_CONFIG.calculateTokens(usdAmount);
    
    // Add tokens to balance
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    await tokenBalance.addTokens(usdAmount, tokens, charge_id || 'completed');
    
    console.log('[Billing] Tokens added:', {
      shop,
      amount: usdAmount,
      tokens,
      newBalance: tokenBalance.balance
    });
    
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

