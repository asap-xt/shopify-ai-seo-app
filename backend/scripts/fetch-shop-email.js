// Script to manually fetch and update shop email from Shopify API
import mongoose from 'mongoose';
import Shop from '../db/Shop.js';
import { SHOPIFY_API_VERSION } from '../utils/env.js';

const MONGODB_URI = process.env.MONGODB_URI;

async function fetchAndUpdateShopEmail(shopDomain) {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const shop = await Shop.findOne({ shop: shopDomain });
    
    if (!shop) {
      console.log('❌ Shop not found in database:', shopDomain);
      process.exit(1);
    }

    if (!shop.accessToken) {
      console.log('❌ Shop has no access token:', shopDomain);
      process.exit(1);
    }

    console.log('\n📧 CURRENT EMAIL INFO:');
    console.log('======================');
    console.log('Shop:', shop.shop);
    console.log('Email:', shop.email || 'NOT SET');
    console.log('Shop Owner:', shop.shopOwner || 'NOT SET');
    console.log('Contact Email:', shop.contactEmail || 'NOT SET');
    console.log('======================\n');

    // Fetch from Shopify GraphQL API
    console.log('📡 Fetching shop email from Shopify GraphQL API...');
    const shopQuery = `
      query {
        shop {
          email
          contactEmail
          name
        }
      }
    `;
    
    const shopResponse = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shop.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: shopQuery }),
    });

    if (!shopResponse.ok) {
      console.error('❌ Shopify GraphQL API error:', shopResponse.status, shopResponse.statusText);
      process.exit(1);
    }

    const shopData = await shopResponse.json();
    console.log('📧 Shop data from Shopify:', JSON.stringify(shopData, null, 2));
    
    const shopEmail = shopData.data?.shop?.email || shopData.data?.shop?.contactEmail || null;
    const shopName = shopData.data?.shop?.name || null;
    
    if (!shopEmail) {
      console.warn('⚠️  No email found in Shopify API response!');
      process.exit(1);
    }

    // Update shop in DB
    const updateFields = {
      updatedAt: new Date()
    };
    
    if (shopEmail) {
      updateFields.email = shopEmail;
      updateFields.shopOwnerEmail = shopEmail;
      updateFields.contactEmail = shopEmail;
    }
    
    if (shopName) {
      updateFields.name = shopName;
    }

    await Shop.updateOne(
      { shop: shopDomain },
      { $set: updateFields }
    );

    console.log('\n✅ UPDATED EMAIL INFO:');
    console.log('======================');
    console.log('Shop:', shopDomain);
    console.log('Email:', shopEmail);
    console.log('Name:', shopName);
    console.log('======================\n');
    console.log('✅ Shop email updated successfully!');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

const shopDomain = process.argv[2];
if (!shopDomain) {
  console.error('Usage: node fetch-shop-email.js <shop-domain>');
  console.error('Example: node fetch-shop-email.js testnew-asapxt.myshopify.com');
  process.exit(1);
}

fetchAndUpdateShopEmail(shopDomain);

