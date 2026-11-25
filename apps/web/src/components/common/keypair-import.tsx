import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Upload } from 'lucide-react';
import { api } from '@/lib/api';
import type { Keypair } from '@/types';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Button, Input, Textarea } from '@/components/ui/controls';
import { Callout } from '@/components/common/primitives';
import { toastApiError } from './keypair-utils';

const schema = z.object({
  name: z.string().trim().min(1, '请输入名称'),
  keyText: z.string().trim().min(1, '请粘贴或上传密钥内容'),
  passphrase: z.string().optional(),
});
type Values = z.infer<typeof schema>;

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function ImportKeypairModal({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', keyText: '', passphrase: '' } });

  useEffect(() => {
    form.reset();
  }, [open, form]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await readAsText(file);
      form.setValue('keyText', text, { shouldValidate: true, shouldDirty: true });
      if (!form.getValues('name').trim()) {
        form.setValue('name', file.name.replace(/\.(pem|key|pub|txt)$/i, '') || file.name);
      }
    } catch {
      toast.error('文件读取失败', { description: '请重试或直接粘贴密钥内容' });
    }
  };

  const submit = form.handleSubmit(async (values) => {
    const isPrivate = /PRIVATE KEY/.test(values.keyText);
    const payload: Record<string, string> = { name: values.name };
    if (isPrivate) {
      payload.privateKey = values.keyText;
      if (values.passphrase) payload.passphrase = values.passphrase;
    } else {
      payload.publicKey = values.keyText;
    }
    try {
      const res = await api.post<Keypair>('/api/v1/keypairs/import', payload);
      toast.success('密钥已导入', { description: `${res.name} · ${res.algorithm}${res.hasPrivate ? '' : '（仅公钥）'}` });
      onImported();
      onOpenChange(false);
    } catch (e) {
      toastApiError(e, '导入失败：无法解析密钥');
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="导入已有密钥"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={form.formState.isSubmitting} onClick={() => void submit()}>
            <Upload size={13} />保存到密钥库
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">名称</label>
          <Input placeholder="例如 laptop-lin-ed25519" {...form.register('name')} />
          {form.formState.errors.name ? <p className="mt-1 text-[11px] text-[var(--bad)]">{form.formState.errors.name.message}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">上传密钥文件（.pem / .key / .pub）</label>
          <input
            type="file"
            accept=".pem,.key,.pub,.txt"
            className="field h-auto py-1.5"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">或直接粘贴内容</label>
          <Textarea
            rows={5}
            className="font-mono text-[11.5px]"
            placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…'}
            {...form.register('keyText')}
          />
          {form.formState.errors.keyText ? <p className="mt-1 text-[11px] text-[var(--bad)]">{form.formState.errors.keyText.message}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">私钥口令（可选）</label>
          <Input type="password" placeholder="仅私钥带口令时填写" {...form.register('passphrase')} />
        </div>
        <Callout>
          服务端使用 ssh2 严格解析并重新加密存储；支持私钥或仅公钥。仅公钥条目可部署，但不能做私钥认证检测或导出私钥。
        </Callout>
      </div>
    </Modal>
  );
}
