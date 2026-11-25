import type { FastifyInstance } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { APP_VERSION } from '@boerfen/shared';
import type { RequestAuth } from '../lib/permissions.js';
import { errors } from '../lib/errors.js';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';

function buildServer(app: FastifyInstance, auth: RequestAuth) {
  const server = new Server(
    { name: 'boerfen-assets', version: APP_VERSION },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: {
        readOnlyHint: t.safety === 'read',
        destructiveHint: false,
        title: t.name,
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await executeTool(app, auth, name, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `工具执行失败：${(e as Error).message}` }],
        isError: true,
      };
    }
  });
  return server;
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.all('/mcp', async (req, reply) => {
    const auth = req.auth;
    if (!auth) throw errors.unauthorized('MCP 需要 Bearer Agent 令牌');
    if (req.method !== 'POST') {
      reply.code(405).send({ error: { code: 'NOT_ALLOWED', message: '仅支持 POST /mcp（Streamable HTTP）' } });
      return;
    }
    const server = buildServer(app, auth);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
}
