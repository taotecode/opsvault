import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { createDatabase, migrateToLatest } from '../src/db/database.js';
import type { DatabaseSchema } from '../src/db/types.js';
import { createUser } from '../src/services/users.js';

interface CookiePair {
  cookie: string;
  csrf: string;
}

let app: FastifyInstance;
let config: AppConfig;
let db: Kysely<DatabaseSchema>;
let dir: string;
let baseUrl: string;

const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'VerySecurePass1!';
const VIEWER_EMAIL = 'viewer@test.local';
const VIEWER_PASSWORD = 'ViewerPass1!';

async function login(email = ADMIN_EMAIL, password = ADMIN_PASSWORD): Promise<CookiePair> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  const setCookie = res.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  const session = cookies.find((c) => c.startsWith('ov_session='))!.split(';')[0]!;
  const csrfCookie = cookies.find((c) => c.startsWith('ov_csrf='))!.split(';')[0]!;
  const csrf = decodeURIComponent(csrfCookie.split('=')[1]!);
  return { cookie: `${session}; ${csrfCookie}`, csrf };
}

function authHeaders(c: CookiePair, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: c.cookie, 'x-csrf-token': c.csrf, ...extra };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsvault-api-'));
  const pgUrl = process.env.TEST_POSTGRES_URL;
  if (pgUrl) {
    // 仅用于专用测试库：保证重复运行从干净 schema 开始
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: pgUrl });
    await client.connect();
    await client.query('drop schema public cascade; create schema public;');
    await client.end();
  }
  const dbConfig = pgUrl
    ? ({ driver: 'postgres', connectionString: pgUrl } as const)
    : ({ driver: 'sqlite', path: path.join(dir, 'test.db') } as const);
  config = loadConfig({
    dataDir: dir,
    db: dbConfig as never,
    baseUrl: 'http://localhost',
    sessionDays: 1,
    revealWindowMinutes: 5,
    isProd: false,
    logLevel: 'silent',
  });
  db = createDatabase(config.db);
  await migrateToLatest(db);
  await createUser(db, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'admin' });
  await createUser(db, { email: VIEWER_EMAIL, password: VIEWER_PASSWORD, role: 'viewer' });
  fs.writeFileSync(path.join(dir, 'install.lock'), JSON.stringify({ installedAt: new Date().toISOString() }));
  app = await buildApp({ config, db, logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
  await db?.destroy().catch(() => undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('api integration', () => {
  let cookies: CookiePair;
  let hostId: string;
  let credentialId: string;
  let keypairId: string;
  let generatedPrivateKey: string;
  let agentToken: string;

  it('reports health and locked setup status', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().data.status).toBe('ok');
    const status = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(status.json().data.installed).toBe(true);
    expect(status.json().data.locked).toBe(true);
    const verify = await app.inject({ method: 'POST', url: '/api/v1/setup/verify-token' });
    expect(verify.statusCode).toBe(404);
  });

  it('logs in with Argon2 credentials and rejects bad password', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);
    cookies = await login();
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookies.cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.email).toBe(ADMIN_EMAIL);

    const byUsername = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin', password: ADMIN_PASSWORD },
    });
    expect(byUsername.statusCode).toBe(200);
    expect(byUsername.json().data.user.email).toBe(ADMIN_EMAIL);
  });

  it('requires CSRF for cookie-authenticated writes', async () => {
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/hosts',
      headers: { cookie: cookies.cookie, 'content-type': 'application/json' },
      payload: { name: 'csrf-test', address: '203.0.113.1' },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('CSRF_FAILED');

    const badBody = await app.inject({
      method: 'POST',
      url: '/api/v1/hosts',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: '{bad',
    });
    expect(badBody.statusCode).toBe(400);
    expect(badBody.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('creates and updates a host', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/hosts',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: {
        name: 'edge-01',
        address: '203.0.113.10',
        port: 2222,
        sshUser: 'deploy',
        env: 'prod',
        provider: '自建',
        group: '边缘节点',
        tags: ['edge'],
        bandwidthMbps: 100,
        trafficTb: 0.5,
        notes: 'test host',
      },
    });
    expect(created.statusCode).toBe(200);
    hostId = created.json().data.id;
    expect(created.json().data.status).toBe('pending');
    expect(created.json().data.port).toBe(2222);
    expect(created.json().data.sshUser).toBe('deploy');
    expect(created.json().data.trafficTb).toBe(0.5);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/hosts/${hostId}`,
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { bandwidthMbps: 200, billingType: '包年包月', expiresAt: '2026-12-31', notes: 'updated' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.bandwidthMbps).toBe(200);

    const badCredential = await app.inject({
      method: 'PATCH',
      url: `/api/v1/hosts/${hostId}`,
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { credentialId: 'missing-credential' },
    });
    expect(badCredential.statusCode).toBe(404);
    const badKeypair = await app.inject({
      method: 'PATCH',
      url: `/api/v1/hosts/${hostId}`,
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { keypairId: 'missing-keypair' },
    });
    expect(badKeypair.statusCode).toBe(404);

    const list = await app.inject({ method: 'GET', url: '/api/v1/hosts?env=prod', headers: { cookie: cookies.cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((h: { id: string }) => h.id === hostId)).toBe(true);
  });

  it('stores credentials encrypted, requires re-auth to reveal, and audits access', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { name: 'edge-root', type: 'password', value: 'P@ssw0rd-edge', hostIds: [hostId] },
    });
    expect(created.statusCode).toBe(200);
    credentialId = created.json().data.id;
    const list = await app.inject({ method: 'GET', url: '/api/v1/credentials', headers: { cookie: cookies.cookie } });
    const item = list.json().data.find((c: { id: string }) => c.id === credentialId);
    expect(item).toBeTruthy();
    expect(JSON.stringify(item)).not.toContain('P@ssw0rd-edge');

    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/reveal`,
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: {},
    });
    expect(denied.statusCode).toBe(403);

    const reveal = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reveal',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { password: ADMIN_PASSWORD },
    });
    expect(reveal.statusCode).toBe(200);

    const revealed = await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/reveal`,
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: {},
    });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json().data.value).toBe('P@ssw0rd-edge');

    const stored = await db
      .selectFrom('credentials')
      .selectAll()
      .where('id', '=', credentialId)
      .executeTakeFirstOrThrow();
    expect(stored.encrypted_value).not.toContain('P@ssw0rd-edge');
    expect(stored.encrypted_dek.length).toBeGreaterThan(0);

    const adminRow = await db
      .selectFrom('users')
      .select('password_hash')
      .where('email', '=', ADMIN_EMAIL)
      .executeTakeFirstOrThrow();
    expect(adminRow.password_hash.startsWith('$argon2id$')).toBe(true);

    const audit = await app.inject({ method: 'GET', url: '/api/v1/audit?category=cred&limit=10', headers: { cookie: cookies.cookie } });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().data.some((a: { action: string }) => a.action === '查看凭据')).toBe(true);
  });

  it('lists per-host credentials and 404s on unknown targets', async () => {
    const links = await app.inject({
      method: 'GET',
      url: `/api/v1/hosts/${hostId}/credentials`,
      headers: { cookie: cookies.cookie },
    });
    expect(links.statusCode).toBe(200);
    const body = links.json().data as Array<{ id: string; role: string; lastCheckOk: boolean | null }>;
    expect(body.some((l) => l.id === credentialId)).toBe(true);
    expect(body.every((l) => l.lastCheckOk === null)).toBe(true);

    const missingHost = await app.inject({
      method: 'POST',
      url: `/api/v1/hosts/missing-host/credentials/${credentialId}/primary`,
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: {},
    });
    expect(missingHost.statusCode).toBe(404);

    const missingCred = await app.inject({
      method: 'POST',
      url: `/api/v1/hosts/${hostId}/credentials/missing-credential/primary`,
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: {},
    });
    expect(missingCred.statusCode).toBe(404);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/hosts/${hostId}/credentials/${credentialId}/primary`,
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: {},
    });
    expect(ok.statusCode).toBe(200);

    // 凭据列表应带 hostIds，供编辑表单精确回填
    const list = await app.inject({ method: 'GET', url: '/api/v1/credentials', headers: { cookie: cookies.cookie } });
    const item = list.json().data.find((c: { id: string }) => c.id === credentialId);
    expect(item.hostIds).toContain(hostId);
  });

  it('generates Ed25519/RSA keys, exposes private key once, and builds quick-connect commands', async () => {
    const ed = await app.inject({
      method: 'POST',
      url: '/api/v1/keypairs/generate',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { name: 'deploy-test', algorithm: 'Ed25519' },
    });
    expect(ed.statusCode).toBe(200);
    keypairId = ed.json().data.id;
    generatedPrivateKey = ed.json().data.privateKey;
    expect(generatedPrivateKey).toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(ed.json().data.fingerprint).toMatch(/^SHA256:/);

    const rsa = await app.inject({
      method: 'POST',
      url: '/api/v1/keypairs/generate',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { name: 'ops-rsa-test', algorithm: 'RSA-4096' },
    });
    expect(rsa.statusCode).toBe(200);
    expect(rsa.json().data.publicKey.startsWith('ssh-rsa')).toBe(true);

    const importedSelf = await app.inject({
      method: 'POST',
      url: '/api/v1/keypairs/import',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { name: 'imported-ed', privateKey: generatedPrivateKey },
    });
    expect(importedSelf.statusCode).toBe(200);
    expect(importedSelf.json().data.hasPrivate).toBe(true);

    const importedPublic = await app.inject({
      method: 'POST',
      url: '/api/v1/keypairs/import',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { name: 'public-only', publicKey: ed.json().data.publicKey },
    });
    expect(importedPublic.statusCode).toBe(200);
    expect(importedPublic.json().data.hasPrivate).toBe(false);

    const command = await app.inject({
      method: 'GET',
      url: `/api/v1/keypairs/${keypairId}/connect-command?hostId=${hostId}`,
      headers: { cookie: cookies.cookie },
    });
    expect(command.statusCode).toBe(200);
    expect(command.json().data.ssh).toContain('ssh -i ~/.ssh/deploy-test.pem -p 2222 deploy@203.0.113.10');
    expect(command.json().data.ssh).not.toContain('PRIVATE KEY');

    const pub = await app.inject({ method: 'GET', url: `/api/v1/keypairs/${keypairId}/public-key`, headers: { cookie: cookies.cookie } });
    expect(pub.statusCode).toBe(200);
    expect(pub.body.startsWith('ssh-ed25519')).toBe(true);

    const priv = await app.inject({
      method: 'POST',
      url: `/api/v1/keypairs/${keypairId}/private-key`,
      headers: authHeaders(cookies),
    });
    expect(priv.statusCode).toBe(200);
    expect(priv.body).toContain('BEGIN OPENSSH PRIVATE KEY');

    const fresh = await login();
    const noWindow = await app.inject({
      method: 'POST',
      url: `/api/v1/keypairs/${keypairId}/private-key`,
      headers: authHeaders(fresh),
    });
    expect(noWindow.statusCode).toBe(403);

    const exportAudit = await db
      .selectFrom('audit_logs')
      .select(['action', 'success'])
      .where('target_id', '=', keypairId)
      .where('action', '=', '导出私钥')
      .execute();
    expect(exportAudit.length).toBeGreaterThanOrEqual(1);
    expect(exportAudit[0]!.success).toBe(1);
  });

  it('creates an Agent token and enforces the read/deny boundary', async () => {
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/tokens',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { name: 'agent-bad', kind: 'agent', scopes: ['keypairs:write'] },
    });
    expect(forbidden.statusCode).toBe(400);

    const token = await app.inject({
      method: 'POST',
      url: '/api/v1/tokens',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { name: 'agent-test', kind: 'agent', scopes: ['hosts:read', 'credentials:read', 'keypairs:read', 'audit:read', 'system:read'] },
    });
    expect(token.statusCode).toBe(200);
    agentToken = token.json().data.token;
    expect(agentToken.startsWith('ovt_')).toBe(true);

    const hosts = await app.inject({
      method: 'GET',
      url: '/api/v1/hosts',
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(hosts.statusCode).toBe(200);

    const reveal = await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/reveal`,
      headers: { authorization: `Bearer ${agentToken}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(reveal.statusCode).toBe(403);

    const privateKey = await app.inject({
      method: 'POST',
      url: `/api/v1/keypairs/${keypairId}/private-key`,
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(privateKey.statusCode).toBe(403);

    const keygen = await app.inject({
      method: 'POST',
      url: '/api/v1/keypairs/generate',
      headers: { authorization: `Bearer ${agentToken}`, 'content-type': 'application/json' },
      payload: { name: 'agent-key', algorithm: 'Ed25519' },
    });
    expect(keygen.statusCode).toBe(403);

    const deploy = await app.inject({
      method: 'POST',
      url: `/api/v1/keypairs/${keypairId}/deploy`,
      headers: { authorization: `Bearer ${agentToken}`, 'content-type': 'application/json' },
      payload: { hostIds: [hostId] },
    });
    expect(deploy.statusCode).toBe(403);

    const bindCredential = await app.inject({
      method: 'POST',
      url: '/api/v1/hosts',
      headers: { authorization: `Bearer ${agentToken}`, 'content-type': 'application/json' },
      payload: { name: 'agent-host', address: '203.0.113.200', credentialId },
    });
    expect(bindCredential.statusCode).toBe(403);

    const changeAddress = await app.inject({
      method: 'PATCH',
      url: `/api/v1/hosts/${hostId}`,
      headers: { authorization: `Bearer ${agentToken}`, 'content-type': 'application/json' },
      payload: { address: '203.0.113.201' },
    });
    expect(changeAddress.statusCode).toBe(403);

    const totpDisable = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp/disable',
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(totpDisable.statusCode).toBe(403);
  });

  it('blocks user tokens from admin APIs and protects the last admin', async () => {
    const userToken = await app.inject({
      method: 'POST',
      url: '/api/v1/tokens',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { name: 'user-token', kind: 'user', scopes: ['hosts:read'] },
    });
    expect(userToken.statusCode).toBe(200);
    const userTokenValue = userToken.json().data.token as string;

    const users = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${userTokenValue}` },
    });
    expect(users.statusCode).toBe(403);

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookies.cookie } });
    const adminId = me.json().data.user.id as string;
    const demoteSelf = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${adminId}`,
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { role: 'viewer' },
    });
    expect(demoteSelf.statusCode).toBe(403);
    const disableSelf = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${adminId}`,
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { status: 'disabled' },
    });
    expect(disableSelf.statusCode).toBe(403);
  });

  it('blocks viewer reveal and private-key export', async () => {
    const viewer = await login(VIEWER_EMAIL, VIEWER_PASSWORD);
    const reveal = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reveal',
      headers: authHeaders(viewer, { 'content-type': 'application/json' }),
      payload: { password: VIEWER_PASSWORD },
    });
    expect(reveal.statusCode).toBe(200);

    const cred = await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/reveal`,
      headers: authHeaders(viewer, { 'content-type': 'application/json' }),
      payload: {},
    });
    expect(cred.statusCode).toBe(403);

    const priv = await app.inject({
      method: 'POST',
      url: `/api/v1/keypairs/${keypairId}/private-key`,
      headers: authHeaders(viewer),
    });
    expect(priv.statusCode).toBe(403);
  });

  it('serves MCP initialize, tools/list and tools/call over Streamable HTTP', async () => {
    const init = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agentToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vitest', version: '1.0' } },
      }),
    });
    expect(init.ok).toBe(true);
    const initBody = (await init.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(initBody.result?.serverInfo?.name).toBe('opsvault');

    const list = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agentToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    expect(list.ok).toBe(true);
    const listBody = (await list.json()) as { result?: { tools?: Array<{ name: string }> } };
    expect((listBody.result?.tools ?? []).length).toBeGreaterThanOrEqual(9);

    const call = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agentToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hosts_list', arguments: {} } }),
    });
    expect(call.ok).toBe(true);
    const callBody = (await call.json()) as { result?: { content?: Array<{ text?: string }> } };
    expect(callBody.result?.content?.[0]?.text).toContain('edge-01');

    const versionCall = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agentToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'system_version', arguments: {} } }),
    });
    expect(versionCall.ok).toBe(true);

    const adminApi = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(adminApi.statusCode).toBe(403);
  });

  it('supports TOTP enrolment and enforces the second factor at login', async () => {
    const invite = await app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: authHeaders(cookies, { 'content-type': 'application/json' }),
      payload: { email: 'totp-user@test.local', role: 'operator' },
    });
    expect(invite.statusCode).toBe(200);
    const tempPassword = invite.json().data.temporaryPassword as string;

    const userLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'totp-user@test.local', password: tempPassword },
    });
    expect(userLogin.statusCode).toBe(200);
    const setCookie = userLogin.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
    const cookie = raw.map((c) => c.split(';')[0]).join('; ');
    const csrf = decodeURIComponent(raw.find((c) => c.startsWith('ov_csrf='))!.split(';')[0]!.split('=')[1]!);

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp/setup',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: {},
    });
    expect(setup.statusCode).toBe(200);
    const secret = setup.json().data.secret as string;
    const { TOTP, Secret } = await import('otpauth');
    const code = new TOTP({ secret: Secret.fromBase32(secret) }).generate();
    const enable = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp/enable',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      payload: { code },
    });
    expect(enable.statusCode).toBe(200);

    const withoutFactor = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'totp-user@test.local', password: tempPassword },
    });
    expect(withoutFactor.statusCode).toBe(403);
    const factorCode = new TOTP({ secret: Secret.fromBase32(secret) }).generate();
    const withFactor = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'totp-user@test.local', password: tempPassword, totp: factorCode },
    });
    expect(withFactor.statusCode).toBe(200);
  });

  it('exposes llms.txt and OpenAPI with operationIds', async () => {
    const llms = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(llms.statusCode).toBe(200);
    expect(llms.body).toContain('hosts_list');
    const spec = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(spec.statusCode).toBe(200);
    const doc = spec.json() as { openapi: string; paths: Record<string, { get?: { operationId?: string } }> };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/api/v1/hosts']?.get?.operationId).toBe('hosts.list');
  });
});
