// backend/controllers/publicSitemapController.js
// Public Sitemap Controller - No authentication required

import express from 'express';
import fetch from 'node-fetch';
import Shop from '../db/Shop.js';
import Subscription from '../db/Subscription.js';
import Sitemap from '../db/Sitemap.js';
import { resolveShopToken } from '../utils/tokenResolver.js';

const router = express.Router();
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// Helper: normalize shop domain
function normalizeShop(s) {
  if (!s) return null;
  s = String(s).trim().toLowerCase();
  if (/^https?:\/\//.test(s)) {
    const u = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return u.toLowerCase();
  }
  if (!/\.myshopify\.com$/i.test(s)) return s.toLowerCase() + '.myshopify.com';
  return s.toLowerCase();
}

// Helper: get access token using centralized resolver
async function resolveAdminTokenForShop(shop) {
  try {
    const token = await resolveShopToken(shop);
    return token;
  } catch (err) {
    console.error('[PUBLIC_SITEMAP] Token resolution failed:', err.message);
    const error = new Error(`No access token found for shop: ${shop} - ${err.message}`);
    error.status = 400;
    throw error;
  }
}

// Helper: GraphQL request
async function shopGraphQL(shop, query, variables = {}) {
  const token = await resolveAdminTokenForShop(shop);
  const url = 'https://' + shop + '/admin/api/' + API_VERSION + '/graphql.json';
  
  const rsp = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  
  const json = await rsp.json().catch(() => ({}));
  
  if (!rsp.ok || json.errors) {
    console.error('[PUBLIC_SITEMAP] GraphQL errors:', json.errors || json);
    const e = new Error('Admin GraphQL error: ' + JSON.stringify(json.errors || json));
    e.status = rsp.status || 500;
    throw e;
  }
  
  return json.data;
}

// Helper: get plan limits
async function getPlanLimits(shop) {
  try {
    const sub = await Subscription.findOne({ shop }).lean().exec();
    
    if (!sub) return { limit: 70, plan: 'starter' };
    
    const planLimits = {
      'starter': 70,
      'professional': 70,
      'professional_plus': 200,
      'professional plus': 200,
      'growth': 450,
      'growth_plus': 450,
      'growth plus': 450,
      'growth_extra': 750,
      'growth extra': 750,
      'enterprise': 1200
    };
    
    const limit = planLimits[sub.plan?.toLowerCase()] || 100;
    const result = { limit, plan: sub.plan };
    return result;
  } catch (e) {
    console.error('[PUBLIC_SITEMAP] Error getting plan limits:', e.message);
    return { limit: 70, plan: 'starter' };
  }
}

// Helper: escape XML special characters
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe).replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// Helper: clean HTML for XML
function cleanHtmlForXml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Main public sitemap handler
async function handlePublicSitemap(req, res) {
  try {
    // Extract shop from query parameters
    const shop = normalizeShop(req.query.shop);
    
    if (!shop) {
      console.error('[PUBLIC_SITEMAP] Missing shop parameter');
      return res.status(400).send('Missing shop parameter. Use: /public-sitemap.xml?shop=your-shop.myshopify.com');
    }
    
    // Check if we have cached sitemap
    const cachedSitemap = await Sitemap.findOne({ shop }).select('+content').lean().exec();
    
    if (cachedSitemap && cachedSitemap.content) {
      // Check if cache is fresh (less than 6 hours old for public access)
      const cacheAge = Date.now() - new Date(cachedSitemap.generatedAt).getTime();
      const sixHours = 6 * 60 * 60 * 1000;
      
      if (cacheAge < sixHours) {
        res.set({
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=21600', // 6 hours
          'Last-Modified': new Date(cachedSitemap.generatedAt).toUTCString(),
          'X-Sitemap-Cache': 'HIT',
          'X-Sitemap-Generated': cachedSitemap.generatedAt
        });
        return res.send(cachedSitemap.content);
      }
    }
    
    // If no fresh cache, return message to generate sitemap first
    
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    
    return res.status(404).send(`
Sitemap not found or outdated for shop: ${shop}

To generate a fresh sitemap:
1. Install and open the NEW AI SEO app in your Shopify admin
2. Go to the Sitemap section
3. Click "Generate Sitemap"
4. Your sitemap will be available at this URL

App URL: https://indexaize-aiseo-app-production.up.railway.app/?shop=${encodeURIComponent(shop)}
    `);
    
  } catch (err) {
    console.error('[PUBLIC_SITEMAP] Error:', err);
    res.status(err.status || 500).send(`Failed to serve sitemap: ${err.message}`);
  }
}

// Mount public sitemap route
router.get('/', handlePublicSitemap);

export default router;
