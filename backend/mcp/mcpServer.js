// backend/mcp/mcpServer.js
// MCP Server instance with tools and resources registration
// Uses StreamableHTTP transport for stateless HTTP operation

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
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

/**
 * Create and configure the MCP Server with all tools and resources.
 * Returns a function that handles Express requests.
 */
export function createMcpHandler() {
  /**
   * Handle an MCP request for a specific shop.
   * Creates a fresh McpServer + Transport per request (stateless mode).
   */
  return async function handleMcpRequest(req, res) {
    const shop = req.query.shop;

    if (!shop) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Missing required query parameter: shop' },
        id: null
      });
    }

    // Normalize shop domain
    const shopDomain = shop.replace(/^https?:\/\//, '').toLowerCase();
    const userAgent = req.get('User-Agent') || '';

    try {
      // Create a new MCP server per request (stateless)
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

      // ============================================================
      // CREATE TRANSPORT AND HANDLE REQUEST
      // ============================================================

      // Stateless transport - no session management needed
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined // stateless mode
      });

      // Connect server to transport
      await server.connect(transport);

      // Handle the HTTP request
      await transport.handleRequest(req, res, req.body);

      // Cleanup after response
      res.on('finish', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

    } catch (err) {
      console.error('[MCP] Server error:', err);

      // Only send error if headers haven't been sent yet
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
