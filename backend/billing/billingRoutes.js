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
  
  // Professional - updated features:
  if (planKey === 'professional') {
    features.push('Product Optimization for AI search');
    features.push('Sitemap generation');
    features.push('AI Bot Access: Meta AI, Claude (Anthropic), Gemini (Google)');
    features.push('Pay-per-use tokens');
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
  
  // Growth Plus - includes Growth features + AI Discovery:
  if (planKey === 'growth plus') {
    features.push('Product Optimization for AI search');
    features.push('Collections optimization');
    features.push('Sitemap generation');
    features.push('✓ AI Bot Access: + ChatGPT (OpenAI)');
    features.push('AI Welcome Page (included)');
    features.push('Collections JSON Feed (included)');
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
    
    // FIX: Validate activatedAt before returning billing info
    // If user has activatedAt but subscription wasn't approved in Shopify,
    // clear activatedAt to allow new activation (this happens when user clicks Back)
    const subscription = await Subscription.findOne({ shop });
    if (subscription?.activatedAt && subscription?.shopifySubscriptionId) {
      const shopDoc = await Shop.findOne({ shop });
      if (shopDoc?.accessToken) {
        const { getCurrentSubscription } = await import('./shopifyBilling.js');
        const shopifySub = await getCurrentSubscription(shop, shopDoc.accessToken);
        const isApproved = shopifySub && shopifySub.id === subscription.shopifySubscriptionId;
        
        if (!isApproved) {
          // activatedAt exists but subscription wasn't approved - clear it
          console.log('[BILLING-INFO] ⚠️ Clearing unapproved activatedAt:', {
            shop,
            activatedAt: subscription.activatedAt,
            shopifySubscriptionId: subscription.shopifySubscriptionId,
            foundInShopify: !!shopifySub,
            shopifySubId: shopifySub?.id
          });
          
          await Subscription.updateOne(
            { shop },
            { $unset: { activatedAt: '', trialEndsAt: '', shopifySubscriptionId: '' } }
          );
          
          // Invalidate cache so fresh data is loaded
          await cacheService.invalidateShop(shop);
          
          // Reload subscription without activatedAt
          const updatedSub = await Subscription.findOne({ shop });
          if (updatedSub) {
            Object.assign(subscription, updatedSub.toObject());
          }
        }
      }
    }
    
    // Cache billing info for 5 minutes (PHASE 3: Caching)
    const billingInfo = await withShopCache(shop, 'billing:info', CACHE_TTL.SHORT, async () => {
      // Use subscription from above (may have been updated)
      const subForInfo = await Subscription.findOne({ shop });
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      const now = new Date();
      const inTrial = subForInfo?.trialEndsAt && now < new Date(subForInfo.trialEndsAt);
      
      // Note: subscription.price is now a virtual property that auto-computes from plans.js
      
      return {
        subscription: subForInfo ? {
          plan: subForInfo.plan,
          status: subForInfo.status || 'active',
          price: subForInfo.price, // Virtual property from Subscription model
          trialEndsAt: subForInfo.trialEndsAt,
          inTrial,
          shopifySubscriptionId: subForInfo.shopifySubscriptionId,
          activatedAt: subForInfo.activatedAt
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
    
    // CRITICAL: Check if this is a plan change (existing subscription)
    const existingSubCheck = await Subscription.findOne({ shop });
    
    // FIX: If user has pendingPlan but subscription wasn't approved in Shopify,
    // clear pendingPlan to allow new plan selection
    if (existingSubCheck?.pendingPlan) {
      const pendingSubscriptionId = existingSubCheck.shopifySubscriptionId;
      
      // If no shopifySubscriptionId, definitely not approved
      if (!pendingSubscriptionId) {
        console.log('[BILLING-SUBSCRIBE] ⚠️ Clearing pendingPlan with no shopifySubscriptionId:', {
          shop,
          pendingPlan: existingSubCheck.pendingPlan
        });
        
        await Subscription.updateOne(
          { shop },
          { $unset: { pendingPlan: '', pendingActivation: '' } }
        );
        
        // Reload subscription without pendingPlan
        const updatedSub = await Subscription.findOne({ shop });
        if (updatedSub) {
          Object.assign(existingSubCheck, updatedSub.toObject());
        }
      } else {
        // Check if pendingPlan's subscriptionId exists in Shopify
        // getCurrentSubscription returns only ACTIVE subscriptions, so if it exists, it's approved
        const { getCurrentSubscription } = await import('./shopifyBilling.js');
        const shopifySub = await getCurrentSubscription(shop, shopDoc.accessToken);
        const isApproved = shopifySub && shopifySub.id === pendingSubscriptionId;
        
        if (!isApproved) {
          // Pending plan wasn't approved - clear it to allow new selection
          console.log('[BILLING-SUBSCRIBE] ⚠️ Clearing unapproved pendingPlan:', {
            shop,
            pendingPlan: existingSubCheck.pendingPlan,
            shopifySubscriptionId: pendingSubscriptionId,
            foundInShopify: !!shopifySub,
            shopifyStatus: shopifySub?.status
          });
          
          await Subscription.updateOne(
            { shop },
            { $unset: { pendingPlan: '', pendingActivation: '' } }
          );
          
          // Reload subscription without pendingPlan
          const updatedSub = await Subscription.findOne({ shop });
          if (updatedSub) {
            Object.assign(existingSubCheck, updatedSub.toObject());
          }
        }
      }
    }
    
    // TRIAL DAYS LOGIC:
    // 1. First subscription (install): trialDays = TRIAL_DAYS (5 days)
    // 2. Plan change during trial: trialDays = REMAINING DAYS (preserve trial in Shopify)
    // 3. Plan change after trial: trialDays = 0 (no trial)
    // 4. User clicks "End Trial": trialDays = 0
    let trialDays = TRIAL_DAYS;
    const now = new Date();
    
    if (endTrial) {
      trialDays = 0; // User explicitly ended trial
    } else if (existingSubCheck) {
      // Plan change: Check if trial is still active
      const trialEnd = existingSubCheck.trialEndsAt ? new Date(existingSubCheck.trialEndsAt) : null;
      
      if (trialEnd && now < trialEnd) {
        // Still in trial - calculate remaining days and preserve in Shopify
        const msRemaining = trialEnd - now;
        const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
        trialDays = daysRemaining;
      } else {
        // Trial already ended - no trial for new subscription
        trialDays = 0;
      }
    }
    
    // Create subscription with Shopify
    const { confirmationUrl, subscription: shopifySubscription } = await createSubscription(
      shop,
      plan,
      shopDoc.accessToken,
      { trialDays }
    );
    
    // Save subscription to MongoDB
    // (now already declared at line 262)
    
    // Use existingSubCheck from above (already fetched at line 254)
    const existingSub = existingSubCheck;
    
    // TRIAL PERIOD LOGIC (Shopify Best Practice):
    // 1. First subscription (install): Set trialEndsAt = now + TRIAL_DAYS
    // 2. Plan change (upgrade/downgrade): PRESERVE original trialEndsAt
    // 3. User ends trial early: Set trialEndsAt = null (trial ended)
    // 4. This ensures trial countdown continues regardless of plan changes
    let trialEndsAt = null;
    if (endTrial) {
      // User explicitly ended trial - clear trialEndsAt
      trialEndsAt = null;
    } else if (existingSub && existingSub.trialEndsAt) {
      // Plan change: Preserve original trial end date
      trialEndsAt = existingSub.trialEndsAt;
    } else if (trialDays > 0) {
      // First subscription: Calculate new trial end date
      trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    }
    
    // CRITICAL: DON'T create subscription before Shopify approval!
    // For plan changes, update existing subscription
    // For new subscriptions, return confirmationUrl WITHOUT creating in MongoDB
    // Subscription will be created by webhook callback after merchant approves
    
    let subscription;
    
    if (existingSub) {
      // Plan change: Set new plan as pending (will be activated in callback)
      const planChangeData = {
        pendingPlan: plan,
        shopifySubscriptionId: shopifySubscription.id,
        pendingActivation: true,
        // PRESERVE trial from existing subscription
        trialEndsAt: existingSub.trialEndsAt,
        updatedAt: now
        // NOTE: activatedAt is NOT modified - preserves trial restriction
      };
      
      subscription = await Subscription.findOneAndUpdate(
        { shop },
        planChangeData,
        { new: true }  // NO upsert - subscription must already exist
      );
      
    } else {
      // First install: DON'T create subscription yet!
      // Just return confirmationUrl - subscription will be created by webhook
      subscription = null;
    }
    
    // Invalidate cache after subscription change (PHASE 3: Caching)
    await cacheService.invalidateShop(shop);
    
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
    const { shop, plan, charge_id, returnTo } = req.query;
    
    if (!shop) {
      return res.status(400).send('Missing shop parameter');
    }
    
    // CRITICAL FIX: Activate pending plan (if user approved subscription)
    // Get current subscription to check for pendingPlan
    const currentSub = await Subscription.findOne({ shop });
    
    const updateData = {
      shop,
      status: 'active',
      pendingActivation: false
      // NOTE: activatedAt is NOT set here - only set when user clicks "Activate Plan" button
      // This allows trial restrictions to work correctly for Growth Extra/Enterprise plans
    };
    
    const now = new Date();
    
    // If there's a pendingPlan, activate it now (user approved!)
    if (currentSub?.pendingPlan) {
      updateData.plan = currentSub.pendingPlan;
      updateData.pendingPlan = null; // Clear pending
      
      // PRESERVE TRIAL if still active!
      if (currentSub.trialEndsAt && now < new Date(currentSub.trialEndsAt)) {
        updateData.trialEndsAt = currentSub.trialEndsAt; // Keep existing trial end
      }
    } else if (plan && PLANS[plan]) {
      // Check if this is an ACTIVATION (user clicked "Activate Plan")
      const isActivation = currentSub?.activatedAt && !currentSub?.pendingPlan;
      
      if (isActivation) {
        // This is an ACTIVATION callback - user already activated plan in /activate
        // DON'T overwrite activatedAt or add trial!
        
        // Only update plan if it changed
        if (currentSub.plan !== plan) {
          updateData.plan = plan;
        }
        
        // PRESERVE activatedAt and trialEndsAt (already null from /activate)
        updateData.activatedAt = currentSub.activatedAt;
        updateData.trialEndsAt = currentSub.trialEndsAt; // Should be null
        
      } else {
        // First subscription: Create subscription NOW (after approval)
        updateData.plan = plan;
        updateData.pendingPlan = null;
        
        // Set trial end date (from TRIAL_DAYS)
        updateData.trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      }
    }
    
    // UPSERT: Create subscription if doesn't exist (first install)
    const subscription = await Subscription.findOneAndUpdate(
      { shop },
      updateData,
      { upsert: true, new: true }  // UPSERT allowed here - AFTER approval
    );
    
    // Invalidate cache after subscription change (PHASE 3: Caching)
    await cacheService.invalidateShop(shop);
    
    // If plan was activated (pendingPlan → plan OR activation callback), set included tokens
    if ((currentSub?.pendingPlan || currentSub?.activatedAt) && subscription.plan) {
      const included = getIncludedTokens(subscription.plan);
      
      if (included.tokens > 0) {
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        
        // Use setIncludedTokens to replace old included tokens (keeps purchased)
        await tokenBalance.setIncludedTokens(
          included.tokens, 
          subscription.plan, 
          subscription.shopifySubscriptionId
        );
      }
    }
    
    // NOTE: For production mode (real webhooks), tokens would also be added by APP_SUBSCRIPTIONS_UPDATE webhook
    // This callback handles test mode and user-approved subscriptions
    
    // Redirect back to app (use returnTo if provided, otherwise default to billing)
    const redirectPath = returnTo || '/billing';
    
    res.redirect(`/apps/new-ai-seo${redirectPath}?shop=${shop}&success=true`);
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
    const { amount, returnTo } = req.body;
    
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
      shopDoc.accessToken,
      { returnTo: returnTo || '/billing' }
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
 * GET /billing/tokens/callback?shop={shop}&amount={amount}&charge_id={id}&returnTo={path}
 */
router.get('/tokens/callback', async (req, res) => {
  try {
    const { shop, amount, charge_id, returnTo } = req.query;
    
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
    
    // Redirect to returnTo path or default to /billing
    const redirectPath = returnTo || '/billing';
    res.redirect(`/apps/new-ai-seo${redirectPath}?shop=${shop}&tokens_purchased=true&amount=${tokens}`);
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

/**
 * POST /api/billing/activate
 * Activate a plan (end trial and set activatedAt)
 * Body: { endTrial: boolean }
 */
router.post('/activate', verifyRequest, async (req, res) => {
  try {
    const shop = req.shopDomain;
    const { endTrial, returnTo } = req.body;
    
    console.log('[BILLING-ACTIVATE] 🚀 START - Activate plan request:', {
      shop,
      endTrial,
      returnTo,
      timestamp: new Date().toISOString()
    });
    
    // Get current subscription
    const subscription = await Subscription.findOne({ shop });
    
    if (!subscription) {
      console.error('[BILLING-ACTIVATE] ❌ No subscription found for:', shop);
      return res.status(404).json({ error: 'No active subscription found' });
    }
    
    console.log('[BILLING-ACTIVATE] 📊 Current subscription state:', {
      shop,
      plan: subscription.plan,
      activatedAt: subscription.activatedAt,
      shopifySubscriptionId: subscription.shopifySubscriptionId,
      trialEndsAt: subscription.trialEndsAt,
      endTrial: endTrial
    });
    
    // FIX: If user has activatedAt but subscription wasn't approved in Shopify,
    // clear activatedAt to allow new activation
    // This check happens BEFORE creating new subscription, so it validates the OLD subscription ID
    if (subscription.activatedAt && endTrial) {
      console.log('[BILLING-ACTIVATE] 🔍 CHECK - Found activatedAt, validating subscription in Shopify...');
      const activatedSubscriptionId = subscription.shopifySubscriptionId;
      
      console.log('[BILLING-ACTIVATE] 🔍 Validating subscription ID:', {
        shop,
        activatedSubscriptionId,
        activatedAt: subscription.activatedAt
      });
      
      // If no shopifySubscriptionId, definitely not approved
      if (!activatedSubscriptionId) {
        console.log('[BILLING-ACTIVATE] ⚠️ No shopifySubscriptionId found - clearing activatedAt:', {
          shop,
          activatedAt: subscription.activatedAt
        });
        
        await Subscription.updateOne(
          { shop },
          { $unset: { activatedAt: '', trialEndsAt: '' } }
        );
        
        // Reload subscription without activatedAt
        const updatedSub = await Subscription.findOne({ shop });
        if (updatedSub) {
          Object.assign(subscription, updatedSub.toObject());
        }
        
        console.log('[BILLING-ACTIVATE] ✅ Cleared activatedAt (no shopifySubscriptionId)');
      } else {
        const shopDoc = await Shop.findOne({ shop });
        if (shopDoc?.accessToken) {
          console.log('[BILLING-ACTIVATE] 🔍 Checking if subscription exists in Shopify...');
          
          // Check if activated subscription exists in Shopify
          // getCurrentSubscription returns only ACTIVE subscriptions, so if it exists, it's approved
          const { getCurrentSubscription } = await import('./shopifyBilling.js');
          const shopifySub = await getCurrentSubscription(shop, shopDoc.accessToken);
          
          console.log('[BILLING-ACTIVATE] 🔍 Shopify subscription check result:', {
            shop,
            expectedId: activatedSubscriptionId,
            foundInShopify: !!shopifySub,
            shopifySubId: shopifySub?.id,
            shopifySubStatus: shopifySub?.status,
            idsMatch: shopifySub?.id === activatedSubscriptionId
          });
          
          const isApproved = shopifySub && shopifySub.id === activatedSubscriptionId;
          
          if (!isApproved) {
            // Activated plan wasn't approved - clear activatedAt to allow new activation
            console.log('[BILLING-ACTIVATE] ⚠️ Subscription NOT approved in Shopify - clearing activatedAt:', {
              shop,
              activatedAt: subscription.activatedAt,
              shopifySubscriptionId: activatedSubscriptionId,
              foundInShopify: !!shopifySub,
              shopifySubId: shopifySub?.id,
              reason: shopifySub ? 'ID mismatch' : 'Subscription not found'
            });
            
            await Subscription.updateOne(
              { shop },
              { $unset: { activatedAt: '', trialEndsAt: '', shopifySubscriptionId: '' } }
            );
            
            // Reload subscription without activatedAt
            const updatedSub = await Subscription.findOne({ shop });
            if (updatedSub) {
              Object.assign(subscription, updatedSub.toObject());
            }
            
            console.log('[BILLING-ACTIVATE] ✅ Cleared activatedAt (subscription not approved)');
          } else {
            console.log('[BILLING-ACTIVATE] ✅ Subscription IS approved in Shopify - keeping activatedAt');
          }
        } else {
          console.log('[BILLING-ACTIVATE] ⚠️ No shop access token found, skipping validation');
        }
      }
    } else {
      console.log('[BILLING-ACTIVATE] ℹ️ No activatedAt found or endTrial=false, proceeding with activation');
    }
    
    // Update subscription
    const updateData = {
      activatedAt: new Date(),
      pendingActivation: false
    };
    
    console.log('[BILLING-ACTIVATE] 📝 Setting activatedAt:', {
      shop,
      activatedAt: updateData.activatedAt,
      endTrial: endTrial
    });
    
    // If ending trial, clear trialEndsAt AND end trial in Shopify
    if (endTrial) {
      updateData.trialEndsAt = null;
      
      console.log('[BILLING-ACTIVATE] 🔄 Ending trial - creating new subscription in Shopify...');
      
      // CRITICAL: End trial in Shopify to start billing NOW!
      // Otherwise Shopify will auto-charge after 5 days even if features were locked!
      try {
        const shopDoc = await Shop.findOne({ shop });
        if (!shopDoc || !shopDoc.accessToken) {
          console.error('[BILLING-ACTIVATE] ❌ Shop not found in DB:', { shop, found: !!shopDoc });
          throw new Error('Shop access token not found');
        }
        
        // Use appSubscriptionCancel + immediate recreate to end trial
        // This is the recommended Shopify approach for ending trials early
        const { createSubscription } = await import('./shopifyBilling.js');
        
        console.log('[BILLING-ACTIVATE] 🔄 Creating new subscription in Shopify (trialDays: 0)...');
        
        const { confirmationUrl, subscription: newShopifySubscription } = await createSubscription(
          shop,
          subscription.plan,
          shopDoc.accessToken,
          { 
            trialDays: 0, // NO trial - start billing NOW!
            returnTo: returnTo || '/billing' // Where to redirect after approval
          }
        );
        
        console.log('[BILLING-ACTIVATE] ✅ New subscription created in Shopify:', {
          shop,
          newSubscriptionId: newShopifySubscription.id,
          confirmationUrl: !!confirmationUrl,
          plan: subscription.plan
        });
        
        // Update shopifySubscriptionId with new subscription
        updateData.shopifySubscriptionId = newShopifySubscription.id;
        
        console.log('[BILLING-ACTIVATE] 💾 Saving to MongoDB:', {
          shop,
          activatedAt: updateData.activatedAt,
          shopifySubscriptionId: updateData.shopifySubscriptionId,
          trialEndsAt: updateData.trialEndsAt
        });
        
        // CRITICAL: Update MongoDB FIRST before returning confirmationUrl!
        // Otherwise callback will read old data (activatedAt: undefined)
        await Subscription.updateOne({ shop }, { $set: updateData });
        
        console.log('[BILLING-ACTIVATE] ✅ Saved to MongoDB successfully');
        
        // If confirmationUrl exists, merchant needs to approve the charge
        if (confirmationUrl) {
          console.log('[BILLING-ACTIVATE] 🔐 Confirmation URL required - user must approve:', {
            shop,
            newSubscriptionId: newShopifySubscription.id,
            note: 'If user clicks Back, on next /activate call, validation will check this NEW subscription ID'
          });
          
          // Invalidate cache so callback reads fresh data
          await cacheService.invalidateShop(shop);
          
          // Return confirmation URL so frontend can redirect
          // NOTE: activatedAt and new shopifySubscriptionId are set in MongoDB
          // If user clicks Back without approving, on next /activate call,
          // the check at the beginning of this function will validate the NEW subscription ID
          // and clear activatedAt if it doesn't exist in Shopify
          return res.json({
            success: true,
            requiresApproval: true,
            confirmationUrl,
            plan: subscription.plan,
            message: 'Please approve the charge to activate your plan'
          });
        }
        
      } catch (shopifyError) {
        console.error('[BILLING-ACTIVATE] ❌ Failed to end trial in Shopify:', shopifyError);
        // Continue anyway - at least we cleared trialEndsAt in MongoDB
        // Worst case: Shopify will charge after 5 days, but user can use features now
      }
    }
    
    console.log('[BILLING-ACTIVATE] 💾 Saving updateData to MongoDB (no endTrial or no confirmationUrl):', {
      shop,
      updateData
    });
    
    await Subscription.updateOne({ shop }, { $set: updateData });
    
    // Add included tokens for plans with them (Growth Extra/Enterprise)
    const includedTokenInfo = getIncludedTokens(subscription.plan);
    if (includedTokenInfo.tokens > 0) {
      console.log('[BILLING-ACTIVATE] 🪙 Adding included tokens:', {
        shop,
        plan: subscription.plan,
        tokens: includedTokenInfo.tokens
      });
      
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      await tokenBalance.addIncludedTokens(includedTokenInfo.tokens, subscription.plan);
    }
    
    // Invalidate cache
    await cacheService.invalidateShop(shop);
    
    console.log('[BILLING-ACTIVATE] ✅ SUCCESS - Plan activated:', {
      shop,
      plan: subscription.plan,
      activatedAt: updateData.activatedAt,
      trialEnded: endTrial,
      tokensAdded: includedTokenInfo.tokens
    });
    
    // Return success
    res.json({
      success: true,
      plan: subscription.plan,
      activatedAt: updateData.activatedAt,
      trialEnded: endTrial,
      tokensAdded: includedTokenInfo.tokens
    });
    
  } catch (error) {
    console.error('[BILLING-ACTIVATE] ❌ ERROR:', {
      shop: req.shopDomain,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message || 'Failed to activate plan' });
  }
});

export default router;

