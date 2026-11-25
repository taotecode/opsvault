import { useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import type { Host } from '@/types';
import { LayoutDashboard, Server, Shield, KeyRound, TerminalSquare, ScrollText, Users, Braces, Settings } from 'lucide-react';

const PAGES = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/hosts', label: '服务器', icon: Server },
  { path: '/credentials', label: '凭据保险库', icon: Shield },
  { path: '/keypairs', label: '密钥对', icon: KeyRound },
  { path: '/terminal', label: 'Web 终端', icon: TerminalSquare },
  { path: '/audit', label: '审计日志', icon: ScrollText },
  { path: '/users', label: '用户与角色', icon: Users },
  { path: '/api', label: 'API 与 Agent', icon: Braces },
  { path: '/settings', label: '设置', icon: Settings },
];

export function CommandPalette({
  open,
  onOpenChange,
  hosts,
  role,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  hosts: Host[];
  role?: string;
}) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const allowedPages = useMemo(
    () =>
      PAGES.filter((p) => {
        if (p.path === '/terminal') return role === 'admin' || role === 'operator';
        if (['/users', '/api', '/settings'].includes(p.path)) return role === 'admin';
        return true;
      }),
    [role],
  );
  const filteredPages = useMemo(
    () => allowedPages.filter((p) => !q || p.label.toLowerCase().includes(q.toLowerCase())),
    [q, allowedPages],
  );
  const filteredHosts = useMemo(
    () =>
      hosts
        .filter((h) => !q || `${h.name} ${h.address} ${h.provider ?? ''}`.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 8),
    [hosts, q],
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="命令面板"
      overlayClassName="fixed inset-0 z-40 bg-[rgba(4,8,15,.55)] backdrop-blur-[3px]"
      contentClassName="fixed inset-0 z-50 grid place-items-start justify-center px-4 pt-[12vh] outline-none pointer-events-none"
    >
      <div className="pointer-events-auto w-[560px] max-w-[92vw] overflow-hidden rounded-[14px] border border-[var(--glass-border)] bg-[var(--bg-side)] shadow-[var(--glass-shadow)] backdrop-blur-2xl">
        <Command.Input
          value={q}
          onValueChange={setQ}
          placeholder="搜索页面或服务器…"
          className="w-full border-0 border-b border-[var(--line)] bg-transparent px-4 py-3.5 text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
        />
        <Command.List className="max-h-[340px] overflow-auto p-1.5">
          <Command.Empty className="p-6 text-center text-[12px] text-[var(--ink-3)]">没有匹配结果</Command.Empty>
          {filteredPages.length ? (
            <>
              <Command.Group heading="页面" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:text-[var(--ink-3)]">
                {filteredPages.map((p) => (
                  <Command.Item
                    key={p.path}
                    value={`page ${p.label}`}
                    onSelect={() => {
                      navigate(p.path);
                      onOpenChange(false);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-[var(--ink-2)] data-[selected=true]:bg-[var(--panel-2)] data-[selected=true]:text-[var(--ink)]"
                  >
                    <p.icon size={15} className="text-[var(--ink-3)]" />
                    {p.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </>
          ) : null}
          {filteredHosts.length ? (
            <Command.Group heading="服务器" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:text-[var(--ink-3)]">
              {filteredHosts.map((h) => (
                <Command.Item
                  key={h.id}
                  value={`host ${h.name} ${h.address} ${h.provider ?? ''}`}
                  onSelect={() => {
                    navigate(`/hosts?hostId=${h.id}`);
                    onOpenChange(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-[var(--ink-2)] data-[selected=true]:bg-[var(--panel-2)] data-[selected=true]:text-[var(--ink)]"
                >
                  <Server size={15} className="text-[var(--ink-3)]" />
                  {h.name}
                  <span className="ml-auto font-mono text-[11px] text-[var(--ink-3)]">{h.address}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
