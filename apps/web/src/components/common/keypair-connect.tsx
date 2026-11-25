import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Lock } from 'lucide-react';
import { api, downloadFile, type ApiError } from '@/lib/api';
import type { Host, Keypair, QuickConnect } from '@/types';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/controls';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/fields';
import { Callout, CopyButton, EmptyState } from '@/components/common/primitives';
import { toast } from 'sonner';
import { toastApiError } from './keypair-utils';

export function QuickConnectModal({
  open,
  onOpenChange,
  keypair,
  hosts,
  onDownload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keypair: Keypair;
  hosts: Host[];
  onDownload: (keypair: Keypair) => void;
}) {
  const [hostId, setHostId] = useState('');
  useEffect(() => {
    if (!open) return;
    setHostId(keypair.hosts.at(0)?.hostId ?? hosts.at(0)?.id ?? '');
  }, [open, keypair.id, hosts.length]);

  const query = useQuery<QuickConnect, ApiError>({
    queryKey: ['quick-connect', keypair.id, hostId],
    enabled: open && !!hostId,
    retry: false,
    queryFn: async () => {
      try {
        return await api.get<QuickConnect>(`/api/v1/keypairs/${keypair.id}/connect-command?hostId=${encodeURIComponent(hostId)}`);
      } catch (e) {
        toastApiError(e, '获取连接命令失败');
        throw e;
      }
    },
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`快速连接 · ${keypair.name}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={() => onDownload(keypair)}>
            <Download size={13} />下载密钥
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {hosts.length ? (
          <>
            <div>
              <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">目标服务器</label>
              <div className="w-full sm:w-[320px]">
                <Select value={hostId} onValueChange={setHostId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择主机" />
                  </SelectTrigger>
                  <SelectContent>
                    {hosts.map((h) => {
                      const deployed = keypair.hosts.some((d) => d.hostId === h.id);
                      return (
                        <SelectItem key={h.id} value={h.id}>
                          {h.name} · {h.address}{deployed ? ' · 已部署' : ''}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {query.isLoading ? <div className="skeleton h-24 w-full" /> : null}
            {query.error ? <Callout tone="warn">{query.error.message}{query.error.hint ? `（${query.error.hint}）` : ''}</Callout> : null}
            {query.data ? (
              <>
                <Callout tone={query.data.deployed ? 'ok' : 'warn'}>
                  {query.data.deployed
                    ? '该主机已部署此公钥，下载私钥后即可直接连接。'
                    : '该主机尚未部署此公钥，请先在「部署」中写入 authorized_keys，否则认证会失败。'}
                </Callout>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[11.5px] text-[var(--ink-3)]">SSH 登录</label>
                    <CopyButton text={query.data.ssh} />
                  </div>
                  <pre className="code-block">{query.data.ssh}</pre>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[11.5px] text-[var(--ink-3)]">SCP 上传示例</label>
                    <CopyButton text={query.data.scp} />
                  </div>
                  <pre className="code-block">{query.data.scp}</pre>
                </div>
                <div className="text-[11px] leading-relaxed text-[var(--ink-3)]">
                  私钥保存为 <span className="mono">~/.ssh/{query.data.keyFile}</span> 后执行
                  <span className="mono"> chmod 600 ~/.ssh/{query.data.keyFile}</span>。命令只包含地址、端口与用户名，不含任何密钥内容。
                </div>
              </>
            ) : null}
          </>
        ) : (
          <EmptyState title="还没有服务器" description="先添加服务器并部署公钥后，才能生成连接命令。" />
        )}
      </div>
    </Modal>
  );
}

export function DownloadKeyModal({
  open,
  onOpenChange,
  keypair,
  onRequestPrivate,
  canDownloadPrivate = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keypair: Keypair | null;
  onRequestPrivate: (keypair: Keypair) => void;
  canDownloadPrivate?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  const downloadPublic = async () => {
    if (!keypair) return;
    setBusy(true);
    try {
      await downloadFile(`/api/v1/keypairs/${keypair.id}/public-key`, 'GET');
      toast.success('公钥已开始下载', { description: `${keypair.name}.pub` });
    } catch (e) {
      toastApiError(e, '公钥下载失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`下载密钥 · ${keypair?.name ?? ''}`}
      footer={<Button onClick={() => onOpenChange(false)}>关闭</Button>}
    >
      <div className="space-y-4">
        <Callout>公钥可随时下载；私钥导出需要重新验证账号密码，并写入审计日志。</Callout>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11.5px] text-[var(--ink-3)]">公钥（.pub）</label>
            <Button size="sm" disabled={busy} onClick={() => void downloadPublic()}>
              <Download size={13} />下载公钥
            </Button>
          </div>
          <pre className="code-block max-h-[90px] overflow-auto">{keypair?.publicKey}</pre>
        </div>
        {canDownloadPrivate ? (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11.5px] text-[var(--ink-3)]">私钥（.pem）</label>
              <Button
                size="sm"
                variant="danger"
                disabled={!keypair?.hasPrivate}
                onClick={() => {
                  if (!keypair) return;
                  onOpenChange(false);
                  onRequestPrivate(keypair);
                }}
              >
                <Lock size={13} />验证并下载私钥
              </Button>
            </div>
            {keypair?.hasPrivate ? (
              <Callout tone="warn">私钥下载将记录审计；下载后请立即存入密码管理器并执行 chmod 600。</Callout>
            ) : (
              <Callout>该条目仅含公钥，无法导出私钥。</Callout>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
