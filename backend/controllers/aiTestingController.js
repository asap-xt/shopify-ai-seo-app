// backend/controllers/aiTestingController.js
import express from 'express';
import { validateRequest } from '../middleware/shopifyAuth.js';
import fetch from 'node-fetch';

const router = express.Router();

/**
 * POST /api/ai-testing/run-tests
 * Run automated tests for AI Discovery endpoints
 */
router.post('/ai-testing/run-tests', validateRequest(), async (req, res) => {
  const shop = req.shopDomain || req.query.shop || req.body.shop;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter required' });
  }
  
  console.log('[AI-TESTING] Running tests for shop:', shop);
  
  const endpoints = [
    { 
      key: 'productsJson', 
      name: 'Products JSON Feed', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/products.json?shop=${shop}`
    },
    { 
      key: 'storeMetadata', 
      name: 'Store Metadata', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/store-metadata.json?shop=${shop}`
    },
    { 
      key: 'welcomePage', 
      name: 'AI Welcome Page', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/welcome?shop=${shop}`
    },
    { 
      key: 'collectionsJson', 
      name: 'Collections JSON Feed', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/collections-feed.json?shop=${shop}`
    },
    { 
      key: 'aiSitemap', 
      name: 'AI-Enhanced Sitemap', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/sitemap.xml?shop=${shop}`
    },
    { 
      key: 'schemaData', 
      name: 'Advanced Schema Data', 
      url: `${process.env.APP_URL || `https://${req.get('host')}`}/ai/schema-data.json?shop=${shop}`
    }
  ];
  
  const results = {};
  
  for (const endpoint of endpoints) {
    try {
      console.log('[AI-TESTING] Testing endpoint:', endpoint.key, endpoint.url);
      
      const response = await fetch(endpoint.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'AI-SEO-Testing-Bot/1.0'
        },
        timeout: 10000 // 10 second timeout
      });
      
      console.log('[AI-TESTING] Response status:', response.status);
      
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        let data = null;
        let dataSize = 0;
        
        try {
          if (contentType && contentType.includes('application/json')) {
            const text = await response.text();
            data = JSON.parse(text);
            dataSize = text.length;
          } else if (contentType && contentType.includes('text/html')) {
            data = await response.text();
            dataSize = data.length;
          } else if (contentType && (contentType.includes('xml') || contentType.includes('text/plain'))) {
            data = await response.text();
            dataSize = data.length;
          } else {
            data = await response.text();
            dataSize = data.length;
          }
          
          results[endpoint.key] = {
            status: 'success',
            message: 'Endpoint is working correctly',
            name: endpoint.name,
            dataSize: dataSize,
            contentType: contentType
          };
          
          console.log('[AI-TESTING] Success:', endpoint.key, 'Size:', dataSize);
        } catch (parseError) {
          console.error('[AI-TESTING] Parse error:', parseError);
          results[endpoint.key] = {
            status: 'error',
            message: `Failed to parse response: ${parseError.message}`,
            name: endpoint.name
          };
        }
      } else if (response.status === 403) {
        results[endpoint.key] = {
          status: 'locked',
          message: 'Feature not enabled or plan upgrade required',
          name: endpoint.name
        };
      } else if (response.status === 402) {
        results[endpoint.key] = {
          status: 'locked',
          message: 'Plan upgrade required',
          name: endpoint.name
        };
      } else if (response.status === 404) {
        results[endpoint.key] = {
          status: 'error',
          message: 'Endpoint not found',
          name: endpoint.name
        };
      } else {
        const errorText = await response.text();
        results[endpoint.key] = {
          status: 'error',
          message: `HTTP ${response.status}: ${response.statusText}`,
          name: endpoint.name,
          details: errorText.substring(0, 200)
        };
      }
    } catch (error) {
      console.error('[AI-TESTING] Error testing endpoint:', endpoint.key, error);
      results[endpoint.key] = {
        status: 'error',
        message: error.message || 'Failed to fetch endpoint',
        name: endpoint.name
      };
    }
  }
  
  console.log('[AI-TESTING] Test results:', JSON.stringify(results, null, 2));
  
  res.json({
    shop,
    timestamp: new Date().toISOString(),
    results
  });
});

export default router;

