import type { Host } from '@/types';
import { cn } from '@/lib/utils';

const TICK_CLASS = {
  online: 'tick-ok',
  warning: 'tick-warn',
  offline: 'tick-bad',
  pending: '',
} as const;

export function FleetStrip({ hosts, onSelect }: { hosts: Host[]; onSelect?: (host: Host) => void }) {
  const counts = {
    online: hosts.filter((h) => h.status === 'online').length,
    warning: hosts.filter((h) => h.status === 'warning').length,
    offline: hosts.filter((h) => h.status === 'offline').length,
    pending: hosts.filter((h) => h.status === 'pending').length,
  };
  return (
    <div className="glass-panel">
      <div className="flex flex-wrap items-center gap-3 px-4 pb-1 pt-3">
        <div>
          <div className="text-[13px] font-semibold">舰队状态</div>
          <div className="text-[11.5px] text-[var(--ink-3)]">每个刻度代表一台服务器，点击查看详情</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11.5px] text-[var(--ink-3)]">
          <span className="inline-flex items-center gap-1.5"><i className="dot dot-ok" />在线 {counts.online}</span>
          <span className="inline-flex items-center gap-1.5"><i className="dot dot-warn" />告警 {counts.warning}</span>
          <span className="inline-flex items-center gap-1.5"><i className="dot dot-bad" />离线 {counts.offline}</span>
          {counts.pending ? <span className="inline-flex items-center gap-1.5"><i className="dot dot-idle" />待探测 {counts.pending}</span> : null}
        </div>
      </div>
      {hosts.length ? (
        <div className="fleet-strip">
          {hosts.map((host) => (
            <button
              key={host.id}
              type="button"
              className={cn('tick', TICK_CLASS[host.status] ?? '')}
              title={`${host.name} · ${host.address} · ${host.status}`}
              onClick={() => onSelect?.(host)}
            >
              <span>{host.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 pb-4 text-[12px] text-[var(--ink-3)]">还没有服务器，先添加一台吧。</div>
      )}
      <div className="flex flex-wrap gap-4 px-4 pb-3 text-[11.5px] text-[var(--ink-3)]">
        <span>{hosts.length} 台服务器</span>
        <span>公网可达 {hosts.filter((h) => h.address && !h.address.startsWith('192.')).length} 台</span>
      </div>
    </div>
  );
}
