import type { FastifyInstance } from 'fastify';
import type { RequestAuth } from '../lib/permissions.js';
import { errors } from '../lib/errors.js';
import type { Scope } from '@boerfen/shared';
import { listHosts, getHostRow, hostDto, createHost, patchHost } from '../services/hosts.js';
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
    scope: 'settings:read',
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
      const result = await listHosts(app.db, {
        limit: Number(args.limit ?? 50),
        q: args.q as string | undefined,
        env: args.env as string | undefined,
        status: args.status as string | undefined,
      });
      return { data: result.items, page: { cursor: result.nextCursor, hasMore: result.hasMore } };
    }
    case 'host_get':
      return { data: hostDto(await getHostRow(app.db, String(args.id))) };
    case 'hosts_search': {
      const result = await listHosts(app.db, {
        limit: Number(args.limit ?? 20),
        q: String(args.q ?? ''),
      });
      return { data: result.items };
    }
    case 'hosts_create': {
      const created = await createHost(
        app.db,
        {
          name: String(args.name),
          address: String(args.address),
          port: Number(args.port ?? 22),
          sshUser: String(args.sshUser ?? 'root'),
          env: (args.env as 'prod' | 'staging' | 'dev') ?? 'prod',
          group: args.group as string | undefined,
          provider: args.provider as string | undefined,
          notes: args.notes as string | undefined,
          bandwidthMbps: args.bandwidthMbps as number | undefined,
          expiresAt: (args.expiresAt as string | undefined) ?? null,
        } as never,
        actor,
      );
      return { data: created };
    }
    case 'hosts_update': {
      const id = String(args.id);
      const patch = (args.patch ?? {}) as Record<string, unknown>;
      return { data: await patchHost(app.db, id, patch as never, actor) };
    }
    case 'host_probe': {
      const result = await probeHost(app.db, app.config, String(args.id), actor);
      return { data: { host: result.host, partial: result.partial } };
    }
    case 'credentials_list_meta':
      return { data: await listCredentials(app.db) };
    case 'keypairs_list':
      return { data: await listKeypairs(app.db) };
    case 'keypairs_connect_command':
      return { data: await connectCommand(app.db, String(args.id), args.hostId as string | undefined) };
    case 'audit_list': {
      const limit = Number(args.limit ?? 20);
      let qb = app.db.selectFrom('audit_logs').selectAll().orderBy('created_at', 'desc').limit(limit);
      if (args.category) qb = qb.where('target_type', '=', String(args.category));
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
