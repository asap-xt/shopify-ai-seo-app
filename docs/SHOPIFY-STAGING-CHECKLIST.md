# Shopify Staging App - Configuration Checklist

## ✅ Проверка в Shopify Partner Dashboard

Отиди на: https://partners.shopify.com → Apps → "indexAIze - Staging"

### 1. App Setup → Client credentials
- [ ] **Client ID**: `cbb6c395806364fba75996525ffce483` ✅
- [ ] **Client secret**: `shpss_***` (check Railway env vars) ✅

### 2. App Setup → App URL
- [ ] **App URL**: `https://indexaize-aiseo-app-staging.up.railway.app` ✅
- [ ] Това трябва да е точно същото като `application_url` в `shopify.app.staging.toml`

### 3. App Setup → Allowed redirection URLs
Трябва да имаш ВСИЧКИ тези URLs:
- [ ] `https://indexaize-aiseo-app-staging.up.railway.app/auth/callback`
- [ ] `https://indexaize-aiseo-app-staging.up.railway.app/api/auth/callback`
- [ ] `https://indexaize-aiseo-app-staging.up.railway.app/api/auth`
- [ ] `https://indexaize-aiseo-app-staging.up.railway.app/`

### 4. App Setup → App proxy
- [ ] **Subpath prefix**: `apps`
- [ ] **Subpath**: `new-ai-seo`
- [ ] **Proxy URL**: `https://indexaize-aiseo-app-staging.up.railway.app/apps`

### 5. App Setup → API scopes
Трябва да имаш всички тези scopes:
- [ ] `read_products`
- [ ] `write_products`
- [ ] `read_themes`
- [ ] `write_themes`
- [ ] `read_translations`
- [ ] `write_translations`
- [ ] `read_locales`
- [ ] `read_metaobjects`
- [ ] `write_metaobjects`
- [ ] `read_content`
- [ ] `write_content`
- [ ] `write_script_tags`
- [ ] `read_markets`

### 6. Webhooks
Трябва да имаш GDPR webhooks:
- [ ] `POST /webhooks/customers/data_request` (customers/data_request)
- [ ] `POST /webhooks/customers/redact` (customers/redact)
- [ ] `POST /webhooks/shop/redact` (shop/redact)

## ✅ Проверка в Railway

### Environment Variables
Провери че всички тези са правилно настроени:

```bash
# Критични
SHOPIFY_API_KEY=cbb6c395806364fba75996525ffce483
SHOPIFY_API_SECRET=shpss_***  # Check Railway env vars
VITE_SHOPIFY_API_KEY=cbb6c395806364fba75996525ffce483  # ⚠️ ТРЯБВА ДА Е СЪЩОТО КАТО SHOPIFY_API_KEY
APP_URL=https://indexaize-aiseo-app-staging.up.railway.app
SHOPIFY_APP_URL=https://indexaize-aiseo-app-staging.up.railway.app
NODE_ENV=staging

# MongoDB
MONGODB_URI=mongodb://mongo:****@ballast.proxy.rlwy.net:48860

# Други (копирани от production)
BASE_URL=https://indexaize-aiseo-app-staging.up.railway.app
HOST=https://indexaize-aiseo-app-staging.up.railway.app
```

## ⚠️ Често срещани проблеми

### 1. App URL не съвпада
- **Симптом**: App не се зарежда или показва "Not Found"
- **Решение**: Провери че App URL в Partner Dashboard съвпада с Railway URL

### 2. Redirect URLs не са добавени
- **Симптом**: OAuth flow не работи, получаваш "redirect_uri_mismatch"
- **Решение**: Добави всички redirect URLs от checklist-а

### 3. VITE_SHOPIFY_API_KEY е различен от SHOPIFY_API_KEY
- **Симптом**: Frontend не може да се автентикира
- **Решение**: Убеди се че и двете са `cbb6c395806364fba75996525ffce483`

### 4. App Proxy не е настроен
- **Симптом**: Sitemap не работи
- **Решение**: Провери App Proxy настройките в Partner Dashboard

## 🔍 Как да тестваш

1. Отиди на: `https://partners.shopify.com` → Apps → "indexAIze - Staging"
2. Кликни "Test on development store"
3. Избери development store
4. App-ът трябва да се зареди и да пренасочи към billing страницата

## 📝 Notes

- `shopify.app.staging.toml` е само за локална разработка с Shopify CLI
- Реалните настройки се правят в Partner Dashboard
- Всички URLs трябва да са HTTPS (не HTTP)
- Всички URLs трябва да завършват без trailing slash (освен root `/`)

