import { useEffect, useState } from 'react';
import { Server, ShieldCheck, Check } from 'lucide-react';
import { api, type ApiError } from '@/lib/api';
import type { Host, Keypair } from '@/types';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/controls';
import { Checkbox } from '@/components/ui/fields';
import { StatusBadge } from '@/components/common/badges';
import { Callout, EmptyState } from '@/components/common/primitives';
import { toast } from 'sonner';
import { toastApiError } from './keypair-utils';

interface HostResult {
  hostId: string;
  hostName: string;
  ok: boolean;
  error?: string;
}

export function DeployKeypairModal({
  open,
  onOpenChange,
  keypair,
  hosts,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keypair: Keypair;
  hosts: Host[];
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setBusy(false);
    }
  }, [open]);

  const toggle = (hostId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) next.delete(hostId);
      else next.add(hostId);
      return next;
    });
  };

  const deploy = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      const results = await api.post<HostResult[]>(`/api/v1/keypairs/${keypair.id}/deploy`, {
        hostIds: Array.from(selected),
      });
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      const message = `${ok} 成功${fail ? ` · ${fail} 失败` : ''}`;
      if (fail) toast.error('部署完成，但存在失败', { description: message });
      else toast.success('公钥部署完成', { description: message });
      setSelected(new Set());
      onDone();
      onOpenChange(false);
    } catch (e) {
      toastApiError(e, '部署公钥失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`部署公钥 · ${keypair.name}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={busy || selected.size === 0} onClick={() => void deploy()}>
            <Server size={13} />确认部署{selected.size ? `（${selected.size}）` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Callout>将公钥追加到目标服务器的 ~/.ssh/authorized_keys；重复部署不会产生重复条目。</Callout>
        {hosts.length ? (
          <div className="max-h-[320px] space-y-1 overflow-auto pr-1">
            {hosts.map((h) => {
              const deployed = keypair.hosts.some((d) => d.hostId === h.id);
              return (
                <label
                  key={h.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--glass-border)] bg-[var(--field)] px-3 py-2"
                >
                  <Checkbox checked={selected.has(h.id)} onCheckedChange={() => toggle(h.id)} />
                  <span className="min-w-0 truncate text-[12.5px]">{h.name}</span>
                  <span className="mono text-[11px] text-[var(--ink-3)]">{h.address}</span>
                  {deployed ? <span className="tag">已部署</span> : null}
                  <span className="ml-auto flex gap-1.5">
                    <StatusBadge status={h.status} />
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <EmptyState title="还没有服务器" description="请先在「服务器」页面添加主机并配置登录凭据。" />
        )}
      </div>
    </Modal>
  );
}

type HostState = 'pending' | 'running' | 'ok' | 'fail';

export function VerifyKeypairModal({
  open,
  onOpenChange,
  keypair,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keypair: Keypair;
  onDone: () => void;
}) {
  const [states, setStates] = useState<Record<string, { state: HostState; error?: string }>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setStates({});
      setBusy(false);
      return;
    }
    const init: Record<string, { state: HostState }> = {};
    for (const h of keypair.hosts) init[h.hostId] = { state: 'pending' };
    setStates(init);
  }, [open, keypair.id]);

  const run = async () => {
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const h of keypair.hosts) {
      setStates((prev) => ({ ...prev, [h.hostId]: { state: 'running' } }));
      try {
        const res = await api.post<HostResult[]>(`/api/v1/keypairs/${keypair.id}/verify`, { hostIds: [h.hostId] });
        const item = res.at(0);
        if (item?.ok) {
          ok += 1;
          setStates((prev) => ({ ...prev, [h.hostId]: { state: 'ok' } }));
        } else {
          fail += 1;
          setStates((prev) => ({ ...prev, [h.hostId]: { state: 'fail', error: item?.error ?? '认证失败' } }));
        }
      } catch (e) {
        fail += 1;
        const err = e as ApiError;
        setStates((prev) => ({ ...prev, [h.hostId]: { state: 'fail', error: err.message } }));
        toastApiError(e, '检测失败');
        break;
      }
    }
    setBusy(false);
    onDone();
    const summary = `${ok} 可用${fail ? ` · ${fail} 不可用` : ''}`;
    if (fail) toast.error('检测完成：存在失败', { description: summary });
    else toast.success('检测完成', { description: summary });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`检测密钥 · ${keypair.name}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
          <Button variant="primary" disabled={busy || keypair.hosts.length === 0} onClick={() => void run()}>
            <ShieldCheck size={13} />{busy ? '检测中…' : '开始检测'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Callout>使用私钥对已部署主机逐一尝试 SSH 认证，结果计入该密钥的验证状态并写审计日志。</Callout>
        {keypair.hosts.length ? (
          <div className="space-y-1">
            {keypair.hosts.map((h) => {
              const st = states[h.hostId]?.state ?? 'pending';
              return (
                <div
                  key={h.hostId}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--field)] px-3 py-2"
                >
                  <span className="text-[12.5px]">{h.hostName}</span>
                  <span className="mono text-[11px] text-[var(--ink-3)]">{h.hostId}</span>
                  <span className="ml-auto">
                    {st === 'pending' ? <span className="badge badge-neutral">待检测</span> : null}
                    {st === 'running' ? <span className="badge badge-info">检测中…</span> : null}
                    {st === 'ok' ? <span className="badge badge-ok"><Check size={11} />可用</span> : null}
                    {st === 'fail' ? <span className="badge badge-bad">不可用</span> : null}
                  </span>
                  {st === 'fail' && states[h.hostId]?.error ? (
                    <div className="w-full text-[11px] text-[var(--bad)]">{states[h.hostId]?.error}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="尚未部署到任何主机" description="先部署公钥，再进行可用性检测。" />
        )}
      </div>
    </Modal>
  );
}
