import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { z } from 'zod';
import { api } from '@/lib/api';
import { toastError } from '@/lib/format';
import type { Credential, Host } from '@/types';
import { Modal } from '@/components/ui/modal';
import { Button, Input, Textarea } from '@/components/ui/controls';
import { Checkbox } from '@/components/ui/fields';
import { Callout } from './primitives';

const editForm = z.object({
  name: z.string().trim().min(1, '请输入名称').max(120),
  value: z.string().max(100_000).optional(),
  hostIds: z.array(z.string()),
});
type EditInput = z.input<typeof editForm>;
type EditOutput = z.output<typeof editForm>;

const TYPE_LABEL: Record<Credential['type'], string> = {
  password: '密码',
  ssh_key: 'SSH 私钥',
  api_token: 'API 令牌',
  certificate: '证书',
  custom: '自定义',
};

/** 编辑凭据：改名、按需轮换内容（不勾选则保持原值）、调整关联主机。 */
export function CredentialEditDialog({
  credential,
  onOpenChange,
}: {
  credential: Credential | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const open = !!credential;
  const [rotate, setRotate] = useState(false);
  const hostsQuery = useQuery({
    queryKey: ['hosts', 'for-credential-edit'],
    queryFn: () => api.get<Host[]>('/api/v1/hosts?limit=200'),
    enabled: open,
  });
  const form = useForm<EditInput, unknown, EditOutput>({
    resolver: zodResolver(editForm),
    defaultValues: { name: '', value: '', hostIds: [] },
  });

  useEffect(() => {
    if (!credential) return;
    const known = credential.hostIds ?? [];
    const matched = known.length
      ? known
      : (hostsQuery.data ?? [])
          .filter((h) => credential.hosts.includes(h.name))
          .map((h) => h.id);
    form.reset({ name: credential.name, value: '', hostIds: matched });
    setRotate(false);
  }, [credential, hostsQuery.data, form]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Credential>(`/api/v1/credentials/${credential!.id}`, body),
  });

  const submit = form.handleSubmit(async (values) => {
    if (rotate && !values.value?.trim()) {
      toast.error('已勾选轮换内容，请输入新的凭据内容');
      return;
    }
    const body: Record<string, unknown> = { name: values.name, hostIds: values.hostIds };
    if (rotate && values.value?.trim()) body.value = values.value;
    try {
      await save.mutateAsync(body);
      await queryClient.invalidateQueries({ queryKey: ['credentials'] });
      await queryClient.invalidateQueries({ queryKey: ['hosts'] });
      await queryClient.invalidateQueries({ queryKey: ['audit'] });
      toast.success('凭据已更新', { description: rotate ? `${values.name} · 内容已轮换` : values.name });
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    }
  });

  const hosts = hostsQuery.data ?? [];
  const hostIds = form.watch('hostIds') ?? [];
  const toggleHost = (id: string) => {
    const next = hostIds.includes(id) ? hostIds.filter((x) => x !== id) : [...hostIds, id];
    form.setValue('hostIds', next, { shouldDirty: true });
  };

  if (!credential) return null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`编辑凭据 · ${credential.name}`}
      footer={
        <>
          <Button type="button" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" variant="primary" disabled={save.isPending} onClick={() => void submit()}>
            {save.isPending ? '保存中…' : '保存更改'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Callout>
          类型：{TYPE_LABEL[credential.type]} · 更新人 {credential.updatedBy}。轮换内容后，各关联主机的「可用状态」会重置为未检测。
        </Callout>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          名称
          <Input {...form.register('name')} className="mt-1" autoFocus />
          {form.formState.errors.name ? <span className="text-[11px] text-[var(--bad)]">{form.formState.errors.name.message}</span> : null}
        </label>
        <div>
          <label className="flex cursor-pointer items-center gap-2 text-[12px]">
            <Checkbox
              checked={rotate}
              onCheckedChange={(v) => {
                setRotate(v);
                form.setValue('value', '');
              }}
            />
            轮换内容（输入新的{credential.type === 'password' ? '密码' : '凭据内容'}）
          </label>
          {rotate ? (
            <div className="mt-2 space-y-2">
              <Textarea {...form.register('value')} rows={4} placeholder="粘贴新的凭据内容；保存后旧值即被覆盖" />
              <div className="flex items-center gap-2 text-[11px] text-[var(--ink-3)]">
                <RefreshCw size={12} />
                <span>记得在服务器侧同步修改，然后点「检测」确认可用。</span>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-[var(--ink-3)]">内容保持不变；如需修改请勾选轮换。</p>
          )}
        </div>
        <div>
          <div className="mb-1 text-[11.5px] text-[var(--ink-3)]">关联服务器（{hostIds.length} 台）</div>
          <div className="max-h-[160px] space-y-0.5 overflow-auto rounded-[8px] border border-[var(--glass-border)] p-2">
            {hosts.map((host) => (
              <label key={host.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12px] hover:bg-[var(--panel-2)]">
                <Checkbox checked={hostIds.includes(host.id)} onCheckedChange={() => toggleHost(host.id)} />
                <span className="truncate">{host.name}</span>
                <span className="mono ml-auto shrink-0 text-[10.5px] text-[var(--ink-3)]">{host.address}</span>
              </label>
            ))}
            {!hosts.length ? <p className="px-1 py-2 text-[11.5px] text-[var(--ink-3)]">暂无服务器。</p> : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
