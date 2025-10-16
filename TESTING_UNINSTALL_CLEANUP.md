# 🧪 Testing Complete Uninstall Cleanup

## 📋 Цел на теста

Да се убедим, че при деинсталиране на апп-а се изтриват **всички следи**, включително:
1. ✅ Metafield definitions от Shopify
2. ✅ Metafield values (автоматично с definitions)
3. ✅ MongoDB данни (shops, products, collections, subscriptions, токени и т.н.)

---

## 🔒 Безопасност

Системата е **безопасна** защото:
- GraphQL query филтрира по namespace (`seo_ai`, `ai_seo_store`)
- Допълнителна проверка в кода преди изтриване
- Само НАШИТЕ namespaces се изтриват
- Подробни логове за всяко изтриване

---

## 📝 Стъпки за тестване

### **Стъпка 1: Подготовка - Инсталирай и оптимизирай**

1. **Инсталирай апп-а** в test shop
2. **Създай SEO за продукти:**
   - Отвори Products → AI SEO
   - Селектирай няколко продукта
   - Дай "Generate Optimization" за 1-2 езика
   - Провери че се създават metafields в Shopify Admin

3. **Създай SEO за колекции:**
   - Отвори Collections → AI SEO
   - Селектирай колекция
   - Дай "Generate Optimization"

4. **Създай Store Metadata:**
   - Отвори Settings → Store Metadata
   - Попълни данни и "Apply Metadata"

5. **Провери метафийлдовете в Shopify Admin:**
   - Products → избери продукт → Metafields секцията
   - Collections → избери колекция → Metafields секцията
   - Settings → Custom Data → Metafields → Shop → виж `ai_seo_store` namespace

---

### **Стъпка 2: Проверка ПРЕДИ деинсталиране**

1. **Отвори Shopify Admin → Settings → Custom Data**
2. **Виж "Metafield definitions"**
3. **Провери че има дефиниции с:**
   - Namespace: `seo_ai` (за продукти/колекции)
   - Namespace: `ai_seo_store` (за shop metadata)
4. **Запомни колко са** (например: 5 за продукти, 3 за колекции, 4 за shop)

---

### **Стъпка 3: Деинсталирай апп-а**

1. **Shopify Admin → Apps**
2. **Намери "New AI SEO"**
3. **Натисни "Uninstall" (Delete/Remove)**
4. **Потвърди деинсталирането**

---

### **Стъпка 4: Провери логовете в Railway**

След деинсталиране, провери Railway логовете за следните съобщения:

```
[Webhook] ===== UNINSTALL WEBHOOK CALLED =====
[Webhook] Step 1: Deleting metafield definitions from Shopify...
[CLEANUP] ===== DELETING METAFIELD DEFINITIONS FOR asapxt-teststore.myshopify.com =====
[CLEANUP] Fetching PRODUCT metafield definitions with namespace "seo_ai"...
[CLEANUP] Found X product definitions to delete
[CLEANUP] Deleting PRODUCT definition: seo_ai.seo__en (AI SEO - EN)
[CLEANUP] Deleting PRODUCT definition: seo_ai.seo__bg (AI SEO - BG)
...
[CLEANUP] Fetching COLLECTION metafield definitions with namespace "seo_ai"...
[CLEANUP] Found X collection definitions to delete
...
[CLEANUP] Fetching SHOP metafield definitions with namespace "ai_seo_store"...
[CLEANUP] Found X shop definitions to delete
[CLEANUP] Deleting SHOP definition: ai_seo_store.seo_metadata (SEO Metadata)
...
[CLEANUP] ===== CLEANUP SUMMARY =====
[CLEANUP] Products: X deleted, 0 errors
[CLEANUP] Collections: X deleted, 0 errors
[CLEANUP] Shop: X deleted, 0 errors
[CLEANUP] Total deleted: X
[Webhook] ✅ Successfully deleted metafield definitions
[Webhook] Deleted shop asapxt-teststore.myshopify.com from database: SUCCESS
[Webhook] Deleted products for asapxt-teststore.myshopify.com
[Webhook] Deleted collections for asapxt-teststore.myshopify.com
[Webhook] Deleted Token Balance for asapxt-teststore.myshopify.com
[Webhook] ===== UNINSTALL CLEANUP COMPLETED =====
```

---

### **Стъпка 5: Провери Shopify Admin - Metafield Definitions**

