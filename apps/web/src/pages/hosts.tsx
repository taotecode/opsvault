import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Globe, Plus, Search, Server } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { api, listPage, type ApiError } from '@/lib/api';
import { formatRelative, hostSpec, loadMetrics, daysUntil } from '@/lib/format';
import { useMe } from '@/lib/hooks';
import type { Env, Host, HostStatus } from '@/types';
import { PageHeader, GlassPanel, EmptyState, Callout } from '@/components/common/primitives';
import { DataTable } from '@/components/common/data-table';
import { LoadMeters } from '@/components/common/stats';
import { Dot, EnvBadge } from '@/components/common/badges';
import { Button, Input } from '@/components/ui/controls';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/fields';
import { AddHostDialog } from '@/components/common/host-add-dialog';
import { HostDrawer } from '@/components/common/host-drawer';

type EnvFilter = 'all' | Env;
type StatusFilter = 'all' | HostStatus;

const ENV_FILTERS: Array<{ value: EnvFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'prod', label: '生产' },
  { value: 'staging', label: '预发' },
  { value: 'dev', label: '开发' },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'online', label: '在线' },
  { value: 'warning', label: '告警' },
  { value: 'offline', label: '离线' },
  { value: 'pending', label: '待探测' },
];

interface ProbeResult {
  hostId: string;
  name?: string;
  ok: boolean;
  error?: string;
}

function toastError(e: unknown): void {
  const err = e as ApiError;
  toast.error(err.message || '操作失败', { description: err.hint });
}

const hostColumns: ColumnDef<Host, any>[] = [
  {
    id: 'host',
    header: '服务器',
    cell: ({ row }) => {
      const host = row.original;
      return (
        <div className="flex items-center gap-2.5">
          <Dot status={host.status} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
              <span className="truncate">{host.name}</span>
              {host.tags?.[0] ? <span className="tag">{host.tags[0]}</span> : null}
            </div>
            <div className="mono text-[10.5px] text-[var(--ink-3)]">
              {host.address}:{host.port}
            </div>
          </div>
        </div>
      );
    },
  },
  {
    id: 'env',
    header: '环境',
    cell: ({ row }) => <EnvBadge env={row.original.env} />,
  },
  {
    id: 'os',
    header: '系统',
    cell: ({ row }) => (
      <div className="text-[12px] text-[var(--ink-2)]">
        {row.original.os ?? '—'}
        {row.original.arch ? <div className="text-[10.5px] text-[var(--ink-3)]">{row.original.arch}</div> : null}
      </div>
    ),
  },
  {
    id: 'spec',
    header: '规格',
    cell: ({ row }) => <span className="mono whitespace-nowrap text-[12px]">{hostSpec(row.original)}</span>,
  },
  {
    id: 'load',
    header: '负载',
    cell: ({ row }) => {
      const metrics = loadMetrics(row.original);
      if (!metrics) return <span className="muted">—</span>;
      return (
        <div title={`负载：${row.original.loadAvg ?? '—'}`}>
          <LoadMeters cpu={metrics.cpu} mem={metrics.mem} disk={metrics.disk} />
        </div>
      );
    },
  },
  {
    id: 'provider',
    header: '供应商',
    cell: ({ row }) => row.original.provider ?? <span className="muted">—</span>,
  },
  {
    id: 'expiresAt',
    header: '到期',
    cell: ({ row }) => {
      const host = row.original;
      if (!host.expiresAt) return <span className="muted">无固定到期</span>;
      const days = daysUntil(host.expiresAt);
      return (
        <div className="whitespace-nowrap">
          <div className="mono text-[12px]">{host.expiresAt}</div>
          {days !== null ? (
            <div className={`text-[10.5px] ${days <= 7 ? 'text-[var(--bad)]' : days <= 30 ? 'text-[var(--warn)]' : 'text-[var(--ink-3)]'}`}>
              {days < 0 ? '已到期' : `${days} 天后`}
            </div>
          ) : null}
        </div>
      );
    },
  },
  {
    id: 'lastProbeAt',
    header: '最近探测',
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-[11.5px] text-[var(--ink-3)]">
        {formatRelative(row.original.lastProbeAt)}
      </span>
    ),
  },
];

