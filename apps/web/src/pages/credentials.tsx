import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Braces, Copy, Eye, FileBadge, FileKey, KeyRound, Lock, Pencil, Plus, Search, Shield, ShieldCheck, Trash2, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { api, type ApiError } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import type { Credential, CredentialCheckResult } from '@/types';
import { PageHeader, GlassPanel, EmptyState, Callout, CopyButton } from '@/components/common/primitives';
import { DataTable } from '@/components/common/data-table';
import { Badge, StrengthBadge } from '@/components/common/badges';
import { ConfirmDialog, ReauthDialog } from '@/components/common/dialogs';
import { Modal } from '@/components/ui/modal';
import { Button, Input } from '@/components/ui/controls';
import { CredentialCreateDialog } from '@/components/common/credential-create-dialog';
import { CredentialEditDialog } from '@/components/common/credential-edit-dialog';
import { copyText, formatDateTime, toastError } from '@/lib/format';

type CredentialType = Credential['type'];
type CredFilter = 'all' | CredentialType;

const TYPE_META: Record<CredentialType, { label: string; icon: LucideIcon }> = {
  password: { label: '密码', icon: Lock },
  ssh_key: { label: 'SSH 私钥', icon: KeyRound },
  api_token: { label: 'API 令牌', icon: Braces },
  certificate: { label: '证书', icon: FileBadge },
  custom: { label: '自定义', icon: FileKey },
};

const CRED_FILTERS: Array<{ value: CredFilter; label: string }> = [
  { value: 'all', label: '全部' }, { value: 'password', label: '密码' }, { value: 'ssh_key', label: 'SSH 私钥' },
  { value: 'api_token', label: 'API 令牌' }, { value: 'certificate', label: '证书' },
];

const STRENGTH_LABEL = { strong: '强', medium: '中', weak: '弱' } as const;

