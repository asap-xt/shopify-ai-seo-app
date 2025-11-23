# Staging Installation Fix Guide

## 🔍 Диагностика

### Стъпка 1: Провери Railway Environment Variables

Отиди на Railway → Staging Project → Variables и провери:

```bash
✅ SHOPIFY_API_KEY=cbb6c395806364fba75996525ffce483
✅ SHOPIFY_API_SECRET=<staging_secret>
✅ VITE_SHOPIFY_API_KEY=cbb6c395806364fba75996525ffce483
✅ APP_URL=https://indexaize-aiseo-app-staging.up.railway.app
✅ NODE_ENV=staging
✅ MONGODB_URI=<staging_mongodb_uri>
```

**⚠️ ВАЖНО:** `VITE_SHOPIFY_API_KEY` ТРЯБВА да е същото като `SHOPIFY_API_KEY`!

### Стъпка 2: Провери Diagnostic Endpoint

Отвори в браузър:
```
https://indexaize-aiseo-app-staging.up.railway.app/debug/staging-install
```

Това ще покаже:
- Всички environment variables (без секрети)
- Дали API keys съвпадат
- Дали APP_URL е правилен
- Списък с redirect URLs
- Всички намерени проблеми

### Стъпка 3: Провери Shopify Partner Dashboard

Отиди на: https://partners.shopify.com → Apps → "indexAIze - Staging"

#### 3.1 App Setup → Client credentials
- **Client ID**: `cbb6c395806364fba75996525ffce483` ✅
- **Client secret**: Трябва да съвпада с `SHOPIFY_API_SECRET` в Railway

#### 3.2 App Setup → App URL
- **App URL**: `https://indexaize-aiseo-app-staging.up.railway.app` ✅
- **⚠️ НЕ трябва да има trailing slash!**

#### 3.3 App Setup → Allowed redirection URLs
Трябва да имаш ВСИЧКИ тези URLs (точно както са написани):
```
https://indexaize-aiseo-app-staging.up.railway.app/auth/callback
https://indexaize-aiseo-app-staging.up.railway.app/api/auth/callback
https://indexaize-aiseo-app-staging.up.railway.app/api/auth
https://indexaize-aiseo-app-staging.up.railway.app/
```

**⚠️ ВАЖНО:** 
- Всички URLs трябва да са HTTPS (не HTTP)
- НЕ трябва да има trailing slash (освен последния `/`)
- Трябва да са точно както са написани горе

#### 3.4 App Setup → App proxy
- **Subpath prefix**: `apps`
- **Subpath**: `new-ai-seo`
- **Proxy URL**: `https://indexaize-aiseo-app-staging.up.railway.app/apps`

### Стъпка 4: Тествай OAuth Flow

1. Отиди на: https://partners.shopify.com → Apps → "indexAIze - Staging"
2. Кликни "Test on development store"
3. Избери development store
4. Провери Railway logs за:
   ```
   [AUTH] Starting OAuth flow
   [AUTH] Redirecting to Shopify OAuth for shop: ...
   [AUTH] OAuth callback received
   [AUTH] Token exchange successful
   ```

### Стъпка 5: Провери Railway Logs

Търси за тези логове при опит за инсталация:

**Ако виждаш:**
```
[AUTH] Missing required environment variables
```
→ Провери Railway environment variables

**Ако виждаш:**
```
[AUTH] State mismatch
```
→ Проблем с cookies/CSRF protection - опитай отново

**Ако виждаш:**
```
[AUTH] HMAC verification failed
```
→ Проблем с SHOPIFY_API_SECRET - провери че е правилен

**Ако виждаш:**
```
Token exchange failed: redirect_uri_mismatch
```
→ Redirect URLs не са правилно конфигурирани в Partner Dashboard

**Ако виждаш:**
```
[AUTH] Token exchange successful
[AUTH] Saving shop record to database...
```
→ OAuth flow работи! Провери дали има проблем с redirect след това.

## 🐛 Често срещани проблеми

### Проблем 1: "redirect_uri_mismatch"
**Причина:** Redirect URL в OAuth заявката не съвпада с тези в Partner Dashboard

**Решение:**
1. Провери че `APP_URL` в Railway е точно `https://indexaize-aiseo-app-staging.up.railway.app` (без trailing slash)
2. Провери че всички 4 redirect URLs са добавени в Partner Dashboard
3. Рестартирай Railway service след промяна на environment variables

### Проблем 2: "Invalid state parameter"
**Причина:** CSRF protection - state cookie не съвпада

**Решение:**
1. Изчисти cookies за staging domain
2. Опитай отново
3. Ако проблемът продължава, провери cookie settings в `auth.js`

### Проблем 3: "HMAC verification failed"
**Причина:** `SHOPIFY_API_SECRET` не е правилен

**Решение:**
1. Провери `SHOPIFY_API_SECRET` в Railway
2. Провери Client Secret в Partner Dashboard
3. Убеди се че са идентични

### Проблем 4: App не се зарежда след OAuth
**Причина:** Проблем с redirect след успешна инсталация

**Решение:**
1. Провери Railway logs за redirect URL
2. Провери че `APP_URL` е правилен
3. Провери browser console за JavaScript грешки

## 📝 Checklist за фикс

- [ ] Railway environment variables са правилни
- [ ] `SHOPIFY_API_KEY` и `VITE_SHOPIFY_API_KEY` съвпадат
- [ ] `APP_URL` е правилен и без trailing slash
- [ ] Всички redirect URLs са добавени в Partner Dashboard
- [ ] App URL в Partner Dashboard съвпада с Railway URL
- [ ] Railway service е рестартиран след промени
- [ ] Diagnostic endpoint показва `status: "ok"`
- [ ] OAuth flow работи (проверено в Railway logs)

## 🚀 След успешен фикс

След като всичко работи:
1. Тествай инсталацията на development store
2. Провери че app-ът се зарежда правилно
3. Провери че GraphQL заявките работят
4. Провери че webhooks се регистрират