export function HostsPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const canWrite = !!me.data && me.data.user.role !== 'viewer';
  const [searchParams, setSearchParams] = useSearchParams();
  const [env, setEnv] = useState<EnvFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [drawerId, setDrawerIdState] = useState<string | null>(() => searchParams.get('hostId'));

  const setDrawerId = (id: string | null) => {
    setDrawerIdState(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('hostId', id);
    else next.delete('hostId');
    setSearchParams(next, { replace: true });
  };

  const params = new URLSearchParams({ limit: '200' });
  if (env !== 'all') params.set('env', env);
  if (status !== 'all') params.set('status', status);
  if (query.trim()) params.set('q', query.trim());
  const hostsQuery = useQuery({
    queryKey: ['hosts', env, status, query.trim()],
    queryFn: () => listPage<Host>(`/api/v1/hosts?${params.toString()}`),
  });
  const page = hostsQuery.data;
  const hosts = page?.data ?? [];
  const hasMore = page?.page.hasMore ?? false;

  const suggestion = useMemo(() => query.trim() || env !== 'all' || status !== 'all', [query, env, status]);

  const batchProbe = useMutation({
    mutationFn: (hostIds: string[]) =>
      api.post<ProbeResult[]>('/api/v1/hosts/batch-probe', { hostIds }),
    onSuccess: (results) => {
      const failed = results.filter((r) => !r.ok).length;
      void queryClient.invalidateQueries({ queryKey: ['hosts'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      const summary = `成功 ${results.length - failed} 台 · 失败 ${failed} 台`;
      if (failed > 0) toast.warning('批量探测完成', { description: summary });
      else toast.success('批量探测完成', { description: summary });
    },
    onError: toastError,
  });

  const runBatchProbe = () => {
    const online = hosts.filter((h) => h.status === 'online');
    if (!online.length) {
      toast.info('当前筛选下没有在线主机可供探测');
      return;
    }
    batchProbe.mutate(online.map((h) => h.id));
  };

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="服务器"
        sub="资产台账 · 自动探测 · 手动补录"
        actions={
          <>
            {canWrite ? (
              <Button onClick={runBatchProbe} disabled={batchProbe.isPending}>
                <Globe size={14} />
                {batchProbe.isPending ? '探测中…' : '批量探测'}
              </Button>
            ) : null}
            {canWrite ? (
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                <Plus size={14} />
                添加服务器
              </Button>
            ) : null}
          </>
        }
      />

      <GlassPanel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] p-3">
          <div className="chips">
            {ENV_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`chip ${env === item.value ? 'chip-active' : ''}`}
                onClick={() => setEnv(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="w-[124px]">
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative ml-auto w-[240px]">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-3)]" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称、IP、供应商…"
              className="pl-8"
              aria-label="搜索服务器"
            />
          </div>
          <span className="hidden text-[11.5px] text-[var(--ink-3)] xl:inline">点击行查看详情与探测</span>
        </div>

        {hostsQuery.isError ? (
          <div className="p-4">
            <Callout tone="warn">
              <div className="flex w-full items-center justify-between gap-3">
                <span>服务器列表加载失败：{(hostsQuery.error as ApiError).message}</span>
                <Button size="sm" onClick={() => void hostsQuery.refetch()}>重试</Button>
              </div>
            </Callout>
          </div>
        ) : hostsQuery.isLoading ? (
          <div className="empty-state">正在加载服务器…</div>
        ) : (
          <DataTable
            data={hosts}
            columns={hostColumns}
            onRowClick={(host) => setDrawerId(host.id)}
            footer={
              <>
                <span>共 {hosts.length} 台</span>
                {hasMore ? <span>已显示前 200 台，请用搜索缩小范围</span> : <span>筛选已应用</span>}
                {suggestion ? <span className="ml-auto">筛选条件生效中</span> : null}
              </>
            }
            empty={
              <EmptyState
                icon={<Server size={20} />}
                title={suggestion ? '没有匹配的服务器' : '还没有服务器'}
                description={suggestion ? '调整筛选条件后重试。' : '添加一台服务器开始资产盘点。'}
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => setAddOpen(true)}>
                      <Plus size={13} />
                      添加服务器
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </GlassPanel>

      {canWrite ? <AddHostDialog open={addOpen} onOpenChange={setAddOpen} /> : null}
      <HostDrawer hostId={drawerId} onClose={() => setDrawerId(null)} readOnly={!canWrite} />
    </div>
  );
}
