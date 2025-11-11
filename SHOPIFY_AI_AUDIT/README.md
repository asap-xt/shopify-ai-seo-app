# SHOPIFY AI AUDIT - BILLING FLOW FILES

## 📋 PURPOSE

This folder contains all files related to the billing flow for Shopify AI analysis and recommendations.

---

## 📂 FILES INCLUDED

### **Backend (9 files)**

1. **`auth.js`** - OAuth flow, shop authentication, initial redirect after install
2. **`billingRoutes.js`** - Plan subscription, Shopify charge creation, billing callback
3. **`plans.js`** - Plan configuration (prices, limits, features)
4. **`seoController.js`** - GraphQL `plansMe` resolver, subscription status checks
5. **`Shop.js`** - MongoDB schema for shop data (accessToken, etc.)
6. **`Subscription.js`** - MongoDB schema for subscriptions (plan, status, trial)
7. **`subscription-update.js`** - Webhook handler for Shopify subscription updates
8. **`webhookValidator.js`** - HMAC validation for webhooks
9. **`shopifyApi.js`** - Shopify API initialization, session storage

### **Frontend (3 files)**

10. **`Billing.jsx`** - Plan selection UI, post-billing redirect logic
11. **`App.jsx`** - Main app routing, `forceBillingPage` logic
12. **`AppBridgeProvider.jsx`** - App Bridge initialization

---

## 🎯 MAIN ISSUE

**Problem:** After user approves a plan in Shopify billing modal, the app does NOT automatically redirect to Dashboard. User remains on Billing page.

**Current Flow:**
1. User approves plan → Shopify redirects to `/apps/new-ai-seo/billing?shop=...&success=true`
2. First load: NO `embedded` or `host` params → `host=null`, `embedded=null`
3. Shopify reloads: NOW has `&embedded=1&host=...`
4. Second load: Redirect to `/dashboard?...&embedded=1&host=...`
5. **ISSUE:** Redirect happens but user stays on Billing page OR sees "Not embedded" error

---

## 📖 DOCUMENTATION

See `BILLING_FLOW_ANALYSIS.md` for:
- Complete step-by-step flow
- Current issues & attempted solutions
- Questions for Shopify AI
- Desired behavior

---

## 🔍 HOW TO ANALYZE

1. Read `BILLING_FLOW_ANALYSIS.md` first (overview & issues)
2. Review backend files (auth → billing → callback)
3. Review frontend files (Billing page → redirect logic)
4. Identify gaps or anti-patterns
5. Suggest official Shopify-recommended approach

---

## 📦 PACKAGE VERSIONS

- **Shopify API:** v11.14.1
- **App Bridge:** v3.7.10
- **App Bridge React:** v4.2.1
- **Node.js:** v18.20.5
- **React:** v18.3.1

---

**Thank you for reviewing!** 🙏

