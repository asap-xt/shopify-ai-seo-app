# Тест на нова инсталация - Token Exchange

## Цел
Да проверим дали новите инсталации на app-а работят правилно с token exchange flow.

## Стъпки за тестване

### 1. Подготовка
- [ ] Създай нова Shopify store (development)
- [ ] Или използвай съществуваща store, която НЕ е инсталирала app-а
- [ ] Убеди се, че няма shop record в MongoDB за тази store

### 2. Инсталация
- [ ] Отиди в Shopify Partners Dashboard
- [ ] Намери app-а "NEW AI SEO"
- [ ] Кликни "Test on development store"
- [ ] Избери новата store
- [ ] Следвай инсталационния процес

### 3. Проверка на логовете
- [ ] Отвори Railway logs
- [ ] Търси за `[APP URL]` съобщения
- [ ] Търси за `[TOKEN_EXCHANGE]` съобщения
- [ ] Търси за `[APP]` съобщения от frontend

### 4. Проверка на базата данни
- [ ] Провери дали се създава shop record
- [ ] Провери дали `needsTokenExchange: true`
- [ ] Провери дали `accessToken: 'jwt-pending'`

### 5. Тестване на функционалността
- [ ] Отвори app-а в Shopify Admin
- [ ] Провери дали се зарежда без грешки
- [ ] Опитай да направиш API call (например да видиш products)
- [ ] Провери дали token exchange се изпълнява автоматично

## Очаквани резултати

### Успешен сценарий:
1. App-ът се инсталира успешно
2. Shop record се създава с `needsTokenExchange: true`
3. Frontend автоматично извиква `/token-exchange`
4. Token exchange успешно получава access token
5. Access token се запазва в базата данни
6. API calls работят нормално

### Проблемен сценарий:
1. App-ът не се инсталира
2. Shop record не се създава
3. Token exchange не се изпълнява
4. API calls не работят
5. App-ът показва грешки

## Логове за следене

```
[APP URL] Found id_token, processing JWT flow...
[APP URL] No valid access token found or API key mismatch, need token exchange...
[APP] Performing token exchange for shop: test-store.myshopify.com
[TOKEN_EXCHANGE] Starting for shop: test-store.myshopify.com
[TOKEN_EXCHANGE] Exchanging JWT for access token: test-store.myshopify.com
[TOKEN_EXCHANGE] Response status: 200
✅ Token exchange successful for shop: test-store.myshopify.com
[APP] Token exchange successful: { status: 'ok', shop: 'test-store.myshopify.com', tokenSaved: true }
```

## Ако не работи

1. **Провери environment variables** - SHOPIFY_API_KEY, SHOPIFY_API_SECRET
2. **Провери MongoDB connection** - дали се свързва правилно
3. **Провери Shopify app configuration** - дали е настроен като embedded app
4. **Провери CORS settings** - дали frontend може да прави заявки
5. **Провери network connectivity** - дали може да се свързва с Shopify API

## Следващи стъпки

Ако тестът е успешен:
- [ ] Документирай резултатите
- [ ] Подготви за production deployment

Ако тестът е неуспешен:
- [ ] Анализирай логовете
- [ ] Идентифицирай проблема
- [ ] Направи корекции
- [ ] Повтори теста
