import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ExternalLink, Globe, KeyRound, Plus, ShieldCheck, Star, Terminal, Trash2, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api';
import { formatDateTime, formatRelative, toastError } from '@/lib/format';
import type { Credential, CredentialCheckResult, Host, HostCredentialLink, Keypair, QuickConnect } from '@/types';
import { Drawer, Modal } from '@/components/ui/modal';
import { Button, Input, Textarea } from '@/components/ui/controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/fields';

import { Badge, Dot, EnvBadge, StatusBadge, StrengthBadge } from './badges';
import { Callout, CopyButton, EmptyState } from './primitives';
import { ConfirmDialog } from './dialogs';

/* ---------- 手动字段 ---------- */
const BILLING_TYPES = ['包年包月', '按量付费', '其他'] as const;
const NONE = '__none';

const manualSchema = z.object({
  provider: z.string().trim().max(120).optional(),
  bandwidthMbps: z.number().int().min(0).nullable().optional(),
  trafficTb: z.number().min(0).nullable().optional(),
  billingType: z.enum(BILLING_TYPES).nullable().optional(),
  costMonth: z.number().min(0).nullable().optional(),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  notes: z.string().max(2000).optional(),
});
type ManualInput = z.input<typeof manualSchema>;
type ManualOutput = z.output<typeof manualSchema>;

function FactGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--line)]">
      {items.map((item) => (
        <div key={item.label} className="bg-[var(--panel)] px-3 py-2">
          <div className="text-[11px] text-[var(--ink-3)]">{item.label}</div>
          <div className="truncate text-[12px] text-[var(--ink-2)]" title={typeof item.value === 'string' ? item.value : undefined}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ManualFields({ host, readOnly }: { host: Host; readOnly?: boolean }) {
  const queryClient = useQueryClient();
  const form = useForm<ManualInput, unknown, ManualOutput>({
    resolver: zodResolver(manualSchema),
    defaultValues: {
      provider: host.provider ?? '',
      bandwidthMbps: host.bandwidthMbps,
      trafficTb: host.trafficTb,
      billingType: BILLING_TYPES.includes(host.billingType as (typeof BILLING_TYPES)[number])
        ? (host.billingType as (typeof BILLING_TYPES)[number])
        : null,
      costMonth: host.costMonth,
      expiresAt: host.expiresAt,
      notes: host.notes ?? '',
    },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['host', host.id] });
    void queryClient.invalidateQueries({ queryKey: ['hosts'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
  };
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<Host>(`/api/v1/hosts/${host.id}`, patch),
    onSuccess: () => {
      refresh();
      toast.success('手动字段已保存', { description: host.name });
    },
    onError: toastError,
  });
  const submit = form.handleSubmit((values) => {
    save.mutate({
      provider: values.provider?.trim() ? values.provider.trim() : null,
      bandwidthMbps: values.bandwidthMbps ?? null,
      trafficTb: values.trafficTb ?? null,
      billingType: values.billingType ?? null,
      costMonth: values.costMonth ?? null,
      expiresAt: values.expiresAt ?? null,
      notes: values.notes ?? '',
    });
  });
  const err = form.formState.errors;
  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={readOnly} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          供应商
          <Input {...form.register('provider')} className="mt-1" placeholder="阿里云 / 腾讯云 / 自建…" />
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          带宽（Mbps）
          <Input
            {...form.register('bandwidthMbps', { setValueAs: (v) => (v === '' ? null : Number(v)) })}
            className="mt-1"
            type="number"
            min="0"
          />
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          月流量（TB）
          <Input
            {...form.register('trafficTb', { setValueAs: (v) => (v === '' ? null : Number(v)) })}
            className="mt-1"
            type="number"
            min="0"
            step="0.5"
          />
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          计费方式
          <Controller
            control={form.control}
            name="billingType"
            render={({ field }) => (
              <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="未设置" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>未设置</SelectItem>
                  {BILLING_TYPES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          月成本（¥）
          <Input
            {...form.register('costMonth', { setValueAs: (v) => (v === '' ? null : Number(v)) })}
            className="mt-1"
            type="number"
            min="0"
          />
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          到期日
          <Input
            {...form.register('expiresAt', { setValueAs: (v) => (v === '' ? null : v) })}
            className="mt-1"
            type="date"
          />
        </label>
      </div>
      <label className="block text-[11.5px] text-[var(--ink-3)]">
        备注
        <Textarea {...form.register('notes')} className="mt-1" rows={2} placeholder="续费联系人、用途、特殊说明…" />
      </label>
      {err.bandwidthMbps || err.trafficTb || err.costMonth || err.expiresAt ? (
        <p className="text-[11.5px] text-[var(--bad)]">请检查数字与日期格式（日期 YYYY-MM-DD）。</p>
      ) : null}
      {readOnly ? null : (
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
            {save.isPending ? '保存中…' : '保存手动字段'}
          </Button>
        </div>
      )}
      </fieldset>
    </form>
  );
}

/* ---------- 服务器抽屉 ---------- */
interface Snapshot {
  id: string;
  status: string;
  facts: unknown;
  error: string | null;
  createdAt: string;
}

const AUTO_AUTH = '__auto';

export function HostDrawer({ hostId, onClose, readOnly }: { hostId: string | null; onClose: () => void; readOnly?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const open = !!hostId;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [quick, setQuick] = useState<QuickConnect | null>(null);
  /** '__auto' 表示按主凭据优先自动回退；具体 id 表示本次只用手动选择的凭据 */
  const [authChoice, setAuthChoice] = useState<string>(AUTO_AUTH);
  const [testingLink, setTestingLink] = useState<string | null>(null);

  useEffect(() => {
    setConfirmDelete(false);
    setQuick(null);
    setAuthChoice(AUTO_AUTH);
  }, [hostId]);

  const hostQuery = useQuery({
    queryKey: ['host', hostId],
    queryFn: () => api.get<Host>(`/api/v1/hosts/${hostId}`),
    enabled: open,
  });
  const credentials = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<Credential[]>('/api/v1/credentials'),
    enabled: open,
  });
  const hostCredentials = useQuery({
    queryKey: ['host-credentials', hostId],
    queryFn: () => api.get<HostCredentialLink[]>(`/api/v1/hosts/${hostId}/credentials`),
    enabled: open,
  });
  const keypairs = useQuery({
    queryKey: ['keypairs'],
    queryFn: () => api.get<Keypair[]>('/api/v1/keypairs'),
    enabled: open,
  });
  const snapshots = useQuery({
    queryKey: ['host-snapshots', hostId],
    queryFn: () => api.get<Snapshot[]>(`/api/v1/hosts/${hostId}/snapshots`),
    enabled: open,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['host', hostId] });
    void queryClient.invalidateQueries({ queryKey: ['host-credentials', hostId] });
    void queryClient.invalidateQueries({ queryKey: ['host-snapshots', hostId] });
    void queryClient.invalidateQueries({ queryKey: ['hosts'] });
    void queryClient.invalidateQueries({ queryKey: ['credentials'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
  };

  const probe = useMutation({
    mutationFn: () => {
      if (!hostId) throw new Error('缺少服务器 ID');
      const body = authChoice === AUTO_AUTH ? {} : { credentialId: authChoice };
      return api.post<{ host: Host; partial: string[] }>(`/api/v1/hosts/${hostId}/probe`, body);
    },
    onSuccess: (res) => {
      refresh();
      const manual = authChoice === AUTO_AUTH ? '' : '（手动凭据）';
      toast.success('探测完成', {
        description: res.partial.length
          ? `部分字段失败：${res.partial.join('、')}`
          : `${res.host.name}${manual} · 字段已更新`,
      });
    },
    onError: (e) => {
      refresh();
      toastError(e);
    },
  });

  const setPrimary = useMutation({
    mutationFn: (credentialId: string) => {
      if (!hostId) throw new Error('缺少服务器 ID');
      return api.post<{ ok: boolean }>(`/api/v1/hosts/${hostId}/credentials/${credentialId}/primary`);
    },
    onSuccess: () => {
      refresh();
      setAuthChoice(AUTO_AUTH);
      toast.success('已设为主凭据', { description: '连接时优先尝试该凭据，失败后自动回退到其他凭据' });
    },
    onError: toastError,
  });

  const testCredential = useMutation({
    mutationFn: (credentialId: string) => {
      setTestingLink(credentialId);
      return api.post<CredentialCheckResult[]>(`/api/v1/credentials/${credentialId}/test`, { hostIds: hostId ? [hostId] : [] });
    },
    onSuccess: (results) => {
      refresh();
      const result = results[0];
      if (!result) toast.info('该凭据未关联本主机');
      else if (result.ok) toast.success('凭据可用', { description: `已在 ${result.hostName} 上验证通过 SSH 登录` });
      else toast.error('凭据不可用', { description: result.error ?? '认证失败' });
    },
    onError: toastError,
    onSettled: () => setTestingLink(null),
  });

  const connect = useMutation({
    mutationFn: (keypair: Keypair) => {
      if (!hostId) throw new Error('缺少服务器 ID');
      return api.get<QuickConnect>(
        `/api/v1/keypairs/${keypair.id}/connect-command?hostId=${encodeURIComponent(hostId)}`,
      );
    },
    onSuccess: (res) => setQuick(res),
    onError: toastError,
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!hostId) throw new Error('缺少服务器 ID');
      return api.delete<{ ok: boolean }>(`/api/v1/hosts/${hostId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hosts'] });
      void queryClient.invalidateQueries({ queryKey: ['credentials'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      toast.success('服务器已删除');
      onClose();
    },
    onError: toastError,
  });

  const host = hostQuery.data;
  const links = useMemo(() => hostCredentials.data ?? [], [hostCredentials.data]);
  const relatedCredentials = useMemo(() => {
    if (!host) return [];
    return (credentials.data ?? []).filter((c) => c.id === host.credentialId || (c.hosts ?? []).includes(host.name));
  }, [credentials.data, host]);
  const selectableCredentials = useMemo(() => {
    const ids = new Set(links.map((l) => l.id));
    return (credentials.data ?? []).filter((c) => ids.has(c.id) && (c.type === 'password' || c.type === 'ssh_key'));
  }, [credentials.data, links]);
  const relatedKeypair = useMemo(
    () => (host?.keypairId ? (keypairs.data ?? []).find((k) => k.id === host.keypairId) ?? null : null),
    [keypairs.data, host?.keypairId],
  );

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <div className="flex h-full flex-col">
        <div className="flex-none px-5 pt-4">
          <div className="flex items-start gap-2">
            {host ? <Dot status={host.status} /> : <span className="dot dot-idle" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold">{host?.name ?? '加载中…'}</h2>
                {host ? <EnvBadge env={host.env} /> : null}
                {host ? <StatusBadge status={host.status} /> : null}
              </div>
              <div className="mt-0.5 text-[11.5px] text-[var(--ink-3)]">
                {host ? `${host.sshUser}@${host.address}:${host.port} · ${host.provider ?? '未填写供应商'} · ${host.group ?? '未分组'}` : ' '}
              </div>
            </div>
            <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {readOnly ? null : (
              <Button
                size="sm"
                disabled={!host}
                onClick={() =>
                  navigate(
                    `/terminal?hostId=${encodeURIComponent(hostId ?? '')}${
                      authChoice === AUTO_AUTH ? '' : `&credentialId=${encodeURIComponent(authChoice)}`
                    }`,
                  )
                }
              >
                <Terminal size={13} />
                打开终端
              </Button>
            )}
            {readOnly ? null : (
              <Button
                size="sm"
                variant="primary"
                disabled={probe.isPending || !host}
                onClick={() => probe.mutate()}
              >
                <Globe size={13} />
                {probe.isPending ? '探测中…' : '立即探测'}
              </Button>
            )}
            {readOnly || !selectableCredentials.length ? null : (
              <div className="w-[210px]">
                <Select
                  value={authChoice}
                  onValueChange={setAuthChoice}
                  disabled={!host || probe.isPending}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO_AUTH}>自动选择（主凭据优先）</SelectItem>
                    {selectableCredentials.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {authChoice === AUTO_AUTH ? null : (
            <p className="mt-1.5 text-[10.5px] text-[var(--warn)]">
              已手动指定凭据，本次探测/终端只尝试该凭据，不会自动回退。
            </p>
          )}
        </div>
        {host ? (
          <Tabs defaultValue="overview" key={host.id} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-none border-b border-[var(--line)] px-5">
              <TabsList className="mt-3 border-b-0">
                <TabsTrigger value="overview">概览</TabsTrigger>
                <TabsTrigger value="secrets">凭据与密钥</TabsTrigger>
                <TabsTrigger value="history">探测记录</TabsTrigger>
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
                <TabsContent value="overview" className="space-y-3 py-3">
                  <FactGrid
                    items={[
                      { label: '主机名', value: host.name },
                      { label: '操作系统', value: host.os ?? '—' },
                      { label: '内核', value: [host.kernel, host.arch].filter(Boolean).join(' · ') || '—' },
                      {
                        label: 'CPU',
                        value: `${host.cpuModel ?? '未知型号'}${host.cpuCores ? ` · ${host.cpuCores} 核` : ''}`,
                      },
                      { label: '内存', value: host.memTotalMb ? `${Math.round(host.memTotalMb / 1024)} GB` : '—' },
                      {
                        label: '磁盘',
                        value: host.disks?.length
                          ? host.disks.map((d) => `${d.mount} ${d.usePct}%`).join(' / ')
                          : '—',
                      },
                      { label: 'IP 地址', value: (host.ips ?? []).map((i) => i.address).join(' / ') || '—' },
                      { label: '负载（1/5/15）', value: host.loadAvg ?? '—' },
                      { label: '运行时长', value: host.uptimeSec ? `${Math.floor(host.uptimeSec / 86400)} 天` : '—' },
                      { label: '虚拟化', value: host.virtualization ?? '—' },
                      { label: 'Docker 容器', value: host.containers === null ? '—' : `${host.containers} 个` },
                      { label: '最近探测', value: host.lastProbeAt ? `${formatRelative(host.lastProbeAt)} · ${host.probeOk ? '成功' : '失败'}` : '尚未探测' },
                    ]}
                  />
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <h4 className="text-[12.5px] font-semibold">手动维护</h4>
                      <Badge tone="warn">不可自动探测</Badge>
                    </div>
                    <ManualFields key={host.id} host={host} readOnly={readOnly} />
                  </div>
                </TabsContent>
                <TabsContent value="secrets" className="space-y-3 py-3">
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <h4 className="text-[12.5px] font-semibold">关联凭据</h4>
                      <Badge tone="neutral">{links.length || relatedCredentials.length} 个</Badge>
                      <Button size="sm" className="ml-auto" onClick={() => navigate('/credentials')}>
                        管理凭据
                      </Button>
                    </div>
                    {links.length ? (
                      <div className="space-y-1.5">
                        {links.map((link) => {
                          const primary = link.role === 'primary';
                          const checkable = link.type === 'password' || link.type === 'ssh_key';
                          const state = link.lastCheckOk === null ? 'unchecked' : link.lastCheckOk ? 'ok' : 'bad';
                          return (
                            <div key={link.id} className="glass-inset px-3 py-2">
                              <div className="flex items-center gap-2.5">
                                <KeyRound size={14} className="shrink-0 text-[var(--ink-3)]" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="truncate text-[12.5px]">{link.name}</span>
                                    {primary ? <Badge tone="brand">主凭据</Badge> : null}
                                    {state === 'ok' ? <Badge tone="ok">可用</Badge> : null}
                                    {state === 'bad' ? <Badge tone="bad">失效</Badge> : null}
                                    {state === 'unchecked' ? <Badge tone="neutral">未检测</Badge> : null}
                                  </div>
                                  {state === 'bad' && link.lastCheckError ? (
                                    <div className="mt-0.5 line-clamp-2 text-[10.5px] text-[var(--bad)]">{link.lastCheckError}</div>
                                  ) : null}
                                  <div className="text-[10.5px] text-[var(--ink-3)]">
                                    {link.type === 'password' ? '密码' : link.type === 'ssh_key' ? 'SSH 私钥' : link.type}
                                    {link.lastCheckedAt ? ` · 检测于 ${formatRelative(link.lastCheckedAt)}` : ''}
                                  </div>
                                </div>
                                {link.strength ? <StrengthBadge strength={link.strength} /> : null}
                              </div>
                              {readOnly ? null : checkable ? (
                                <div className="mt-1.5 flex justify-end gap-1.5">
                                  <Button
                                    size="sm"
                                   disabled={testingLink === link.id}
                                    onClick={() => testCredential.mutate(link.id)}
                                  >
                                    <ShieldCheck size={12} />
                                    检测
                                  </Button>
                                  {primary ? null : (
                                    <Button
                                      size="sm"
                                      disabled={setPrimary.isPending}
                                      onClick={() => setPrimary.mutate(link.id)}
                                    >
                                      <Star size={12} />
                                      设为主凭据
                                    </Button>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : relatedCredentials.length ? (
                      <div className="space-y-1.5">
                        {relatedCredentials.map((c) => (
                          <div key={c.id} className="glass-inset flex items-center gap-2.5 px-3 py-2">
                            <KeyRound size={14} className="text-[var(--ink-3)]" />
                            <div className="min-w-0">
                              <div className="truncate text-[12.5px]">{c.name}</div>
                              <div className="text-[10.5px] text-[var(--ink-3)]">
                                更新于 {formatDateTime(c.updatedAt)} · 关联 {c.hostCount} 台
                              </div>
                            </div>
                            {c.strength ? (
                              <div className="ml-auto">
                                <StrengthBadge strength={c.strength} />
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Callout>尚未关联凭据。可在凭据保险库中创建并关联到该服务器。</Callout>
                    )}
                    {links.length ? (
                      <p className="mt-1.5 text-[10.5px] text-[var(--ink-3)]">
                        连接时按「主机密钥对 → 主凭据 → 其余关联凭据」顺序自动尝试；失效凭据会被跳过并在上方标注。
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <h4 className="text-[12.5px] font-semibold">公钥部署</h4>
                      {relatedKeypair ? <Badge tone="ok">已关联</Badge> : <Badge tone="neutral">未关联</Badge>}
                    </div>
                    {relatedKeypair ? (
                      <div className="glass-inset flex flex-wrap items-center gap-2.5 px-3 py-2">
                        <KeyRound size={14} className="text-[var(--ink-3)]" />
                        <div className="min-w-0">
                          <div className="truncate text-[12.5px]">{relatedKeypair.name}</div>
                          <div className="mono truncate text-[10.5px] text-[var(--ink-3)]">{relatedKeypair.fingerprint}</div>
                        </div>
                        <div className="ml-auto flex gap-1.5">
                          <Button
                            size="sm"
                            disabled={connect.isPending}
                            onClick={() => connect.mutate(relatedKeypair)}
                          >
                            <Terminal size={12} />
                            连接命令
                          </Button>
                          <Button size="sm" onClick={() => navigate('/keypairs')}>
                            <ExternalLink size={12} />
                            重新部署
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Callout>未部署管理密钥，密钥登录不可用。</Callout>
                        <Button size="sm" className="shrink-0" onClick={() => navigate('/keypairs')}>
                          <Plus size={12} />
                          前往密钥对
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="history" className="py-3">
                  {snapshots.isLoading ? (
                    <div className="skeleton h-16 w-full" />
                  ) : snapshots.data?.length ? (
                    <div className="divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)]">
                      {snapshots.data.map((s) => (
                        <div key={s.id} className="flex items-start gap-2.5 px-3 py-2">
                          <span
                            className={`dot ${s.status === 'offline' ? 'dot-bad' : s.status === 'warning' ? 'dot-warn' : 'dot-ok'}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] text-[var(--ink-2)]">
                              {s.status === 'offline' ? '探测失败' : s.status === 'warning' ? '探测部分成功' : '探测成功'}
                              {s.error && s.status !== 'offline' ? ` · ${s.error}` : ''}
                            </div>
                            {s.error && s.status === 'offline' ? (
                              <div className="mt-0.5 text-[11px] text-[var(--bad)]">{s.error}</div>
                            ) : null}
                            {s.facts && typeof s.facts === 'object' ? (
                              <div className="text-[10.5px] text-[var(--ink-3)]">
                                {Object.keys(s.facts as Record<string, unknown>).length} 项字段
                              </div>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-[10.5px] text-[var(--ink-3)]">{formatDateTime(s.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="还没有探测记录" description="点击上方「立即探测」开始第一次采集。" />
                  )}
                </TabsContent>
              </div>
            </Tabs>
          ) : hostQuery.isError ? (
            <div className="py-6">
              <Callout tone="warn">服务器详情加载失败：{(hostQuery.error as ApiError).message}</Callout>
            </div>
          ) : (
            <div className="space-y-2 py-6">
              <div className="skeleton h-6 w-1/2" />
              <div className="skeleton h-24 w-full" />
            </div>
          )}
        {host ? (
          <div className="mt-auto flex flex-none items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
            <span className="text-[11px] text-[var(--ink-3)]">创建于 {formatDateTime(host.createdAt)}</span>
            {readOnly ? null : (
              <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} />
                删除服务器
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除服务器"
        message={`确定删除「${host?.name ?? ''}」？该操作不可恢复，探测快照与凭据关联将一并移除。`}
        confirmLabel="删除"
        danger
        onConfirm={async () => {
          await remove.mutateAsync();
        }}
      />

      <Modal
        open={!!quick}
        onOpenChange={(o) => !o && setQuick(null)}
        title={`连接命令 · ${quick?.keyName ?? ''}`}
        wide
        footer={
          <>
            <Button onClick={() => setQuick(null)}>关闭</Button>
            {/* CopyButton 在正文内提供复制 */}
          </>
        }
      >
        {quick ? (
          <div className="space-y-3">
            <Callout icon={<Terminal size={14} className="mt-[2px] shrink-0" />}>
              {quick.deployed ? '公钥已部署到 ' : '公钥尚未确认部署到 '}
              <b>{quick.hostName}</b>（{quick.sshUser}@{quick.address}:{quick.port}）。命令不包含任何密钥内容。
            </Callout>
            <div>
              <div className="mb-1 flex items-center gap-2 text-[11.5px] text-[var(--ink-3)]">
                SSH 登录
                <CopyButton text={quick.ssh} className="ml-auto" />
              </div>
              <div className="code-block">{quick.ssh}</div>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-2 text-[11.5px] text-[var(--ink-3)]">
                SCP 上传
                <CopyButton text={quick.scp} className="ml-auto" />
              </div>
              <div className="code-block">{quick.scp}</div>
            </div>
          </div>
        ) : null}
      </Modal>
    </Drawer>
  );
}

