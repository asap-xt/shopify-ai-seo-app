# 🧪 Тестване на Dynamic Token Tracking System

## 📊 Цели на тестването:
1. ✅ Проверка на token reservation с 10% margin
2. ✅ Проверка на actual usage tracking
3. ✅ Проверка на automatic refund
4. ✅ Проверка на graceful stop при недостиг
5. ✅ Проверка на summary response

---

## 🛠️ Подготовка:

### 1. Провери текущия token баланс:
```
Отвори: Railway Dashboard → Billing page
Или: MongoDB Compass → tokenbalances collection
```

**Запиши:**
- Начален баланс: `_______` tokens
- Shop: `asapxt-teststore.myshopify.com`

---

## 🧪 ТЕСТ 1: Products AI Enhancement - Single Language

### Цел: Проверка на основния flow (reserve → track → finalize → refund)

### Стъпки:
1. **Отвори Products page** (`/products` в app-а)
2. **Избери 1 продукт** с Basic SEO (за 1 език)
3. **Натисни "AI Enhanced add-ons"**
4. **НЕ избирай допълнителни езици** - използвай само default-ния език

### Очаквано поведение:
- ✅ Показва се progress modal
- ✅ Успешно enhancement
- ✅ Success toast message

### Railway Logs - какво да търсиш:
```
🔍 Търси в Railway logs:

1. RESERVATION:
   "[AI-ENHANCE] Reserved X tokens (Y margin), reservation: [ID]"
   
2. ACTUAL USAGE:
   "[AI-ENHANCE] en: ZZZZ tokens (prompt: AAA, completion: BBB)"
   
3. FINALIZATION:
   "[AI-ENHANCE] Finalized reservation [ID]"
   "[AI-ENHANCE] New balance: [number]"
   
4. REFUND (ако има):
   "[TokenBalance] Refunded X tokens from reservation [ID]"
```

### MongoDB Compass - какво да провериш:
```
Отвори: tokenbalances collection → намери shop документа

Провери последния entry в usage array:
{
  feature: "ai-seo-product-enhanced",
  tokensUsed: ZZZZ,  // <-- actual tokens
  metadata: {
    reservationId: "...",
    status: "finalized",  // <-- важно!
    estimatedAmount: X,   // <-- reserved amount
    actualTokensUsed: ZZZZ,
    refunded: Y  // <-- разликата (ако има)
  }
}
```

### Изчисли спестяванията:
```
Reserved:  _______ tokens (with 10% margin)
Actual:    _______ tokens (real usage)
Refunded:  _______ tokens
Savings:   _______% 
```

---

## 🧪 ТЕСТ 2: Products AI Enhancement - Multiple Languages

### Цел: Проверка на tracking за множество езици

### Стъпки:
1. **Отвори Products page**
2. **Избери 1 продукт** с Basic SEO за **2-3 езика**
3. **Натисни "AI Enhanced add-ons"**

### Очаквано поведение:
- ✅ Progress modal показва "Processing language 1/3..."
- ✅ Успешно enhancement за всички езици
- ✅ Summary: "3 languages enhanced"

### Railway Logs - какво да търсиш:
```
1. RESERVATION (за всички езици наведнъж):
   "[AI-ENHANCE] Reserved X tokens (Y margin)"

2. ACTUAL USAGE (за всеки език поотделно):
   "[AI-ENHANCE] en: 1234 tokens"
   "[AI-ENHANCE] de: 1198 tokens"
   "[AI-ENHANCE] fr: 1267 tokens"

3. FINALIZATION (обща сума):
   "[AI-ENHANCE] Total actual tokens used: 3699"
   "[TokenBalance] Refunded X tokens"  // <-- refund от margin
```

### Изчисли:
```
Estimated per language: _______ tokens
Reserved (3 × estimate × 1.1): _______ tokens
Actual total: _______ tokens
Refunded: _______ tokens
```

---

## 🧪 ТЕСТ 3: Collections AI Enhancement

### Цел: Същото като Products, но за Collections

### Стъпки:
1. **Отвори Collections page**
2. **Избери 1 collection** с Basic SEO
3. **Натисни "AI Enhanced add-ons"**

### Очаквано поведение:
- ✅ Идентично на Products test
- ✅ Logs показват `ai-seo-collection-enhanced` като feature

### Railway Logs:
```
Търси същите patterns като ТЕСТ 1, но за:
feature: "ai-seo-collection-enhanced"
```

---

## 🧪 ТЕСТ 4: Graceful Stop - Insufficient Tokens

### ⚠️ Цел: Проверка на graceful stop механизма

### Подготовка:
```
В MongoDB Compass:
1. Намери tokenbalances документа за твоя shop
2. Временно намали balance на малка стойност:
   balance: 500  // <-- достатъчно за 1 език, но не за повече
```

### Стъпки:
1. **Отвори Products page**
2. **Избери 1 продукт** с Basic SEO за **3 езика**
3. **Натисни "AI Enhanced add-ons"**

