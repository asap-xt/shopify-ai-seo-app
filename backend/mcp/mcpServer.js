// backend/mcp/mcpServer.js
// MCP Server instance with tools and resources registration
// Uses StreamableHTTP transport with session management

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import crypto from 'crypto';
import {
  searchProducts,
  getProductDetails,
  getStoreInfo,
  searchCollections,
  askQuestion,
  readCatalogResource,
  readPoliciesResource,
  readMetadataResource
} from './mcpTools.js';

// ============================================================
// SESSION MANAGEMENT
// ============================================================
// Each MCP session maintains a server + transport pair.
// Sessions are keyed by sessionId and expire after 30 minutes.
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Cleanup stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      console.log(`[MCP] Cleaning up stale session ${id} for ${session.shop}`);
      session.transport.close().catch(() => {});
      session.server.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

/**
 * Create an MCP Server with all tools and resources for a specific shop.
 */
function createServer(shopDomain, userAgent) {
  const server = new McpServer(
    {
      name: 'indexAIze',
      version: '1.2.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );

  // ============================================================
  // REGISTER TOOLS
  // ============================================================

  server.tool(
    'search_products',
    'Search for products with AI-optimized titles, descriptions, FAQ, and keywords. Returns richer data than standard Shopify search.',
    {
      query: z.string().describe('Search query (e.g. "blue dress", "midi skirt")'),
      product_type: z.string().optional().describe('Filter by product type (e.g. "Dress", "Shoes")'),
      tags: z.string().optional().describe('Filter by tags, comma-separated (e.g. "blue,summer")'),
      min_price: z.number().optional().describe('Minimum price filter'),
      max_price: z.number().optional().describe('Maximum price filter'),
      limit: z.number().optional().default(10).describe('Max results to return (default 10, max 50)')
    },
    async (args) => {
      return await searchProducts(shopDomain, args, userAgent);
    }
  );

  server.tool(
    'get_product_details',
    'Get full details for a specific product including AI-optimized description, FAQ, bullet points, keywords, images, and availability.',
    {
      handle: z.string().optional().describe('Product URL handle (e.g. "the-white-blue-bohemian-dress")'),
      product_id: z.string().optional().describe('Shopify product ID')
    },
    async (args) => {
      if (!args.handle && !args.product_id) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Either handle or product_id is required' }) }],
          isError: true
        };
      }
      return await getProductDetails(shopDomain, args, userAgent);
    }
  );

  server.tool(
    'get_store_info',
    'Get store brand information including business type, unique selling points, target audience, brand voice, shipping/return policies, and contact details. Not available through standard Shopify MCP.',
    {},
    async () => {
      return await getStoreInfo(shopDomain, {}, userAgent);
    }
  );

  server.tool(
    'search_collections',
    'Browse product collections with AI-optimized descriptions and product counts.',
    {
      query: z.string().optional().describe('Search query to filter collections by name'),
      limit: z.number().optional().default(20).describe('Max results to return (default 20)')
    },
    async (args) => {
      return await searchCollections(shopDomain, args, userAgent);
    }
  );

  server.tool(
    'ask_question',
    'Ask any question about the store and get an AI-powered answer based on the full product catalog, policies, and store context. Great for "What do you recommend for X?" type questions.',
    {
      question: z.string().describe('The question to ask (e.g. "What midi dresses do you have in blue?", "What is your return policy?")'),
      context: z.string().optional().describe('Additional context about the buyer (e.g. "looking for a gift", "budget under $50")')
    },
    async (args) => {
      return await askQuestion(shopDomain, args, userAgent);
    }
  );

  // ============================================================
  // REGISTER RESOURCES
  // ============================================================

  server.resource(
    'catalog',
    `store://${shopDomain}/catalog`,
    { mimeType: 'application/json', description: 'Full product catalog with titles, prices, types, and URLs' },
    async () => {
      return await readCatalogResource(shopDomain);
    }
  );

  server.resource(
    'policies',
    `store://${shopDomain}/policies`,
    { mimeType: 'application/json', description: 'Store policies: shipping, returns, privacy, terms of service' },
    async () => {
      return await readPoliciesResource(shopDomain);
    }
  );

  server.resource(
    'metadata',
    `store://${shopDomain}/metadata`,
    { mimeType: 'application/json', description: 'Store metadata: brand info, SEO data, AI context, contact details' },
    async () => {
      return await readMetadataResource(shopDomain);
    }
  );

  return server;
}

/**
 * Create and configure the MCP handler.
 * Returns an Express handler function.
 */
export function createMcpHandler() {
  return async function handleMcpRequest(req, res) {
    const shop = req.query.shop;

    if (!shop) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Missing required query parameter: shop' },
        id: null
      });
    }

    const shopDomain = shop.replace(/^https?:\/\//, '').toLowerCase();
    const userAgent = req.get('User-Agent') || '';

    // Check for existing session
    const sessionId = req.headers['mcp-session-id'];

    if (sessionId && sessions.has(sessionId)) {
      // Existing session — reuse server + transport
      const session = sessions.get(sessionId);
      session.lastActivity = Date.now();

      try {
        await session.transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error('[MCP] Session request error:', err.message);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal MCP server error' },
            id: null
          });
        }
      }
      return;
    }

    // Handle DELETE for session cleanup
    if (req.method === 'DELETE') {
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        await session.transport.close();
        await session.server.close();
        sessions.delete(sessionId);
        res.status(200).end();
      } else {
        // No session to delete — that's OK per spec
        res.status(405).end();
      }
      return;
    }

    // New session — create server + transport
    try {
      const server = createServer(shopDomain, userAgent);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID()
      });

      // When transport closes, remove session
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };

      await server.connect(transport);

      // Handle the initialize request
      await transport.handleRequest(req, res, req.body);

      // Store session for future requests
      if (transport.sessionId) {
        sessions.set(transport.sessionId, {
          server,
          transport,
          shop: shopDomain,
          userAgent,
          lastActivity: Date.now()
        });
        console.log(`[MCP] New session ${transport.sessionId} for ${shopDomain} (total: ${sessions.size})`);
      }
    } catch (err) {
      console.error('[MCP] Server error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal MCP server error' },
          id: null
        });
      }
    }
  };
}
