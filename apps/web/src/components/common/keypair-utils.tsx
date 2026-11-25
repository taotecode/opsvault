import { toast } from 'sonner';
import type { ApiError } from '@/lib/api';

export function toastApiError(error: unknown, fallback = '操作失败'): void {
  const err = error as ApiError;
  toast.error(err?.message || fallback, { description: err?.hint });
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return '从未';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN', { hour12: false });
}
