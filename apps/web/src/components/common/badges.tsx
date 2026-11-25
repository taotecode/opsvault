import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Env, HostStatus, Role } from '@/types';

export function StatusBadge({ status }: { status: HostStatus }) {
  const map: Record<HostStatus, { label: string; cls: string }> = {
    online: { label: '在线', cls: 'badge-ok' },
    warning: { label: '告警', cls: 'badge-warn' },
    offline: { label: '离线', cls: 'badge-bad' },
    pending: { label: '待探测', cls: 'badge-neutral' },
  };
  const item = map[status] ?? map.pending;
  return <span className={cn('badge', item.cls)}>{item.label}</span>;
}

export function EnvBadge({ env }: { env: Env }) {
  const map: Record<Env, { label: string; cls: string }> = {
    prod: { label: '生产', cls: 'badge-bad' },
    staging: { label: '预发', cls: 'badge-warn' },
    dev: { label: '开发', cls: 'badge-info' },
  };
  const item = map[env] ?? map.dev;
  return <span className={cn('badge', item.cls)}>{item.label}</span>;
}

export function RoleBadge({ role }: { role: Role | string }) {
  const map: Record<string, { label: string; cls: string }> = {
    admin: { label: '管理员', cls: 'badge-warn' },
    operator: { label: '运维', cls: 'badge-info' },
    viewer: { label: '只读', cls: 'badge-neutral' },
  };
  const item = map[role] ?? map.viewer!;
  return <span className={cn('badge', item.cls)}>{item.label}</span>;
}

export function StrengthBadge({ strength }: { strength: 'strong' | 'medium' | 'weak' | null }) {
  if (!strength) return <span className="muted">—</span>;
  const map = {
    strong: { label: '强', cls: 'badge-ok' },
    medium: { label: '中', cls: 'badge-warn' },
    weak: { label: '弱', cls: 'badge-bad' },
  } as const;
  return <span className={cn('badge', map[strength].cls)}>{map[strength].label}</span>;
}

export function Dot({ status }: { status: HostStatus }) {
  const cls = { online: 'dot-ok', warning: 'dot-warn', offline: 'dot-bad', pending: 'dot-idle' }[status] ?? 'dot-idle';
  return <span className={cn('dot', cls)} />;
}

export interface BadgeProps {
  tone?: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'brand';
  children: ReactNode;
  className?: string;
}
export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return <span className={cn(`badge badge-${tone}`, className)}>{children}</span>;
}
