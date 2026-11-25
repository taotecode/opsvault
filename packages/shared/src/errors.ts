export const ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'RATE_LIMITED',
  'SETUP_REQUIRED',
  'SETUP_LOCKED',
  'CSRF_FAILED',
  'SSH_CONNECT_FAILED',
  'SSH_AUTH_FAILED',
  'KEY_PARSE_FAILED',
  'KEY_VERIFY_FAILED',
  'UPGRADE_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    hint?: string;
    docsUrl?: string;
    details?: unknown;
  };
}

export interface PageInfo {
  cursor: string | null;
  hasMore: boolean;
}

export interface ApiListResponse<T> {
  data: T[];
  page: PageInfo;
}

export interface ApiItemResponse<T> {
  data: T;
}
