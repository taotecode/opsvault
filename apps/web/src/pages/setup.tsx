import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Database, Lock, Shield, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSetupStatus } from '@/lib/hooks';
import { Button, Input } from '@/components/ui/controls';
import { Callout } from '@/components/common/primitives';
import { cn } from '@/lib/utils';

type Driver = 'sqlite' | 'postgres';

export function SetupPage() {
  const status = useSetupStatus();
  const [step, setStep] = useState(0);
  const env = useQuery({
    queryKey: ['setup-env'],
    queryFn: () =>
      api.get<{ nodeVersion: string; openssh: boolean; dataDirWritable: boolean }>('/api/v1/setup/env-check'),
    retry: false,
    enabled: !status.data?.installed,
  });
  const [token, setToken] = useState('');
  const [driver, setDriver] = useState<Driver>('sqlite');
  const [pg, setPg] = useState({ host: '127.0.0.1', port: '5432', database: 'opsvault', user: 'opsvault', password: '' });
  const [admin, setAdmin] = useState({ email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [dbCheck, setDbCheck] = useState<string | null>(null);

  useEffect(() => {
    if (status.data?.installed) setStep(4);
  }, [status.data?.installed]);

  const databasePayload = () =>
    driver === 'sqlite'
      ? { driver: 'sqlite' as const, path: 'data/opsvault.db' }
      : {
          driver: 'postgres' as const,
          host: pg.host,
          port: Number(pg.port),
          database: pg.database,
          user: pg.user,
          password: pg.password || undefined,
        };

  const verifyToken = async () => {
    setBusy(true);
    try {
      await api.raw('/api/v1/setup/verify-token', {
        method: 'POST',
        headers: { 'x-setup-token': token },
        body: JSON.stringify({}),
      });
      setStep(2);
      toast.success('Setup Token 校验通过');
    } catch (e) {
      toast.error((e as Error).message, { description: (e as ApiError).hint });
    } finally {
      setBusy(false);
    }
  };

  const testDatabase = async () => {
    setBusy(true);
    setDbCheck(null);
    try {
      const res = await api.raw<{ ok: boolean; error?: string }>('/api/v1/setup/test-database', {
        method: 'POST',
        headers: { 'x-setup-token': token },
        body: JSON.stringify({ database: databasePayload() }),
      });
      const data = (res as unknown as { ok?: boolean; error?: string }) ?? {};
      setDbCheck(data.ok ? '连接成功，可以继续' : `连接失败：${data.error ?? '未知错误'}`);
    } catch (e) {
      setDbCheck((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!token) return toast.error('缺少 Setup Token');
    if (!admin.email.includes('@')) return toast.error('请输入管理员邮箱');
    if (admin.password.length < 8) return toast.error('密码至少 8 位');
    if (admin.password !== admin.confirm) return toast.error('两次密码不一致');
    setBusy(true);
    try {
      await api.post('/api/v1/setup/complete', {
        token,
        database: databasePayload(),
        admin: { email: admin.email, password: admin.password, enableTotp: false },
      });
      setStep(4);
      toast.success('安装完成，安装入口已锁定');
      void status.refetch();
    } catch (e) {
      toast.error((e as Error).message, { description: (e as ApiError).hint });
    } finally {
      setBusy(false);
    }
  };

  const labels = ['环境检查', '数据库', '管理员', '完成'];
  return (
    <div className="relative min-h-screen">
      <div className="app-bg" />
      <div className="relative z-10 grid min-h-screen place-items-center p-6">
        <div className="w-full max-w-[720px]">
          <div className="mb-5 flex items-center justify-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[var(--brand-strong)] to-[var(--brand)] text-base font-bold tracking-wide text-[#241504]">OV</div>
            <div>
              <div className="text-[18px] font-semibold">安装向导</div>
              <div className="text-[11px] text-[var(--ink-3)]">OpsVault 服务器资产管理平台 · 在线安装</div>
            </div>
          </div>
          <div className="glass-panel p-6">
            {step < 4 ? (
              <div className="mb-5 flex flex-wrap gap-2">
                {labels.map((label, i) => (
                  <span
                    key={label}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-1 text-[12px] text-[var(--ink-3)]',
                      i === step && 'border-[var(--brand)]/40 bg-[var(--brand-dim)] text-[var(--brand-ink)]',
                    )}
                  >
                    <i className={cn('grid h-[18px] w-[18px] place-items-center rounded-full bg-[var(--panel-2)] font-mono text-[10.5px] not-italic', i === step && 'bg-[var(--brand)] text-[#241504]', i < step && 'bg-[var(--ok)] text-white')}>
                      {i < step ? <Check size={11} /> : step === 3 ? 4 : i + 1}
                    </i>
                    {label}
                  </span>
                ))}
              </div>
            ) : null}

            {status.data?.installed ? (
              <div className="space-y-3">
                <Callout tone="ok">
                  平台已安装，安装入口已关闭（<span className="mono">/setup</span> 与安装 API 均返回 404）。
                </Callout>
                <p className="text-[12px] text-[var(--ink-3)]">如需重装，请在服务器上执行 <span className="mono">pnpm cli reset-install --yes</span>。</p>
                <Link to="/login"><Button variant="primary">去登录</Button></Link>
              </div>
            ) : step === 0 ? (
              <div className="space-y-4">
                <Callout>
                  首次部署需要输入服务端控制台打印的一次性 <b>Setup Token</b>，防止安装入口被他人抢先初始化。
                </Callout>
                <div>
                  <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">Setup Token</label>
                  <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="例如 6F2AFF97-967410D8" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    {
                      label: `Node.js ${env.data?.nodeVersion ?? ''}`.trim(),
                      ok: env.data ? Number(env.data.nodeVersion.replace(/^v/, '').split('.')[0]) >= 22 : null,
                    },
                    { label: 'OpenSSH ssh-keygen', ok: env.data?.openssh ?? null },
                    { label: 'data 目录可写', ok: env.data?.dataDirWritable ?? null },
                    { label: '服务运行中', ok: true },
                  ].map((item) => (
                    <div key={item.label} className="glass-inset flex items-center justify-between px-3 py-2 text-[12px]">
                      {item.label}
                      <span className={cn('badge', item.ok === null ? 'badge-neutral' : item.ok ? 'badge-ok' : 'badge-bad')}>
                        {item.ok === null ? '检测中/不可用' : item.ok ? '通过' : '未通过'}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button variant="primary" disabled={!token || busy} onClick={() => void verifyToken()}>下一步</Button>
                </div>
              </div>
            ) : step === 1 ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" className={cn('glass-panel p-3 text-left', driver === 'sqlite' && 'ring-2 ring-[var(--brand)]')} onClick={() => setDriver('sqlite')}>
                    <div className="flex items-center gap-2 text-[12.5px] font-semibold">SQLite <span className="badge badge-ok">默认 · 零依赖</span></div>
                    <p className="mt-1 text-[11px] text-[var(--ink-3)]">单文件数据库，适合单机与小团队；升级前自动备份。</p>
                  </button>
                  <button type="button" className={cn('glass-panel p-3 text-left', driver === 'postgres' && 'ring-2 ring-[var(--brand)]')} onClick={() => setDriver('postgres')}>
                    <div className="flex items-center gap-2 text-[12.5px] font-semibold"><Database size={14} /> PostgreSQL 16+</div>
                    <p className="mt-1 text-[11px] text-[var(--ink-3)]">适合多实例与高并发生产环境；需要连接信息。</p>
                  </button>
                </div>
                {driver === 'postgres' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">主机</label><Input value={pg.host} onChange={(e) => setPg({ ...pg, host: e.target.value })} /></div>
                    <div><label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">端口</label><Input value={pg.port} onChange={(e) => setPg({ ...pg, port: e.target.value })} /></div>
                    <div><label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">数据库</label><Input value={pg.database} onChange={(e) => setPg({ ...pg, database: e.target.value })} /></div>
                    <div><label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">用户</label><Input value={pg.user} onChange={(e) => setPg({ ...pg, user: e.target.value })} /></div>
                    <div className="sm:col-span-2"><label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">密码</label><Input type="password" value={pg.password} onChange={(e) => setPg({ ...pg, password: e.target.value })} /></div>
                  </div>
                ) : (
                  <Callout>数据文件：<span className="mono">data/opsvault.db</span>；备份 = 复制该文件与 <span className="mono">data/master.key</span>。</Callout>
                )}
                {dbCheck ? <Callout tone={dbCheck.startsWith('连接成功') ? 'ok' : 'warn'}>{dbCheck}</Callout> : null}
                <div className="flex justify-between">
                  <Button onClick={() => setStep(0)}>上一步</Button>
                  <div className="flex gap-2">
                    <Button onClick={() => void testDatabase()} disabled={busy}>测试连接</Button>
                    <Button variant="primary" onClick={() => setStep(2)}>下一步</Button>
                  </div>
                </div>
              </div>
            ) : step === 2 ? (
              <div className="space-y-4">
                <Callout><Lock size={14} /> 管理员账号只在首次安装时创建；密码使用 Argon2id 哈希存储。</Callout>
                <div><label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">管理员邮箱</label><Input value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} placeholder="admin@example.com" /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">密码（≥ 8 位）</label><Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} /></div>
                  <div><label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">确认密码</label><Input type="password" value={admin.confirm} onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })} /></div>
                </div>
                <div className="flex justify-between">
                  <Button onClick={() => setStep(1)}>上一步</Button>
                  <Button variant="primary" disabled={busy} onClick={() => void complete()}>
                    <Shield size={14} /> 完成安装
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <Callout tone="ok"><Check size={14} /> 安装完成。管理员账号已创建，数据库已迁移。</Callout>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="glass-inset px-3 py-2 text-[12px]">数据库 <span className="float-right mono">{driver === 'sqlite' ? 'SQLite' : 'PostgreSQL'}</span></div>
                  <div className="glass-inset px-3 py-2 text-[12px]">管理员 <span className="float-right mono">{admin.email || '已创建'}</span></div>
                  <div className="glass-inset px-3 py-2 text-[12px]">安装锁 <span className="float-right mono">data/install.lock</span></div>
                  <div className="glass-inset px-3 py-2 text-[12px]">/setup <span className="badge badge-bad float-right">404 已关闭</span></div>
                </div>
                <Callout tone="warn">安装入口已永久关闭。重装只能由服务器管理员执行 <span className="mono">pnpm cli reset-install --yes</span>，并写入审计。</Callout>
                <div className="flex justify-end">
                  <Link to="/login"><Button variant="primary"><UserRound size={14} /> 去登录</Button></Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
