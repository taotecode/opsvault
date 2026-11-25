import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { Globe } from 'lucide-react';
import { hostCreateSchema } from '@boerfen/shared';
import { api } from '@/lib/api';
import { toastError } from '@/lib/format';
import type { Credential, Host, Keypair } from '@/types';
import { Modal } from '@/components/ui/modal';
import { Button, Input } from '@/components/ui/controls';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/fields';
import { Callout } from './primitives';

const hostFormSchema = hostCreateSchema.pick({
  name: true,
  address: true,
  port: true,
  sshUser: true,
  env: true,
  group: true,
  provider: true,
  credentialId: true,
  keypairId: true,
});
type HostFormInput = z.input<typeof hostFormSchema>;
type HostFormOutput = z.output<typeof hostFormSchema>;

const HOST_DEFAULTS: HostFormInput = {
  name: '',
  address: '',
  port: 22,
  sshUser: 'root',
  env: 'prod',
  group: '',
  provider: '',
  credentialId: null,
  keypairId: null,
};
const NONE = '__none';

export function AddHostDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const credentials = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<Credential[]>('/api/v1/credentials'),
    enabled: open,
  });
  const keypairs = useQuery({
    queryKey: ['keypairs'],
    queryFn: () => api.get<Keypair[]>('/api/v1/keypairs'),
    enabled: open,
  });
  const form = useForm<HostFormInput, unknown, HostFormOutput>({
    resolver: zodResolver(hostFormSchema),
    defaultValues: HOST_DEFAULTS,
  });
  useEffect(() => {
    if (open) form.reset(HOST_DEFAULTS);
  }, [open, form]);
  const create = useMutation({
    mutationFn: (input: HostFormOutput) =>
      api.post<Host>('/api/v1/hosts', {
        ...input,
        group: input.group?.trim() || undefined,
        provider: input.provider?.trim() || undefined,
      }),
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ['hosts'] });
      await queryClient.invalidateQueries({ queryKey: ['credentials'] });
      await queryClient.invalidateQueries({ queryKey: ['audit'] });
      onOpenChange(false);
      form.reset(HOST_DEFAULTS);
      toast.success('服务器已添加', { description: `${values.name} · 添加后可立即探测` });
    } catch (e) {
      toastError(e);
    }
  });
  const err = form.formState.errors;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="添加服务器"
      footer={
        <>
          <Button type="button" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" variant="primary" disabled={create.isPending} onClick={() => void submit()}>
            {create.isPending ? '保存中…' : '添加并保存'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block text-[11.5px] text-[var(--ink-3)]">
          名称 *
          <Input {...form.register('name')} className="mt-1" placeholder="例如 ali-hk-web-02" autoFocus />
          {err.name ? <span className="text-[11px] text-[var(--bad)]">请输入名称</span> : null}
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          公网 IP / 域名 *
          <Input {...form.register('address')} className="mt-1" placeholder="47.242.0.0" />
          {err.address ? <span className="text-[11px] text-[var(--bad)]">请输入合法地址</span> : null}
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          SSH 端口
          <Input {...form.register('port', { valueAsNumber: true })} className="mt-1" type="number" min="1" max="65535" />
          {err.port ? <span className="text-[11px] text-[var(--bad)]">端口需为 1-65535</span> : null}
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          SSH 用户
          <Input {...form.register('sshUser')} className="mt-1" />
          {err.sshUser ? <span className="text-[11px] text-[var(--bad)]">请输入 SSH 用户</span> : null}
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          环境
          <Controller
            control={form.control}
            name="env"
            render={({ field }) => (
              <Select value={field.value ?? 'prod'} onValueChange={(v) => field.onChange(v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prod">生产</SelectItem>
                  <SelectItem value="staging">预发</SelectItem>
                  <SelectItem value="dev">开发</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          分组
          <Input {...form.register('group')} className="mt-1" placeholder="例如 Web 站点" />
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          供应商
          <Input {...form.register('provider')} className="mt-1" placeholder="阿里云 / Oracle Cloud…" />
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          关联凭据
          <Controller
            control={form.control}
            name="credentialId"
            render={({ field }) => (
              <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="不关联" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>不关联</SelectItem>
                  {(credentials.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </label>
        <label className="block text-[11.5px] text-[var(--ink-3)]">
          管理密钥对
          <Controller
            control={form.control}
            name="keypairId"
            render={({ field }) => (
              <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="不关联" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>不关联</SelectItem>
                  {(keypairs.data ?? []).map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </label>
      </div>
      <div className="mt-3">
        <Callout icon={<Globe size={14} className="mt-[2px] shrink-0" />}>
          添加后点击「立即探测」，平台将通过 SSH 自动采集系统与硬件信息；带宽、计费与到期日在详情中手动维护。
        </Callout>
      </div>
    </Modal>
  );
}
