import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Bot, Braces, FileText, Plus, TerminalSquare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ApiToken } from '@/types';
import { Button, Input } from '@/components/ui/controls';
import { Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/fields';
import { Modal } from '@/components/ui/modal';
import { DataTable } from '@/components/common/data-table';
import { Badge } from '@/components/common/badges';
import { Callout, CopyButton, EmptyState, GlassPanel, PageHeader, SectionTitle } from '@/components/common/primitives';
import { ConfirmDialog } from '@/components/common/dialogs';
import { toastApiError } from '@/components/common/keypair-utils';

const AGENT_SCOPES = ['hosts:read', 'hosts:write', 'credentials:read', 'keypairs:read', 'audit:read', 'system:read'];
const USER_SCOPES = [...AGENT_SCOPES, 'credentials:write', 'keypairs:write', 'settings:read'];
const SCOPE_LABELS: Record<string, string> = {
  'hosts:read': '读取服务器与探测结果',
  'hosts:write': '创建/更新服务器、触发探测',
  'credentials:read': '读取凭据元数据',
  'credentials:write': '创建/更新凭据',
  'keypairs:read': '读取密钥与公钥',
  'keypairs:write': '生成/部署/检验密钥（仅用户令牌）',
  'audit:read': '读取审计日志',
  'system:read': '读取版本与安装状态',
  'settings:read': '读取全局设置',
};
const SKILL_CMD = 'cp -r skills/opsvault ~/.claude/skills/';

function formatTime(value: string | null): string {
  if (!value) return '从未使用';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN', { hour12: false });
}

export function ApiPage() {
  const queryClient = useQueryClient();
  const tokens = useQuery<ApiToken[]>({ queryKey: ['tokens'], queryFn: () => api.get<ApiToken[]>('/api/v1/tokens') });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'user' | 'agent'>('user');
  const [scopes, setScopes] = useState<string[]>(['hosts:read', 'credentials:read', 'keypairs:read', 'system:read']);
  const [expiresDays, setExpiresDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<(ApiToken & { token: string }) | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);

  const availableScopes = kind === 'agent' ? AGENT_SCOPES : USER_SCOPES;
  const toggleScope = (scope: string) =>
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  const changeKind = (next: 'user' | 'agent') => {
    setKind(next);
    if (next === 'agent') setScopes((prev) => prev.filter((s) => AGENT_SCOPES.includes(s)));
  };

  const createToken = async () => {
    if (!name.trim()) {
      toast.error('请输入令牌名称', { description: '用于区分不同用途的令牌' });
      return;
    }
    if (!scopes.length) {
      toast.error('至少选择一个 scope');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<ApiToken & { token: string }>('/api/v1/tokens', {
        name: name.trim(),
        kind,
        scopes,
        expiresDays: expiresDays ? Number(expiresDays) : undefined,
      });
      setOpen(false);
      setCreated(res);
      setName('');
      setScopes(['hosts:read', 'credentials:read', 'keypairs:read', 'system:read']);
      setExpiresDays('');
      void queryClient.invalidateQueries({ queryKey: ['tokens'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    } catch (e) {
      toastApiError(e, '创建令牌失败');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revokeTarget) return;
    await api.delete(`/api/v1/tokens/${revokeTarget.id}`);
    toast.success('令牌已吊销', { description: revokeTarget.name });
    void queryClient.invalidateQueries({ queryKey: ['tokens'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
  };

  const columns: ColumnDef<ApiToken>[] = [
    {
      header: '名称 / 类型',
      cell: ({ row }) => (
        <div>
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
            {row.original.name}
            {row.original.kind === 'agent' ? <Badge tone="info"><Bot size={11} />智能体</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {row.original.scopes.map((s) => <span className="badge badge-neutral" key={s}>{s}</span>)}
          </div>
        </div>
      ),
    },
    {
      header: '前缀',
      cell: ({ row }) => <span className="mono text-[11.5px]">{row.original.prefix}…</span>,
    },
    {
      header: '最后使用',
      cell: ({ row }) => <span className="text-[11.5px] text-[var(--ink-3)]">{formatTime(row.original.lastUsedAt)}</span>,
    },
    {
      header: '操作',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <button type="button" className="icon-btn" title="吊销令牌" onClick={() => setRevokeTarget(row.original)}>
          <Trash2 size={15} />
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="API 与 Agent 接入"
        sub="人与 AI 共用一套接口：REST · OpenAPI · llms.txt · MCP · 官方 Skill"
        actions={<CopyButton text={`${window.location.origin}/api/v1`} label="复制 Base URL" />}
      />
      <div className="grid items-start gap-3.5 xl:grid-cols-2">
        <GlassPanel className="overflow-hidden">
          <SectionTitle right={<Badge tone="brand">Agent Ready</Badge>}>四种接入方式</SectionTitle>
          <div className="divide-y divide-[var(--line)]">
            {[
              { icon: Braces, title: 'REST API', tags: ['/api/v1', 'OpenAPI 3.1'], desc: '稳定 operationId 与示例，x-safety 标注敏感级别；/api/docs 人类可读，/openapi.json 机器可读。', action: <Button size="sm" onClick={() => window.open('/api/docs', '_blank')}>文档</Button> },
              { icon: FileText, title: 'llms.txt', tags: ['LLM 阅读指南'], desc: '纯文本说明认证、端点与使用禁忌，让大模型一次读懂平台。', action: <Button size="sm" onClick={() => window.open('/llms.txt', '_blank')}>查看</Button> },
              { icon: Bot, title: 'MCP Server', tags: ['Streamable HTTP'], desc: 'POST /mcp · 11 个工具，Claude Desktop / Claude Code 可直接挂载。', action: <CopyButton text={`${window.location.origin}/mcp`} label="地址" /> },
              { icon: TerminalSquare, title: '官方 Skill', tags: ['skills/opsvault'], desc: '教 Agent 何时用、怎么调、如何安全操作；含 scripts/api.sh curl 封装。', action: <CopyButton text={SKILL_CMD} label="安装" /> },
            ].map(({ icon: Icon, title, tags, desc, action }) => (
              <div key={title} className="flex items-start gap-3 px-4 py-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--line-strong)] bg-[var(--panel-2)] text-[var(--brand-ink)]">
                  <Icon size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold">
                    {title}{tags.map((t) => <span className="tag" key={t}>{t}</span>)}
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--ink-3)]">{desc}</div>
                </div>
                {action}
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--line)] px-4 py-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12px] font-semibold">Skill 安装命令</span>
              <CopyButton text={SKILL_CMD} />
            </div>
            <pre className="code-block">{SKILL_CMD}</pre>
          </div>
        </GlassPanel>

        <GlassPanel className="overflow-hidden">
          <SectionTitle right={<Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus size={13} />新建令牌</Button>}>
            API 令牌
          </SectionTitle>
          {tokens.isLoading ? (
            <div className="space-y-2 p-4"><div className="skeleton h-10 w-full" /><div className="skeleton h-10 w-full" /></div>
          ) : tokens.error ? (
            <div className="p-4"><Callout tone="warn">加载令牌失败：{tokens.error.message}</Callout></div>
          ) : (
            <div className="overflow-x-auto">
              <DataTable
                data={tokens.data ?? []}
                columns={columns}
                empty={<EmptyState icon={<Bot size={18} />} title="还没有 API 令牌" description="创建用户令牌或只读 Agent 令牌以接入自动化流程。" />}
              />
            </div>
          )}
          <div className="border-t border-[var(--line)] px-4 py-2.5 text-[11px] text-[var(--ink-3)]">
            Agent 令牌默认只读；reveal / 私钥导出 / 终端永不开放。
          </div>
        </GlassPanel>
      </div>
      <div className="mt-3.5">
        <Callout>
          所有 API 调用（含 Agent）都会记录审计：谁、何时、从哪个令牌、做了什么。凭证只以 SHA-256 哈希形式存储，令牌明文仅创建时显示一次。
        </Callout>
      </div>

      <Modal
        open={open}
        onOpenChange={setOpen}
        wide
        title="新建 API 令牌"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => void createToken()}>生成令牌</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">名称</label>
            <Input placeholder="例如 ci-deploy" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">类型</label>
              <Select value={kind} onValueChange={(v) => changeKind(v as 'user' | 'agent')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">用户令牌（跟随我的权限）</SelectItem>
                  <SelectItem value="agent">Agent 令牌（默认只读）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">有效期</label>
              <Select value={expiresDays || 'never'} onValueChange={(v) => setExpiresDays(v === 'never' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">永久（手动吊销）</SelectItem>
                  <SelectItem value="30">30 天</SelectItem>
                  <SelectItem value="90">90 天</SelectItem>
                  <SelectItem value="365">365 天</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">权限范围</label>
            <div className="grid gap-1 sm:grid-cols-2">
              {availableScopes.map((scope) => (
                <label key={scope} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--panel-2)]">
                  <Checkbox checked={scopes.includes(scope)} onCheckedChange={() => toggleScope(scope)} />
                  <span className="text-[11.5px] text-[var(--ink-2)]">
                    <span className="mono">{scope}</span>
                    <span className="block text-[10.5px] text-[var(--ink-3)]">{SCOPE_LABELS[scope]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <Callout tone="warn">令牌明文只显示一次；凭据 reveal、私钥导出与终端永远不会授予任何令牌。</Callout>
        </div>
      </Modal>

      <Modal
        open={!!created}
        onOpenChange={(next) => {
          if (!next) setCreated(null);
        }}
        title="令牌已创建"
        footer={<Button variant="primary" onClick={() => setCreated(null)}>我已安全保存</Button>}
      >
        {created ? (
          <div className="space-y-3">
            <Callout tone="warn">令牌明文只显示这一次，关闭后无法找回；请立即存入密码管理器。</Callout>
            <div>
              <label className="mb-1 block text-[11.5px] text-[var(--ink-3)]">令牌明文</label>
              <pre className="code-block select-all">{created.token}</pre>
              <div className="mt-2"><CopyButton text={created.token} label="复制令牌" sensitive /></div>
            </div>
            <div className="text-[11px] text-[var(--ink-3)]">
              类型：{created.kind === 'agent' ? 'Agent 令牌（默认只读）' : '用户令牌'} · scope：{created.scopes.join('、')}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(next) => {
          if (!next) setRevokeTarget(null);
        }}
        title="吊销令牌"
        danger
        confirmLabel="吊销令牌"
        message={`吊销「${revokeTarget?.name ?? ''}」后，使用该令牌的脚本与 Agent 将立即失去访问权限。`}
        onConfirm={revoke}
      />
    </>
  );
}
