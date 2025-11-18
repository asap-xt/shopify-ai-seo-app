# Staging Environment Quick Start

## 🚀 Quick Setup

### 1. Create Staging Branch
```bash
git checkout -b staging
git push -u origin staging
```

### 2. Create Staging Shopify App
1. Go to [Shopify Partner Dashboard](https://partners.shopify.com/)
2. Create **NEW** app: `indexAIze - Staging`
3. Copy `client_id` and `client_secret`

### 3. Create Staging Railway Project
1. Go to [Railway Dashboard](https://railway.app/)
2. Create **NEW** project: `indexAIze-Staging`
3. Connect GitHub repo
4. Set branch to `staging`
5. Add environment variables (see below)

### 4. Environment Variables (Railway Staging)

```bash
NODE_ENV=staging
SHOPIFY_API_KEY=<staging_client_id>
SHOPIFY_API_SECRET=<staging_client_secret>
MONGODB_URI=<staging_mongodb_uri>
APP_URL=<railway_staging_url>
# ... other vars
```

## 📋 Workflow

### Daily Development
```bash
# Work on staging
git checkout staging
# Make changes
git commit -m "feat: new feature"
git push origin staging
# Railway auto-deploys
```

### Merge to Production
```bash
# When ready for production
git checkout main
git merge staging
git push origin main
# Railway auto-deploys production
```

## 🔄 Sync Staging with Production

```bash
# Get production fixes into staging
git checkout staging
git merge main
git push origin staging
```

## 📚 Full Documentation

See [docs/staging-setup.md](docs/staging-setup.md) for complete setup guide.

## ⚠️ Important Notes

- **Never merge untested code to main**
- **Keep staging in sync with main** (merge main → staging regularly)
- **Use separate test shops** for staging vs production
- **Test billing carefully** in staging before production

