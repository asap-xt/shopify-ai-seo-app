// Cleanup legacy IndexAIze ScriptTags (Option 3).
//
// The storefront JSON-LD injection is disabled. A ScriptTag pointing to
// /api/schema/auto-inject.js may still exist on stores from an older app version.
// auto-inject.js is now a no-op, but this script removes the leftover ScriptTag entirely.
//
// Usage:
//   node scripts/cleanup-legacy-scripttags.js <shop-domain>            # dry-run (lists only)
//   node scripts/cleanup-legacy-scripttags.js <shop-domain> --delete   # actually delete
//
// Example:
//   node scripts/cleanup-legacy-scripttags.js plamenna-fashion-boutique.myshopify.com --delete

import mongoose from 'mongoose';
import Shop from '../db/Shop.js';
import { SHOPIFY_API_VERSION } from '../utils/env.js';

const MONGODB_URI = process.env.MONGODB_URI;

// A ScriptTag is considered "ours (legacy)" if its src matches any of these.
const LEGACY_SRC_PATTERNS = ['/api/schema/auto-inject.js', '/api/schema/product-schemas', '/api/schema/site-faq-script'];

function isLegacyScriptTag(src) {
  if (!src) return false;
  return LEGACY_SRC_PATTERNS.some((p) => src.includes(p));
}

async function main(shopDomain, doDelete) {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is not set in the environment.');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const shop = await Shop.findOne({ shop: shopDomain });
  if (!shop) {
    console.error('❌ Shop not found in database:', shopDomain);
    process.exit(1);
  }
  if (!shop.accessToken) {
    console.error('❌ Shop has no access token:', shopDomain);
    process.exit(1);
  }

  const base = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}`;
  const headers = { 'X-Shopify-Access-Token': shop.accessToken, 'Content-Type': 'application/json' };

  // List all ScriptTags (paginate defensively; a store rarely has >250).
  console.log('📡 Fetching ScriptTags…');
  const listRes = await fetch(`${base}/script_tags.json?limit=250`, { headers });
  if (!listRes.ok) {
    console.error('❌ Failed to list ScriptTags:', listRes.status, listRes.statusText);
    process.exit(1);
  }
  const { script_tags: allTags = [] } = await listRes.json();

  console.log(`\nFound ${allTags.length} ScriptTag(s) total:`);
  allTags.forEach((t) => console.log(`  - id=${t.id}  src=${t.src}`));

  const legacy = allTags.filter((t) => isLegacyScriptTag(t.src));

  if (legacy.length === 0) {
    console.log('\n✅ No legacy IndexAIze ScriptTags found. Nothing to clean up.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`\n🎯 ${legacy.length} legacy IndexAIze ScriptTag(s) matched:`);
  legacy.forEach((t) => console.log(`  - id=${t.id}  src=${t.src}`));

  if (!doDelete) {
    console.log('\nℹ️  Dry-run. Re-run with --delete to remove the ScriptTag(s) above.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('\n🗑️  Deleting…');
  for (const tag of legacy) {
    const delRes = await fetch(`${base}/script_tags/${tag.id}.json`, { method: 'DELETE', headers });
    if (delRes.ok) {
      console.log(`  ✅ Deleted ScriptTag id=${tag.id}`);
    } else {
      console.error(`  ❌ Failed to delete id=${tag.id}: ${delRes.status} ${delRes.statusText}`);
    }
  }

  console.log('\n✅ Done.');
  await mongoose.disconnect();
  process.exit(0);
}

const shopDomain = process.argv[2];
const doDelete = process.argv.includes('--delete');

if (!shopDomain) {
  console.error('Usage: node scripts/cleanup-legacy-scripttags.js <shop-domain> [--delete]');
  console.error('Example: node scripts/cleanup-legacy-scripttags.js plamenna-fashion-boutique.myshopify.com --delete');
  process.exit(1);
}

main(shopDomain, doDelete).catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
