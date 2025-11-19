# Staging Debug Checklist

## ✅ Проверено и правилно:

1. **Shopify Partner Dashboard:**
   - Client ID: `cbb6c395806364fba75996525ffce483` ✅
   - App URL: `https://indexaize-aiseo-app-staging.up.railway.app` ✅
   - Redirect URLs: всички 4 са добавени ✅
   - App Proxy: правилно настроен ✅

2. **Railway Environment Variables:**
   - `SHOPIFY_API_KEY=cbb6c395806364fba75996525ffce483` ✅
   - `VITE_SHOPIFY_API_KEY=cbb6c395806364fba75996525ffce483` ✅
   - `APP_URL=https://indexaize-aiseo-app-staging.up.railway.app` ✅

## 🔍 Какво да провериш СЕГА:

### 1. Railway Logs - търси тези logs:

```
[ROOT] GET / request: { shop: ..., embedded: ..., hasIdToken: ... }
[ROOT] Serving HTML for embedded app, shop: ...
[SERVER] Injecting API key into HTML: { apiKey: 'cbb6c395...', ... }
[SERVER-INJECTED] API Key: cbb6c395...
```

**Ако НЕ виждаш тези logs:**
- Проблем с routing или условието `if (id_token || embedded === '1')` не се изпълнява

### 2. Browser Console (F12) - търси тези logs:

```
[MAIN] Public App - Host: ... Shop: ...
[MAIN] Full URL: ...
[APP] useEffect triggered, shop: ...
[APP] handleTokenExchange called
[APP] loadInitialData called for shop: ...
[APP] Making GraphQL request to /graphql for shop: ...
```

**Ако НЕ виждаш тези logs:**
- Frontend-ът не се зарежда или има JavaScript грешка преди това

### 3. Network Tab - търси заявка към `/graphql`:

- **Ако я НЯМА:** Frontend-ът не прави заявката (вероятно JavaScript грешка)
- **Ако я ИМА:** Провери status code и response

### 4. Railway Logs - търси GraphQL заявки:

```
[MIDDLEWARE] POST request detected: { path: '/graphql', ... }
[MIDDLEWARE] GraphQL request detected: { ... }
[GRAPHQL] Request received: { ... }
```

**Ако НЕ виждаш тези logs:**
- Заявката не достига до сървъра (CORS, network проблем, или frontend не я прави)

## 🎯 Най-вероятен проблем:

Ако всичко е правилно настроено, но app-ът не работи, проблемът е вероятно:

1. **Frontend не се зарежда** → Провери browser console за JavaScript грешки
2. **API key не се инжектира** → Провери Railway logs за `[SERVER] Injecting API key`
3. **GraphQL заявката не се прави** → Провери browser console и Network tab
4. **GraphQL заявката не достига до сървъра** → Провери Railway logs за `[MIDDLEWARE] POST request`

## 📝 Следващи стъпки:

1. Отвори browser console (F12)
2. Опитай да инсталираш app-а отново
3. Сподели:
   - Какво виждаш в browser console
   - Какво виждаш в Railway logs
   - Какво виждаш в Network tab

Това ще покаже точно къде е проблемът!

