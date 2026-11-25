import { readCookie } from './utils';

export class ApiError extends Error {
  status: number;
  code: string;
  hint?: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, hint?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

interface Envelope<T> {
  data: T;
  page?: { cursor: string | null; hasMore: boolean };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('bf_csrf');
    if (csrf) headers.set('x-csrf-token', csrf);
  }
  const res = await fetch(path, { credentials: 'include', ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let code = 'INTERNAL';
    let message = res.statusText;
    let hint: string | undefined;
    if (contentType.includes('application/json')) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { code?: string; message?: string; hint?: string } }
        | null;
      code = body?.error?.code || code;
      message = body?.error?.message || message;
      hint = body?.error?.hint;
    }
    if (res.status === 401 && !path.includes('/auth/me')) {
      window.dispatchEvent(new CustomEvent('boerfen:unauthorized'));
    }
    throw new ApiError(res.status, code, message, hint);
  }
  if (!contentType.includes('application/json')) {
    return (await res.text()) as unknown as T;
  }
  const body = (await res.json()) as Envelope<T>;
  return (body && 'data' in body ? body.data : body) as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
  raw: request,
};

export async function downloadFile(path: string, method: 'GET' | 'POST' = 'GET'): Promise<void> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const csrf = readCookie('bf_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const res = await fetch(path, { method, credentials: 'include', headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body.error?.message || message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, 'DOWNLOAD_FAILED', message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="?([^";]+)"?/.exec(disposition)?.[1];
  let name = plain ?? 'download.bin';
  if (encoded) {
    try {
      name = decodeURIComponent(encoded);
    } catch {
      /* keep plain fallback */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface Page<T> {
  data: T[];
  page: { cursor: string | null; hasMore: boolean };
}

export async function listPage<T>(path: string): Promise<Page<T>> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) {
    let code = 'INTERNAL';
    let message = res.statusText;
    let hint: string | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string; hint?: string } };
      code = body.error?.code || code;
      message = body.error?.message || message;
      hint = body.error?.hint;
    } catch {
      /* ignore */
    }
    if (res.status === 401) window.dispatchEvent(new CustomEvent('boerfen:unauthorized'));
    throw new ApiError(res.status, code, message, hint);
  }
  return (await res.json()) as Page<T>;
}
