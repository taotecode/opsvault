import type { ReactNode } from 'react';
import { Check, Copy, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export function GlassPanel({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('glass-panel', className)} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="mt-[2px] text-[12px] text-[var(--ink-3)]">{sub}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-h-[46px] items-center gap-2.5 border-b border-[var(--line)] px-4 py-3">
      <div className="text-[13px] font-semibold">{children}</div>
      {right ? <div className="ml-auto">{right}</div> : null}
    </div>
  );
}

export function CopyButton({
  text,
  label,
  className,
  sensitive,
}: {
  text: string;
  label?: string;
  className?: string;
  sensitive?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    if (sensitive) {
      setTimeout(() => {
        void navigator.clipboard.writeText('').catch(() => undefined);
      }, 30_000);
    }
  };
  return (
    <button type="button" className={cn('btn btn-sm', className)} onClick={() => void copy()}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {label ?? (copied ? '已复制' : '复制')}
    </button>
  );
}

export function Callout({ tone = 'neutral', icon, children }: { tone?: 'neutral' | 'warn' | 'ok'; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn('callout', tone === 'warn' && 'callout-warn', tone === 'ok' && 'callout-ok')}>
      {icon ?? <AlertTriangle size={14} className="mt-[2px] shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon ? <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl border border-dashed border-[var(--line-strong)] text-[var(--ink-3)]">{icon}</div> : null}
      <h4 className="mb-1 text-[13px] font-semibold text-[var(--ink-2)]">{title}</h4>
      {description ? <p className="mb-3 text-[12px]">{description}</p> : null}
      {action}
    </div>
  );
}
