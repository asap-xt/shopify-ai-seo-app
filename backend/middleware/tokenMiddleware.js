// backend/middleware/tokenMiddleware.js
// Middleware for token validation and trial restrictions

import TokenBalance from '../db/TokenBalance.js';
import Subscription from '../db/Subscription.js';
import { requiresTokens, isBlockedInTrial, calculateFeatureCost } from '../billing/tokenConfig.js';

/**
 * Check if user is in trial period
 */
export function checkTrialStatus(req, res, next) {
  const subscription = req.subscription;
  
  if (!subscription) {
    req.inTrial = false;
    req.trialEndsAt = null;
    return next();
  }
  
  const now = new Date();
  const inTrial = subscription.trialEndsAt && now < new Date(subscription.trialEndsAt);
  
  req.inTrial = inTrial;
  req.trialEndsAt = subscription.trialEndsAt;
  
  next();
}

/**
 * Block token-based features during trial
 * Use this middleware on routes that require tokens
 */
export function blockTokenFeaturesInTrial(req, res, next) {
  const { inTrial } = req;
  const feature = req.body?.feature || req.query?.feature;
  
  if (inTrial && feature && isBlockedInTrial(feature)) {
    return res.status(402).json({
      error: 'Token-based features are not available during trial period',
      requiresActivation: true,
      trialRestriction: true,
      trialEndsAt: req.trialEndsAt,
      message: 'To use this feature, activate your paid plan or purchase tokens',
      options: [
        {
          action: 'activate_plan',
          label: 'End Trial & Activate Plan',
          description: 'Your plan will be charged immediately'
        },
        {
          action: 'purchase_tokens',
          label: 'Purchase Tokens Only',
          description: 'Keep your trial running'
        }
      ]
    });
  }
  
  next();
}

/**
 * Validate token balance before allowing feature use
 * Use this middleware on token-consuming routes
 */
export async function validateTokenBalance(req, res, next) {
  try {
    const shop = req.shop || req.shopDomain;
    const feature = req.body?.feature || req.query?.feature;
    const options = req.body?.options || {};
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter required' });
    }
    
    if (!feature) {
      return res.status(400).json({ error: 'Feature parameter required' });
    }
    
    // Check if feature requires tokens
    if (!requiresTokens(feature)) {
      console.log('[Token Middleware] Feature does not require tokens:', feature);
      return next();
    }
    
    // Get token balance
    const tokenBalance = await TokenBalance.getOrCreate(shop);
    
    // Calculate required tokens
    const requiredTokens = calculateFeatureCost(feature, options);
    
    console.log('[Token Middleware] Token check:', {
      shop,
      feature,
      required: requiredTokens,
      available: tokenBalance.balance
    });
    
    // Check if sufficient balance
    if (!tokenBalance.hasBalance(requiredTokens)) {
      return res.status(402).json({
        error: 'Insufficient token balance',
        requiresPurchase: true,
        tokensRequired: requiredTokens,
        tokensAvailable: tokenBalance.balance,
        tokensNeeded: requiredTokens - tokenBalance.balance,
        message: 'You need more tokens to use this feature',
        purchaseUrl: `/billing/tokens/purchase?shop=${shop}`
      });
    }
    
    // Attach token info to request
    req.tokenBalance = tokenBalance;
    req.requiredTokens = requiredTokens;
    req.feature = feature;
    
    next();
  } catch (error) {
    console.error('[Token Middleware] Error:', error);
    res.status(500).json({ error: 'Failed to validate token balance' });
  }
}

/**
 * Deduct tokens after successful operation
 * Call this after the feature has been used successfully
 */
export async function deductTokens(req, res, next) {
  try {
    const { tokenBalance, requiredTokens, feature } = req;
    const metadata = {
      productId: req.body?.productId,
      collectionId: req.body?.collectionId,
      ...req.body?.metadata
    };
    
    if (tokenBalance && requiredTokens) {
      await tokenBalance.deductTokens(requiredTokens, feature, metadata);
      
      console.log('[Token Middleware] Tokens deducted:', {
        shop: req.shop,
        feature,
        amount: requiredTokens,
        remaining: tokenBalance.balance
      });
      
      // Attach updated balance to response
      res.locals.tokensDeducted = requiredTokens;
      res.locals.tokensRemaining = tokenBalance.balance;
    }
    
    next();
  } catch (error) {
    console.error('[Token Middleware] Error deducting tokens:', error);
    // Don't fail the request, just log the error
    next();
  }
}

/**
 * Combined middleware: check trial + validate tokens
 * Use this as a single middleware for token-based routes
 */
export function requireTokens(feature) {
  return async (req, res, next) => {
    // Attach feature to request if provided
    if (feature && !req.body?.feature) {
      req.body = req.body || {};
      req.body.feature = feature;
    }
    
    // Check trial status first
    checkTrialStatus(req, res, (err) => {
      if (err) return next(err);
      
      // Block if in trial
      blockTokenFeaturesInTrial(req, res, (err) => {
        if (err) return next(err);
        
        // Validate token balance
        validateTokenBalance(req, res, next);
      });
    });
  };
}

/**
 * Middleware to attach subscription info to request
 * Should be used before token middleware
 */
export async function attachSubscriptionInfo(req, res, next) {
  try {
    const shop = req.shop || req.shopDomain || req.query?.shop;
    
    if (!shop) {
      return next();
    }
    
    const subscription = await Subscription.findOne({ shop });
    req.subscription = subscription;
    
    next();
  } catch (error) {
    console.error('[Token Middleware] Error attaching subscription:', error);
    next();
  }
}

