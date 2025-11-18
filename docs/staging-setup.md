# Staging Environment Setup Guide

## Overview
This guide explains how to set up a staging environment for continued development while the production app is under Shopify review.

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Production    │         │    Staging      │
│                 │         │                 │
│  Git: main      │         │  Git: staging   │
│  Railway: prod  │         │  Railway: stage │
│  Shopify: prod  │         │  Shopify: stage │
│  MongoDB: prod  │         │  MongoDB: stage │
└─────────────────┘         └─────────────────┘
```

## Step 1: Create Staging Branch

```bash
# Create and switch to staging branch
git checkout -b staging

# Push staging branch to remote
git push -u origin staging
```

## Step 2: Create Staging Shopify App

1. Go to [Shopify Partner Dashboard](https://partners.shopify.com/)
2. Create a **NEW** app (not a new version of existing app)
3. Name it: `indexAIze - Staging` or `indexAIze - Development`
4. Copy the new `client_id` and `client_secret`
5. Set up webhooks and redirect URLs for staging domain

## Step 3: Create Staging Railway Project

1. Go to [Railway Dashboard](https://railway.app/)
2. Create a **NEW** project: `indexAIze-Staging`
3. Connect your GitHub repo
4. Set branch to `staging` (not `main`)
5. Railway will auto-deploy from `staging` branch

## Step 4: Configure Staging Environment Variables

In Railway staging project, set these environment variables:

```bash
# Environment
NODE_ENV=staging

# Shopify App Credentials (from staging app)
SHOPIFY_API_KEY=<staging_client_id>
SHOPIFY_API_SECRET=<staging_client_secret>
SHOPIFY_SCOPES=read_products,write_products,read_themes,write_themes,read_translations,write_translations,read_locales,read_metaobjects,write_metaobjects,read_content,write_content,write_script_tags,read_markets

# MongoDB (separate database for staging)
MONGODB_URI=<staging_mongodb_uri>

# Redis (optional - can share or use separate)
REDIS_URL=<staging_redis_url>

# App URL (Railway will provide this)
APP_URL=https://indexaize-staging.up.railway.app

# Other environment variables...
# (copy from production, but adjust URLs to staging)
```

## Step 5: Create Staging shopify.app.toml

Create `shopify.app.staging.toml`:

```toml
# shopify.app.staging.toml
name = "indexAIze - Staging"
handle = "indexaize-staging"
client_id = "<staging_client_id>"
application_url = "https://indexaize-staging.up.railway.app"
embedded = true

[webhooks]
api_version = "2025-07"

# GDPR Compliance Webhooks
[[webhooks.subscriptions]]
compliance_topics = ["customers/data_request"]
uri = "/webhooks/customers/data_request"

[[webhooks.subscriptions]]
compliance_topics = ["customers/redact"]
uri = "/webhooks/customers/redact"

[[webhooks.subscriptions]]
compliance_topics = ["shop/redact"]
uri = "/webhooks/shop/redact"

[auth]
redirect_urls = [
  "https://indexaize-staging.up.railway.app/auth/callback",
  "https://indexaize-staging.up.railway.app/api/auth/callback",
  "https://indexaize-staging.up.railway.app/api/auth",
  "https://indexaize-staging.up.railway.app/"
]

[access_scopes]
scopes = "read_products,write_products,read_themes,write_themes,read_translations,write_translations,read_locales,read_metaobjects,write_metaobjects,read_content,write_content,write_script_tags,read_markets"

[app_proxy]
url = "https://indexaize-staging.up.railway.app/apps"
prefix = "apps"
subpath = "new-ai-seo"

[pos]
embedded = false

[build]
automatically_update_urls_on_dev = true
```

## Step 6: Update Code for Environment Detection

The code already uses `NODE_ENV` for environment detection. You can add staging-specific logic:

```javascript
const IS_PROD = process.env.NODE_ENV === 'production';
const IS_STAGING = process.env.NODE_ENV === 'staging';
const IS_DEV = !IS_PROD && !IS_STAGING;
```

## Step 7: Workflow

### Development Workflow

1. **Work on staging branch:**
   ```bash
   git checkout staging
   git pull origin staging
   # Make changes
   git add .
   git commit -m "feat: new feature"
   git push origin staging
   # Railway auto-deploys staging
   ```

2. **Merge to main when ready for production:**
   ```bash
   git checkout main
   git pull origin main
   git merge staging
   git push origin main
   # Railway auto-deploys production
   ```

### Testing Workflow

1. Test new features in staging environment
2. Install staging app on test shop
3. Verify everything works
4. Merge to main when ready

## Step 8: Database Separation

### Option A: Separate MongoDB Database (Recommended)

Create a new database in MongoDB:
- Production: `indexaize_prod`
- Staging: `indexaize_staging`

Update `MONGODB_URI` in Railway staging project to point to staging database.

### Option B: Same Database, Different Collections

Use environment prefix in collection names (not recommended, but possible).

## Step 9: Monitoring

Set up separate monitoring for staging:
- Railway logs for staging
- Error tracking (if using Sentry, create separate project)
- Analytics (separate tracking if needed)

## Step 10: Testing Checklist

Before merging staging → main:

- [ ] All features work in staging
- [ ] No console errors
- [ ] Webhooks work correctly
- [ ] Billing/subscriptions work
- [ ] Database migrations (if any) are tested
- [ ] Performance is acceptable
- [ ] Security checks pass

## Important Notes

1. **Never merge untested code to main** - main should always be production-ready
2. **Keep staging in sync** - regularly merge main → staging to avoid drift
3. **Test billing carefully** - use Shopify test mode in staging
4. **Separate test shops** - use different shops for staging vs production testing
5. **Document changes** - keep staging branch documented

## Quick Commands

```bash
# Switch to staging
git checkout staging

# Create feature branch from staging
git checkout -b feature/new-feature staging

# Merge staging to main (when ready)
git checkout main
git merge staging
git push origin main

# Sync staging with main (to get production fixes)
git checkout staging
git merge main
git push origin staging
```

## Troubleshooting

### Staging app not connecting
- Check `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` in Railway
- Verify redirect URLs in Shopify Partner Dashboard
- Check `APP_URL` matches Railway domain

### Database issues
- Verify `MONGODB_URI` points to staging database
- Check database connection in Railway logs

### Webhook issues
- Verify webhook URLs in Shopify Partner Dashboard
- Check webhook subscriptions are active
- Review Railway logs for webhook errors

