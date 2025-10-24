# План за мултиезична поддръжка - Shopify SEO App

## 📊 Текущ статус

### ✅ КАКВО ВЕЧЕ СЪЩЕСТВУВА:
- **i18n инфраструктура:** `useI18n` hook с пълна функционалност
- **JSON файлове:** EN, DE, FR, ES в `/frontend/src/i18n/`
- **localStorage persistence:** `app_lang` ключ
- **Динамично зареждане:** на преводи при смяна на език
- **UI компоненти:** `LangButton`, `AppHeader` работещи
- **Използване:** `App.jsx` извлича `{ lang, setLang, t }` от `useI18n()`

### ❌ КАКВО НЕ РАБОТИ:
- **Преводите НЕ се използват:** НИТО ЕДНА страница не използва `t()` функцията!
- **Всички текстове са hardcoded** на английски
- **Липсват преводи за:** модали, error messages, toast notifications, форми, banner-и, data cards, plan descriptions, feature lists, help text

## 🎯 План за имплементация

### Етап 1: Разширяване на JSON файловете (2-3 часа)
```json
{
  "common": {
    "save": "Save",
    "cancel": "Cancel", 
    "delete": "Delete",
    "edit": "Edit",
    "loading": "Loading...",
    "error": "An error occurred",
    "success": "Success",
    "warning": "Warning",
    "info": "Information"
  },
  "dashboard": {
    "title": "Dashboard",
    "products": {
      "title": "Products & Collections",
      "total": "Total",
      "optimized": "Optimized", 
      "unoptimized": "Unoptimized",
      "lastSynced": "Last synced",
      "lastOptimized": "Last optimized"
    },
    "languages": {
      "title": "Languages & Markets",
      "markets": "Markets"
    },
    "sync": {
      "title": "Store Sync",
      "autoSync": "Auto-sync on load",
      "syncNow": "Sync Now",
      "lastSynced": "Last synced",
      "enabled": "Auto-sync enabled",
      "settings": "Settings"
    },
    "plan": {
      "title": "Current Plan",
      "viewPlans": "View Plans & Billing"
    },
    "tokens": {
      "title": "Token Balance",
      "manageTokens": "Manage Tokens",
      "includedMonthly": "included monthly"
    },
    "optimization": {
      "title": "Last Optimization",
      "optimizeNow": "Optimize Now"
    }
  },
  "plans": {
    "starter": {
      "name": "Starter",
      "price": "$9.99/month",
      "features": ["Up to 100 products", "1 language", "Basic AI providers"]
    },
    "professional": {
      "name": "Professional", 
      "price": "$15.99/month",
      "features": ["Up to 250 products", "2 languages", "Advanced AI providers", "Pay-per-use tokens"]
    },
    "growth": {
      "name": "Growth",
      "price": "$29.99/month", 
      "features": ["Up to 700 products", "3 languages", "Premium AI providers", "Pay-per-use tokens"]
    },
    "growth_extra": {
      "name": "Growth Extra",
      "price": "$69.99/month",
      "features": ["Up to 1000 products", "6 languages", "All AI providers", "100M included tokens"]
    },
    "enterprise": {
      "name": "Enterprise",
      "price": "$139.99/month",
      "features": ["Up to 2500 products", "10 languages", "All AI providers", "300M included tokens"]
    }
  },
  "billing": {
    "title": "Plans & Billing",
    "choosePlan": "Choose your plan:",
    "currentPlan": "Current Plan",
    "buyTokens": "Buy Tokens",
    "manageTokens": "Manage Tokens",
    "upgradeRequired": "Upgrade Required",
    "insufficientTokens": "Insufficient tokens for this action"
  },
  "errors": {
    "networkError": "Network error occurred",
    "insufficientTokens": "Insufficient tokens",
    "planUpgradeRequired": "Plan upgrade required",
    "syncError": "Sync failed",
    "genericError": "An unexpected error occurred"
  },
  "modals": {
    "upgrade": {
      "title": "Upgrade Required",
      "message": "This feature requires a higher plan",
      "viewPlans": "View Plans",
      "close": "Close"
    },
    "buyTokens": {
      "title": "Buy Tokens",
      "message": "Purchase tokens to unlock AI features",
      "buyNow": "Buy Now",
      "close": "Close"
    }
  },
  "banners": {
    "upgrade": {
      "title": "Upgrade to {planName} Plan",
      "reason": "Your store has {count} products, exceeding the {limit}-product limit of your current plan.",
      "viewPlans": "View Plans"
    },
    "tokens": {
      "title": "Buy Tokens to Unlock AI Features",
      "message": "Your current plan uses pay-per-use tokens. Purchase tokens to access AI-enhanced optimization features.",
      "buyTokens": "Buy Tokens"
    }
  }
}
```

### Етап 2: Refactoring на компонентите (5-8 часа)

**Страници за обновяване:**
1. `Dashboard.jsx` - всички текстове в карти и banner-и
2. `Billing.jsx` - plan descriptions, features, buttons
3. `Settings.jsx` - всички labels и descriptions
4. `Products.jsx` - AI enhancement интерфейс
5. `Collections.jsx` - AI enhancement интерфейс
6. `AiTesting.jsx` - всички модали и текстове

**Модали за обновяване:**
1. `UpgradeModal.jsx` - всички текстове
2. Всички AI enhancement модали
3. Error toast messages
4. Success notifications

**Пример за refactoring:**
```jsx
// ПРЕДИ:
<Text variant="headingMd">Products & Collections</Text>

// СЛЕД:
<Text variant="headingMd">{t('dashboard.products.title')}</Text>
```

### Етап 3: Тестване (1-2 часа)
- Проверка на всички 4 езика
- Проверка на всички модали и error states
- Проверка на localStorage persistence
- Проверка на езиковия бутон

## 🚀 Имплементационни етапи

### Фаза 1: Критични страници (приоритет 1)
- Dashboard (всички карти и banner-и)
- Billing (plan descriptions и features)
- Upgrade/Buy Tokens модали

### Фаза 2: Settings и AI функции (приоритет 2)  
- Settings страница
- AI Testing модали
- Products/Collections AI enhancement

### Фаза 3: Error handling (приоритет 3)
- Error messages
- Toast notifications
- Success messages

## 📝 Технически детайли

**Сложност:** 🟡 СРЕДНА
- Имаме отлична подготовка, но нулево използване
- Не е критично сложно, но изисква систематичен подход

**Време:** 8-13 часа общо
- JSON файлове: 2-3 часа
- Refactoring: 5-8 часа  
- Тестване: 1-2 часа

**Автоматизация:** 
- JSON преводите могат да се автоматизират с AI
- Refactoring трябва да се прави ръчно за качество

## ✅ Кога да се приложи

Когато всички текстове в приложението са финализирани и няма да се променят често.