1. **Shopify Admin → Settings → Custom Data**
2. **Виж "Metafield definitions"**
3. **Провери че:**
   - ✅ **НЯМА** definitions с namespace `seo_ai`
   - ✅ **НЯМА** definitions с namespace `ai_seo_store`
   - ✅ **ИМА** други definitions от други апп-ове (ако има други апп-ове)

---

### **Стъпка 6: Провери Shopify Admin - Metafield Values**

1. **Отвори продукт** (който преди имаше SEO)
2. **Виж Metafields секцията**
3. **Провери че:**
   - ✅ **НЯМА** metafields с namespace `seo_ai`

4. **Отвори колекция** (която преди имаше SEO)
5. **Виж Metafields секцията**
6. **Провери че:**
   - ✅ **НЯМА** metafields с namespace `seo_ai`

7. **Settings → Custom Data → Metafields → Shop**
8. **Провери че:**
   - ✅ **НЯМА** metafields с namespace `ai_seo_store`

---

### **Стъпка 7: Провери MongoDB (опционално)**

Ако имаш достъп до MongoDB:

```javascript
// Провери shops
db.shops.find({ shop: 'asapxt-teststore.myshopify.com' })
// Трябва да връща: нищо (deleted)

// Провери products
db.products.find({ shop: 'asapxt-teststore.myshopify.com' })
// Трябва да връща: нищо (deleted)

// Провери collections
db.collections.find({ shop: 'asapxt-teststore.myshopify.com' })
// Трябва да връща: нищо (deleted)

// Провери tokenbalances
db.tokenbalances.find({ shop: 'asapxt-teststore.myshopify.com' })
// Трябва да връща: нищо (deleted)
```

---

## ✅ Критерии за успешен тест

### **1. Shopify е чист:**
- ✅ Няма metafield definitions с `seo_ai` или `ai_seo_store`
- ✅ Няма metafield values в продукти/колекции/shop
- ✅ Други апп-ове НЕ са засегнати

### **2. MongoDB е чист:**
- ✅ Няма shop record
- ✅ Няма products
- ✅ Няма collections
- ✅ Няма subscriptions
- ✅ Няма tokenbalances

### **3. Логовете показват:**
- ✅ Всички metafield definitions са изтрити
- ✅ Всички MongoDB records са изтрити
- ✅ Няма грешки

---

## 🚨 Възможни проблеми

### **Проблем 1: "No access token found"**
- **Причина:** Webhook идва преди shop record да е изтрит от MongoDB
- **Решение:** Вече е решено - извличаме токена ПРЕДИ да изтрием shop record

### **Проблем 2: "GraphQL request failed: 401"**
- **Причина:** Access token е невалиден или изтекъл
- **Решение:** Shopify изпраща webhook ПРЕДИ да revoke токена, така че това не трябва да се случи

### **Проблем 3: Някои definitions не се изтриват**
- **Причина:** Може да има API rate limiting
- **Решение:** Добавяме малко delay между заявките (в следваща версия ако се налага)

---

## 📊 Очаквани резултати

### **Пример за логове:**

```
[CLEANUP] Products: 5 deleted, 0 errors
[CLEANUP] Collections: 3 deleted, 0 errors
[CLEANUP] Shop: 6 deleted, 0 errors
[CLEANUP] Total deleted: 14
```

### **MongoDB:**
Всички колекции за shop-а трябва да са празни:
- `shops`: 0 documents
- `products`: 0 documents
- `collections`: 0 documents
- `subscriptions`: 0 documents
- `tokenbalances`: 0 documents
- `aidiscoverysettings`: 0 documents
- `advancedschemas`: 0 documents
- `sitemaps`: 0 documents

---

## 🎯 Заключение

Ако всички проверки минат успешно, това означава че:

1. ✅ **Магазинът не може да злоупотреби trial периода** - всички SEO оптимизации са изтрити
2. ✅ **Не засягаме други апп-ове** - филтрираме само наши namespaces
3. ✅ **Чиста база данни** - всички MongoDB записи са изтрити
4. ✅ **GDPR compliance** - всички данни на магазина са премахнати

---

## 📝 Бележки

- **AI Welcome Page**: Няма отделни metafields, само MongoDB запис (вече се изтрива)
- **Advanced Schema**: Съхранява се в MongoDB (вече се изтрива)
- **robots.txt**: НЕ може да бъде променян без `write_themes` scope - оставяме за ръчна промяна от merchant

