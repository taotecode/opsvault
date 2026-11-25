import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ScrollText, Search } from 'lucide-react';
import { listPage, type ApiError } from '@/lib/api';
import type { AuditEntry } from '@/types';
import { Button, Input } from '@/components/ui/controls';
import { DataTable } from '@/components/common/data-table';
import { Badge } from '@/components/common/badges';
import { Callout, EmptyState, GlassPanel, PageHeader } from '@/components/common/primitives';
import { toastApiError } from '@/components/common/keypair-utils';

const CATEGORIES: Array<[string, string]> = [
  ['all', '全部'],
  ['auth', '认证'],
  ['asset', '资产'],
  ['cred', '凭据'],
  ['key', '密钥'],
  ['user', '用户'],
  ['api', 'API'],
];

function formatTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN', { hour12: false });
}

export function AuditPage() {
  const [category, setCategory] = useState('all');
  const [success, setSuccess] = useState<'all' | 'true' | 'false'>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const buildPath = (cursor: string) => {
    const params = new URLSearchParams({ limit: '50' });
    if (category !== 'all') params.set('category', category);
    if (success !== 'all') params.set('success', success);
    if (query) params.set('q', query);
    if (cursor) params.set('cursor', cursor);
    return `/api/v1/audit?${params.toString()}`;
  };

  const audit = useInfiniteQuery({
    queryKey: ['audit', category, success, query],
    initialPageParam: '',
    retry: false,
    queryFn: async ({ pageParam }) => {
      try {
        return await listPage<AuditEntry>(buildPath(pageParam));
      } catch (e) {
        toastApiError(e as ApiError, '加载审计日志失败');
        throw e;
      }
    },
    getNextPageParam: (last) => (last.page.hasMore && last.page.cursor ? last.page.cursor : undefined),
  });

  const entries = audit.data?.pages.flatMap((page) => page.data) ?? [];

  const columns: ColumnDef<AuditEntry>[] = [
    {
      header: '时间',
      cell: ({ row }) => <span className="mono whitespace-nowrap text-[11px] text-[var(--ink-3)]">{formatTime(row.original.time)}</span>,
    },
    {
      header: '用户',
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 text-[12px]">
          {row.original.actor}
          {row.original.actorKind === 'agent' ? <Badge tone="info">Agent</Badge> : null}
        </span>
      ),
    },
    { header: '操作', cell: ({ row }) => <span className="text-[12.5px]">{row.original.action}</span> },
    {
      header: '对象',
      cell: ({ row }) => <span className="mono text-[11px] text-[var(--ink-3)]">{row.original.target ?? '—'}</span>,
    },
    {
      header: '来源 IP',
      cell: ({ row }) => <span className="mono hidden text-[11px] text-[var(--ink-3)] md:table-cell">{row.original.ip ?? '—'}</span>,
    },
    {
      header: '结果',
      cell: ({ row }) =>
        row.original.success ? <span className="badge badge-ok">成功</span> : <span className="badge badge-bad">失败</span>,
    },
  ];

  return (
    <>
      <PageHeader title="审计日志" sub="登录、写操作、敏感读取与 Agent 调用，全部留痕" />
      <GlassPanel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <div className="chips">
            {CATEGORIES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={category === value ? 'chip chip-active' : 'chip'}
                onClick={() => setCategory(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="chips">
            {([['all', '全部结果'], ['true', '成功'], ['false', '失败']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={success === value ? 'chip chip-active' : 'chip'}
                onClick={() => setSuccess(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-[260px]">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-3)]" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索用户、操作、对象…"
              className="pl-7"
            />
          </div>
        </div>
        {audit.error ? (
          <div className="p-4"><Callout tone="warn">加载审计日志失败：{audit.error.message}</Callout></div>
        ) : audit.isLoading ? (
          <div className="space-y-2 p-4"><div className="skeleton h-10 w-full" /><div className="skeleton h-10 w-full" /></div>
        ) : (
          <div className="overflow-x-auto">
            <DataTable
              data={entries}
              columns={columns}
              empty={
                <EmptyState icon={<ScrollText size={18} />} title="没有匹配的审计记录" description="换个关键词或类别试试。" />
              }
              footer={
                <>
                  <span>已加载 {entries.length} 条{audit.hasNextPage ? '（还有更多）' : ''}</span>
                  {audit.hasNextPage ? (
                    <Button size="sm" className="ml-auto" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
                      {audit.isFetchingNextPage ? '加载中…' : '加载更多'}
                    </Button>
                  ) : null}
                </>
              }
            />
          </div>
        )}
      </GlassPanel>
      <div className="mt-3.5">
        <Callout>审计记录按时间倒序排列，使用游标分页；筛选条件变化会自动从第一页重新加载。</Callout>
      </div>
    </>
  );
}
