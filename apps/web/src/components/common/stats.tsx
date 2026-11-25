import type { ReactNode } from 'react';

export interface StatItem {
  label: ReactNode;
  value: ReactNode;
}

export function StatBand({ items }: { items: StatItem[] }) {
  return (
    <div className="stat-band">
      {items.map((item, i) => (
        <div className="stat" key={i}>
          <div className="font-mono text-[22px] font-semibold leading-tight tracking-[-0.5px] tabular-nums">{item.value}</div>
          <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-[var(--ink-3)]">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

export function LoadMeters({ cpu, mem, disk }: { cpu: number; mem: number; disk: number }) {
  const color = (v: number) => (v >= 80 ? 'var(--bad)' : v >= 60 ? 'var(--warn)' : 'var(--info)');
  return (
    <div className="loads">
      {[
        ['CPU', cpu],
        ['MEM', mem],
        ['DSK', disk],
      ].map(([label, value]) => (
        <div className="load" key={String(label)}>
          <span className="w-6 shrink-0">{label}</span>
          <div className="load-track">
            <i style={{ width: `${value}%`, background: color(Number(value)) }} />
          </div>
          <em className="w-5 text-right font-mono not-italic">{value}</em>
        </div>
      ))}
    </div>
  );
}
