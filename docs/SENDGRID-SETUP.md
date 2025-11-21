# 📧 SendGrid Email Setup Guide

## ✅ Какво е направено вече

1. ✅ Domain Authentication е настроен (CNAME, DMARC)
2. ✅ Domain е верифициран в SendGrid
3. ✅ Email service е имплементиран
4. ✅ API ключ е конфигуриран

## 📝 Какво трябва да направиш сега

### Стъпка 1: Избери Sender Email адрес

С верифициран домейн в SendGrid, можеш да използваш **всякакъв email адрес** от този домейн!

**Препоръчани опции:**
- `noreply@yourdomain.com` - За автоматични имейли
- `hello@yourdomain.com` - По-приятелски тон
- `support@yourdomain.com` - За support имейли
- `notifications@yourdomain.com` - За notifications

**Пример:**
Ако домейнът ти е `aiseo2.app`, можеш да използваш:
- `noreply@aiseo2.app`
- `hello@aiseo2.app`
- `support@aiseo2.app`

### Стъпка 2: НЕ е нужно да създаваш email hosting!

**Важно:** С Domain Authentication в SendGrid, **НЕ е нужно** да имаш email hosting (Gmail, Outlook, etc.). SendGrid handle-ва изпращането директно.

### Стъпка 3: Настрой в Environment Variables

#### За Development (sendgrid.env):

```bash
# В sendgrid.env файла
SENDGRID_API_KEY=SG.xxxxx
FROM_EMAIL=noreply@yourdomain.com  # ⬅️ Промени това!
FROM_NAME=AI SEO 2.0 Team
SUPPORT_EMAIL=support@yourdomain.com  # ⬅️ И това!
```

#### За Production (Railway Environment Variables):

Добави в Railway:
```
SENDGRID_API_KEY=SG.xxxxx
FROM_EMAIL=noreply@yourdomain.com
FROM_NAME=AI SEO 2.0 Team
SUPPORT_EMAIL=support@yourdomain.com
```

### Стъпка 4: Тествай

```bash
# Пусни тест скрипта
node backend/test-email.js
```

## 🔍 Как да провериш дали работи

1. **Провери SendGrid Dashboard:**
   - Settings → Sender Authentication
   - Domain трябва да е "Authenticated" ✅

2. **Тествай изпращане:**
   - Пусни тест скрипта
   - Провери inbox-а (и spam папката)

3. **Провери SendGrid Activity:**
   - Activity → Email Activity
   - Трябва да видиш изпратените имейли

## ⚠️ Често срещани проблеми

### Проблем: 403 Forbidden

**Причина:** Sender email не е от верифицирания домейн

**Решение:** 
- Убеди се че `FROM_EMAIL` е от верифицирания домейн
- Пример: Ако домейнът е `aiseo2.app`, използвай `noreply@aiseo2.app`

### Проблем: Emails отиват в spam

**Причина:** DMARC/SPF не са правилно настроени

**Решение:**
- Провери SendGrid → Settings → Sender Authentication
- Убеди се че всички DNS записи са правилно настроени

## 📋 Checklist

- [ ] Domain Authentication е верифициран в SendGrid
- [ ] Избрал си sender email адрес от верифицирания домейн
- [ ] Настроил си `FROM_EMAIL` в environment variables
- [ ] Тествал си изпращане на имейл
- [ ] Проверил си SendGrid Activity за изпратени имейли

## 🎯 Примерна конфигурация

```env
# sendgrid.env (development)
SENDGRID_API_KEY=SG.xxxxx  # Replace with your actual SendGrid API key
FROM_EMAIL=noreply@aiseo2.app
FROM_NAME=AI SEO 2.0 Team
SUPPORT_EMAIL=support@aiseo2.app
```

```env
# Railway Environment Variables (production)
SENDGRID_API_KEY=SG.xxxxx  # Replace with your actual SendGrid API key
FROM_EMAIL=noreply@aiseo2.app
FROM_NAME=AI SEO 2.0 Team
SUPPORT_EMAIL=support@aiseo2.app
```

## 💡 Важно

- **НЕ е нужно email hosting** - SendGrid handle-ва всичко
- **Използвай email от верифицирания домейн** - иначе ще получиш 403
- **Тествай преди production** - използвай тест скрипта
- **Мониторирай SendGrid Activity** - за да видиш статуса на имейлите

