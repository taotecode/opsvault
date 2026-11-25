import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { APP_VERSION } from '@boerfen/shared';
import { api, downloadFile } from '@/lib/api';
import type { UpdateInfo, VersionInfo } from '@/types';
import { useMe, useSetupStatus } from '@/lib/hooks';
import { Button, Input } from '@/components/ui/controls';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui/fields';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/common/badges';
import { Callout, CopyButton, GlassPanel, PageHeader, SectionTitle } from '@/components/common/primitives';
import { ConfirmDialog, ReauthDialog } from '@/components/common/dialogs';
import { toastApiError } from '@/components/common/keypair-utils';

interface SettingsData {
  security: { sessionDays: number; forceTotp: boolean; revealWindowMinutes: number; loginLockout: boolean };
  probe: { schedule: string; concurrency: number; timeoutSec: number; snapshotKeep: number };
  notifications: { expiryDays: number; webhookUrl: string };
  system: { updateChannel: string };
}
const DEFAULTS: SettingsData = {
  security: { sessionDays: 7, forceTotp: false, revealWindowMinutes: 5, loginLockout: true },
  probe: { schedule: 'off', concurrency: 4, timeoutSec: 8, snapshotKeep: 20 },
  notifications: { expiryDays: 30, webhookUrl: '' },
  system: { updateChannel: 'github' },
};