### Очаквано поведение:

**Ако токените НЕ достигат преди да започне:**
- 🚫 Показва "Insufficient Tokens" modal с детайли:
  - **Current balance:** 500 tokens
  - **Required:** 5,500 tokens (за 3 езика с margin)
  - **You need:** 5,000 more tokens
- ✅ Два бутона: "Go to Billing" и "Cancel"

**Ако започне, но токените свършат по средата:**
- ✅ Успява колкото може (напр. 1 език)
- ⚠️ **Спира след изчерпване на токените**
- ✅ Показва results modal: "Operation stopped: Insufficient tokens. 1 language(s) enhanced, 2 skipped."

### Railway Logs:
```
🔍 Търси:

"[AI-ENHANCE] ⚠️ Insufficient tokens for remaining languages. Stopping gracefully."
"[AI-ENHANCE] Required: XXXX, Available: YYY"
```

### Response JSON:
```json
{
  "success": true,
  "summary": {
    "total": 3,
    "successful": 1,
    "failed": 0,
    "skippedDueToTokens": 2,
    "tokensExhausted": true
  },
  "warning": "Operation stopped: Insufficient tokens. 1 language(s) enhanced, 2 skipped.",
  "skippedLanguages": ["de", "fr"]
}
```

### ‼️ ВАЖНО: След теста върни баланса обратно!
```
В MongoDB Compass:
balance: 100000  // или каквото беше преди
```

---

## 🧪 ТЕСТ 5: AI Testing/Simulation

### Цел: Проверка на dynamic tracking за AI Testing

### Стъпки:
1. **Отвори Dashboard → Search Optimization for AI**
2. **Scroll до "AI Testing & Simulation"**
3. **Избери продукт от dropdown**
4. **Натисни "Simulate AI Response"**

### Очаквано поведение:
- ✅ Показва AI response
- ✅ Success message

### Railway Logs:
```
🔍 Търси:

1. RESERVATION:
   "Reserved X tokens (Y margin), reservation: [ID]"
   
2. FINALIZATION:
   "Finalized reservation [ID]"
```

### MongoDB:
```
Провери usage entry:
{
  feature: "ai-testing-simulation",
  metadata: {
    questionType: "...",
    status: "finalized"
  }
}
```

---

## 🧪 ТЕСТ 6: Already Enhanced Skip Optimization (Growth Extra & Enterprise only)

### Цел: Проверка че вече enhanced езици се skip-ват САМО за Growth Extra/Enterprise

### ⚠️ Важно: 
Тази оптимизация работи **САМО** за Growth Extra и Enterprise планове (с включени токени).
За Starter/Professional/Growth (pay-per-use tokens) винаги се прави **re-enhancement**.

### Стъпки (на Growth Extra или Enterprise план):
1. **Отвори Products page**
2. **Избери 1 продукт**
3. **AI Enhanced add-ons за EN език** (само 1 език)
4. **Изчакай да завърши**
5. **Повтори AI Enhanced add-ons за EN + DE** (2 езика)

### Очаквано поведение:

#### За Growth Extra / Enterprise:
- ✅ **Първи път**: EN се обработва (харчи токени)
- ✅ **Втори път**: 
  - EN се skip-ва (БЕЗ AI заявка!)
  - DE се обработва (харчи токени)

#### За Starter / Professional / Growth:
- ✅ **Първи път**: EN се обработва (харчи токени)
- ✅ **Втори път**: 
  - EN се обработва ОТНОВО (харчи токени - fresh AI enhancement!)
  - DE се обработва (харчи токени)

### Railway Logs:
```
🔍 Търси при ВТОРИЯ опит:

Growth Extra / Enterprise:
"[AI-ENHANCE] Skipping en - already has AI Enhanced content (Growth Extra plan saves tokens)"
"[AI-ENHANCE] Reserved XXXX tokens"  // само за DE
"[AI-ENHANCE] de: YYYY tokens"  // само DE се track-ва

Starter / Professional / Growth:
"[AI-ENHANCE] Reserved XXXX tokens"  // за EN + DE
"[AI-ENHANCE] en: YYYY tokens"  // и EN се обработва отново!
"[AI-ENHANCE] de: ZZZZ tokens"
```

### Response JSON (втори опит):

**Growth Extra / Enterprise:**
```json
{
  "success": true,
  "summary": {
    "total": 2,
    "successful": 1,  // само DE
    "failed": 0,
    "alreadyEnhanced": 1,  // EN беше skip-нат
    "skippedDueToTokens": 0
  },
  "info": "1 language(s) already had AI Enhanced content and were skipped to save tokens."
}
```

**Starter / Professional / Growth:**
```json
{
  "success": true,
  "summary": {
    "total": 2,
    "successful": 2,  // и EN и DE
    "failed": 0,
    "alreadyEnhanced": 0,  // НЕ skip-ва
    "skippedDueToTokens": 0
  }
}
```

### Изчисли спестяванията:

**Growth Extra / Enterprise:**
```
Без оптимизация:
  Втори опит би харчил: 2 езика × ~2000 tokens = 4000 tokens

С оптимизация:
  Втори опит харчи: 1 език × ~2000 tokens = 2000 tokens
  
Savings от skip: 2000 tokens (50%)!
```

**Starter / Professional / Growth:**
```
Без оптимизация:
  Втори опит би харчил: 2 езика × ~2000 tokens = 4000 tokens

С dynamic tracking (no skip):
  Втори опит харчи: ~2400 tokens (actual usage)
  
Savings от dynamic tracking: ~1600 tokens (40%)!
Note: No skip savings - user gets fresh AI content
```

---

## 🧪 ТЕСТ 7: Compare Old vs New System

### Цел: Потвърждение на спестяванията

### Метод:
1. **Направи ТЕСТ 1 (1 продукт, 1 език)**
2. **Запиши резултатите**

### Изчисли:

#### Стара система (без dynamic tracking):
```
Estimated: ~2000 tokens per language per product
За 1 product × 1 language = 2000 tokens би се приспаднали
```

#### Нова система (с dynamic tracking):
```
Reserved: ~2200 tokens (2000 × 1.1)
Actual: ~1200 tokens (измерено)
Refunded: ~1000 tokens
Net spent: 1200 tokens
```

#### Спестявания:
```
Old system: 2000 tokens
New system: 1200 tokens
Savings: 800 tokens (40%)
```

---

## 📊 ФИНАЛЕН ТЕСТ: Full Scenario + Skip Optimization

### Цел: Комплексен тест на всички функции

### Стъпки:
1. **Запиши началния баланс**: `_______`
2. **Products Enhancement**: 2 products × 2 languages = 4 operations
3. **Collections Enhancement**: 1 collection × 2 languages = 2 operations
4. **AI Testing**: 3 simulations
5. **Запиши крайния баланс**: `_______`

### Изчисли:
```
Expected (old system):
  4 product ops × 2000 = 8,000 tokens
  2 collection ops × 2000 = 4,000 tokens
  3 testing ops × 3000 = 9,000 tokens
  Total: 21,000 tokens

Actual (new system):
  Check MongoDB for total actual usage: _______ tokens
  
Real savings: _______ tokens (_____%)
```

---

## ✅ Checklist за успешно тестване:

### Basic Functionality:
- [ ] Token reservation работи (виждам в logs)
- [ ] Actual usage се track-ва правилно
- [ ] Finalization работи (status: "finalized")
- [ ] Refund работи (виждам refunded amount)
- [ ] Balance се обновява правилно

### Skip Optimization:
- [ ] Already enhanced езици се skip-ват
- [ ] Не се правят duplicate AI calls
- [ ] Summary показва alreadyEnhanced count
- [ ] Info message се показва

### Graceful Stop:
- [ ] Спира при недостиг на токени
- [ ] Запазва направената работа
- [ ] Връща правилен warning message
- [ ] Summary е коректен

### Advanced:
- [ ] Multiple languages работят
- [ ] Collections работят
- [ ] AI Testing работи
- [ ] Token savings са очевидни (>30%)

---

## 🐛 Какво да правя ако нещо не работи?

### 1. Грешка при reservation:
```
Провери в Railway logs:
"[AI-ENHANCE] Reserved X tokens"

Ако липсва → провери дали TokenBalance.js е deployed
```

### 2. Не виждам refund:
```
Провери в logs:
"[TokenBalance] Refunded X tokens"

Ако actual > estimated → няма refund (нормално)
Ако actual < estimated → трябва да има refund
```

### 3. Graceful stop не работи:
```
Провери:
1. Balance наистина ли е нисък?
2. Logs показват ли "⚠️ Insufficient tokens"?
3. Response има ли "tokensExhausted": true?
```

### 4. MongoDB не се обновява:
```
Провери:
1. Connection string в .env
2. Logs за "Finalized reservation"
3. Refresh MongoDB Compass
```

---

## 📸 Екрани за spoделяне:

След тестване, направи screenshots на:
1. ✅ Railway logs с reservation/finalization
2. ✅ MongoDB usage entry с refunded amount
3. ✅ Success toast message
4. ✅ Graceful stop warning (ако има)

---

## 🎯 Критерии за успех:

### ✅ PASS условия:
- Token reservation работи винаги
- Actual usage е по-малък от estimated (в повечето случаи)
- Refund се случва автоматично
- Graceful stop спира операцията без crash
- Balance никога не става негативен
- Savings са поне 20-30%

### ❌ FAIL условия:
- Balance става негативен
- Няма refund when actual < estimated
- Graceful stop не спира операцията
- Logs показват errors
- Savings са под 10%

---

## 📞 Помощ:

Ако имаш въпроси по време на тестване:
1. Копирай Railway logs
2. Направи screenshot на MongoDB
3. Опиши какво очакваше vs какво видя
4. Праща всичко!

---

**Успех с тестването! 🚀**

