import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { APP_NAME, APP_VERSION, SCOPES } from '@opsvault/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
/** src/lib 或 dist/lib 均上溯 4 层到达仓库根 */
export const repoRoot = path.resolve(here, '../../../..');

export function repoFile(name: string): string | null {
  const candidates = [path.resolve(process.cwd(), name), path.resolve(repoRoot, name)];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function openApiSpec(baseUrl = 'http://localhost:8080') {
  const op = (
    operationId: string,
    summary: string,
    safety: 'read' | 'write' | 'sensitive',
    tags: string[],
    params: string[] = [],
    isPublic = false,
  ) => ({
    operationId,
    summary,
    tags,
    'x-safety': safety,
    ...(isPublic ? { security: [] } : {}),
    ...(params.length ? { parameters: params.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })) } : {}),
    responses: {
      '200': { description: '成功' },
      '401': { description: '未认证' },
      '403': { description: '无权限' },
      '404': { description: '不存在或已锁定' },
    },
  });

  const paths: Record<string, Record<string, unknown>> = {
    '/api/v1/health': { get: op('root.health', '健康检查', 'read', ['system'], [], true) },
    '/api/v1/meta': { get: op('root.meta', '能力发现：认证、scope、安全级别', 'read', ['system'], [], true) },
    '/llms.txt': { get: op('root.llms', 'LLM 纯文本接入说明', 'read', ['system'], [], true) },
    '/api/v1/openapi.json': { get: op('root.openapi', 'OpenAPI 3.1 目录', 'read', ['system'], [], true) },
    '/api/v1/auth/login': { post: op('auth.login', '登录并设置会话 Cookie', 'write', ['auth'], [], true) },
    '/api/v1/auth/logout': { post: op('auth.logout', '退出登录', 'write', ['auth']) },
    '/api/v1/auth/me': { get: op('auth.me', '当前用户', 'read', ['auth']) },
    '/api/v1/auth/password': { post: op('auth.changePassword', '修改密码（会吊销其他会话与令牌）', 'sensitive', ['auth']) },
    '/api/v1/auth/reveal': { post: op('auth.reveal', '敏感操作二次验证（密码）', 'sensitive', ['auth']) },
    '/api/v1/auth/reveal-window': { get: op('auth.revealWindow', '查询二次验证有效期', 'read', ['auth']) },
    '/api/v1/auth/totp/setup': { post: op('auth.totpSetup', '开始绑定 TOTP（重新绑定需二次验证）', 'sensitive', ['auth']) },
    '/api/v1/auth/totp/enable': { post: op('auth.totpEnable', '确认并启用 TOTP', 'write', ['auth']) },
    '/api/v1/auth/totp/disable': { post: op('auth.totpDisable', '停用 TOTP（需二次验证）', 'sensitive', ['auth']) },
    '/api/v1/setup/status': { get: op('setup.status', '安装状态（公开，最小信息）', 'read', ['setup'], [], true) },
    '/api/v1/bootstrap/status': { get: op('bootstrap.status', '安装状态别名（未安装时可用）', 'read', ['setup'], [], true) },
    '/api/v1/setup/verify-token': { post: op('setup.verifyToken', '校验一次性 Setup Token', 'write', ['setup'], [], true) },
    '/api/v1/setup/test-database': { post: op('setup.testDatabase', '测试数据库连接', 'write', ['setup'], [], true) },
    '/api/v1/setup/env-check': { get: op('setup.envCheck', '安装环境自检', 'read', ['setup'], [], true) },
    '/api/v1/setup/complete': { post: op('setup.complete', '完成安装并锁定入口', 'sensitive', ['setup'], [], true) },
    '/api/v1/hosts': {
      get: op('hosts.list', '列出服务器（q/env/status/limit/cursor）', 'read', ['hosts']),
      post: op('hosts.create', '创建服务器', 'write', ['hosts']),
    },
    '/api/v1/hosts/{id}': {
      get: op('hosts.get', '服务器详情', 'read', ['hosts'], ['id']),
      patch: op('hosts.update', '更新服务器（含手动字段）', 'write', ['hosts'], ['id']),
      delete: op('hosts.delete', '删除服务器', 'write', ['hosts'], ['id']),
    },
    '/api/v1/hosts/{id}/probe': { post: op('hosts.probe', 'SSH 探测并写入快照', 'write', ['hosts'], ['id']) },
    '/api/v1/hosts/batch-probe': { post: op('hosts.batchProbe', '批量探测', 'write', ['hosts']) },
    '/api/v1/hosts/{id}/snapshots': { get: op('hosts.snapshots', '探测快照列表', 'read', ['hosts'], ['id']) },
    '/api/v1/credentials': {
      get: op('credentials.list', '凭据元数据（永不返回明文）', 'read', ['credentials']),
      post: op('credentials.create', '创建凭据', 'write', ['credentials']),
    },
    '/api/v1/credentials/{id}': {
      patch: op('credentials.update', '更新/轮换凭据', 'write', ['credentials'], ['id']),
      delete: op('credentials.delete', '删除凭据', 'write', ['credentials'], ['id']),
    },
    '/api/v1/credentials/{id}/reveal': { post: op('credentials.reveal', '查看凭据明文（需二次验证；Agent 403）', 'sensitive', ['credentials'], ['id']) },
    '/api/v1/credentials/generate-password': { post: op('credentials.generatePassword', '生成强密码（需 credentials:write）', 'write', ['credentials']) },
    '/api/v1/keypairs': { get: op('keypairs.list', '密钥列表（含部署与验证状态）', 'read', ['keypairs']) },
    '/api/v1/keypairs/generate': { post: op('keypairs.create', '生成 Ed25519 / RSA 密钥对', 'write', ['keypairs']) },
    '/api/v1/keypairs/import': { post: op('keypairs.import', '导入私钥或公钥', 'write', ['keypairs']) },
    '/api/v1/keypairs/{id}': { get: op('keypairs.get', '密钥详情（不含私钥）', 'read', ['keypairs'], ['id']), delete: op('keypairs.delete', '删除密钥对', 'write', ['keypairs'], ['id']) },
    '/api/v1/keypairs/{id}/deploy': { post: op('keypairs.deploy', '部署公钥到 authorized_keys', 'write', ['keypairs'], ['id']) },
    '/api/v1/keypairs/{id}/verify': { post: op('keypairs.verify', '逐主机检测私钥认证可用性', 'write', ['keypairs'], ['id']) },
    '/api/v1/keypairs/{id}/public-key': { get: op('keypairs.publicKey', '下载公钥', 'read', ['keypairs'], ['id']) },
    '/api/v1/keypairs/{id}/private-key': { post: op('keypairs.privateKey', '导出私钥（需二次验证；Agent 403）', 'sensitive', ['keypairs'], ['id']) },
    '/api/v1/keypairs/{id}/connect-command': { get: op('keypairs.connectCommand', '生成 ssh/scp 快速连接命令（不含密钥内容）', 'read', ['keypairs'], ['id']) },
    '/api/v1/tokens': {
      get: op('tokens.list', '令牌列表', 'read', ['tokens']),
      post: op('tokens.create', '创建令牌（明文仅返回一次）', 'write', ['tokens']),
    },
    '/api/v1/tokens/{id}': { delete: op('tokens.delete', '吊销令牌', 'write', ['tokens'], ['id']) },
    '/api/v1/users': { get: op('users.list', '用户列表', 'read', ['users']) },
    '/api/v1/users/invite': { post: op('users.invite', '邀请用户', 'write', ['users']) },
    '/api/v1/users/{id}': { patch: op('users.update', '更新角色/状态', 'write', ['users'], ['id']) },
    '/api/v1/audit': {
      get: op('audit.list', '审计日志（筛选与分页）', 'read', ['audit']),
      delete: op('audit.clear', '清空审计日志（需二次验证；Agent 403）', 'sensitive', ['audit']),
    },
    '/api/v1/system/export': { post: op('system.export', '导出全部数据（需二次验证；Agent 403）', 'sensitive', ['system']) },
    '/api/v1/settings': {
      get: op('settings.get', '读取设置', 'read', ['settings']),
      patch: op('settings.update', '更新设置（管理员）', 'write', ['settings']),
    },
    '/api/v1/settings/webhook-test': { post: op('settings.webhookTest', '发送 Webhook 测试消息（管理员）', 'write', ['settings']) },
    '/api/v1/system/version': { get: op('system.version', '版本与数据库信息', 'read', ['system']) },
    '/api/v1/system/updates': { get: op('system.updates', '检查 GitHub Releases 更新', 'read', ['system']) },
    '/api/v1/system/check-updates': { post: op('system.checkUpdates', '立即检查更新', 'read', ['system']) },
    '/api/v1/system/update-history': { get: op('system.updateHistory', '版本历史', 'read', ['system']) },
    '/mcp': { post: op('mcp.endpoint', 'MCP Streamable HTTP（initialize/tools/list/tools/call）', 'read', ['agent']) },
    '/api/v1/hosts/{id}/terminal': { get: op('hosts.terminal', 'Web SSH 终端（WebSocket；Agent 与 viewer 403）', 'sensitive', ['hosts'], ['id']) },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: `${APP_NAME} API`,
      version: APP_VERSION,
      description:
        '人和 AI 共用一套接口。稳定 operationId、x-safety 标注、统一错误码；Agent 令牌默认只读，reveal/私钥/终端永不开放。',
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: 'auth' }, { name: 'setup' }, { name: 'hosts' }, { name: 'credentials' },
      { name: 'keypairs' }, { name: 'tokens' }, { name: 'users' }, { name: 'audit' },
      { name: 'settings' }, { name: 'system' }, { name: 'agent' },
    ],
    paths,
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ov_session' },
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'ovt_...' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                hint: { type: 'string' },
                docsUrl: { type: 'string' },
              },
            },
          },
        },
      },
    },
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    'x-scopes': SCOPES,
    'x-agent-policy': {
      default: 'read-only',
      denied: ['credentials.reveal', 'keypairs.privateKey', 'terminal'],
    },
  };
}

