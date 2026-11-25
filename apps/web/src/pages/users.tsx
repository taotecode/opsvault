import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Pencil, Power, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import type { User } from '@/types';
import { Button, Input } from '@/components/ui/controls';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/fields';
import { Modal } from '@/components/ui/modal';
import { DataTable } from '@/components/common/data-table';
import { Badge, RoleBadge } from '@/components/common/badges';
import { Callout, CopyButton, EmptyState, GlassPanel, PageHeader } from '@/components/common/primitives';
import { ConfirmDialog } from '@/components/common/dialogs';
import { toastApiError } from '@/components/common/keypair-utils';

const inviteSchema = z.object({
  email: z.string().trim().email('请输入有效邮箱'),
  role: z.enum(['admin', 'operator', 'viewer']),
});
type InviteValues = z.infer<typeof inviteSchema>;

function lastLogin(value: string | null | undefined): string {
  if (!value) return '从未登录';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN', { hour12: false });
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const users = useQuery<User[]>({ queryKey: ['users'], queryFn: () => api.get<User[]>('/api/v1/users') });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ user: User; temporaryPassword: string } | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editRole, setEditRole] = useState('operator');
  const [disableTarget, setDisableTarget] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', role: 'operator' } });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
  };

  const sendInvite = form.handleSubmit(async (values) => {
    try {
      const res = await api.post<{ user: User; temporaryPassword: string }>('/api/v1/users/invite', values);
      setInviteOpen(false);
      setInviteResult(res);
      form.reset();
      refresh();
      toast.success('已创建邀请', { description: `${res.user.email} · ${res.user.role}` });
    } catch (e) {
      toastApiError(e, '邀请用户失败');
    }
  });

  const patchUser = async (user: User, patch: { role?: User['role']; status?: 'active' | 'disabled' }) => {
    setBusy(true);
    try {
      await api.patch<User>(`/api/v1/users/${user.id}`, patch);
      toast.success('用户已更新', { description: user.email });
      refresh();
      setEditTarget(null);
      setDisableTarget(null);
    } catch (e) {
      toastApiError(e, '更新用户失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnDef<User>[] = [
    {
      header: '用户',
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--brand-strong)] to-[var(--brand)] text-[12px] font-semibold text-[#241504]">
            {row.original.username.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-semibold">{row.original.username}</div>
            <div className="truncate text-[11px] text-[var(--ink-3)]">{row.original.email}</div>
          </div>
        </div>
      ),
    },
    { header: '角色', cell: ({ row }) => <RoleBadge role={row.original.role} /> },
    {
      header: '2FA',
      cell: ({ row }) =>
        row.original.totpEnabled ? <Badge tone="ok">已启用</Badge> : <Badge tone="warn">未启用</Badge>,
    },
    {
      header: '最近登录',
      cell: ({ row }) => <span className="text-[11.5px] text-[var(--ink-3)]">{lastLogin(row.original.lastLoginAt)}</span>,
    },
    {
      header: '状态',
      cell: ({ row }) =>
        row.original.status === 'disabled' ? <Badge>已禁用</Badge> : <Badge tone="ok">活跃</Badge>,
    },
    {
      header: '操作',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const u = row.original;
        const isSelf = u.id === me.data?.user.id;
        const activeAdmins = (users.data ?? []).filter((x) => x.role === 'admin' && x.status === 'active').length;
        const lastAdmin = u.role === 'admin' && activeAdmins <= 1;
        if (isSelf) return <span className="text-[11px] text-[var(--ink-3)]">当前账号</span>;
        return (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              className="icon-btn"
              title={lastAdmin ? '不能修改最后一名管理员' : '编辑角色'}
              disabled={lastAdmin}
              onClick={() => {
                setEditRole(u.role);
                setEditTarget(u);
              }}
            >
              <Pencil size={15} />
            </button>
            {u.status === 'disabled' ? (
              <button type="button" className="icon-btn" title="启用账号" onClick={() => void patchUser(u, { status: 'active' })}>
                <Power size={15} />
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn"
                title={lastAdmin ? '不能禁用最后一名管理员' : '禁用账号'}
                disabled={lastAdmin}
                onClick={() => setDisableTarget(u)}
              >
                <Power size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="用户与角色"
        sub="邀请制 · 最小权限 · 操作可追溯"
        actions={
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            <UserPlus size={14} />邀请用户
          </Button>
        }
      />
      <GlassPanel className="overflow-hidden">
        {users.isLoading ? (
          <div className="space-y-2 p-4">
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
          </div>
        ) : users.error ? (
          <div className="p-4"><Callout tone="warn">加载用户失败：{users.error.message}</Callout></div>
        ) : (
          <div className="overflow-x-auto">
            <DataTable
              data={users.data ?? []}
              columns={columns}
              footer={<span>共 {users.data?.length ?? 0} 位成员 · 仅管理员可管理用户</span>}
              empty={<EmptyState icon={<UserPlus size={18} />} title="还没有其他用户" description="邀请运维或只读成员加入团队。" />}
            />
          </div>
        )}
      </GlassPanel>
      <div className="mt-3.5 grid gap-3 md:grid-cols-3">
        <GlassPanel className="p-4">
          <div className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold">管理员 <Badge tone="warn">admin</Badge></div>
          <p className="text-[11.5px] leading-relaxed text-[var(--ink-3)]">全部权限：用户与令牌管理、平台设置、数据导出、危险区操作。</p>
        </GlassPanel>
        <GlassPanel className="p-4">
          <div className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold">运维 <Badge tone="info">operator</Badge></div>
          <p className="text-[11.5px] leading-relaxed text-[var(--ink-3)]">服务器与凭据的增删改查、探测、终端；不能管理用户与全局设置。</p>
        </GlassPanel>
        <GlassPanel className="p-4">
          <div className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold">只读 <Badge>viewer</Badge></div>
          <p className="text-[11.5px] leading-relaxed text-[var(--ink-3)]">只读资产列表，看不到凭据明文，无终端权限；适合审计与旁观。</p>
        </GlassPanel>
      </div>

      <Modal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="邀请用户"
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)}>取消</Button>
            <Button variant="primary" disabled={form.formState.isSubmitting} onClick={() => void sendInvite()}>
              <Mail size={13} />创建账号
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">邮箱</label>
            <Input type="email" placeholder="name@example.com" {...form.register('email')} />
            {form.formState.errors.email ? <p className="mt-1 text-[11px] text-[var(--bad)]">{form.formState.errors.email.message}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">角色</label>
            <Select value={form.watch('role')} onValueChange={(v) => form.setValue('role', v as InviteValues['role'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">运维 operator</SelectItem>
                <SelectItem value="viewer">只读 viewer</SelectItem>
                <SelectItem value="admin">管理员 admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Callout>平台关闭公开注册，仅支持邀请制。系统将生成一次性临时密码，关闭结果窗口后无法再次查看。</Callout>
        </div>
      </Modal>

      <Modal
        open={!!inviteResult}
        onOpenChange={(open) => {
          if (!open) setInviteResult(null);
        }}
        title="邀请已创建"
        footer={<Button variant="primary" onClick={() => setInviteResult(null)}>我已安全保存</Button>}
      >
        {inviteResult ? (
          <div className="space-y-3">
            <Callout tone="warn">临时密码仅显示这一次。请通过安全渠道交给 {inviteResult.user.email}，并要求首次登录后修改。</Callout>
            <div>
              <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">临时密码</label>
              <pre className="code-block">{inviteResult.temporaryPassword}</pre>
              <div className="mt-2"><CopyButton text={inviteResult.temporaryPassword} label="复制临时密码" sensitive /></div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        title={`编辑角色 · ${editTarget?.username ?? ''}`}
        footer={
          <>
            <Button onClick={() => setEditTarget(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                if (editTarget) void patchUser(editTarget, { role: editRole as User['role'] });
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <div>
          <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">角色</label>
          <Select value={editRole} onValueChange={setEditRole}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">管理员 admin</SelectItem>
              <SelectItem value="operator">运维 operator</SelectItem>
              <SelectItem value="viewer">只读 viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!disableTarget}
        onOpenChange={(open) => {
          if (!open) setDisableTarget(null);
        }}
        title="禁用用户"
        message={`禁用「${disableTarget?.username ?? ''}」后，其所有会话与 API 令牌将立即失效。`}
        confirmLabel="禁用"
        danger
        onConfirm={async () => {
          if (disableTarget) await patchUser(disableTarget, { status: 'disabled' });
        }}
      />
    </>
  );
}
