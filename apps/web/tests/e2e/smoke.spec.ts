import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ADMIN_EMAIL = 'e2e-admin@example.com';
const ADMIN_PASSWORD = 'E2eSecurePass1!';

function setupTokenPath(): string {
  const dataDir = process.env.E2E_DATA_DIR || path.resolve(process.cwd(), '../../.e2e-data');
  return path.join(dataDir, 'setup.token');
}

async function completeSetup(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const tokenFile = setupTokenPath();
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const res = await request.post('/api/v1/setup/complete', {
    data: {
      token,
      database: { driver: 'sqlite', path: 'data/opsvault.db' },
      admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, enableTotp: false },
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data: { locked: boolean } };
  expect(body.data.locked).toBe(true);
}

async function csrf(context: import('@playwright/test').BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === 'ov_csrf');
  expect(cookie).toBeTruthy();
  return cookie!.value;
}

test.describe.configure({ mode: 'serial' });
test('setup wizard verifies token then shows database step', async ({ page }) => {
  const token = fs.readFileSync(setupTokenPath(), 'utf8').trim();
  await page.goto('/setup');
  await expect(page.getByText('安装向导').first()).toBeVisible();
  const next = page.getByRole('button', { name: '下一步' });
  await expect(next).toBeDisabled();
  await page.getByLabel('Setup Token').fill(token);
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByText('SQLite', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '测试连接' })).toBeVisible();
  await expect(page.getByText('管理员邮箱')).toBeHidden();
  await next.click();
  await expect(page.getByText('管理员邮箱')).toBeVisible();
});

test('setup, login, asset management and terminal smoke', async ({ page, request }) => {
  completeSetup(request);

  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  const failedUrls: string[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400) failedUrls.push(`${res.status()} ${res.url()}`);
  });

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible();
  const shotDirPre = path.resolve(process.cwd(), '../../docs/screenshots');
  fs.mkdirSync(shotDirPre, { recursive: true });
  await page.screenshot({ path: path.join(shotDirPre, 'login-dark.png'), fullPage: false });
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /登录/ }).click();
  await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible({ timeout: 15_000 });

  // 登录前 /auth/me 的 401 属于预期探测；登录后再收集控制台错误
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: '命令面板' });
  await expect(palette).toBeVisible({ timeout: 10_000 });
  await expect(palette.getByText('服务器', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();

  const token = await csrf(page.context());
  const headers = { 'x-csrf-token': token };

  const hostRes = await page.request.post('/api/v1/hosts', {
    headers,
    data: { name: 'e2e-ui-host', address: '203.0.113.99', port: 22, sshUser: 'root', env: 'prod', provider: '自建' },
  });
  expect(hostRes.ok()).toBeTruthy();
  const credRes = await page.request.post('/api/v1/credentials', {
    headers,
    data: { name: 'e2e-ui-credential', type: 'password', value: 'E2eCredential1!' },
  });
  expect(credRes.ok()).toBeTruthy();
  const keyRes = await page.request.post('/api/v1/keypairs/generate', {
    headers,
    data: { name: 'e2e-ui-key', algorithm: 'Ed25519' },
  });
  expect(keyRes.ok()).toBeTruthy();

  await page.goto('/hosts');
  await expect(page.getByText('e2e-ui-host').first()).toBeVisible({ timeout: 15_000 });
  await page.goto('/credentials');
  await expect(page.getByText('e2e-ui-credential').first()).toBeVisible({ timeout: 15_000 });
  await page.goto('/keypairs');
  await expect(page.getByText('e2e-ui-key').first()).toBeVisible({ timeout: 15_000 });

  await page.goto('/terminal');
  await expect(page.getByText('Web 终端').first()).toBeVisible({ timeout: 15_000 });
  const hostSelect = page.locator('select').first();
  if (await hostSelect.count()) {
    const option = await hostSelect.locator('option').first().getAttribute('value');
    if (option) await hostSelect.selectOption(option).catch(() => undefined);
  }
  await expect(page.locator('.xterm, .term').first()).toBeVisible({ timeout: 15_000 });

  const shotDir = path.resolve(process.cwd(), '../../docs/screenshots');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
  await page.screenshot({ path: path.join(shotDir, 'dashboard-dark.png'), fullPage: false });
  await page.goto('/hosts');
  await expect(page.getByText('e2e-ui-host').first()).toBeVisible();
  await page.screenshot({ path: path.join(shotDir, 'hosts-dark.png'), fullPage: false });
  await page.goto('/credentials');
  await page.screenshot({ path: path.join(shotDir, 'credentials-dark.png'), fullPage: false });
  await page.goto('/keypairs');
  await expect(page.getByText('e2e-ui-key').first()).toBeVisible();
  await page.screenshot({ path: path.join(shotDir, 'keypairs-dark.png'), fullPage: false });
  await page.goto('/users');
  await expect(page.getByRole('heading', { name: '用户与角色' })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(shotDir, 'users-dark.png'), fullPage: false });
  await page.goto('/api');
  await expect(page.getByRole('heading', { name: 'API 与 Agent 接入' })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(shotDir, 'api-dark.png'), fullPage: false });
  await page.goto('/audit');
  await page.screenshot({ path: path.join(shotDir, 'audit-dark.png'), fullPage: false });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(shotDir, 'settings-dark.png'), fullPage: false });
  await page.goto('/terminal');
  await page.screenshot({ path: path.join(shotDir, 'terminal-dark.png'), fullPage: false });
  await page.goto('/');
  await page.getByTitle('切换主题').click();
  await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shotDir, 'dashboard-light.png'), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(shotDir, 'dashboard-mobile.png'), fullPage: false });

  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')} | failed: ${failedUrls.join(', ')}`).toEqual([]);
});

test('installer entry is permanently closed', async ({ request }) => {
  const res = await request.get('/setup');
  expect(res.status()).toBe(404);
  const api = await request.post('/api/v1/setup/verify-token', { headers: { 'x-setup-token': 'x' }, data: {} });
  expect(api.status()).toBe(404);
});
