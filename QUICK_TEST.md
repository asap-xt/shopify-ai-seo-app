# ⚡ БЪРЗ ТЕСТ (5 минути)

## 🎯 Минимален тест за потвърждение

### 1️⃣ Подготовка (30 сек)
```
Отвори 3 таба:
1. Railway Dashboard → Logs (realtime)
2. MongoDB Compass → tokenbalances collection
3. Shopify App → Products page
```

### 2️⃣ Запиши начален баланс (10 сек)
```
MongoDB Compass:
Намери shop: "asapxt-teststore.myshopify.com"
balance: _______ (запиши го!)
```

### 3️⃣ Направи 1 AI Enhancement (2 мин)
```
Products page:
1. Избери 1 продукт с Basic SEO
2. "AI Enhanced add-ons"
3. Изчакай да завърши
```

### 4️⃣ Провери Railway Logs (1 мин)
```
Търси тези 3 реда:

✅ "[AI-ENHANCE] Reserved 2200 tokens (200 margin)"
✅ "[AI-ENHANCE] en: 1234 tokens"
✅ "[TokenBalance] Refunded 966 tokens"

Ако ги виждаш → РАБОТИ! ✅
```

### 5️⃣ Провери MongoDB (1 мин)
```
Refresh MongoDB Compass

Последният usage entry трябва да има:
{
  metadata: {
    status: "finalized",  ✅
    estimatedAmount: 2200,
    actualTokensUsed: 1234,
    refunded: 966  ✅
  }
}

Ако го виждаш → РАБОТИ! ✅
```

### 6️⃣ Изчисли спестяванията (30 сек)
```
Reserved:  2200 tokens
Actual:    1234 tokens
Refunded:  966 tokens
Savings:   ~44% ✅

Ако savings > 20% → РАБОТИ ОТЛИЧНО! 🎉
```

---

## ✅ Success Criteria:
- [ ] Виждам "Reserved" в logs
- [ ] Виждам "Refunded" в logs
- [ ] status: "finalized" в MongoDB
- [ ] Savings > 20%

## ❌ Ако нещо липсва:
→ Виж пълната инструкция в `TESTING_DYNAMIC_TOKENS.md`

---

**Total време: ~5 минути**
**Очакван резултат: 30-50% token savings** 🚀

