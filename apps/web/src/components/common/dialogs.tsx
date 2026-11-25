import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/modal';
import { Button, Input } from '@/components/ui/controls';
import { Callout } from './primitives';
import { toast } from 'sonner';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = '确认',
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[12.5px] leading-relaxed text-[var(--ink-2)]">{message}</p>
    </Modal>
  );
}

export function ReauthDialog({
  open,
  onOpenChange,
  target,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: string;
  onVerified: (revealUntil: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) setPassword('');
  }, [open]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="验证身份"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant="primary"
            disabled={busy || !password}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await api.post<{ revealUntil: string }>('/api/v1/auth/reveal', { password });
                onVerified(res.revealUntil);
                onOpenChange(false);
                toast.success('二次验证成功', { description: '5 分钟内可查看敏感内容' });
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            继续
          </Button>
        </>
      }
    >
      <Callout tone="warn">访问 {target} 属于敏感操作，将记录审计日志。</Callout>
      <div className="mt-3">
        <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">当前账号密码</label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="输入登录密码" autoFocus />
      </div>
    </Modal>
  );
}
