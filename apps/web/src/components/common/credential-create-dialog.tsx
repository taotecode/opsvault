import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { z } from 'zod';
import { credentialCreateSchema } from '@boerfen/shared';
import { api } from '@/lib/api';
import { toastError } from '@/lib/format';
import type { Credential, Host } from '@/types';
import { Modal } from '@/components/ui/modal';
import { Button, Input, Textarea } from '@/components/ui/controls';
import { Checkbox } from '@/components/ui/fields';
import { StrengthBadge } from './badges';

const CRED_CREATE_TYPES: Array<{ value: Credential['type']; label: string }> = [
  { value: 'password', label: '密码' },
  { value: 'ssh_key', label: 'SSH 私钥' },
  { value: 'api_token', label: 'API 令牌' },
  { value: 'certificate', label: '证书' },
  { value: 'custom', label: '自定义' },
];
const CRED_CREATE_PLACEHOLDER: Record<string, string> = {
  password: '粘贴或生成密码…',
  ssh_key: '-----BEGIN OPENSSH PRIVATE KEY-----',
  api_token: '粘贴 API Token…',
  certificate: '-----BEGIN CERTIFICATE-----',
  custom: '粘贴凭据内容…',
};
const CRED_STRENGTH_LABEL = { strong: '强', medium: '中', weak: '弱' } as const;
const credCreateForm = credentialCreateSchema;
type CredCreateInput = z.input<typeof credCreateForm>;
type CredCreateOutput = z.output<typeof credCreateForm>;
const CRED_CREATE_DEFAULTS: CredCreateInput = { name: '', type: 'password', value: '', hostIds: [] };

export function CredentialCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [generated, setGenerated] = useState<{ password: string; strength: 'strong' | 'medium' | 'weak' } | null>(null);
  const form = useForm<CredCreateInput, unknown, CredCreateOutput>({
    resolver: zodResolver(credCreateForm),
    defaultValues: CRED_CREATE_DEFAULTS,
  });
  useEffect(() => {
    if (open) {
      form.reset(CRED_CREATE_DEFAULTS);
      setGenerated(null);
    }
  }, [open, form]);
  const hostsQuery = useQuery({
    queryKey: ['hosts'],
    queryFn: () => api.get<Host[]>('/api/v1/hosts?limit=200'),
    enabled: open,
  });
  const generate = useMutation({
    mutationFn: () =>
      api.post<{ password: string; strength: 'strong' | 'medium' | 'weak' }>(
        '/api/v1/credentials/generate-password',
        { length: 24, uppercase: true, lowercase: true, digits: true, symbols: true },
      ),
    onSuccess: (res) => {
      form.setValue('value', res.password, { shouldValidate: true, shouldDirty: true });
      setGenerated(res);
      toast.success('已生成强密码', { description: `长度 24 · 强度：${CRED_STRENGTH_LABEL[res.strength]}` });
    },
    onError: toastError,
  });
  const create = useMutation({
    mutationFn: (input: CredCreateOutput) => api.post<Credential>('/api/v1/credentials', input),
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync({ ...values, hostIds: values.hostIds?.length ? values.hostIds : undefined });
      await queryClient.invalidateQueries({ queryKey: ['credentials'] });
      await queryClient.invalidateQueries({ queryKey: ['hosts'] });
      await queryClient.invalidateQueries({ queryKey: ['audit'] });
      toast.success('凭据已保存', { description: `${CRED_CREATE_TYPES.find((t) => t.value === values.type)?.label ?? values.type} · ${values.name}` });
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    }
  });
  const type = form.watch('type');
  const value = form.watch('value');
  const hostIds = form.watch('hostIds') ?? [];
  const toggleHost = (id: string) => {
    const current = form.getValues('hostIds') ?? [];
    form.setValue('hostIds', current.includes(id) ? current.filter((x) => x !== id) : [...current, id], {
      shouldDirty: true,
    });
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="新建凭据"
      footer={
        <>
          <Button type="button" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" variant="primary" disabled={create.isPending} onClick={() => void submit()}>
            {create.isPending ? '保存中…' : '保存凭据'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-[11.5px] text-[var(--ink-3)]">类型</div>
          <div className="chips">
            {CRED_CREATE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`chip ${type === t.value ? 'chip-active' : ''}`}
                onClick={() => form.setValue('type', t.value, { shouldValidate: true })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          名称
          <Input {...form.register('name')} className="mt-1" placeholder="例如 prod-db-root" autoFocus />
          {form.formState.errors.name ? <span className="text-[11px] text-[var(--bad)]">请输入名称</span> : null}
        </label>
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--ink-3)]">
            内容
            {type === 'password' ? (
              <>
                <Button type="button" size="sm" disabled={generate.isPending} onClick={() => generate.mutate()}>
                  <Sparkles size={12} />
                  {generate.isPending ? '生成中…' : '生成密码'}
                </Button>
                <span className="text-[10.5px]">长度 24 · 四类字符</span>
                {generated && value === generated.password ? <StrengthBadge strength={generated.strength} /> : null}
              </>
            ) : null}
          </div>
          <Textarea {...form.register('value')} rows={4} placeholder={CRED_CREATE_PLACEHOLDER[type] ?? '粘贴凭据内容'} />
          <p className="mt-1 text-[10.5px] text-[var(--ink-3)]">内容以 AES-256-GCM 加密存储，列表中始终脱敏。</p>
          {form.formState.errors.value ? <span className="text-[11px] text-[var(--bad)]">请输入凭据内容</span> : null}
        </div>
        <div>
          <div className="mb-1 text-[11.5px] text-[var(--ink-3)]">关联服务器（可选，{hostIds.length} 台）</div>
          <div className="max-h-[140px] space-y-0.5 overflow-auto rounded-[8px] border border-[var(--glass-border)] p-2">
            {(hostsQuery.data ?? []).map((host) => (
              <label key={host.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12px] hover:bg-[var(--panel-2)]">
                <Checkbox checked={hostIds.includes(host.id)} onCheckedChange={() => toggleHost(host.id)} />
                <span className="truncate">{host.name}</span>
                <span className="mono ml-auto shrink-0 text-[10.5px] text-[var(--ink-3)]">{host.address}</span>
              </label>
            ))}
            {!(hostsQuery.data ?? []).length ? <p className="px-1 py-2 text-[11.5px] text-[var(--ink-3)]">暂无服务器。</p> : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
