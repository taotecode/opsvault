import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, Download } from 'lucide-react';
import { api } from '@/lib/api';
import type { Keypair } from '@/types';
import { Modal } from '@/components/ui/modal';
import { Button, Input } from '@/components/ui/controls';
import { Checkbox } from '@/components/ui/fields';
import { Callout, CopyButton } from '@/components/common/primitives';
import { cn } from '@/lib/utils';
import { downloadText, toastApiError } from './keypair-utils';

const schema = z.object({
  name: z.string().trim().min(1, '请输入名称'),
  algorithm: z.enum(['Ed25519', 'RSA-4096']),
});
type Values = z.infer<typeof schema>;

export function GenerateKeypairModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [result, setResult] = useState<(Keypair & { privateKey: string }) | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', algorithm: 'Ed25519' } });
  const algorithm = form.watch('algorithm');

  useEffect(() => {
    if (!open) {
      setResult(null);
      setConfirmed(false);
      form.reset();
    }
  }, [open, form]);

  const close = (next: boolean) => {
    if (!next) {
      setResult(null);
      setConfirmed(false);
    }
    onOpenChange(next);
  };

  const submit = form.handleSubmit(async (values) => {
    try {
      const res = await api.post<Keypair & { privateKey: string }>('/api/v1/keypairs/generate', values);
      onCreated();
      if (!openRef.current) return; // 关闭后不保留私钥
      setResult(res);
      setConfirmed(false);
    } catch (e) {
      toastApiError(e, '生成密钥对失败');
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={close}
      wide
      title={result ? '密钥对已生成' : '生成密钥对'}
      footer={
        result ? (
          <Button variant="primary" disabled={!confirmed} onClick={() => close(false)}>
            完成
          </Button>
        ) : (
          <>
            <Button onClick={() => close(false)}>取消</Button>
            <Button variant="primary" disabled={form.formState.isSubmitting} onClick={() => void submit()}>
              <KeyRound size={13} />生成
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">名称</label>
            <Input placeholder="例如 deploy-2027" autoFocus {...form.register('name')} />
            {form.formState.errors.name ? <p className="mt-1 text-[11px] text-[var(--bad)]">{form.formState.errors.name.message}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">算法</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['Ed25519', '推荐', '更短、更快，现代服务器首选（OpenSSH 6.5+）'],
                ['RSA-4096', '兼容', '兼容老旧服务器的保守选择，生成较慢'],
              ] as const).map(([algo, tag, desc]) => (
                <button
                  key={algo}
                  type="button"
                  onClick={() => form.setValue('algorithm', algo, { shouldValidate: true })}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors',
                    algorithm === algo
                      ? 'border-[var(--brand)] bg-[var(--brand-dim)]'
                      : 'border-[var(--glass-border)] bg-[var(--field)] hover:border-[var(--line-strong)]',
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                    {algo}<span className="badge badge-neutral">{tag}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--ink-3)]">{desc}</div>
                </button>
              ))}
            </div>
          </div>
          <Callout tone="warn">私钥只在生成后显示一次，关闭窗口后无法再次查看；请提前准备安全保存位置。</Callout>
        </div>
      ) : (
        <div className="space-y-3">
          <Callout tone="warn">私钥仅显示这一次。关闭后无法再次查看，只能重新生成或从备份恢复。</Callout>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11.5px] text-[var(--ink-3)]">公钥（可公开分发）</label>
              <div className="flex gap-1.5">
                <CopyButton text={result.publicKey} label="复制公钥" />
                <Button size="sm" onClick={() => downloadText(`${result.name}.pub`, result.publicKey)}>
                  <Download size={13} />下载 .pub
                </Button>
              </div>
            </div>
            <pre className="code-block max-h-[110px] overflow-auto">{result.publicKey}</pre>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11.5px] text-[var(--bad)]">私钥（仅此一次显示，请勿泄露）</label>
              <div className="flex gap-1.5">
                <CopyButton text={result.privateKey} label="复制私钥" sensitive />
                <Button size="sm" onClick={() => downloadText(`${result.name}.pem`, result.privateKey)}>
                  <Download size={13} />下载 .pem
                </Button>
              </div>
            </div>
            <pre
              className="code-block max-h-[180px] overflow-auto"
              style={{ borderColor: 'color-mix(in srgb, var(--bad) 40%, transparent)', background: 'color-mix(in srgb, var(--bad) 7%, transparent)' }}
            >
              {result.privateKey}
            </pre>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-[12px] text-[var(--ink-2)]">
            <Checkbox checked={confirmed} onCheckedChange={setConfirmed} />
            <span>我已将私钥保存到安全位置，并理解关闭后无法再次查看</span>
          </label>
        </div>
      )}
    </Modal>
  );
}
