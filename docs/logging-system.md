# Logging System

## Overview

The application uses a centralized logging system to reduce log spam and improve Railway performance.

---

## Log Levels

Set the `LOG_LEVEL` environment variable to control verbosity:

| Level | Description | What's logged |
|-------|-------------|---------------|
| `error` | Only errors | Critical failures only |
| `warn` | Errors + Warnings | Problems that need attention |
| `info` | **DEFAULT** | Errors + Warnings + Important events |
| `debug` | Everything | All logs including verbose debug info |

---

## Usage

### Environment Variable

Add to your `.env` or Railway variables:

```bash
# Default (recommended for production)
LOG_LEVEL=info

# Verbose debugging (development only)
LOG_LEVEL=debug

# Minimal logging (errors only)
LOG_LEVEL=error
```

### In Code

```javascript
import { logger, dbLogger, tokenLogger } from './utils/logger.js';

// General logging
logger.info('Application started');
logger.error('Something went wrong:', error);
logger.warn('Deprecated feature used');
logger.debug('Verbose debugging info');

// Module-specific loggers
dbLogger.info('Database connected');
tokenLogger.debug('Token resolved for shop:', shop);
```

---

## Module-Specific Loggers

| Logger | Prefix | Purpose |
|--------|--------|---------|
| `logger` | (none) | General application logs |
| `dbLogger` | `[DB]` | Database operations |
| `tokenLogger` | `[TOKEN]` | Token resolution |
| `graphqlLogger` | `[GRAPHQL]` | GraphQL queries |
| `apiLogger` | `[API]` | API requests |
| `shopLogger` | `[SHOP]` | Shop operations |

---

## Benefits

### Before (500+ logs/sec)

```
[TOKEN_RESOLVER] Resolving token for shop: example.myshopify.com
[TOKEN_RESOLVER] Found valid token in DB for example.myshopify.com
[GRAPHQL] Shop: example.myshopify.com
[GRAPHQL] Query: { shop { name } }
[GRAPHQL] Variables: {}
[GRAPHQL] Token resolved: Yes
[GRAPHQL] URL: https://example.myshopify.com/admin/api/2025-07/graphql.json
[GRAPHQL] Success, returning data
```

### After (info level, ~10-20 logs/sec)

```
[DB] ✅ MongoDB connected with optimized pool settings
[TOKEN] Exchanging JWT for access token: example.myshopify.com
✔ Server listening on 8080
```

---

## Railway Deployment

Railway has a **500 logs/sec limit**. Exceeding this causes:
- ⚠️ "Railway rate limit reached" warning
- ❌ Log messages dropped
- 🐌 Slower performance

**Solution:** Use `LOG_LEVEL=info` (default) in production.

---

## Debugging Production Issues

If you need to debug a production issue:

1. **Enable debug logging temporarily:**
   ```bash
   # Railway Dashboard → Variables
   LOG_LEVEL=debug
   ```

2. **Reproduce the issue**

3. **Check logs and identify the problem**

4. **Restore info level:**
   ```bash
   LOG_LEVEL=info
   ```

---

## Created: January 24, 2025
## Part of: PHASE 1 - Database Optimization