export function CredentialsPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const canReveal = !!me.data && me.data.user.role !== 'viewer';
  const [filter, setFilter] = useState<CredFilter>('all');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState<{ cred: Credential; mode: 'view' | 'copy' } | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [secret, setSecret] = useState<{ name: string; type: string; value: string; strength: Credential['strength'] } | null>(null);
  const [remaining, setRemaining] = useState(10);
  const [deleteTarget, setDeleteTarget] = useState<Credential | null>(null);
  const [editTarget, setEditTarget] = useState<Credential | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const credentialsQuery = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<Credential[]>('/api/v1/credentials'),
  });
  const credentials = credentialsQuery.data ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return credentials.filter((c) => (filter === 'all' || c.type === filter) && (!needle || `${c.name} ${TYPE_META[c.type].label}`.toLowerCase().includes(needle)));
  }, [credentials, filter, query]);

  const beginReveal = (cred: Credential, mode: 'view' | 'copy') => {
    setPending({ cred, mode });
    setReauthOpen(true);
  };

  const handleVerified = () => {
    const task = pending;
    if (!task) return;
    setReauthOpen(false);
    void (async () => {
      try {
        const res = await api.post<{ value: string; name: string; type: string }>(
          `/api/v1/credentials/${task.cred.id}/reveal`,
        );
        void queryClient.invalidateQueries({ queryKey: ['audit'] });
        if (task.mode === 'view') {
          setRemaining(10);
          setSecret({ ...res, strength: task.cred.strength });
        } else {
          await copyText(res.value);
          toast.success('已复制到剪贴板', { description: `${res.name} · 明文未在前端缓存` });
        }
      } catch (e) {
        toastError(e);
      } finally {
        setPending(null);
      }
    })();
  };

  useEffect(() => {
    if (!secret) return;
    let n = 10;
    setRemaining(10);
    const timer = window.setInterval(() => {
      n -= 1;
      setRemaining(n);
      if (n <= 0) {
        window.clearInterval(timer);
        setSecret(null);
        toast.info('已自动隐藏', { description: '凭据明文已从屏幕清除' });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secret]);

  const columns: ColumnDef<Credential, any>[] = [
    {
      id: 'name',
      header: '名称',
      cell: ({ row }) => {
        const meta = TYPE_META[row.original.type];
        const Icon = meta.icon;
        return (
          <div className="flex items-center gap-2.5">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border border-[var(--glass-border)] bg-[var(--panel-2)] text-[var(--ink-3)]">
              <Icon size={14} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium">{row.original.name}</div>
              <div className="text-[10.5px] text-[var(--ink-3)]">更新人：{row.original.updatedBy}</div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'type',
      header: '类型',
      cell: ({ row }) => <Badge tone="neutral">{TYPE_META[row.original.type].label}</Badge>,
    },
    {
      id: 'strength',
      header: '强度',
      cell: ({ row }) => <StrengthBadge strength={row.original.strength} />,
    },
    {
      id: 'hosts',
      header: '关联服务器',
      cell: ({ row }) =>
        row.original.hostCount ? (
          <span className="mono">{row.original.hostCount} 台</span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      id: 'check',
      header: '可用状态',
      cell: ({ row }) => {
        const summary = row.original.checkSummary;
        const failed = summary?.failed ?? 0;
        const usable = summary?.usable ?? 0;
        const unchecked = summary?.unchecked ?? 0;
        if (!summary) return <span className="muted">未关联</span>;
        if (failed > 0) {
          return (
            <Badge tone="bad">
              失效 {failed} 台{failed === 1 && usable === 0 ? '（需更新）' : ''}
            </Badge>
          );
        }
        if (usable > 0) return <Badge tone="ok">可用 {usable} 台</Badge>;
        if (unchecked > 0) return <Badge tone="neutral">未检测 {unchecked} 台</Badge>;
        return <span className="muted">—</span>;
      },
    },
    {
      id: 'updatedAt',
      header: '最近更新',
      cell: ({ row }) => <span className="mono text-[11.5px] text-[var(--ink-3)]">{formatDateTime(row.original.updatedAt)}</span>,
    },
    {
      id: 'actions',
      header: '操作',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <div className="flex justify-end gap-0.5">
          {canReveal ? (
            <>
              <button
                type="button"
                className="icon-btn"
                title="检测该凭据在每个关联主机上的可用性"
                aria-label="检测凭据可用性"
                disabled={testingId === row.original.id || row.original.type === 'certificate' || row.original.type === 'custom' || row.original.type === 'api_token'}
                onClick={() => void testCredential(row.original)}
              >
                <ShieldCheck size={14} className={testingId === row.original.id ? 'animate-pulse' : undefined} />
              </button>
              <button type="button" className="icon-btn" title="编辑名称/内容/关联" aria-label="编辑凭据" onClick={() => setEditTarget(row.original)}><Pencil size={14} /></button>
              <button type="button" className="icon-btn" title="查看（需验证）" aria-label="查看凭据" onClick={() => beginReveal(row.original, 'view')}><Eye size={14} /></button>
              <button type="button" className="icon-btn" title="复制（需验证）" aria-label="复制凭据" onClick={() => beginReveal(row.original, 'copy')}><Copy size={14} /></button>
              <button type="button" className="icon-btn" title="删除" aria-label="删除凭据" onClick={() => setDeleteTarget(row.original)}><Trash2 size={14} /></button>
            </>
          ) : (
            <span className="text-[11px] text-[var(--ink-3)]">只读</span>
          )}
        </div>
      ),
    },
  ];

  const countFor = (value: CredFilter) => (value === 'all' ? credentials.length : credentials.filter((c) => c.type === value).length);

  const emptyTitle = filter === 'certificate' ? '还没有证书类型的凭据' : filter === 'all' ? '还没有凭据' : `还没有${TYPE_META[filter].label}类型的凭据`;
  const emptyDescription = filter === 'certificate' ? '登记 TLS / 客户端证书后，可关联到服务器；查看明文同样需要二次验证。' : '登记后可关联到服务器；查看与轮换都会写入审计日志。';

  const testCredential = async (cred: Credential) => {
    setTestingId(cred.id);
    try {
      const results = await api.post<CredentialCheckResult[]>(`/api/v1/credentials/${cred.id}/test`, {});
      const failed = results.filter((r) => !r.ok);
      void queryClient.invalidateQueries({ queryKey: ['credentials'] });
      void queryClient.invalidateQueries({ queryKey: ['hosts'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      if (!results.length) toast.info('该凭据尚未关联服务器', { description: '先关联主机后再检测' });
      else if (failed.length) {
        toast.error(`检测完成：${failed.length} 台失败`, {
          description: failed.map((r) => `${r.hostName}: ${r.error ?? '认证失败'}`).join('；').slice(0, 220),
        });
      } else toast.success(`检测完成：${results.length} 台全部可用`);
    } catch (e) {
      toastError(e);
    } finally {
      setTestingId(null);
    }
  };

  const deleteCredential = async () => {
    if (!deleteTarget) return;
    await api.delete<{ ok: boolean }>(`/api/v1/credentials/${deleteTarget.id}`);
    void queryClient.invalidateQueries({ queryKey: ['credentials'] });
    void queryClient.invalidateQueries({ queryKey: ['hosts'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
    toast.success('已删除凭据', { description: deleteTarget.name });
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="凭据保险库"
        sub="AES-256-GCM 加密存储 · 查看需二次验证 · 全程审计"
        actions={
          canReveal ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} />
              新建凭据
            </Button>
          ) : undefined
        }
      />

      <GlassPanel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] p-3">
          <div className="chips">
            {CRED_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`chip ${filter === item.value ? 'chip-active' : ''}`}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
                <span className="ml-1 text-[10.5px] text-[var(--ink-3)]">{countFor(item.value)}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-[240px]">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-3)]" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索凭据名称…"
              className="pl-8"
              aria-label="搜索凭据"
            />
          </div>
        </div>
        {credentialsQuery.isError ? (
          <div className="p-4">
            <Callout tone="warn">
              <div className="flex w-full items-center justify-between gap-3">
                <span>凭据列表加载失败：{(credentialsQuery.error as ApiError).message}</span>
                <Button size="sm" onClick={() => void credentialsQuery.refetch()}>重试</Button>
              </div>
            </Callout>
          </div>
        ) : credentialsQuery.isLoading ? (
          <div className="empty-state">正在加载凭据…</div>
        ) : (
          <DataTable
            data={filtered}
            columns={columns}
            footer={<span>共 {credentials.length} 条 · 显示 {filtered.length} 条</span>}
            empty={
              <EmptyState
                icon={<Shield size={20} />}
                title={emptyTitle}
                description={emptyDescription}
                action={
                  canReveal ? (
                    <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
                      <Plus size={13} />
                      新建凭据
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </GlassPanel>

      <Callout icon={<Lock size={14} className="mt-[2px] shrink-0" />}>
        凭据值只在「查看」时解密展示，10 秒后自动隐藏；Agent 令牌与 MCP 接口永远无法读取明文。
      </Callout>

      <CredentialCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CredentialEditDialog credential={editTarget} onOpenChange={(o) => !o && setEditTarget(null)} />

      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        target={`凭据「${pending?.cred.name ?? ''}」`}
        onVerified={() => handleVerified()}
      />

      <Modal
        open={!!secret}
        onOpenChange={(o) => !o && setSecret(null)}
        title={`凭据 · ${secret?.name ?? ''}`}
        footer={
          <>
            <Button onClick={() => setSecret(null)}>关闭</Button>
            <CopyButton text={secret?.value ?? ''} label="复制" className="btn-primary" sensitive />
          </>
        }
      >
        {secret ? (
          <div>
            <Callout tone="warn" icon={<TriangleAlert size={14} className="mt-[2px] shrink-0" />}>
              以下为明文内容，请勿在共享屏幕时打开；<b>{Math.max(remaining, 0)} 秒</b>后自动隐藏。
            </Callout>
            <div className="code-block mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap">{secret.value}</div>
            <p className="mt-2 text-[11.5px] text-[var(--ink-3)]">
              类型：{TYPE_META[secret.type as CredentialType]?.label ?? secret.type}
              {secret.strength ? ` · 强度：${STRENGTH_LABEL[secret.strength]}` : ''} · 本次查看已写入审计日志
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="删除凭据"
        message={`确定删除「${deleteTarget?.name ?? ''}」？该操作不可恢复，已关联的服务器将解除绑定。`}
        confirmLabel="删除"
        danger
        onConfirm={deleteCredential}
      />
    </div>
  );
}
