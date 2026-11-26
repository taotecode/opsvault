import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RequestAuth } from '../lib/permissions.js';
import { errors } from '../lib/errors.js';
import {
  hostCreateSchema,
  hostListQuerySchema,
  hostPatchSchema,
  idSchema,
  type Scope,
} from '@opsvault/shared';
import { listHosts, getHostRow, hostDto, createHost, patchHost, projectHosts } from '../services/hosts.js';
import { probeHost } from '../services/probe.js';
import { listCredentials } from '../services/credentials.js';
import { listKeypairs, connectCommand } from '../services/keypairs.js';
import { versionInfo } from '../services/system.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  safety: 'read' | 'write' | 'sensitive';
  scope: Scope;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'hosts_list',
    description:
      '列出服务器资产（含自动探测字段、手动字段与状态）。示例：{"env":"prod","limit":20}',
    safety: 'read',
    scope: 'hosts:read',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '按名称/地址/供应商搜索' },
        env: { type: 'string', enum: ['prod', 'staging', 'dev'] },
        status: { type: 'string', enum: ['pending', 'online', 'warning', 'offline'] },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
        fields: { type: 'string', description: '逗号分隔的字段名，如 id,name,status,address' },
      },
    },
  },
  {
    name: 'host_get',
    description: '按 id 获取单台服务器详情；id 来自 hosts_list。',
    safety: 'read',
    scope: 'hosts:read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'hosts_search',
    description: '按关键字搜索服务器（名称、地址、供应商、分组）。',
    safety: 'read',
    scope: 'hosts:read',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, limit: { type: 'number', default: 20 } },
      required: ['q'],
    },
  },
  {
    name: 'hosts_create',
    description:
      '创建服务器资产（需 hosts:write）。示例：{"name":"ali-hk-02","address":"47.242.0.0","sshUser":"root","env":"prod"}',
    safety: 'write',
    scope: 'hosts:write',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        address: { type: 'string' },
        port: { type: 'number', default: 22 },
        sshUser: { type: 'string', default: 'root' },
        env: { type: 'string', enum: ['prod', 'staging', 'dev'] },
        group: { type: 'string' },
        provider: { type: 'string' },
        notes: { type: 'string' },
        bandwidthMbps: { type: 'number' },
        expiresAt: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['name', 'address'],
    },
  },
  {
    name: 'hosts_update',
    description: '更新服务器手动字段或基础信息（需 hosts:write）。',
    safety: 'write',
    scope: 'hosts:write',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        patch: { type: 'object', description: '可含 name/address/provider/bandwidthMbps/expiresAt/notes 等' },
      },
      required: ['id', 'patch'],
    },
  },
  {
    name: 'host_probe',
    description: '触发一次 SSH 自动探测并返回最新硬件/系统字段（需 hosts:write）。',
    safety: 'write',
    scope: 'hosts:write',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'credentials_list_meta',
    description: '列出凭据的元数据（名称/类型/强度/关联主机）。永不返回明文。',
    safety: 'read',
    scope: 'credentials:read',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'keypairs_list',
    description: '列出密钥对及部署/验证状态、快速连接命令所需信息（不含私钥）。',
    safety: 'read',
    scope: 'keypairs:read',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'keypairs_connect_command',
    description: '获取指定密钥对在目标主机上的 ssh/scp 快速连接命令（不含密钥内容）。',
    safety: 'read',
    scope: 'keypairs:read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, hostId: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'audit_list',
    description: '读取审计日志（需 audit:read；可按类别过滤）。',
    safety: 'read',
    scope: 'audit:read',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['auth', 'asset', 'cred', 'key', 'user', 'api', 'system'] },
        limit: { type: 'number', default: 20, maximum: 100 },
      },
    },
  },
  {
    name: 'system_version',
    description: '返回平台版本、数据库引擎与安装状态。',
    safety: 'read',
    scope: 'system:read',
    inputSchema: { type: 'object', properties: {} },
  },
];

function ensureScope(auth: RequestAuth, scope: Scope): void {
  if (auth.via === 'token') {
    if (!auth.scopes.includes(scope)) throw errors.forbidden(`令牌缺少 scope：${scope}`);
    return;
  }
  if (auth.user.role === 'viewer' && scope.endsWith(':write')) throw errors.forbidden('只读用户不可写');
}

function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

function parseArgs<T>(schema: z.ZodType<T>, args: unknown): T {
  const result = schema.safeParse(args ?? {});
  if (!result.success) throw errors.validation(result.error.issues, '检查工具参数');
  return result.data;
}

const hostIdArgs = z.object({ id: idSchema });
const hostsSearchArgs = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const hostsUpdateArgs = z.object({ id: idSchema, patch: hostPatchSchema });
const connectCommandArgs = z.object({ id: idSchema, hostId: idSchema.optional() });
const auditListArgs = z.object({
  category: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function executeTool(
  app: FastifyInstance,
  auth: RequestAuth,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = toolByName(name);
  if (!tool) throw errors.notFound(`工具 ${name}`);
  ensureScope(auth, tool.scope);
  const actor = {
    id: auth.user.id,
    label: auth.actorLabel,
    kind: auth.actorKind,
    ip: null,
    ua: 'mcp',
  };

  switch (name) {
    case 'hosts_list': {
      const query = parseArgs(hostListQuerySchema, args);
      const result = await listHosts(app.db, {
        limit: query.limit,
        q: query.q,
        env: query.env,
        status: query.status,
      });
      return {
        data: projectHosts(result.items, query.fields),
        page: { cursor: result.nextCursor, hasMore: result.hasMore },
      };
    }
    case 'host_get': {
      const { id } = parseArgs(hostIdArgs, args);
      return { data: hostDto(await getHostRow(app.db, id)) };
    }
    case 'hosts_search': {
      const query = parseArgs(hostsSearchArgs, args);
      const result = await listHosts(app.db, { limit: query.limit, q: query.q });
      return { data: result.items };
    }
    case 'hosts_create': {
      const input = parseArgs(hostCreateSchema, args);
      const created = await createHost(app.db, input, actor);
      return { data: created };
    }
    case 'hosts_update': {
      const { id, patch } = parseArgs(hostsUpdateArgs, args);
      return { data: await patchHost(app.db, id, patch, actor) };
    }
    case 'host_probe': {
      const { id } = parseArgs(hostIdArgs, args);
      const result = await probeHost(app.db, app.config, id, actor);
      return { data: { host: result.host, partial: result.partial } };
    }
    case 'credentials_list_meta':
      return { data: await listCredentials(app.db) };
    case 'keypairs_list':
      return { data: await listKeypairs(app.db) };
    case 'keypairs_connect_command': {
      const { id, hostId } = parseArgs(connectCommandArgs, args);
      return { data: await connectCommand(app.db, id, hostId) };
    }
    case 'audit_list': {
      const { limit, category } = parseArgs(auditListArgs, args);
      let qb = app.db.selectFrom('audit_logs').selectAll().orderBy('created_at', 'desc').limit(limit);
      if (category) qb = qb.where('target_type', '=', category);
      const rows = await qb.execute();
      return {
        data: rows.map((r) => ({
          time: r.created_at,
          actor: r.actor_label,
          action: r.action,
          target: r.target_id,
          success: !!r.success,
        })),
      };
    }
    case 'system_version':
      return { data: versionInfo(app.config) };
    default:
      throw errors.notFound('工具');
  }
}
