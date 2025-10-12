# Testing Insufficient Tokens Flow

## Method 1: MongoDB Direct Manipulation (Recommended)

### Steps:

1. **Open MongoDB Atlas/Compass**
   - Connect to your MongoDB instance
   - Navigate to database: `shopify_seo_app` (or your DB name)
   - Collection: `tokenbalances`

2. **Find your shop's token balance:**
   ```javascript
   {
     shop: "asapxt-teststore.myshopify.com"
   }
   ```

3. **Set balance to a low number:**
   ```javascript
   // Update the document
   {
     $set: {
       balance: 100  // Very low balance
     }
   }
   ```

4. **Try to use an AI feature:**
   - Go to Products page → Select a product
   - Click "Generate AI SEO"
   - Choose multiple languages (requires more tokens)
   - **Expected:** InsufficientTokensModal appears!

5. **Test the modal:**
   - Check token amounts displayed
   - Try selecting different purchase amounts
   - Verify token calculation is correct
   - Click "Purchase Tokens" → Should redirect to Shopify

---

## Method 2: Backend Test Endpoint (For Development)

### Create a test endpoint to manipulate balance:

**Add to `backend/server.js` (temporary, for testing only):**

```javascript
// TEST ENDPOINT - Remove in production
app.post('/test/set-token-balance', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not allowed in production' });
  }
  
  const { shop, balance } = req.body;
  const TokenBalance = (await import('./db/TokenBalance.js')).default;
  
  const tokenBalance = await TokenBalance.getOrCreate(shop);
  tokenBalance.balance = balance || 0;
  await tokenBalance.save();
  
  res.json({ 
    success: true, 
    shop,
    newBalance: tokenBalance.balance 
  });
});
```

### Usage:

```bash
# Set balance to 100 tokens
curl -X POST https://your-app.railway.app/test/set-token-balance \
  -H "Content-Type: application/json" \
  -d '{"shop": "asapxt-teststore.myshopify.com", "balance": 100}'
```

---

## Method 3: Use AI Feature Multiple Times

### Natural depletion:

1. **Set initial balance** (via MongoDB):
   - Balance: 5,000 tokens

2. **Use AI SEO Generation** repeatedly:
   - Generate for 1 product = ~1,000 tokens
   - Generate for 2 languages = ~2,800 tokens
   - After 2 generations, balance = ~200 tokens

3. **Try to generate again:**
   - Requires 1,000+ tokens
   - **Expected:** InsufficientTokensModal appears!

---

## Test Scenarios:

### Scenario 1: Slightly insufficient
```
Required: 1,000 tokens
Available: 500 tokens
Needed: 500 tokens
```
- Modal should show: "You need 500 more tokens"
- Purchase $10 → 60M tokens → "✓ Enough to use this feature"

### Scenario 2: Very insufficient
```
Required: 10,000 tokens
Available: 100 tokens
Needed: 9,900 tokens
```
- Modal should show: "You need 9,900 more tokens"
- Purchase $10 → Still not enough warning

### Scenario 3: Zero balance
```
Required: 1,000 tokens
Available: 0 tokens
Needed: 1,000 tokens
```
- Modal should show: "You need 1,000 more tokens"
- Any purchase amount should work

---

## Expected Modal Behavior:

### Visual Elements:
- ✅ Warning banner: "You don't have enough tokens"
- ✅ Current balance display
- ✅ Tokens required
- ✅ Tokens needed (difference)
- ✅ Purchase amount selector ($10, $20, $50, $100, custom)
- ✅ Token calculation preview
- ✅ Visual indicator: "✓ Enough" or "⚠ Still not enough"

### Functional Tests:
1. **Select $10:**
   - Should show: 60,000,000 tokens
   - Check if sufficient indicator appears

2. **Enter custom amount:**
   - Type "15"
   - Should show: 90,000,000 tokens
   - Verify calculation is correct

3. **Click Purchase:**
   - Should call `/api/billing/tokens/purchase`
   - Redirect to Shopify confirmation
   - After approval → balance updated
   - Modal closes → feature works

---

## Quick Test Commands:

### Set low balance via MongoDB:
```javascript
db.tokenbalances.updateOne(
  { shop: "asapxt-teststore.myshopify.com" },
  { 
    $set: { balance: 100 },
    $setOnInsert: {
      shop: "asapxt-teststore.myshopify.com",
      totalPurchased: 0,
      totalUsed: 0,
      purchases: [],
      usage: []
    }
  },
  { upsert: true }
)
```

### Check token balance:
```javascript
db.tokenbalances.findOne({ shop: "asapxt-teststore.myshopify.com" })
```

### Reset to high balance (after testing):
```javascript
db.tokenbalances.updateOne(
  { shop: "asapxt-teststore.myshopify.com" },
  { $set: { balance: 60000000 } }
)
```

---

## Backend Logs to Monitor:

When testing, watch for these logs:

```
[Billing] Error checking feature access: Insufficient token balance
[SEO/GENERATE] Insufficient tokens
Response: 402 Payment Required
{
  error: "Insufficient token balance",
  requiresPurchase: true,
  tokensRequired: 1000,
  tokensAvailable: 100,
  tokensNeeded: 900
}
```

---

## Frontend Console Logs:

```javascript
[useTokens] Error executing with tokens: 
{
  type: 'access_denied',
  reason: 'insufficient_tokens',
  details: {
    tokensRequired: 1000,
    tokensAvailable: 100,
    tokensNeeded: 900
  }
}
```

---

## Common Issues & Solutions:

### Issue 1: Modal doesn't appear
**Solution:** Check if `useTokens` hook is properly integrated
- Verify `executeWithTokens()` is called before AI generation
- Check 402 error handling in frontend

### Issue 2: Wrong token calculations
**Solution:** Verify formula in modal:
```javascript
const tokenBudget = usdAmount * 0.60;
const tokens = (tokenBudget / 0.10) * 1_000_000;
// $10 = $6 = 60M tokens ✓
```

### Issue 3: Purchase doesn't update balance
**Solution:** Check callback endpoint:
- `/billing/tokens/callback` is registered
- MongoDB update is successful
- Frontend refetches balance after redirect

---

## Complete Test Checklist:

- [ ] Set low token balance (100 tokens)
- [ ] Try AI SEO generation → Modal appears
- [ ] Verify all modal information is correct
- [ ] Select different purchase amounts
- [ ] Check real-time token calculation
- [ ] Verify "enough/not enough" indicator
- [ ] Click "Purchase Tokens"
- [ ] Approve test charge in Shopify
- [ ] Verify redirect back to app
- [ ] Check balance is updated
- [ ] Try feature again → Should work now
- [ ] Verify token deduction after use
- [ ] Check usage history in MongoDB