function Row({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] px-4 py-2.5">
      <div className="min-w-0 flex-1"><div className="text-[12.5px]">{title}</div><div className="text-[11px] text-[var(--ink-3)]">{desc}</div></div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
function Pick({ value, onChange, options, width = 132 }: { value: string; onChange: (v: string) => void; options: Array<[string, string]>; width?: number }) {
  return (
    <div style={{ width }}>
      <Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
    </div>
  );
}
function Foot({ busy, disabled, onClick }: { busy: string | null; disabled: boolean; onClick: () => void }) {
  return <div className="flex justify-end px-4 py-2.5"><Button size="sm" disabled={disabled || busy !== null} onClick={onClick}>{busy ? '保存中…' : '保存设置'}</Button></div>;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const setup = useSetupStatus();
  const settings = useQuery<SettingsData>({ queryKey: ['settings'], queryFn: () => api.get<SettingsData>('/api/v1/settings') });
  const version = useQuery<VersionInfo>({ queryKey: ['system-version'], queryFn: () => api.get<VersionInfo>('/api/v1/system/version') });
  const [form, setForm] = useState<SettingsData>(DEFAULTS);
  const [saving, setSaving] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [reauthFor, setReauthFor] = useState<'totp' | 'export' | 'clear' | null>(null);
  const [clearAuditOpen, setClearAuditOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const isAdmin = me.data?.user.role === 'admin';
  const totpEnabled = me.data?.user.totpEnabled ?? false;

  useEffect(() => { if (settings.data) setForm(settings.data); }, [settings.data]);

  const save = async (key: 'security' | 'probe' | 'notifications', value: unknown) => {
    setSaving(key);
    try {
      await api.patch('/api/v1/settings', { [key]: value });
      toast.success('设置已保存');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    } catch (e) {
      toastApiError(e, '保存设置失败');
    } finally {
      setSaving(null);
    }
  };

  const startTotp = async () => {
    try {
      const res = await api.post<{ secret: string; uri: string }>('/api/v1/auth/totp/setup');
      setTotpSetup(res);
      setTotpCode('');
    } catch (e) {
      toastApiError(e, '启动 TOTP 绑定失败');
    }
  };

  const enableTotp = async () => {
    if (!/^\d{6}$/.test(totpCode.trim())) {
      toast.error('请输入 6 位动态口令');
      return;
    }
    setTotpBusy(true);
    try {
      await api.post('/api/v1/auth/totp/enable', { code: totpCode.trim() });
      toast.success('TOTP 已启用', { description: '下次登录需要输入动态口令' });
      setTotpSetup(null);
      setTotpCode('');
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      toastApiError(e, '动态口令校验失败');
    } finally {
      setTotpBusy(false);
    }
  };

  const disableTotp = async () => {
    try {
      await api.post('/api/v1/auth/totp/disable');
      toast.success('TOTP 已停用');
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    } catch (e) {
      toastApiError(e, '停用 TOTP 失败');
    }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      await downloadFile('/api/v1/system/export', 'POST');
      toast.success('数据已导出', { description: '包含资产、加密凭据、审计与设置' });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    } catch (e) {
      toastApiError(e, '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const clearAudit = async () => {
    try {
      const res = await api.delete<{ ok: boolean; deleted: number }>('/api/v1/audit');
      toast.success('审计日志已清空', { description: `删除 ${res.deleted} 条，本次操作已重新记录` });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    } catch (e) {
      toastApiError(e, '清空审计失败');
    }
  };

  const handleReauth = () => {
    const action = reauthFor;
    setReauthFor(null);
    if (action === 'totp') void disableTotp();
    else if (action === 'export') void exportData();
    else if (action === 'clear') void clearAudit();
  };

  const testWebhook = async () => {
    try {
      await api.patch('/api/v1/settings', { notifications: form.notifications });
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      const res = await api.post<{ ok: boolean; status?: number; error?: string }>('/api/v1/settings/webhook-test');
      if (res.ok) toast.success('Webhook 测试发送成功', { description: res.status ? `HTTP ${res.status}` : undefined });
      else toast.error('Webhook 发送失败', { description: res.error ?? '检查地址与服务端网络' });
    } catch (e) {
      toastApiError(e, 'Webhook 测试失败');
    }
  };

  const checkUpdates = async () => {
    setChecking(true);
    try {
      const res = await api.post<UpdateInfo>('/api/v1/system/check-updates');
      setUpdate(res);
      if (!res.enabled) toast.info('更新检查未启用', { description: res.reason ?? '服务端未配置更新源' });
      else if (res.hasUpdate) toast.success(`发现新版本 v${res.latestVersion ?? ''}`, { description: `当前 v${res.currentVersion}` });
      else toast.success('已是最新版本', { description: `当前 v${res.currentVersion}` });
    } catch (e) {
      toastApiError(e, '检查更新失败');
    } finally {
      setChecking(false);
    }
  };

  const dockerCmd = 'docker compose pull && docker compose up -d';
  const bareCmd = `./scripts/upgrade.sh --version v${update?.latestVersion ?? '<version>'}`;
  const updateDesc = update
    ? update.enabled
      ? `最新版本 ${update.latestVersion ? `v${update.latestVersion}` : '未知'} · 检查于 ${update.checkedAt ?? '—'}`
      : `更新检查不可用：${update.reason ?? '未配置'}`
    : '通过 GitHub Releases 检查更新（可配置镜像或关闭）';

  return (
    <>
      <PageHeader title="设置" sub="安全 · 探测 · 通知 · 账户 · 系统与升级" />
      {!isAdmin ? <div className="mb-3"><Callout tone="warn">当前账号不是管理员：设置保存、更新检查与危险区操作不可用。</Callout></div> : null}
      {settings.error ? <div className="mb-3"><Callout tone="warn">加载设置失败：{settings.error.message}</Callout></div> : null}
      <div className="grid items-start gap-3.5 lg:grid-cols-2">
        <GlassPanel className="overflow-hidden">
          <SectionTitle>安全</SectionTitle>
          <Row title="会话有效期" desc="超过后需要重新登录；由服务端环境配置，只读展示"><Badge>{form.security.sessionDays} 天</Badge></Row>
          <Row title="强制 TOTP 二次验证" desc="非管理员成员登录时强制动态口令；管理员豁免以便修复">
            <Switch checked={form.security.forceTotp} disabled={!isAdmin} onCheckedChange={(v) => setForm({ ...form, security: { ...form.security, forceTotp: v } })} />
          </Row>
          <Row title="敏感操作二次验证" desc="始终开启；验证有效期结束后需重新验证">
            <Pick value={String(form.security.revealWindowMinutes)} onChange={(v) => setForm({ ...form, security: { ...form.security, revealWindowMinutes: Number(v) } })} options={[['5', '5 分钟'], ['10', '10 分钟'], ['15', '15 分钟']]} />
          </Row>
          <Row title="登录失败锁定" desc="多次失败后临时锁定账号，并记录审计">
            <Switch checked={form.security.loginLockout} disabled={!isAdmin} onCheckedChange={(v) => setForm({ ...form, security: { ...form.security, loginLockout: v } })} />
          </Row>
          <Foot busy={saving === 'security' ? 'security' : null} disabled={!isAdmin} onClick={() => void save('security', form.security)} />
        </GlassPanel>

        <GlassPanel className="overflow-hidden">
          <SectionTitle>探测</SectionTitle>
          <Row title="定期探测" desc="按计划自动刷新硬件与系统信息">
            <Pick value={form.probe.schedule} onChange={(v) => setForm({ ...form, probe: { ...form.probe, schedule: v } })} options={[['off', '关闭'], ['hourly', '每小时'], ['daily', '每天 03:00']]} />
          </Row>
          <Row title="并发数" desc="同时探测的主机数量">
            <Pick value={String(form.probe.concurrency)} onChange={(v) => setForm({ ...form, probe: { ...form.probe, concurrency: Number(v) } })} options={[['4', '4'], ['8', '8']]} />
          </Row>
          <Row title="SSH 超时" desc="单次探测连接与命令超时">
            <Pick value={String(form.probe.timeoutSec)} onChange={(v) => setForm({ ...form, probe: { ...form.probe, timeoutSec: Number(v) } })} options={[['8', '8 秒'], ['15', '15 秒'], ['30', '30 秒']]} />
          </Row>
          <Row title="快照保留" desc="每台主机保留的探测快照数量">
            <Pick value={String(form.probe.snapshotKeep)} onChange={(v) => setForm({ ...form, probe: { ...form.probe, snapshotKeep: Number(v) } })} options={[['20', '20 条'], ['50', '50 条'], ['100', '100 条']]} />
          </Row>
          <Foot busy={saving === 'probe' ? 'probe' : null} disabled={!isAdmin} onClick={() => void save('probe', form.probe)} />
        </GlassPanel>

        <GlassPanel className="overflow-hidden">
          <SectionTitle>通知</SectionTitle>
          <Row title="到期提醒" desc="提前多少天在仪表盘提示">
            <Pick value={String(form.notifications.expiryDays)} onChange={(v) => setForm({ ...form, notifications: { ...form.notifications, expiryDays: Number(v) } })} options={[['7', '7 天'], ['14', '14 天'], ['30', '30 天']]} />
          </Row>
          <Row title="Webhook" desc="探测失败与登录失败/锁定推送">
            <div className="w-[240px]"><Input placeholder="https://hooks.example.com/…" value={form.notifications.webhookUrl} disabled={!isAdmin} onChange={(e) => setForm({ ...form, notifications: { ...form.notifications, webhookUrl: e.target.value } })} /></div>
          </Row>
          <Row title="测试发送" desc="向 Webhook 发送一条测试消息">
            <Button size="sm" disabled={!form.notifications.webhookUrl} onClick={() => void testWebhook()}>发送测试</Button>
          </Row>
          <Foot busy={saving === 'notifications' ? 'notifications' : null} disabled={!isAdmin} onClick={() => void save('notifications', form.notifications)} />
        </GlassPanel>

        <GlassPanel className="overflow-hidden">
          <SectionTitle>账户安全</SectionTitle>
          <Row title="当前账号" desc={me.data?.user.email ?? '—'}>
            <Badge>{me.data?.user.role === 'admin' ? '管理员' : me.data?.user.role ?? ''}</Badge>
          </Row>
          <Row title="TOTP 二次验证" desc={totpEnabled ? '已启用：登录时需要动态口令' : '未启用：建议绑定 TOTP 提升账号安全'}>
            {totpEnabled ? <Badge tone="ok">已启用</Badge> : <Badge tone="warn">未启用</Badge>}
            {totpEnabled
              ? <Button size="sm" variant="danger" onClick={() => setReauthFor('totp')}>停用</Button>
              : <Button size="sm" variant="primary" onClick={() => void startTotp()}><ShieldCheck size={13} />启用 TOTP</Button>}
          </Row>
          <div className="px-4 py-2.5 text-[11px] text-[var(--ink-3)]">请妥善保管 TOTP 设备；停用需要二次验证并写入审计。</div>
        </GlassPanel>

        <GlassPanel className="overflow-hidden lg:col-span-2">
          <SectionTitle right={<Badge tone="ok">v{version.data?.version ?? APP_VERSION} 运行中</Badge>}>系统与升级</SectionTitle>
          <Row title="当前版本" desc={`commit ${version.data?.commit ?? '—'} · 构建于 ${version.data?.buildDate ?? '未知'}`}><Badge>SemVer</Badge></Row>
          <Row
            title="主密钥（MASTER_KEY）"
            desc={
              version.data?.masterKeySource === 'env'
                ? '来自环境变量；轮换需更新环境并重启'
                : version.data?.masterKeySource === 'file'
                  ? 'data/master.key（0600）；可停止服务后运行 pnpm cli rotate-master-key --yes'
                  : '尚未生成：首次写入凭据时自动生成 data/master.key（0600）'
            }
          >
            <Badge tone={version.data?.masterKeySource === 'missing' ? 'warn' : 'ok'}>
              {version.data?.masterKeySource === 'env' ? 'env' : version.data?.masterKeySource === 'file' ? 'file' : '待生成'}
            </Badge>
          </Row>
          <Row title="数据库引擎" desc={version.data?.database === 'postgres' ? 'PostgreSQL（DATABASE_URL）' : 'SQLite（data/boerfen.db）'}><Badge tone="info">双方言</Badge></Row>
          <Row title="安装入口" desc={setup.data?.locked ? '已安装并锁定：/setup 与安装 API 强制返回 404；重装仅限服务器 CLI（reset-install）' : '尚未完成安装或未写入安装锁'}>
            {setup.data?.locked ? <Badge tone="ok">已锁定</Badge> : <Badge tone="warn">未锁定</Badge>}
          </Row>
          <Row title="更新检查" desc={updateDesc}>
            {update?.hasUpdate ? <Badge tone="warn">可升级</Badge> : null}
            <Button size="sm" disabled={!isAdmin || checking} onClick={() => void checkUpdates()}><RefreshCw size={13} />{checking ? '检查中…' : '检查更新'}</Button>
            {update?.hasUpdate ? <Button size="sm" variant="primary" onClick={() => setUpgradeOpen(true)}>升级步骤</Button> : null}
          </Row>
          {update?.releaseNotes ? <div className="max-h-32 overflow-auto whitespace-pre-wrap border-b border-[var(--line)] px-4 py-2.5 text-[11.5px] text-[var(--ink-2)]">{update.releaseNotes}</div> : null}
          <div className="px-4 py-2.5 text-[11px] text-[var(--ink-3)]">Docker：构建/拉取后 <span className="mono">docker compose up -d app</span>；裸机：scripts/upgrade.sh（SHA256 校验 + 迁移 + 失败回滚）。升级前请自行备份数据库与 master.key。</div>
        </GlassPanel>

        <GlassPanel className="overflow-hidden lg:col-span-2" style={{ borderColor: 'color-mix(in srgb, var(--bad) 30%, var(--line))' }}>
          <SectionTitle>危险区</SectionTitle>
          <Row title="导出全部数据" desc="生成 JSON 备份（含资产、加密凭据、审计与设置），需要二次验证">
            <Button size="sm" disabled={!isAdmin || exporting} onClick={() => setReauthFor('export')}><Download size={13} />{exporting ? '导出中…' : '导出数据'}</Button>
          </Row>
          <Row title="清空审计日志" desc="删除全部审计记录；此操作本身也会被记录，且需要管理员">
            <Button size="sm" variant="danger" disabled={!isAdmin} onClick={() => setClearAuditOpen(true)}><Trash2 size={13} />清空审计</Button>
          </Row>
        </GlassPanel>
      </div>

      <Modal
        open={!!totpSetup}
        onOpenChange={(open) => { if (!open) { setTotpSetup(null); setTotpCode(''); } }}
        title="启用 TOTP 二次验证"
        footer={
          <>
            <Button onClick={() => { setTotpSetup(null); setTotpCode(''); }}>取消</Button>
            <Button variant="primary" disabled={totpBusy} onClick={() => void enableTotp()}>{totpBusy ? '校验中…' : '验证并启用'}</Button>
          </>
        }
      >
        {totpSetup ? (
          <div className="space-y-3">
            <Callout>用 Google Authenticator、1Password 等 TOTP 应用扫描或手动输入以下密钥。</Callout>
            <div>
              <div className="mb-1 flex items-center justify-between"><label className="text-[11.5px] text-[var(--ink-3)]">密钥（Secret）</label><CopyButton text={totpSetup.secret} sensitive /></div>
              <pre className="code-block select-all">{totpSetup.secret}</pre>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between"><label className="text-[11.5px] text-[var(--ink-3)]">otpauth URI</label><CopyButton text={totpSetup.uri} /></div>
              <pre className="code-block break-all">{totpSetup.uri}</pre>
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">6 位动态口令</label>
              <Input inputMode="numeric" autoComplete="one-time-code" placeholder="输入验证码" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        wide
        title={`在线升级 · v${update?.latestVersion ?? ''}`}
        footer={<Button onClick={() => setUpgradeOpen(false)}>关闭</Button>}
      >
        <div className="space-y-3">
          <Callout tone="warn">升级前请备份数据库与 master.key；下载包必须通过 SHA256 校验；成功或失败均写入版本历史与审计。</Callout>
          <div>
            <div className="mb-1 flex items-center justify-between"><label className="text-[11.5px] text-[var(--ink-3)]">Docker 部署</label><CopyButton text={dockerCmd} /></div>
            <pre className="code-block">{dockerCmd}</pre>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between"><label className="text-[11.5px] text-[var(--ink-3)]">裸机部署</label><CopyButton text={bareCmd} /></div>
            <pre className="code-block">{bareCmd}</pre>
            <div className="mt-1 text-[11px] text-[var(--ink-3)]">脚本会下载 Release、校验 SHA256、执行数据库迁移、symlink 切换版本；失败自动回滚上一版本。</div>
          </div>
          {update?.releaseUrl ? <div className="text-[11.5px] text-[var(--ink-3)]">发布页：<span className="mono break-all">{update.releaseUrl}</span></div> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={clearAuditOpen}
        onOpenChange={setClearAuditOpen}
        title="清空审计日志"
        message="将删除全部审计记录，且不可恢复。确认后会先要求二次验证；本次清空操作会重新写入一条审计。"
        confirmLabel="继续"
        danger
        onConfirm={() => {
          setClearAuditOpen(false);
          setReauthFor('clear');
        }}
      />
      <ReauthDialog
        open={!!reauthFor}
        onOpenChange={(o) => {
          if (!o) setReauthFor(null);
        }}
        target={reauthFor === 'totp' ? '停用 TOTP' : reauthFor === 'export' ? '导出全部数据' : '清空审计日志'}
        onVerified={handleReauth}
      />
    </>
  );
}
