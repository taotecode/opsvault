import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, KeyRound, Plus, Server, ShieldCheck, TerminalSquare, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import type { Host, Keypair } from '@/types';
import { Button } from '@/components/ui/controls';
import { DataTable } from '@/components/common/data-table';
import { Badge } from '@/components/common/badges';
import { Callout, EmptyState, GlassPanel, PageHeader } from '@/components/common/primitives';
import { ConfirmDialog, ReauthDialog } from '@/components/common/dialogs';
import { GenerateKeypairModal } from '@/components/common/keypair-generate';
import { ImportKeypairModal } from '@/components/common/keypair-import';
import { DownloadKeyModal, QuickConnectModal } from '@/components/common/keypair-connect';
import { DeployKeypairModal, VerifyKeypairModal } from '@/components/common/keypair-deploy';
import { formatWhen, toastApiError } from '@/components/common/keypair-utils';

export function KeypairsPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const canWrite = !!me.data && me.data.user.role !== 'viewer';
  const keypairs = useQuery<Keypair[]>({
    queryKey: ['keypairs'],
    queryFn: () => api.get<Keypair[]>('/api/v1/keypairs'),
  });
  const hosts = useQuery<Host[]>({
    queryKey: ['hosts', 'keypairs'],
    queryFn: () => api.get<Host[]>('/api/v1/hosts?limit=200'),
  });
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [connectTarget, setConnectTarget] = useState<Keypair | null>(null);
  const [deployTarget, setDeployTarget] = useState<Keypair | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Keypair | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<Keypair | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Keypair | null>(null);
  const [pendingPrivate, setPendingPrivate] = useState<Keypair | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['keypairs'] });
    void queryClient.invalidateQueries({ queryKey: ['hosts'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
  };
  const hostTotal = hosts.data?.length ?? 0;

  const handleConnect = (kp: Keypair) => {
    if (!kp.deployed) {
      toast.info('该密钥尚未部署', { description: '连接命令仍可复制；部署公钥到目标主机后即可直接登录。' });
    }
    setConnectTarget(kp);
  };

  const handleVerify = (kp: Keypair) => {
    if (!kp.deployed) {
      toast.info('该密钥尚未部署', { description: '先在「部署」中将公钥写入目标服务器的 authorized_keys，再检测可用性。' });
      return;
    }
    if (!kp.hasPrivate) {
      toast.error('无法检测', { description: '该条目仅含公钥，不能进行私钥认证检测。' });
      return;
    }
    setVerifyTarget(kp);
  };

  const privateDownload = async (kp: Keypair) => {
    try {
      await downloadFile(`/api/v1/keypairs/${kp.id}/private-key`, 'POST');
      toast.success('私钥已开始下载', { description: `${kp.name}.pem · 请执行 chmod 600` });
    } catch (e) {
      toastApiError(e, '私钥下载失败');
    } finally {
      setPendingPrivate(null);
    }
  };

  const columns: ColumnDef<Keypair>[] = [
    {
      header: '名称',
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--line-strong)] bg-[var(--panel-2)] text-[var(--ink-3)]">
            <KeyRound size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
              <span className="truncate">{row.original.name}</span>
              {row.original.source === 'imported' ? <Badge tone="info">已导入</Badge> : null}
            </div>
            <div className="text-[11px] text-[var(--ink-3)]">
              {row.original.source === 'imported' ? '导入' : '创建'}于 {formatWhen(row.original.createdAt)}
              {row.original.createdBy ? ` · ${row.original.createdBy}` : ''}
            </div>
          </div>
        </div>
      ),
    },
    {
      header: '算法',
      cell: ({ row }) => (
        <Badge tone={row.original.algorithm === 'Ed25519' ? 'ok' : 'info'}>{row.original.algorithm}</Badge>
      ),
    },
    {
      header: '指纹',
      cell: ({ row }) => (
        <span className="mono inline-block max-w-[220px] truncate align-middle text-[11px] text-[var(--ink-3)]" title={row.original.fingerprint}>
          {row.original.fingerprint}
        </span>
      ),
    },
    {
      header: '部署与验证',
      cell: ({ row }) => {
        const kp = row.original;
        const pct = hostTotal ? Math.round((kp.deployed / hostTotal) * 100) : 0;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-[11.5px]">
              {kp.deployed}/{hostTotal || '—'}
            </span>
            <div className="h-1 w-12 overflow-hidden rounded bg-[var(--track)]">
              <i className="block h-full rounded bg-[var(--info)]" style={{ width: `${pct}%` }} />
            </div>
            {kp.failed > 0 ? (
              <Badge tone="warn">{kp.verified} 可用 · {kp.failed} 失败</Badge>
            ) : kp.verified > 0 ? (
              <Badge tone="ok">全部可用 {kp.verified}</Badge>
            ) : (
              <Badge>未验证</Badge>
            )}
          </div>
        );
      },
    },
    {
      header: '最近验证',
      cell: ({ row }) => (
        <span className="mono text-[11px] text-[var(--ink-3)]">{formatWhen(row.original.lastVerifiedAt)}</span>
      ),
    },
    {
      header: '操作',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const kp = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" type="button" title="查看 SSH / SCP 连接命令" onClick={() => handleConnect(kp)}>
              <TerminalSquare size={13} />连接
            </Button>
            {canWrite ? (
              <>
                <button type="button" className="icon-btn" title="检测密钥是否可用" onClick={() => handleVerify(kp)}>
                  <ShieldCheck size={15} />
                </button>
                <button type="button" className="icon-btn" title="部署公钥" onClick={() => setDeployTarget(kp)}>
                  <Server size={15} />
                </button>
              </>
            ) : null}
            <button type="button" className="icon-btn" title="下载密钥" onClick={() => setDownloadTarget(kp)}>
              <Download size={15} />
            </button>
            {canWrite ? (
              <button type="button" className="icon-btn" title="删除密钥对" onClick={() => setDeleteTarget(kp)}>
                <Trash2 size={15} />
              </button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="密钥对"
        sub="生成或导入 · 私钥仅一次 · 快速连接命令 · 可用性检测"
        actions={
          canWrite ? (
            <>
              <Button onClick={() => setImportOpen(true)}>
                <Upload size={14} />导入已有密钥
              </Button>
              <Button variant="primary" onClick={() => setGenerateOpen(true)}>
                <Plus size={14} />生成密钥对
              </Button>
            </>
          ) : undefined
        }
      />
      <GlassPanel className="overflow-hidden">
        {keypairs.isLoading ? (
          <div className="space-y-2 p-4">
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
          </div>
        ) : keypairs.error ? (
          <div className="p-4">
            <Callout tone="warn">加载密钥对失败：{keypairs.error.message}</Callout>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <DataTable
              data={keypairs.data ?? []}
              columns={columns}
              footer={<span>共 {keypairs.data?.length ?? 0} 个密钥对</span>}
              empty={
                <EmptyState
                  icon={<KeyRound size={18} />}
                  title="还没有密钥对"
                  description="生成一对新密钥，或导入已有的 .pem / .pub 文件。"
                />
              }
            />
          </div>
        )}
      </GlassPanel>
      <div className="mt-3.5">
        <Callout>
          私钥导出与下载需要二次验证并写审计；快速连接命令只包含主机、端口与用户名，不含任何密钥内容；仅公钥条目不能做私钥认证检测。
        </Callout>
      </div>

      <GenerateKeypairModal open={generateOpen} onOpenChange={setGenerateOpen} onCreated={refresh} />
      <ImportKeypairModal open={importOpen} onOpenChange={setImportOpen} onImported={refresh} />
      {connectTarget ? (
        <QuickConnectModal
          open
          onOpenChange={(open) => {
            if (!open) setConnectTarget(null);
          }}
          keypair={connectTarget}
          hosts={hosts.data ?? []}
          onDownload={(kp) => {
            setConnectTarget(null);
            setDownloadTarget(kp);
          }}
        />
      ) : null}
      {deployTarget ? (
        <DeployKeypairModal
          open
          onOpenChange={(open) => {
            if (!open) setDeployTarget(null);
          }}
          keypair={deployTarget}
          hosts={hosts.data ?? []}
          onDone={refresh}
        />
      ) : null}
      {verifyTarget ? (
        <VerifyKeypairModal
          open
          onOpenChange={(open) => {
            if (!open) setVerifyTarget(null);
          }}
          keypair={verifyTarget}
          onDone={refresh}
        />
      ) : null}
      <DownloadKeyModal
        open={!!downloadTarget}
        onOpenChange={(open) => {
          if (!open) setDownloadTarget(null);
        }}
        keypair={downloadTarget}
        canDownloadPrivate={canWrite}
        onRequestPrivate={(kp) => {
          setPendingPrivate(kp);
          setReauthOpen(true);
        }}
      />
      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        target={pendingPrivate ? `私钥「${pendingPrivate.name}」` : '私钥'}
        onVerified={() => {
          if (pendingPrivate) void privateDownload(pendingPrivate);
        }}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除密钥对"
        danger
        confirmLabel="删除密钥对"
        message={`删除「${deleteTarget?.name ?? ''}」后将无法再通过它登录已部署的服务器。请确认仍保留其他可用密钥。`}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await api.delete(`/api/v1/keypairs/${deleteTarget.id}`);
          toast.success('密钥对已删除', { description: deleteTarget.name });
          refresh();
        }}
      />
    </>
  );
}
