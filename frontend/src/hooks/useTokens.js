// frontend/src/hooks/useTokens.js
// Hook for managing token balance and handling token-related errors

import { useState, useCallback, useEffect } from 'react';

export function useTokens(shop) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch token balance
  const fetchBalance = useCallback(async () => {
    if (!shop) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/billing/tokens/balance?shop=${shop}`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setBalance(data);
    } catch (err) {
      console.error('[useTokens] Error fetching balance:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [shop]);

  // Check if feature requires tokens and user has trial restrictions
  const checkFeatureAccess = useCallback(async (feature, options = {}) => {
    if (!shop) return { allowed: false, reason: 'no_shop' };
    
    try {
      // This will be called before using a feature
      // The backend will check trial status and token balance
      const response = await fetch(`/api/billing/check-feature-access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          shop,
          feature,
          options
        })
      });
      
      const data = await response.json();
      
      if (response.status === 402) {
        // Payment required - either trial restriction or insufficient tokens
        return {
          allowed: false,
          reason: data.trialRestriction ? 'trial_restriction' : 'insufficient_tokens',
          details: data
        };
      }
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to check feature access');
      }
      
      return {
        allowed: true,
        details: data
      };
    } catch (err) {
      console.error('[useTokens] Error checking feature access:', err);
      return {
        allowed: false,
        reason: 'error',
        error: err.message
      };
    }
  }, [shop]);

  // Execute a token-consuming action
  const executeWithTokens = useCallback(async (feature, action, options = {}) => {
    if (!shop) throw new Error('Shop not available');
    
    try {
      // First check access
      const accessCheck = await checkFeatureAccess(feature, options);
      
      if (!accessCheck.allowed) {
        // Return the restriction info so caller can show appropriate modal
        throw {
          type: 'access_denied',
          reason: accessCheck.reason,
          details: accessCheck.details
        };
      }
      
      // Execute the action
      const result = await action();
      
      // Refresh balance after successful execution
      await fetchBalance();
      
      return result;
    } catch (err) {
      console.error('[useTokens] Error executing with tokens:', err);
      throw err;
    }
  }, [shop, checkFeatureAccess, fetchBalance]);

  // Purchase tokens redirect
  const purchaseTokens = useCallback((amount) => {
    if (!shop) return;
    
    // Redirect to billing page with token purchase flow
    window.location.href = `/apps/new-ai-seo/billing?shop=${shop}&purchase_tokens=true&amount=${amount}`;
  }, [shop]);

  // Activate plan redirect
  const activatePlan = useCallback(() => {
    if (!shop) return;
    
    // Redirect to billing page with plan activation flow
    window.location.href = `/apps/new-ai-seo/billing?shop=${shop}&activate_plan=true`;
  }, [shop]);

  // Initial fetch
  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  return {
    balance: balance?.balance || 0,
    totalPurchased: balance?.totalPurchased || 0,
    totalUsed: balance?.totalUsed || 0,
    lastPurchase: balance?.lastPurchase,
    recentUsage: balance?.recentUsage || [],
    loading,
    error,
    fetchBalance,
    checkFeatureAccess,
    executeWithTokens,
    purchaseTokens,
    activatePlan
  };
}

export default useTokens;

