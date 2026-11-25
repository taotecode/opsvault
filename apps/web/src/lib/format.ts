import { toast } from 'sonner';
import type { ApiError } from './api';
import type { Host } from '@/types';

export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '—';
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function hostSpec(host: Host): string {
  const parts: string[] = [];
  if (host.cpuCores) parts.push(`${host.cpuCores}C`);
  if (host.memTotalMb) parts.push(`${Math.round(host.memTotalMb / 1024)}G`);
  if (host.disks?.length) {
    const totalGb = Math.round(host.disks.reduce((sum, d) => sum + d.sizeKb, 0) / 1_048_576);
    if (totalGb > 0) parts.push(`${totalGb}G`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

/** host 无实时 CPU/内存百分比：CPU 由 load1/核数推导，内存沿用负载近似，磁盘取各挂载点均值。 */
export function loadMetrics(host: Host): { cpu: number; mem: number; disk: number } | null {
  const diskVals = (host.disks ?? []).map((d) => d.usePct).filter((v) => Number.isFinite(v));
  const disk = diskVals.length ? Math.round(diskVals.reduce((a, b) => a + b, 0) / diskVals.length) : 0;
  const load1 = host.loadAvg ? Number.parseFloat(host.loadAvg.trim().split(/\s+/)[0] ?? '') : Number.NaN;
  const cores = host.cpuCores && host.cpuCores > 0 ? host.cpuCores : 1;
  const pct = Number.isFinite(load1) ? Math.min(100, Math.round((load1 / cores) * 100)) : 0;
  if (!host.loadAvg && !diskVals.length) return null;
  return { cpu: pct, mem: pct, disk };
}

export function toastError(e: unknown): void {
  const err = e as ApiError;
  toast.error(err.message || '操作失败', { description: err.hint });
}

export async function copyText(text: string): Promise<void> {
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
}
