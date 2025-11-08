/**
 * Google Analytics 4 & Meta Pixel Tracking Utilities
 * 
 * Usage:
 * import { trackEvent, trackPageView, trackFBEvent } from '@/utils/analytics';
 * 
 * trackEvent('product_optimized', { count: 5, type: 'ai_enhanced' });
 * trackPageView('/dashboard');
 * trackFBEvent('Subscribe', { value: 19.99, currency: 'USD' });
 */

// Initialize GA4
export const initGA4 = () => {
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('[ANALYTICS] GA4 not loaded');
    return;
  }

  console.log('[ANALYTICS] GA4 initialized');
};

// Initialize Meta Pixel
export const initFBPixel = () => {
  if (typeof window === 'undefined' || !window.fbq) {
    console.warn('[ANALYTICS] Meta Pixel not loaded');
    return;
  }

  console.log('[ANALYTICS] Meta Pixel initialized');
};

// Track Facebook Pixel events
export const trackFBEvent = (eventName, params = {}) => {
  if (typeof window === 'undefined' || !window.fbq) {
    console.warn('[ANALYTICS] Meta Pixel not available, skipping event:', eventName);
    return;
  }

  try {
    window.fbq('track', eventName, params);
    console.log('[ANALYTICS] FB Event tracked:', eventName, params);
  } catch (error) {
    console.error('[ANALYTICS] Error tracking FB event:', error);
  }
};

// Track custom events
export const trackEvent = (eventName, params = {}) => {
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('[ANALYTICS] GA4 not available, skipping event:', eventName);
    return;
  }

  try {
    window.gtag('event', eventName, {
      ...params,
      timestamp: new Date().toISOString(),
      app_version: '1.0.0'
    });
    console.log('[ANALYTICS] Event tracked:', eventName, params);
  } catch (error) {
    console.error('[ANALYTICS] Error tracking event:', error);
  }
};

// Track page views (for SPA navigation)
export const trackPageView = (pagePath, pageTitle = '') => {
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('[ANALYTICS] GA4 not available, skipping page view:', pagePath);
    return;
  }

  try {
    window.gtag('event', 'page_view', {
      page_path: pagePath,
      page_title: pageTitle || document.title,
      page_location: window.location.href
    });
    console.log('[ANALYTICS] Page view tracked:', pagePath);
  } catch (error) {
    console.error('[ANALYTICS] Error tracking page view:', error);
  }
};

// App lifecycle events
export const trackAppInstalled = (shop) => {
  trackEvent('app_installed', { shop });
  trackFBEvent('CompleteRegistration'); // FB conversion event
};

export const trackAppUninstalled = (shop) => {
  trackEvent('app_uninstalled', { shop });
};

// Product optimization events
export const trackProductOptimization = (params) => {
  trackEvent('product_optimized', {
    count: params.count || 1,
    type: params.type || 'basic', // 'basic' or 'ai_enhanced'
    language: params.language || 'en',
    duration_ms: params.duration
  });
};

export const trackCollectionOptimization = (params) => {
  trackEvent('collection_optimized', {
    count: params.count || 1,
    type: params.type || 'basic',
    language: params.language || 'en',
    duration_ms: params.duration
  });
};

// Sitemap events
export const trackSitemapGenerated = (params) => {
  trackEvent('sitemap_generated', {
    type: params.type || 'basic', // 'basic' or 'ai_enhanced'
    products: params.products || 0,
    collections: params.collections || 0,
    languages: params.languages || 1,
    duration_ms: params.duration
  });
};

export const trackSitemapViewed = () => {
  trackEvent('sitemap_viewed');
};

// Billing events
export const trackPlanUpgraded = (params) => {
  trackEvent('plan_upgraded', {
    from_plan: params.from,
    to_plan: params.to,
    mrr_change: params.mrrChange
  });
  
  // Track FB conversion
  trackFBEvent('Subscribe', {
    value: params.newPrice || 0,
    currency: 'USD',
    predicted_ltv: (params.newPrice || 0) * 12 // Annual value
  });
};

export const trackTokenPurchased = (params) => {
  trackEvent('token_purchased', {
    amount: params.amount,
    price: params.price,
    currency: 'USD'
  });
  
  // Track FB purchase
  trackFBEvent('Purchase', {
    value: params.price,
    currency: 'USD',
    content_name: `Token Pack ${params.amount.toLocaleString()}`,
    content_type: 'product'
  });
};

export const trackTrialStarted = (plan, price = 0) => {
  trackEvent('trial_started', { plan });
  
  // Track FB trial start
  trackFBEvent('StartTrial', {
    value: price,
    currency: 'USD',
    predicted_ltv: price * 12
  });
};

export const trackSubscriptionActivated = (params) => {
  trackEvent('subscription_activated', {
    plan: params.plan,
    price: params.price,
    currency: 'USD'
  });
  
  // Track FB subscription
  trackFBEvent('Subscribe', {
    value: params.price,
    currency: 'USD',
    predicted_ltv: params.price * 12
  });
};

// Settings events
export const trackSettingChanged = (params) => {
  trackEvent('setting_changed', {
    setting_name: params.name,
    setting_value: params.value,
    section: params.section || 'general'
  });
};

export const trackLanguageEnabled = (language) => {
  trackEvent('language_enabled', { language });
};

// AI Testing events
export const trackAITestingStarted = () => {
  trackEvent('ai_testing_started');
};

export const trackAITestingCompleted = (params) => {
  trackEvent('ai_testing_completed', {
    endpoints_tested: params.endpointsTested || 0,
    duration_ms: params.duration,
    tokens_used: params.tokensUsed || 0
  });
};

// Store metadata events
export const trackStoreMetadataSaved = () => {
  trackEvent('store_metadata_saved');
};

// Schema events
export const trackSchemaCopied = (type) => {
  trackEvent('schema_copied', { schema_type: type });
};

// Error tracking
export const trackError = (params) => {
  trackEvent('error_occurred', {
    error_message: params.message,
    error_code: params.code,
    page: params.page || window.location.pathname
  });
};

// User engagement
export const trackFeatureUsed = (featureName) => {
  trackEvent('feature_used', { feature_name: featureName });
};

export const trackHelpViewed = (topic) => {
  trackEvent('help_viewed', { help_topic: topic });
};

