# Analytics Implementation

## Overview
This app uses Google Analytics 4 (GA4) and Meta Pixel to track merchant behavior and improve the app experience.

## What We Track

### Google Analytics 4
- **Page Views**: Navigation between Dashboard, Billing, Settings, etc.
- **Feature Usage**: Product optimization, sitemap generation, AI testing
- **Plan Events**: Trial starts, subscriptions, plan upgrades
- **Product Events**: Products optimized, collections optimized
- **Performance Metrics**: API response times, error rates

### Meta Pixel
- **CompleteRegistration**: When a merchant installs the app
- **StartTrial**: When a trial period begins
- **Subscribe**: When a merchant activates a paid subscription or upgrades
- **Purchase**: When tokens are purchased

## What We DON'T Track

❌ End customer personal information (emails, names, addresses)
❌ Individual customer order details
❌ Customer purchase history
❌ Sensitive merchant data

## Configuration

### IDs
- **GA4 Measurement ID**: `G-9K66SEGS4Q`
- **Meta Pixel ID**: `1609120716735758`

### Features
- **IP Anonymization**: Enabled (GA4)
- **Manual Page View Tracking**: Enabled (for SPA routing)
- **Async Loading**: All scripts load asynchronously

## GDPR Compliance

This app is GDPR compliant:
- We only track aggregate merchant behavior (B2B context)
- No end-customer PII is collected
- Merchants are informed via Privacy Policy
- `shop/redact` and `customers/redact` webhooks are implemented
- Data is used solely for product improvement

## Privacy Policy Disclosure

The following disclosure is included in our Privacy Policy:

> **Analytics & Tracking**
> 
> We use Google Analytics and Meta Pixel to:
> - Understand how merchants use our app
> - Improve features and user experience
> - Measure app performance and stability
> 
> We do NOT track:
> - End customer personal information
> - Individual customer emails, names, or addresses
> - Individual order details or purchase history
> 
> We only track aggregate merchant behavior to improve our app.

## Usage Examples

### Track Product Optimization
```javascript
import { trackProductOptimization } from '@/utils/analytics';

trackProductOptimization({
  count: 5,
  type: 'ai_enhanced',
  language: 'en',
  duration: 2500
});
```

### Track Plan Upgrade
```javascript
import { trackPlanUpgraded } from '@/utils/analytics';

trackPlanUpgraded({
  from: 'starter',
  to: 'professional',
  mrrChange: 10.00,
  newPrice: 19.99
});
```

### Track Token Purchase
```javascript
import { trackTokenPurchased } from '@/utils/analytics';

trackTokenPurchased({
  amount: 1000000,
  price: 49.99
});
```

## Files Modified

- `frontend/index.html` - Added GA4 and Meta Pixel scripts
- `frontend/src/utils/analytics.js` - Analytics utility functions
- `frontend/src/App.jsx` - Page view tracking initialization
- Privacy Policy - Analytics disclosure

## Testing

To verify analytics are working:
1. Open browser DevTools → Console
2. Look for `[ANALYTICS]` logs
3. Check GA4 Real-Time reports: https://analytics.google.com/
4. Check Meta Pixel Events Manager: https://business.facebook.com/events_manager

## Future Enhancements

Potential additions after Shopify approval:
- Google Tag Manager (easier tag management)
- Hotjar or Microsoft Clarity (heatmaps, session recordings)
- Mixpanel or Amplitude (advanced SaaS metrics)
- Custom dashboards for merchant insights

