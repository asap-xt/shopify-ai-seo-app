// backend/middleware/aiAnalytics.js
// Middleware to track AI bot visits to AI endpoints
// Logs asynchronously to MongoDB without blocking the response

import crypto from 'crypto';
import AIVisitLog from '../db/AIVisitLog.js';

/**
 * Known AI bots and their friendly names
 * Order matters: first match wins
 */
const KNOWN_BOTS = [
  // AI Search / Chat bots
  { pattern: /GPTBot/i, name: 'ChatGPT' },
  { pattern: /ChatGPT-User/i, name: 'ChatGPT' },
  { pattern: /OAI-SearchBot/i, name: 'OpenAI Search' },
  { pattern: /ClaudeBot/i, name: 'Claude' },
  { pattern: /Claude-Web/i, name: 'Claude' },
  { pattern: /PerplexityBot/i, name: 'Perplexity' },
  { pattern: /cohere-ai/i, name: 'Cohere' },
  { pattern: /YouBot/i, name: 'You.com' },
  
  // Search engine AI
  { pattern: /Google-Extended/i, name: 'Google AI' },
  { pattern: /Googlebot/i, name: 'Google' },
  { pattern: /Bingbot/i, name: 'Bing' },
  { pattern: /bingbot/i, name: 'Bing' },
  
  // Platform bots
  { pattern: /Applebot/i, name: 'Apple' },
  { pattern: /Meta-ExternalAgent/i, name: 'Meta AI' },
  { pattern: /facebookexternalhit/i, name: 'Facebook' },
  { pattern: /Twitterbot/i, name: 'Twitter/X' },
  { pattern: /LinkedInBot/i, name: 'LinkedIn' },
  
  // Internal
  { pattern: /AI-SEO-Testing-Bot/i, name: 'indexAIze Test' },
  
  // Generic crawlers
  { pattern: /Amazonbot/i, name: 'Amazon' },
  { pattern: /YandexBot/i, name: 'Yandex' },
  { pattern: /DuckDuckBot/i, name: 'DuckDuckGo' },
  { pattern: /Slurp/i, name: 'Yahoo' },
  { pattern: /Sogou/i, name: 'Sogou' },
  { pattern: /ia_archiver/i, name: 'Internet Archive' },
  { pattern: /SemrushBot/i, name: 'Semrush' },
  { pattern: /AhrefsBot/i, name: 'Ahrefs' },
  { pattern: /MJ12bot/i, name: 'Majestic' },
  { pattern: /DotBot/i, name: 'DotBot' },
  
  // Generic bot detection (catch-all)
  { pattern: /bot|crawler|spider|scraper|agent/i, name: 'Other Bot' },
];

/**
 * Detect bot name from User-Agent string
 */
function detectBot(userAgent) {
  if (!userAgent) return 'Unknown';
  
  for (const bot of KNOWN_BOTS) {
    if (bot.pattern.test(userAgent)) {
      return bot.name;
    }
  }
  
  // If no bot pattern matched, it might be a human visitor or unknown agent
  return 'Human/Unknown';
}

/**
 * Hash IP address for privacy (no PII stored)
 */
function hashIP(ip) {
  if (!ip) return '';
  return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

/**
 * Normalize endpoint path for consistent grouping
 * e.g. '/apps/indexaize/ai/products.json' -> '/ai/products.json'
 */
function normalizeEndpoint(path) {
  if (!path) return '/unknown';
  
  // Strip app proxy prefix
  const cleaned = path
    .replace(/^\/apps\/[^/]+/, '')  // Remove /apps/{subpath}
    .replace(/\?.*$/, '');          // Remove query string
  
  return cleaned || '/unknown';
}

/**
 * Create AI analytics middleware
 * @param {string} source - 'app_proxy' or 'direct'
 */
export function createAIAnalyticsMiddleware(source = 'direct') {
  return (req, res, next) => {
    const startTime = Date.now();
    
    // Capture the original end method
    const originalEnd = res.end;
    
    res.end = function(...args) {
      // Restore original end
      res.end = originalEnd;
      res.end(...args);
      
      // Log asynchronously (fire-and-forget, don't block response)
      const responseTimeMs = Date.now() - startTime;
      const shop = req.query?.shop || req.get('x-shopify-shop-domain') || '';
      const userAgent = req.get('User-Agent') || '';
      const ip = req.get('x-forwarded-for')?.split(',')[0]?.trim() || req.ip || '';
      
      // Only log if we have a shop
      if (shop) {
        AIVisitLog.create({
          shop: shop.replace(/^https?:\/\//, '').toLowerCase(),
          endpoint: normalizeEndpoint(req.path),
          botName: detectBot(userAgent),
          userAgent: userAgent.substring(0, 500), // Limit UA length
          ipHash: hashIP(ip),
          statusCode: res.statusCode,
          responseTimeMs,
          source,
          createdAt: new Date()
        }).catch(err => {
          // Silent fail - analytics should never break the app
          if (process.env.NODE_ENV !== 'production') {
            console.error('[AI-ANALYTICS] Log error:', err.message);
          }
        });
      }
    };
    
    next();
  };
}

export { detectBot, normalizeEndpoint, KNOWN_BOTS };