export async function metaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health', { config: { rateLimit: false } }, async () => {
    try {
      await app.db.selectFrom('users').select('id').limit(1).execute();
      return { data: { status: 'ok', version: APP_VERSION, database: app.config.db.driver } };
    } catch {
      return {
        data: { status: 'error', version: APP_VERSION, message: '数据库不可用' },
      } as any;
    }
  });

  app.get('/api/v1/meta', { config: { rateLimit: false } }, async () => ({
    data: {
      name: APP_NAME,
      version: APP_VERSION,
      auth: ['cookie', 'bearer'],
      scopes: SCOPES,
      rateLimit: { window: '1 minute', max: 300 },
      safety: { levels: ['read', 'write', 'sensitive'] },
      endpoints: {
        openapi: '/api/v1/openapi.json',
        docs: '/api/docs',
        llms: '/llms.txt',
        mcp: '/mcp',
      },
    },
  }));

  app.get('/api/v1/openapi.json', { config: { rateLimit: false } }, async () => openApiSpec(app.config.baseUrl));
  app.get('/openapi.json', { config: { rateLimit: false } }, async () => openApiSpec(app.config.baseUrl));

  app.get('/llms.txt', { config: { rateLimit: false } }, async (req, reply) => {
    const file = repoFile('llms.txt');
    if (!file) {
      reply.code(404).type('text/plain').send('llms.txt not found');
      return;
    }
    reply.type('text/plain; charset=utf-8').send(fs.readFileSync(file, 'utf8'));
  });

  app.get('/api/v1/llms.txt', async (req, reply) => {
    const file = repoFile('llms.txt');
    if (!file) {
      reply.code(404).type('text/plain').send('llms.txt not found');
      return;
    }
    reply.type('text/plain; charset=utf-8').send(fs.readFileSync(file, 'utf8'));
  });
}
