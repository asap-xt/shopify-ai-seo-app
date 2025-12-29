// backend/billing/billingRoutes.js
// Billing routes using ONLY GraphQL Admin API

import express from 'express';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import TokenBalance from '../db/TokenBalance.js';
import PromoCode from '../db/PromoCode.js';
import PromoAllowlist from '../db/PromoAllowlist.js';
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

// App proxy subpath from environment (default: 'indexaize')
const APP_PROXY_SUBPATH = process.env.APP_PROXY_SUBPATH || 'indexaize';

// ============================================
// EXEMPT STORES - Free Enterprise access
// These stores get full Enterprise access without billing
// Add store domains to EXEMPT_SHOPS env var (comma-separated)
// Example: EXEMPT_SHOPS=my-store.myshopify.com,another-store.myshopify.com
// ============================================
const EXEMPT_SHOPS = (process.env.EXEMPT_SHOPS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Log exempt shops on startup for debugging
if (EXEMPT_SHOPS.length > 0) {
  console.log(`[EXEMPT] ✅ Loaded ${EXEMPT_SHOPS.length} exempt shops:`, EXEMPT_SHOPS);
} else {
  console.log(`[EXEMPT] ℹ️ No exempt shops configured (EXEMPT_SHOPS env var is empty)`);
}

/**
 * Check if a shop is exempt from billing
 * @param {string} shop - Shop domain
 * @returns {boolean} True if shop is exempt
 */
export function isExemptShop(shop) {
  if (!shop) return false;
  const normalizedShop = shop.toLowerCase().trim();
  const isExempt = EXEMPT_SHOPS.includes(normalizedShop);
  
  // Debug logging
  console.log(`[EXEMPT] Checking shop: "${normalizedShop}" - exempt: ${isExempt} (list: ${EXEMPT_SHOPS.join(', ') || 'empty'})`);
  
  return isExempt;
}

/**
 * Determine trial period based on shop's promo eligibility
 * @param {string} shop - Shop domain
 * @returns {Promise<{trialDays: number, promoType: string|null, isFreeEnterprise: boolean}>}
 */
async function determineTrialPeriod(shop) {
  // Default trial days
  let trialDays = TRIAL_DAYS;
  let promoType = null;
  let isFreeEnterprise = false;
  
  try {
    // Check allowlist first
    const allowlistCheck = await PromoAllowlist.checkShop(shop);
    if (allowlistCheck.onAllowlist) {
      promoType = allowlistCheck.promo.type;
      
      if (promoType === 'free_enterprise') {
        isFreeEnterprise = true;
        trialDays = 0; // No trial needed, gets free Enterprise
      } else if (promoType === 'free_month' || promoType === 'free_trial_extended') {
        trialDays = allowlistCheck.promo.trialDays || 30;
      }
      
      console.log(`[BILLING] Shop ${shop} on allowlist: ${promoType}, trialDays=${trialDays}`);
      return { trialDays, promoType, isFreeEnterprise };
    }
    
    // Check shop's promo from installation
    const shopDoc = await Shop.findOne({ shop }).lean();
    if (shopDoc?.hasPromoEligibility && shopDoc.promoType) {
      promoType = shopDoc.promoType;
      
      if (promoType === 'free_enterprise') {
        isFreeEnterprise = true;
        trialDays = 0;
      } else if (promoType === 'free_month' || promoType === 'free_trial_extended') {
        // Fetch the original promo code details
        if (shopDoc.promoCode) {
          const promoCheck = await PromoCode.checkValidity(shopDoc.promoCode);
          if (promoCheck.valid) {
            trialDays = promoCheck.promo.trialDays || 30;
          }
        } else {
          trialDays = 30; // Default for free_month
        }
      }
      
      console.log(`[BILLING] Shop ${shop} has promo: ${promoType}, trialDays=${trialDays}`);
    }
    
    // Also check campaign source for special treatment
    if (shopDoc?.campaignSource) {
      // Example: 'launch2025' campaign gives 30 day trial
      const extendedTrialCampaigns = ['launch2025', 'beta', 'partner'];
      if (extendedTrialCampaigns.includes(shopDoc.campaignSource)) {
        trialDays = Math.max(trialDays, 30);
        console.log(`[BILLING] Shop ${shop} campaign ${shopDoc.campaignSource} gives ${trialDays} day trial`);
      }
    }
    
  } catch (error) {
    console.error(`[BILLING] Error determining trial period for ${shop}:`, error);
  }
  
  return { trialDays, promoType, isFreeEnterprise };
}

/**
 * Ensure exempt shop has active Enterprise subscription
 * Call this on shop load/auth to auto-grant access
 * CRITICAL: Also CANCELS any existing Shopify subscriptions to prevent billing!
 * @param {string} shop - Shop domain
 */
export async function ensureExemptShopAccess(shop) {
  console.log(`[EXEMPT] ensureExemptShopAccess called for: ${shop}`);
  
  if (!isExemptShop(shop)) {
    console.log(`[EXEMPT] ⚠️ Shop ${shop} is NOT exempt, returning null`);
    return null;
  }
  
  try {
    // Check if subscription exists
    let subscription = await Subscription.findOne({ shop });
    console.log(`[EXEMPT] Existing subscription for ${shop}:`, subscription ? { plan: subscription.plan, status: subscription.status } : 'NONE');
    
    // CRITICAL: Cancel any existing Shopify subscription to prevent billing!
    // This is the key fix - exempt shops should NOT be charged by Shopify
    if (subscription?.shopifySubscriptionId) {
      try {
        const shopDoc = await Shop.findOne({ shop });
        if (shopDoc?.accessToken) {
          const cancelled = await cancelSubscription(
            shop,
            subscription.shopifySubscriptionId,
            shopDoc.accessToken
          );
          if (cancelled) {
            console.log(`[EXEMPT] ✅ Cancelled Shopify subscription for exempt shop: ${shop}`);
          }
        }
      } catch (cancelError) {
        console.error(`[EXEMPT] Failed to cancel Shopify subscription for ${shop}:`, cancelError.message);
      }
    }
    
    // Also check for any active Shopify subscriptions that we don't know about
    try {
      const shopDoc = await Shop.findOne({ shop });
      if (shopDoc?.accessToken) {
        const activeShopifySub = await getCurrentSubscription(shop, shopDoc.accessToken);
        if (activeShopifySub?.id) {
          console.log(`[EXEMPT] Found active Shopify subscription, cancelling: ${activeShopifySub.id}`);
          await cancelSubscription(shop, activeShopifySub.id, shopDoc.accessToken);
          console.log(`[EXEMPT] ✅ Cancelled unknown Shopify subscription for exempt shop: ${shop}`);
        }
      }
    } catch (checkError) {
      console.error(`[EXEMPT] Error checking for active subscriptions:`, checkError.message);
    }
    
    if (!subscription) {
      // Create new Enterprise subscription for exempt shop (NO Shopify billing!)
      console.log(`[EXEMPT] No subscription found, creating Enterprise for: ${shop}`);
      subscription = await Subscription.create({
        shop,
        plan: 'enterprise',
        status: 'active',
        startedAt: new Date(),
        activatedAt: new Date(),
        // No trial, no expiry for exempt shops
        trialEndsAt: null,
        expiredAt: null,
        // CRITICAL: No shopifySubscriptionId - exempt from billing!
        shopifySubscriptionId: null
      });
      console.log(`[EXEMPT] ✅ Created Enterprise subscription (NO BILLING) for exempt shop: ${shop}`);
    } else {
      // ALWAYS update to Enterprise for exempt shops, regardless of current state
      console.log(`[EXEMPT] Updating existing subscription to Enterprise for: ${shop} (was: ${subscription.plan}/${subscription.status})`);
      subscription.plan = 'enterprise';
      subscription.status = 'active';
      subscription.activatedAt = subscription.activatedAt || new Date();
      subscription.expiredAt = null;
      subscription.cancelledAt = null;
      subscription.trialEndsAt = null;
      subscription.pendingPlan = null;
      subscription.pendingActivation = false;
      // CRITICAL: Clear Shopify subscription ID - exempt from billing!
      subscription.shopifySubscriptionId = null;
      await subscription.save();
      console.log(`[EXEMPT] ✅ Updated subscription to Enterprise (NO BILLING) for exempt shop: ${shop}`);
    }
    
    // EXEMPT shops get Enterprise plan tokens (300M) - but NEVER reduce existing balance!
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    const ENTERPRISE_INCLUDED_TOKENS = 300_000_000; // 300M tokens for Enterprise plan
    
    // Only ADD tokens if balance is below Enterprise included amount
    // NEVER reduce tokens if user already has more!
    if (tokenBalance.balance < ENTERPRISE_INCLUDED_TOKENS) {
      const previousBalance = tokenBalance.balance;
      tokenBalance.balance = ENTERPRISE_INCLUDED_TOKENS;
      tokenBalance.totalGranted = (tokenBalance.totalGranted || 0) + (ENTERPRISE_INCLUDED_TOKENS - previousBalance);
      await tokenBalance.save();
      console.log(`[EXEMPT] ✅ Granted Enterprise tokens to exempt shop: ${shop} (${previousBalance.toLocaleString()} → ${ENTERPRISE_INCLUDED_TOKENS.toLocaleString()})`);
    } else {
      console.log(`[EXEMPT] ℹ️ Exempt shop ${shop} already has ${tokenBalance.balance.toLocaleString()} tokens (keeping existing balance)`);
    }
    
    // CRITICAL: Invalidate cache after updating subscription and tokens!
    // This ensures the UI shows the correct values immediately
    await cacheService.invalidateShop(shop);
    console.log(`[EXEMPT] ✅ Cache invalidated for exempt shop: ${shop}`);
    
    return subscription;
  } catch (error) {
    console.error(`[EXEMPT] Error ensuring access for ${shop}:`, error);
    return null;
  }
}

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
export function getPlanFeatures(planKey) {
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
    features.push('🔓 All AI Discovery features unlocked with pay-per-use tokens:');
    features.push('✓ AI Welcome Page');
    features.push('✓ Collections JSON Feed');
    features.push('✓ Store Metadata');
    features.push('✓ AI-Optimized Sitemap (pay-per-use tokens)');
    features.push('✓ Advanced Schema Data (pay-per-use tokens)');
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
    features.push('Store Metadata (included)');
    features.push('🔓 AI Discovery features with pay-per-use tokens:');
    features.push('AI-Optimized Sitemap (pay-per-use tokens)');
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
    
    // EXEMPT SHOPS: Auto-grant Enterprise access for exempt stores
    // For EXEMPT shops, skip cache entirely to avoid race conditions
    if (isExemptShop(shop)) {
      console.log(`[BILLING-INFO] EXEMPT shop detected: ${shop}, calling ensureExemptShopAccess...`);
      await ensureExemptShopAccess(shop);
      console.log(`[BILLING-INFO] ensureExemptShopAccess completed for: ${shop}`);
      
      // For EXEMPT shops, return fresh data directly (no cache)
      const subForInfo = await Subscription.findOne({ shop });
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      console.log(`[BILLING-INFO] EXEMPT shop ${shop} - plan: ${subForInfo?.plan}, tokens: ${tokenBalance.balance.toLocaleString()}`);
      
      // CRITICAL: Disable HTTP caching for EXEMPT shops
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      
      return res.json({
        subscription: subForInfo ? {
          plan: subForInfo.plan,
          status: subForInfo.status || 'active',
          price: subForInfo.price,
          trialEndsAt: subForInfo.trialEndsAt,
          inTrial: false, // EXEMPT shops don't have trial
          shopifySubscriptionId: subForInfo.shopifySubscriptionId,
          activatedAt: subForInfo.activatedAt,
          pendingActivation: false,
          pendingPlan: null,
          isExempt: true // Flag for frontend
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
      });
    }
    
    // FIX: Validate activatedAt and pendingActivation BEFORE checking cache
    // If user has activatedAt or pendingActivation but subscription wasn't approved in Shopify,
    // clear them and invalidate cache to allow new activation (this happens when user clicks Back)
    const subscription = await Subscription.findOne({ shop });
    
    // CRITICAL: Invalidate cache first to force fresh data load
    let needsCacheInvalidation = false;
    
    // Validate pendingActivation FIRST (before activatedAt check)
    // This fixes the issue where banner disappears after second "back" click
    if (subscription?.pendingActivation && subscription?.shopifySubscriptionId) {
      needsCacheInvalidation = true;
      await cacheService.invalidateShop(shop);
      
      const shopDoc = await Shop.findOne({ shop });
      if (shopDoc?.accessToken) {
        const { getSubscriptionById } = await import('./shopifyBilling.js');
        const shopifySub = await getSubscriptionById(
          shop, 
          subscription.shopifySubscriptionId, 
          shopDoc.accessToken
        );
        
        // Subscription exists if found (even if PENDING - waiting for approval)
        const subscriptionExists = !!shopifySub;
        
        // If subscription exists but is CANCELLED, clear pendingActivation
        const isCancelled = shopifySub?.status === 'CANCELLED';
        
        // pendingActivation is valid only if subscription exists and is not CANCELLED
        const isPendingActivationValid = subscriptionExists && !isCancelled;
        
        if (!isPendingActivationValid) {
          // pendingActivation exists but subscription was cancelled or doesn't exist - clear it
          await Subscription.updateOne(
            { shop },
            { $unset: { pendingActivation: '', shopifySubscriptionId: '' } }
          );
          
          // Reload subscription to get updated data
          const updatedSub = await Subscription.findOne({ shop });
          if (updatedSub) {
            Object.assign(subscription, updatedSub.toObject());
          }
        }
      } else if (!shopDoc?.accessToken) {
        // No access token - can't validate, but clear pendingActivation to be safe
        await Subscription.updateOne(
          { shop },
          { $unset: { pendingActivation: '', shopifySubscriptionId: '' } }
        );
        
        // Reload subscription to get updated data
        const updatedSub = await Subscription.findOne({ shop });
        if (updatedSub) {
          Object.assign(subscription, updatedSub.toObject());
        }
      }
    } else if (subscription?.pendingActivation && !subscription?.shopifySubscriptionId) {
      // pendingActivation exists but no shopifySubscriptionId - invalid state, clear it
      needsCacheInvalidation = true;
      await Subscription.updateOne(
        { shop },
        { $unset: { pendingActivation: '' } }
      );
      
      // Reload subscription to get updated data
      const updatedSub = await Subscription.findOne({ shop });
      if (updatedSub) {
        Object.assign(subscription, updatedSub.toObject());
      }
    }
    
    // CRITICAL: If we have activatedAt, we need to validate it BEFORE cache check
    if (subscription?.activatedAt && subscription?.shopifySubscriptionId) {
      if (!needsCacheInvalidation) {
        await cacheService.invalidateShop(shop);
        needsCacheInvalidation = true;
      }
      
      const shopDoc = await Shop.findOne({ shop });
      if (shopDoc?.accessToken) {
        // CRITICAL: Use getSubscriptionById instead of getCurrentSubscription
        // getCurrentSubscription only returns ACTIVE subscriptions
        // getSubscriptionById checks if subscription exists (even if PENDING)
        // This is important when subscription is waiting for approval
        const { getSubscriptionById } = await import('./shopifyBilling.js');
        const shopifySub = await getSubscriptionById(
          shop, 
          subscription.shopifySubscriptionId, 
          shopDoc.accessToken
        );
        
        // Subscription exists if found (even if PENDING - waiting for approval)
        // Only clear activatedAt if subscription doesn't exist at all (CANCELLED or never created)
        const subscriptionExists = !!shopifySub;
        
        // If subscription exists but is CANCELLED, clear activatedAt
        const isCancelled = shopifySub?.status === 'CANCELLED';
        
        const isApproved = subscriptionExists && !isCancelled;
        
        if (!isApproved) {
          // activatedAt exists but subscription wasn't approved - clear it
          await Subscription.updateOne(
            { shop },
            { $unset: { activatedAt: '', trialEndsAt: '', shopifySubscriptionId: '' } }
          );
          
          // Reload subscription to get updated data
          const updatedSub = await Subscription.findOne({ shop });
          if (updatedSub) {
            Object.assign(subscription, updatedSub.toObject());
          }
        }
      }
    }
    
    // Invalidate cache if we made any changes
    if (needsCacheInvalidation) {
      await cacheService.invalidateShop(shop);
    }
    
    // Cache billing info for 5 minutes (PHASE 3: Caching)
    // Note: If activatedAt was cleared above, cache was invalidated, so fresh data will be loaded
    const billingInfo = await withShopCache(shop, 'billing:info', CACHE_TTL.SHORT, async () => {
      // Use subscription from above (may have been updated)
      const subForInfo = await Subscription.findOne({ shop });
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      
      const now = new Date();
      // CRITICAL: Trial is active only if trialEndsAt exists, is in the future, AND plan is not activated yet
      // If activatedAt exists, trial has ended (user activated plan during trial)
      const inTrial = subForInfo?.trialEndsAt && now < new Date(subForInfo.trialEndsAt) && !subForInfo?.activatedAt;
      
      // Note: subscription.price is now a virtual property that auto-computes from plans.js
      
      return {
        subscription: subForInfo ? {
          plan: subForInfo.plan,
          status: subForInfo.status || 'active',
          price: subForInfo.price, // Virtual property from Subscription model
          trialEndsAt: subForInfo.trialEndsAt,
          inTrial,
          shopifySubscriptionId: subForInfo.shopifySubscriptionId,
          activatedAt: subForInfo.activatedAt,
          pendingActivation: subForInfo.pendingActivation || false,
          pendingPlan: subForInfo.pendingPlan || null // Include pendingPlan to check if activation is for current plan
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
    const { plan, endTrial, returnTo } = req.body;
    
    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    
    // CRITICAL: EXEMPT shops do NOT go through Shopify billing!
    // They get Enterprise access for free
    if (isExemptShop(shop)) {
      console.log(`[BILLING] ⚠️ EXEMPT shop ${shop} tried to subscribe - granting free Enterprise access`);
      
      // Ensure exempt access (creates/updates subscription, cancels any Shopify billing)
      await ensureExemptShopAccess(shop);
      
      // Invalidate cache
      await cacheService.invalidateShop(shop);
      
      // Return success without creating Shopify subscription
      return res.json({
        success: true,
        exempt: true,
        plan: 'enterprise',
        message: 'You have been granted free Enterprise access. No billing required.'
      });
    }
    
    // Get shop access token
    const shopDoc = await Shop.findOne({ shop });
    if (!shopDoc || !shopDoc.accessToken) {
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    // Check for promo eligibility (free_enterprise gives free access without Shopify billing)
    const promoInfo = await determineTrialPeriod(shop);
    
    if (promoInfo.isFreeEnterprise) {
      console.log(`[BILLING] 🎁 Shop ${shop} has free_enterprise promo - granting free access`);
      
      // Cancel any existing Shopify subscription
      const activeSub = await getCurrentSubscription(shop, shopDoc.accessToken);
      if (activeSub?.id) {
        await cancelSubscription(shop, activeSub.id, shopDoc.accessToken);
        console.log(`[BILLING] ✅ Cancelled existing subscription for promo shop: ${shop}`);
      }
      
      // Create/update local subscription as Enterprise (no Shopify billing)
      await Subscription.findOneAndUpdate(
        { shop },
        {
          shop,
          plan: 'enterprise',
          status: 'active',
          activatedAt: new Date(),
          trialEndsAt: null,
          shopifySubscriptionId: null, // No Shopify billing!
          pendingPlan: null,
          pendingActivation: false
        },
        { upsert: true, new: true }
      );
      
      // Grant Enterprise tokens (300M) - but NEVER reduce existing balance!
      const tokenBalance = await TokenBalance.getOrCreate(shop);
      const ENTERPRISE_INCLUDED_TOKENS = 300_000_000; // 300M for Enterprise
      if (tokenBalance.balance < ENTERPRISE_INCLUDED_TOKENS) {
        const previousBalance = tokenBalance.balance;
        tokenBalance.balance = ENTERPRISE_INCLUDED_TOKENS;
        tokenBalance.totalGranted = (tokenBalance.totalGranted || 0) + (ENTERPRISE_INCLUDED_TOKENS - previousBalance);
        await tokenBalance.save();
        console.log(`[BILLING] ✅ Granted Enterprise tokens for promo shop: ${shop} (${previousBalance.toLocaleString()} → ${ENTERPRISE_INCLUDED_TOKENS.toLocaleString()})`);
      }
      
      // Invalidate cache
      await cacheService.invalidateShop(shop);
      
      return res.json({
        success: true,
        promo: true,
        promoType: 'free_enterprise',
        plan: 'enterprise',
        message: 'You have been granted free Enterprise access through your promotion!'
      });
    }
    
    // CRITICAL: Check if this is a plan change (existing subscription)
    const existingSubCheck = await Subscription.findOne({ shop });
    
    // FIX: If user has pendingPlan but subscription wasn't approved in Shopify,
    // clear pendingPlan to allow new plan selection
    if (existingSubCheck?.pendingPlan) {
      const pendingSubscriptionId = existingSubCheck.shopifySubscriptionId;
      
      // If no shopifySubscriptionId, definitely not approved
      if (!pendingSubscriptionId) {
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
    // 1. First subscription (install): trialDays = TRIAL_DAYS (5 days) OR promo trial days
    // 2. Plan change during trial: trialDays = REMAINING DAYS (preserve trial in Shopify)
    // 3. Plan change after trial: trialDays = 0 (no trial)
    // 4. Plan change after activation: trialDays = 0 (no trial, continue billing period)
    // 5. User clicks "End Trial": trialDays = 0
    // 6. Promo codes can extend trial (e.g., 30 days instead of 5)
    let trialDays = promoInfo.trialDays || TRIAL_DAYS; // Use promo trial days if available
    const now = new Date();
    
    if (promoInfo.promoType && promoInfo.trialDays > TRIAL_DAYS) {
      console.log(`[BILLING] 🎁 Applying promo trial: ${promoInfo.trialDays} days (normal: ${TRIAL_DAYS})`);
    }
    
    if (endTrial) {
      trialDays = 0; // User explicitly ended trial
    } else if (existingSubCheck) {
      // Plan change: Check if plan is activated or if trial is still active
      // CRITICAL: If activatedAt exists, plan is activated - NO trial on upgrade!
      if (existingSubCheck.activatedAt) {
        // CRITICAL: Plan is already activated - NO trial on upgrade!
        // According to Shopify: upgrade after activation continues billing period (no new trial)
        trialDays = 0;
      } else {
        // Plan is in trial - check if trial is still active
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
    }
    
    // Create subscription with Shopify
    const { confirmationUrl, subscription: shopifySubscription } = await createSubscription(
      shop,
      plan,
      shopDoc.accessToken,
      { trialDays, returnTo: returnTo || '/billing' }
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
      // CRITICAL: According to Shopify documentation:
      // - If plan is activated (activatedAt exists): NO trial, continue billing period
      // - If plan is in trial (no activatedAt): Preserve trial end date
      // This ensures that when switching plans during trial, remaining days are preserved
      // But if plan is already activated, billing period continues (no trial)
      let preservedTrialEndsAt = null;
      if (existingSub.trialEndsAt && !existingSub.activatedAt) {
        // CRITICAL: Only preserve trial if plan is NOT activated yet
        // If activatedAt exists, plan is already activated - no trial on upgrade!
        const trialEnd = new Date(existingSub.trialEndsAt);
        if (now < trialEnd) {
          // Trial is still active - preserve the original trial end date
          preservedTrialEndsAt = existingSub.trialEndsAt;
        } else {
          // Trial already ended (past date) - clear it
          preservedTrialEndsAt = null;
        }
      } else if (existingSub.activatedAt) {
        // CRITICAL: Plan is already activated - NO trial on upgrade!
        // According to Shopify: upgrade after activation continues billing period
        preservedTrialEndsAt = null;
      }
      
      // CRITICAL: Clear old pendingActivation if it exists (from /activate or previous upgrade/downgrade)
      // This ensures that when upgrading/downgrading, old pendingActivation is cleared
      // This allows user to upgrade/downgrade even if they have pendingActivation from /activate
      // Updated: 2025-11-17 - Fixed pending activation blocking issue
      if (existingSub.pendingActivation && !existingSub.pendingPlan) {
        // Old pendingActivation from /activate (no pendingPlan) - clear it
        await Subscription.updateOne(
          { shop },
          { $unset: { pendingActivation: '', shopifySubscriptionId: '' } }
        );
      }
      
      // CRITICAL: If user had pendingActivation for a different plan, clear it
      // This handles the case where user started activating one plan, clicked back, then chose a different plan
      // Also clear old shopifySubscriptionId if it exists (from previous pending activation)
      // IMPORTANT: Do NOT set pendingActivation here - pendingActivation is only for /activate endpoint
      // When upgrading/downgrading, we only set pendingPlan, not pendingActivation
      const planChangeData = {
        pendingPlan: plan,
        shopifySubscriptionId: shopifySubscription.id,
        updatedAt: now
        // NOTE: activatedAt is NOT modified - preserves trial restriction
        // NOTE: pendingActivation is NOT set here - only set in /activate endpoint
        // NOTE: shopifySubscriptionId is updated to the new subscription ID
      };
      
      // CRITICAL: Handle trialEndsAt based on activation status
      // According to Shopify documentation:
      // - If plan is activated (activatedAt exists): NO trial, continue billing period
      // - If plan is in trial (no activatedAt): Preserve trial end date
      if (existingSub.activatedAt) {
        // CRITICAL: Plan is already activated - NO trial on upgrade!
        // According to Shopify: upgrade after activation continues billing period (no new trial)
        planChangeData.trialEndsAt = null;
      } else if (preservedTrialEndsAt) {
        // Plan is in trial - preserve the original trial end date
        planChangeData.trialEndsAt = preservedTrialEndsAt;
      }
      // If preservedTrialEndsAt is null AND activatedAt doesn't exist, don't set trialEndsAt
      // This allows webhook to set it for first install
      
      
      subscription = await Subscription.findOneAndUpdate(
        { shop },
        planChangeData,
        { new: true }  // NO upsert - subscription must already exist
      );
      
    } else {
      // First install: Create subscription with pendingPlan so webhook can find it
      // CRITICAL: Create subscription NOW with pendingPlan and shopifySubscriptionId
      // This allows webhook to find and activate it even if it arrives before callback
      // CRITICAL: Set trialEndsAt immediately for first install (trial starts when plan is selected)
      // If user clicks "back", trialEndsAt will be cleared by webhook if subscription is cancelled
      const firstInstallData = {
        shop,
        plan: plan, // Set current plan (will be updated if pendingPlan is different)
        pendingPlan: plan, // Mark plan as pending until approved
        shopifySubscriptionId: shopifySubscription.id,
        status: 'pending', // Will be activated by webhook or callback
        trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000), // CRITICAL: Set trial end date immediately
        updatedAt: now
      };
      
      subscription = await Subscription.findOneAndUpdate(
        { shop },
        firstInstallData,
        { upsert: true, new: true }  // UPSERT allowed for first install
      );
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
    // Get current subscription to check for pendingPlan and pendingActivation
    const currentSub = await Subscription.findOne({ shop });
    
    const updateData = {
      shop,
      status: 'active',
      pendingActivation: false
    };
    
    const now = new Date();
    
    // If there's a pendingPlan, activate it now (user approved!)
    if (currentSub?.pendingPlan) {
      updateData.plan = currentSub.pendingPlan;
      updateData.pendingPlan = null; // Clear pending
      updateData.pendingActivation = false; // CRITICAL: Clear pendingActivation when pendingPlan is approved
      
      // CRITICAL: DO NOT set activatedAt when approving pendingPlan - user is in trial period
      // activatedAt should only be set when user clicks "Activate Plan" (pendingActivation)
      // If activatedAt already exists (from previous activation), preserve it
      if (currentSub.activatedAt) {
        // User already activated plan previously - preserve activatedAt
        updateData.activatedAt = currentSub.activatedAt;
      } else {
        // User is in trial - DO NOT set activatedAt
        // activatedAt will be set when user clicks "Activate Plan" (pendingActivation)
      }
      
      // CRITICAL: Preserve shopifySubscriptionId from charge_id if provided
      // This ensures webhook can find the subscription even if it arrives before callback
      if (charge_id) {
        updateData.shopifySubscriptionId = charge_id;
      } else if (currentSub?.shopifySubscriptionId) {
        // If no charge_id but we have shopifySubscriptionId from /subscribe, preserve it
        updateData.shopifySubscriptionId = currentSub.shopifySubscriptionId;
      }
      
      // PRESERVE TRIAL if still active!
      // CRITICAL: According to Shopify documentation:
      // - If plan is activated (activatedAt exists): NO trial, continue billing period
      // - If plan is in trial (no activatedAt): Preserve trial end date
      // IMPORTANT: Only preserve trial if plan is NOT activated yet (no activatedAt)
      // If activatedAt exists, plan is already activated - no trial on upgrade!
      if (currentSub.activatedAt) {
        // CRITICAL: Plan is already activated - NO trial on upgrade!
        // According to Shopify: upgrade after activation continues billing period (no new trial)
        updateData.trialEndsAt = null;
      } else if (currentSub.trialEndsAt) {
        // Plan is in trial - preserve trial end date
        const trialEnd = new Date(currentSub.trialEndsAt);
        if (now < trialEnd) {
          // Trial is still active - preserve the original trial end date
          updateData.trialEndsAt = currentSub.trialEndsAt;
        } else {
          // Trial already ended - clear it
          updateData.trialEndsAt = null;
        }
      } else if (!currentSub.trialEndsAt) {
        // First install: Set trial end date (from TRIAL_DAYS)
        // Only set if this is first install (no activatedAt and no trialEndsAt exists)
        updateData.trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      }
    } else if (plan && PLANS[plan]) {
      // CRITICAL: Check if this is an ACTIVATION callback (user clicked "Activate Plan" and approved)
      // IMPORTANT: Check pendingActivation FIRST, even if activatedAt is already set (webhook might have arrived first)
      const isPendingActivation = currentSub?.pendingActivation;
      
      if (isPendingActivation) {
        // CRITICAL: This is an ACTIVATION callback - user approved the charge!
        // NOW we can set activatedAt (user confirmed in Shopify)
        // IMPORTANT: Only set activatedAt if not already set (webhook might have arrived first)
        if (!currentSub.activatedAt) {
          updateData.activatedAt = new Date();
        } else {
          // Webhook already set activatedAt - preserve it
          updateData.activatedAt = currentSub.activatedAt;
        }
        updateData.plan = plan;
        updateData.trialEndsAt = null; // Trial ended when user clicked "Activate Plan"
        updateData.pendingActivation = false; // CRITICAL: Clear pending activation flag (ALWAYS clear if pendingActivation was true)
        
        // CRITICAL: Preserve shopifySubscriptionId from charge_id if provided
        // This ensures webhook can find the subscription even if it arrives before callback
        if (charge_id) {
          updateData.shopifySubscriptionId = charge_id;
        } else if (currentSub?.shopifySubscriptionId) {
          // If no charge_id but we have shopifySubscriptionId from /activate, preserve it
          updateData.shopifySubscriptionId = currentSub.shopifySubscriptionId;
        }
        
      } else if (currentSub?.activatedAt) {
        // Already activated - preserve existing activation data
        // CRITICAL: Always update plan to match the approved plan (even if same)
        // This ensures plan is correctly set after approval
        updateData.plan = plan;
        
        // CRITICAL: According to Shopify documentation:
        // - If plan is activated (activatedAt exists): NO trial, continue billing period
        // - Upgrade after activation continues billing period (no new trial)
        // PRESERVE activatedAt but CLEAR trialEndsAt (no trial on upgrade after activation!)
        updateData.activatedAt = currentSub.activatedAt;
        updateData.trialEndsAt = null; // CRITICAL: NO trial on upgrade after activation!
        
      } else {
        // First subscription approval: User approved plan from /subscribe
        // CRITICAL: DO NOT set activatedAt here - user is in trial period
        // activatedAt should only be set when user clicks "Activate Plan" (pendingActivation)
        updateData.plan = plan;
        updateData.pendingPlan = null;
        // CRITICAL: DO NOT set activatedAt - user is in trial, activatedAt should be undefined
        // Only set activatedAt when user explicitly clicks "Activate Plan" (pendingActivation)
        
        // Set trial end date (from TRIAL_DAYS) only if not already set
        // This handles cases where trialEndsAt was set by webhook before callback
        if (!currentSub?.trialEndsAt) {
          updateData.trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
        } else {
          // Preserve existing trialEndsAt (set by webhook or /subscribe)
          updateData.trialEndsAt = currentSub.trialEndsAt;
        }
        
        // CRITICAL: Preserve shopifySubscriptionId from charge_id if provided
        if (charge_id) {
          updateData.shopifySubscriptionId = charge_id;
        } else if (currentSub?.shopifySubscriptionId) {
          updateData.shopifySubscriptionId = currentSub.shopifySubscriptionId;
        }
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
    
    // If plan was activated (pendingPlan → plan OR pendingActivation → activatedAt), set included tokens
    // CRITICAL: Only add included tokens if trial has ended (activatedAt is set and trialEndsAt is null or past)
    if ((currentSub?.pendingPlan || currentSub?.pendingActivation || subscription.activatedAt) && subscription.plan) {
      const now = new Date();
      // CRITICAL: Trial is active only if trialEndsAt exists, is in the future, AND plan is not activated yet
      const inTrial = subscription.trialEndsAt && now < new Date(subscription.trialEndsAt) && !subscription.activatedAt;
      const isFullyActivated = subscription.activatedAt && !inTrial;
      
      if (isFullyActivated) {
        // Trial ended and plan is activated → set included tokens (or zero them if plan has none)
        // CRITICAL: Always call setIncludedTokens, even if tokens is 0, to zero out included tokens on downgrade
        const included = getIncludedTokens(subscription.plan);
        const tokenBalance = await TokenBalance.getOrCreate(shop);
        
        // Use setIncludedTokens to replace old included tokens (keeps purchased)
        // IMPORTANT: This will zero out included tokens if new plan has none (downgrade)
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
    
    res.redirect(`/apps/${APP_PROXY_SUBPATH}${redirectPath}?shop=${shop}&success=true`);
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
    res.redirect(`/apps/${APP_PROXY_SUBPATH}${redirectPath}?shop=${shop}&tokens_purchased=true&amount=${tokens}`);
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
    
    // For EXEMPT shops, ensure they have Enterprise tokens
    if (isExemptShop(shop)) {
      await ensureExemptShopAccess(shop);
    }
    
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    
    // Disable HTTP caching for token balance
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
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
    // CRITICAL: Trial is active only if trialEndsAt exists, is in the future, AND plan is not activated yet
    const inTrial = subscription?.trialEndsAt && now < new Date(subscription.trialEndsAt) && !subscription?.activatedAt;
    
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
    
    // Get current subscription
    const subscription = await Subscription.findOne({ shop });
    
    if (!subscription) {
      console.error('[BILLING-ACTIVATE] ❌ No subscription found for:', shop);
      return res.status(404).json({ error: 'No active subscription found' });
    }
    
    // CRITICAL: Clear any existing pendingPlan before creating new activation
    // BUT: DO NOT clear pendingActivation or shopifySubscriptionId if they exist
    // If pendingActivation exists, it means user clicked "Activate Plan" but didn't approve
    // We should check if that subscription was cancelled, and only then clear it
    // This allows user to retry activation if previous attempt failed
    if (subscription.pendingPlan) {
      await Subscription.updateOne(
        { shop },
        { $unset: { pendingPlan: '' } }
      );
      
      // Reload subscription without pendingPlan
      const updatedSub = await Subscription.findOne({ shop });
      if (updatedSub) {
        Object.assign(subscription, updatedSub.toObject());
      }
    }
    
    // CRITICAL: If pendingActivation exists, check if the subscription was cancelled
    // If it was cancelled (user clicked "back"), clear pendingActivation to allow new activation
    if (subscription.pendingActivation && subscription.shopifySubscriptionId) {
      const shopDoc = await Shop.findOne({ shop });
      if (shopDoc?.accessToken) {
        const { getSubscriptionById } = await import('./shopifyBilling.js');
        const shopifySub = await getSubscriptionById(
          shop, 
          subscription.shopifySubscriptionId, 
          shopDoc.accessToken
        );
        
        // If subscription doesn't exist or is CANCELLED, clear pendingActivation
        if (!shopifySub || shopifySub.status === 'CANCELLED') {
          await Subscription.updateOne(
            { shop },
            { $unset: { pendingActivation: '', shopifySubscriptionId: '' } }
          );
          
          // Reload subscription without pendingActivation
          const updatedSub = await Subscription.findOne({ shop });
          if (updatedSub) {
            Object.assign(subscription, updatedSub.toObject());
          }
        }
      }
    }
    
    // CRITICAL: If user has pendingActivation but no pendingPlan (or pendingPlan matches current plan),
    // and we're trying to activate the current plan, we need to check if the pendingActivation
    // is for the current plan or for a different plan (from a previous activation attempt)
    // If pendingActivation exists but pendingPlan is null or matches current plan, it's for current plan - OK
    // If pendingActivation exists but pendingPlan is different, it's for different plan - clear it
    if (subscription.pendingActivation && !subscription.pendingPlan && endTrial) {
      // pendingActivation exists but no pendingPlan - this means it's from a previous activation attempt
      // We need to check if the subscription in Shopify is still pending or was cancelled
      // If it was cancelled, clear pendingActivation to allow new activation
      const pendingSubscriptionId = subscription.shopifySubscriptionId;
      
      if (pendingSubscriptionId) {
        const shopDoc = await Shop.findOne({ shop });
        if (shopDoc?.accessToken) {
          const { getSubscriptionById } = await import('./shopifyBilling.js');
          const shopifySub = await getSubscriptionById(
            shop, 
            pendingSubscriptionId, 
            shopDoc.accessToken
          );
          
          // If subscription doesn't exist or is CANCELLED, clear pendingActivation
          if (!shopifySub || shopifySub.status === 'CANCELLED') {
            await Subscription.updateOne(
              { shop },
              { $unset: { pendingActivation: '', shopifySubscriptionId: '' } }
            );
            
            // Reload subscription without pendingActivation
            const updatedSub = await Subscription.findOne({ shop });
            if (updatedSub) {
              Object.assign(subscription, updatedSub.toObject());
            }
          }
        }
      } else {
        // No shopifySubscriptionId but pendingActivation exists - clear it
        await Subscription.updateOne(
          { shop },
          { $unset: { pendingActivation: '' } }
        );
        
        // Reload subscription without pendingActivation
        const updatedSub = await Subscription.findOne({ shop });
        if (updatedSub) {
          Object.assign(subscription, updatedSub.toObject());
        }
      }
    }
    
    // FIX: If user has pendingActivation or activatedAt but subscription wasn't approved in Shopify,
    // clear them to allow new activation
    // This check happens BEFORE creating new subscription, so it validates the OLD subscription ID
    // NOTE: Only check if pendingActivation still exists (wasn't cleared by previous checks)
    if ((subscription.pendingActivation || subscription.activatedAt) && endTrial && !subscription.pendingPlan) {
      const pendingSubscriptionId = subscription.shopifySubscriptionId;
      
      // If no shopifySubscriptionId, definitely not approved
      if (!pendingSubscriptionId) {
        await Subscription.updateOne(
          { shop },
          { $unset: { activatedAt: '', pendingActivation: '', trialEndsAt: '' } }
        );
        
        // Reload subscription without activation flags
        const updatedSub = await Subscription.findOne({ shop });
        if (updatedSub) {
          Object.assign(subscription, updatedSub.toObject());
        }
      } else {
        const shopDoc = await Shop.findOne({ shop });
        if (shopDoc?.accessToken) {
          // CRITICAL: Use getSubscriptionById instead of getCurrentSubscription
          // getCurrentSubscription only returns ACTIVE subscriptions
          // getSubscriptionById checks if subscription exists (even if PENDING)
          // This is important when subscription is waiting for approval
          const { getSubscriptionById } = await import('./shopifyBilling.js');
          const shopifySub = await getSubscriptionById(
            shop, 
            pendingSubscriptionId, 
            shopDoc.accessToken
          );
          
          // Subscription exists if found (even if PENDING - waiting for approval)
          // Only clear activation flags if subscription doesn't exist at all (CANCELLED or never created)
          const subscriptionExists = !!shopifySub;
          
          // If subscription exists but is CANCELLED, clear activation flags
          const isCancelled = shopifySub?.status === 'CANCELLED';
          
          const isApproved = subscriptionExists && !isCancelled;
          
          if (!isApproved) {
            // Activation wasn't approved (user clicked back) - clear activation flags to allow new activation
            await Subscription.updateOne(
              { shop },
              { $unset: { activatedAt: '', pendingActivation: '', trialEndsAt: '', shopifySubscriptionId: '' } }
            );
            
            // Reload subscription without activation flags
            const updatedSub = await Subscription.findOne({ shop });
            if (updatedSub) {
              Object.assign(subscription, updatedSub.toObject());
            }
          }
        }
      }
    }
    
    // Update subscription
    // CRITICAL FIX: DO NOT set activatedAt here - only set it in callback AFTER user approves!
    // This prevents plan from being activated if user clicks "back" without approving
    const updateData = {
      pendingActivation: true // Mark as pending - will be activated in callback after approval
      // NOTE: activatedAt is NOT set here - only set in callback after Shopify approval
    };
    
    // If ending trial, clear trialEndsAt AND end trial in Shopify
    if (endTrial) {
      updateData.trialEndsAt = null;
      
      // CRITICAL: End trial in Shopify to start billing NOW!
      // Otherwise Shopify will auto-charge after 5 days even if features were locked!
      try {
        const shopDoc = await Shop.findOne({ shop });
        if (!shopDoc || !shopDoc.accessToken) {
          console.error('[BILLING-ACTIVATE] ❌ Shop not found in DB:', { shop, found: !!shopDoc });
          throw new Error('Shop access token not found');
        }
        
        // CRITICAL: Cancel OLD subscription before creating new one!
        // If user has an existing active subscription (with trial), we must cancel it first
        // Otherwise we'll have TWO subscriptions active at once
        // IMPORTANT: Check BOTH MongoDB AND Shopify for active subscriptions
        let oldSubscriptionId = subscription.shopifySubscriptionId;
        
        // If no subscription ID in MongoDB, check Shopify for any active subscription
        if (!oldSubscriptionId) {
          const { getCurrentSubscription } = await import('./shopifyBilling.js');
          const shopifySub = await getCurrentSubscription(shop, shopDoc.accessToken);
          
          if (shopifySub?.id) {
            oldSubscriptionId = shopifySub.id;
          }
        }
        
        if (oldSubscriptionId) {
          await cancelSubscription(
            shop,
            oldSubscriptionId,
            shopDoc.accessToken
          );
        }
        
        // Use appSubscriptionCancel + immediate recreate to end trial
        // This is the recommended Shopify approach for ending trials early
        const { createSubscription } = await import('./shopifyBilling.js');
        
        const { confirmationUrl, subscription: newShopifySubscription } = await createSubscription(
          shop,
          subscription.plan,
          shopDoc.accessToken,
          { 
            trialDays: 0, // NO trial - start billing NOW!
            returnTo: returnTo || '/billing' // Where to redirect after approval
          }
        );
        
        // CRITICAL: Store shopifySubscriptionId but DO NOT set activatedAt yet!
        // activatedAt will be set in callback ONLY after user approves
        // CRITICAL: Ensure pendingActivation is true so webhook can find subscription
        updateData.shopifySubscriptionId = newShopifySubscription.id;
        updateData.pendingActivation = true; // CRITICAL: Set explicitly to handle race conditions
        
        // Update MongoDB with pending activation (NO activatedAt yet!)
        // Use findOneAndUpdate to ensure atomic update and return updated document
        await Subscription.findOneAndUpdate(
          { shop },
          { $set: updateData },
          { new: true } // Return updated document
        );
        
        // If confirmationUrl exists, merchant needs to approve the charge
        if (confirmationUrl) {
          // Invalidate cache so callback reads fresh data
          await cacheService.invalidateShop(shop);
          
          // Return confirmation URL so frontend can redirect
          // NOTE: activatedAt is NOT set yet - only set in callback after approval
          // If user clicks Back without approving, pendingActivation stays true
          // and activatedAt remains undefined, so plan is NOT activated
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
    
    // If no confirmationUrl needed (shouldn't happen for endTrial, but handle anyway)
    await Subscription.updateOne({ shop }, { $set: updateData });
    
    // CRITICAL: DO NOT add tokens here - plan is NOT activated yet!
    // Tokens will be added in callback AFTER user approves the charge
    // Only add tokens if activatedAt is set (which it's not - only set in callback)
    
    // Invalidate cache
    await cacheService.invalidateShop(shop);
    
    // Return success (but plan is NOT activated yet - pending approval)
    res.json({
      success: true,
      plan: subscription.plan,
      pendingActivation: true, // Plan is pending - not activated yet
      trialEnded: endTrial,
      message: 'Plan activation pending approval'
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

// ============================================
// ADMIN ENDPOINTS - Promo & Allowlist Management
// Protected by ADMIN_SECRET environment variable
// ============================================

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin-secret-change-me';

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const providedSecret = authHeader?.replace('Bearer ', '') || req.query.secret;
  
  if (providedSecret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized - invalid admin secret' });
  }
  next();
}

/**
 * Generate promo codes
 * POST /api/billing/admin/promo/generate
 * Body: { count, prefix, type, trialDays, maxUses, expiresInDays, campaign, notes }
 */
router.post('/admin/promo/generate', adminAuth, async (req, res) => {
  try {
    const {
      count = 10,
      prefix = 'PROMO',
      type = 'free_month',
      trialDays = 30,
      maxUses = 1,
      expiresInDays = 90,
      campaign = null,
      notes = null
    } = req.body;
    
    const codes = await PromoCode.generateCodes(count, {
      prefix,
      type,
      trialDays,
      maxUses,
      expiresInDays,
      campaign,
      notes,
      createdBy: 'admin'
    });
    
    console.log(`[ADMIN] Generated ${codes.length} promo codes:`, codes);
    
    res.json({
      success: true,
      count: codes.length,
      codes,
      config: { type, trialDays, maxUses, expiresInDays, campaign }
    });
  } catch (error) {
    console.error('[ADMIN] Error generating promo codes:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * List promo codes
 * GET /api/billing/admin/promo/list
 */
router.get('/admin/promo/list', adminAuth, async (req, res) => {
  try {
    const { campaign, valid } = req.query;
    
    const query = {};
    if (campaign) query.campaign = campaign;
    if (valid === 'true') {
      query.expiresAt = { $gt: new Date() };
      query.$expr = { $lt: ['$currentUses', '$maxUses'] };
    }
    
    const codes = await PromoCode.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    
    res.json({
      success: true,
      count: codes.length,
      codes: codes.map(c => ({
        ...c,
        isValid: new Date() < c.expiresAt && c.currentUses < c.maxUses
      }))
    });
  } catch (error) {
    console.error('[ADMIN] Error listing promo codes:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Check promo code validity
 * GET /api/billing/admin/promo/check?code=XXX
 */
router.get('/admin/promo/check', adminAuth, async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).json({ error: 'Code parameter required' });
    }
    
    const result = await PromoCode.checkValidity(code);
    res.json(result);
  } catch (error) {
    console.error('[ADMIN] Error checking promo code:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add shop to allowlist
 * POST /api/billing/admin/allowlist/add
 * Body: { shop, promoType, trialDays, expiresInDays, reason, campaign, notes }
 */
router.post('/admin/allowlist/add', adminAuth, async (req, res) => {
  try {
    const {
      shop,
      promoType = 'free_month',
      trialDays = 30,
      discountPercent = 0,
      expiresInDays = 30,
      reason = null,
      campaign = null,
      notes = null
    } = req.body;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop domain required' });
    }
    
    const entry = await PromoAllowlist.addShop(shop, {
      promoType,
      trialDays,
      discountPercent,
      expiresInDays,
      reason,
      campaign,
      addedBy: 'admin',
      notes
    });
    
    console.log(`[ADMIN] Added shop to allowlist:`, entry);
    
    res.json({
      success: true,
      entry
    });
  } catch (error) {
    console.error('[ADMIN] Error adding to allowlist:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Remove shop from allowlist
 * DELETE /api/billing/admin/allowlist/remove?shop=XXX
 */
router.delete('/admin/allowlist/remove', adminAuth, async (req, res) => {
  try {
    const { shop } = req.query;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter required' });
    }
    
    const removed = await PromoAllowlist.removeShop(shop);
    
    res.json({
      success: true,
      removed
    });
  } catch (error) {
    console.error('[ADMIN] Error removing from allowlist:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * List allowlist entries
 * GET /api/billing/admin/allowlist/list
 */
router.get('/admin/allowlist/list', adminAuth, async (req, res) => {
  try {
    const { valid } = req.query;
    
    const query = {};
    if (valid === 'true') {
      query.expiresAt = { $gt: new Date() };
    }
    
    const entries = await PromoAllowlist.find(query)
      .sort({ addedAt: -1 })
      .limit(100)
      .lean();
    
    res.json({
      success: true,
      count: entries.length,
      entries: entries.map(e => ({
        ...e,
        isValid: new Date() < e.expiresAt
      }))
    });
  } catch (error) {
    console.error('[ADMIN] Error listing allowlist:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Check shop promo status
 * GET /api/billing/admin/shop/promo-status?shop=XXX
 */
router.get('/admin/shop/promo-status', adminAuth, async (req, res) => {
  try {
    const { shop } = req.query;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter required' });
    }
    
    const isExempt = isExemptShop(shop);
    const allowlistCheck = await PromoAllowlist.checkShop(shop);
    const shopDoc = await Shop.findOne({ shop }).lean();
    const subscription = await Subscription.findOne({ shop }).lean();
    
    res.json({
      shop,
      isExempt,
      onAllowlist: allowlistCheck.onAllowlist,
      allowlistPromo: allowlistCheck.promo || null,
      shopPromo: shopDoc ? {
        campaignSource: shopDoc.campaignSource,
        promoCode: shopDoc.promoCode,
        promoType: shopDoc.promoType,
        hasPromoEligibility: shopDoc.hasPromoEligibility
      } : null,
      subscription: subscription ? {
        plan: subscription.plan,
        status: subscription.status,
        shopifySubscriptionId: subscription.shopifySubscriptionId,
        activatedAt: subscription.activatedAt,
        trialEndsAt: subscription.trialEndsAt
      } : null
    });
  } catch (error) {
    console.error('[ADMIN] Error checking shop promo status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Force cancel Shopify subscription for a shop
 * POST /api/billing/admin/shop/cancel-subscription
 * Body: { shop }
 */
router.post('/admin/shop/cancel-subscription', adminAuth, async (req, res) => {
  try {
    const { shop } = req.body;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop domain required' });
    }
    
    const shopDoc = await Shop.findOne({ shop });
    if (!shopDoc?.accessToken) {
      return res.status(404).json({ error: 'Shop not found or no access token' });
    }
    
    // Get current Shopify subscription
    const activeSub = await getCurrentSubscription(shop, shopDoc.accessToken);
    
    if (!activeSub?.id) {
      return res.json({ success: true, message: 'No active Shopify subscription found' });
    }
    
    // Cancel it
    const cancelled = await cancelSubscription(shop, activeSub.id, shopDoc.accessToken);
    
    // Update local subscription
    await Subscription.findOneAndUpdate(
      { shop },
      { 
        shopifySubscriptionId: null,
        status: 'active' // Keep as active if they have promo/exempt status
      }
    );
    
    res.json({
      success: true,
      cancelled,
      message: `Cancelled Shopify subscription ${activeSub.id} for ${shop}`
    });
  } catch (error) {
    console.error('[ADMIN] Error cancelling subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

