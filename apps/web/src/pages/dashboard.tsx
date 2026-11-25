import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, Globe, RefreshCw } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { api, listPage, type ApiError } from '@/lib/api';
import { useMe, useSettings } from '@/lib/hooks';
import type { AuditEntry, Credential, Host, Keypair } from '@/types';
import { PageHeader, GlassPanel, SectionTitle, EmptyState, Callout } from '@/components/common/primitives';
import { FleetStrip } from '@/components/common/fleet-strip';
import { StatBand } from '@/components/common/stats';
import { DataTable } from '@/components/common/data-table';
import { Badge } from '@/components/common/badges';
import { Button } from '@/components/ui/controls';
import { formatRelative, daysUntil } from '@/lib/format';

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

function auditTargetLabel(entry: AuditEntry): string | null {
  const detail = entry.detail;
  if (detail && typeof detail === 'object' && 'name' in detail) {
    const name = (detail as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return null;
}

const expiringColumns: ColumnDef<Host, any>[] = [
  {
    id: 'name',
    header: '服务器',
    cell: ({ row }) => (
      <div>
        <div className="text-[12.5px] font-medium">{row.original.name}</div>
        <div className="text-[10.5px] text-[var(--ink-3)]">
          {row.original.provider ?? '未填写供应商'} · {row.original.group ?? '未分组'}
        </div>
      </div>
    ),
  },
  {
    id: 'expiresAt',
    header: '到期日',
    cell: ({ row }) => <span className="mono">{row.original.expiresAt ?? '—'}</span>,
  },
  {
    id: 'days',
    header: '剩余',
    cell: ({ row }) => {
      const days = daysUntil(row.original.expiresAt);
      if (days === null) return <span className="muted">—</span>;
      return <Badge tone={days <= 7 ? 'bad' : 'warn'}>{days} 天后</Badge>;
    },
  },
  {
    id: 'action',
    header: '操作',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Button
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          toast.info('续费提醒', {
            description: `${row.original.name} 将于 ${row.original.expiresAt} 到期，请联系 ${row.original.provider ?? '供应商'} 续费。`,
          });
        }}
      >
        <CalendarClock size={12} />
        去续费
      </Button>
    ),
  },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const me = useMe();
  const canWrite = !!me.data && me.data.user.role !== 'viewer';
  const expiryDays = settings.data?.notifications.expiryDays ?? 30;
  const hostsQuery = useQuery({
    queryKey: ['hosts'],
    queryFn: () => listPage<Host>('/api/v1/hosts?limit=200'),
  });
  const credentialsQuery = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<Credential[]>('/api/v1/credentials'),
  });
  const keypairsQuery = useQuery({
    queryKey: ['keypairs'],
    queryFn: () => api.get<Keypair[]>('/api/v1/keypairs'),
  });
  const auditQuery = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => api.get<AuditEntry[]>('/api/v1/audit?limit=6'),
  });

  const hosts = hostsQuery.data?.data ?? [];
  const online = hosts.filter((h) => h.status === 'online');

  const expiring = useMemo(
    () =>
      hosts
        .filter((h) => {
          const days = daysUntil(h.expiresAt);
          return days !== null && days >= 0 && days <= expiryDays;
        })
        .sort((a, b) => (daysUntil(a.expiresAt) ?? 0) - (daysUntil(b.expiresAt) ?? 0)),
    [hosts],
  );

  const groups = useMemo(() => {
    const map = new Map<string, number>();
    for (const host of hosts) {
      const name = host.group?.trim() || '未分组';
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [hosts]);
  const groupMax = Math.max(...groups.map(([, n]) => n), 1);

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

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['hosts'] });
    void queryClient.invalidateQueries({ queryKey: ['credentials'] });
    void queryClient.invalidateQueries({ queryKey: ['keypairs'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
    toast.success('状态已刷新');
  };

  const runBatchProbe = () => {
    if (!online.length) {
      toast.info('没有在线主机可供批量探测');
      return;
    }
    batchProbe.mutate(online.map((h) => h.id));
  };

  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="仪表盘"
        sub={`${today} · 舰队运行概览`}
        actions={
          <>
            <Button onClick={refreshAll} disabled={hostsQuery.isFetching}>
              <RefreshCw size={14} className={hostsQuery.isFetching ? 'animate-spin' : undefined} />
              刷新状态
            </Button>
            {canWrite ? (
              <Button variant="primary" onClick={runBatchProbe} disabled={batchProbe.isPending}>
                <Globe size={14} />
                {batchProbe.isPending ? '探测中…' : '批量探测'}
              </Button>
            ) : null}
          </>
        }
      />

      {hostsQuery.isError ? (
        <Callout tone="warn">
          <div className="flex w-full items-center justify-between gap-3">
            <span>资产数据加载失败：{(hostsQuery.error as ApiError).message}</span>
            <Button size="sm" onClick={() => void hostsQuery.refetch()}>重试</Button>
          </div>
        </Callout>
      ) : hostsQuery.isLoading ? (
        <div className="glass-panel empty-state">正在加载资产…</div>
      ) : null}

      <FleetStrip hosts={hosts} onSelect={(host) => navigate(`/hosts?hostId=${host.id}`)} />

      <StatBand
        items={[
          { label: '服务器资产', value: hosts.length },
          { label: <><i className="dot dot-ok" />在线运行</>, value: online.length },
          { label: '凭据条目', value: credentialsQuery.data?.length ?? 0 },
          { label: '密钥对', value: keypairsQuery.data?.length ?? 0 },
          { label: <><i className="dot dot-warn" />{expiryDays} 天内到期</>, value: expiring.length },
        ]}
      />

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <GlassPanel className="overflow-hidden">
          <SectionTitle right={<Badge tone="warn">{expiring.length} 台 · {expiryDays} 天内</Badge>}>到期提醒</SectionTitle>
          <DataTable
            data={expiring}
            columns={expiringColumns}
            onRowClick={() => navigate('/hosts')}
            empty={
              <EmptyState
                icon={<CalendarClock size={20} />}
                title={`${expiryDays} 天内没有到期资产`}
                description="续费窗口一切正常。"
              />
            }
          />
        </GlassPanel>

        <div className="space-y-3.5">
          <GlassPanel>
            <SectionTitle right={<span className="text-[11.5px] text-[var(--ink-3)]">{hosts.length} 台</span>}>
              分组分布
            </SectionTitle>
            <div className="max-h-56 overflow-auto px-4 py-2">
              {groups.length ? (
                groups.map(([name, count]) => (
                  <div key={name} className="flex items-center gap-2 py-1 text-[12px]">
                    <span className="w-24 shrink-0 truncate text-[var(--ink-2)]" title={name}>
                      {name}
                    </span>
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-[var(--track)]">
                      <i
                        className="block h-full rounded bg-[var(--brand)]"
                        style={{ width: `${Math.round((count / groupMax) * 100)}%` }}
                      />
                    </div>
                    <span className="mono w-6 shrink-0 text-right text-[var(--ink-3)]">{count}</span>
                  </div>
                ))
              ) : (
                <p className="py-4 text-center text-[12px] text-[var(--ink-3)]">还没有服务器分组。</p>
              )}
            </div>
          </GlassPanel>

          <GlassPanel className="overflow-hidden">
            <SectionTitle
              right={
                <Button size="sm" onClick={() => navigate('/audit')}>
                  全部
                </Button>
              }
            >
              最近动态
            </SectionTitle>
            <div>
              {(auditQuery.data ?? []).length ? (
                (auditQuery.data ?? []).map((entry, i) => (
                  <div
                    key={entry.id ?? `${entry.time}-${i}`}
                    className="flex items-start gap-2.5 border-b border-[var(--line)] px-4 py-2 last:border-b-0"
                  >
                    <span className={`dot ${entry.success ? 'dot-ok' : 'dot-bad'} mt-1.5`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-[var(--ink-2)]">
                        <b className="text-[var(--ink)]">{entry.actor}</b> {entry.action}
                        {auditTargetLabel(entry) ? ` · ${auditTargetLabel(entry)}` : ''}
                        {entry.actorKind === 'agent' ? ' (Agent)' : ''}
                      </div>
                      <div className="text-[10.5px] text-[var(--ink-3)]">{formatRelative(entry.time)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="px-4 py-6 text-center text-[12px] text-[var(--ink-3)]">暂无操作记录。</p>
              )}
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
