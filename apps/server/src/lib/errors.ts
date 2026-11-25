import type { FastifyReply } from 'fastify';
import { ERROR_CODES, type ErrorCode } from '@boerfen/shared';

export class AppError extends Error {
  statusCode: number;
  code: ErrorCode;
  hint?: string;
  details?: unknown;
  constructor(statusCode: number, code: ErrorCode, message: string, hint?: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

export const errors = {
  unauthorized: (hint = '请先登录', message = '未认证或会话已过期') =>
    new AppError(401, 'UNAUTHORIZED', message, hint),
  forbidden: (hint = '权限不足', message = '没有执行该操作的权利') =>
    new AppError(403, 'FORBIDDEN', message, hint),
  notFound: (what = '资源') => new AppError(404, 'NOT_FOUND', `${what}不存在`, '检查 id 或刷新列表'),
  validation: (details: unknown, hint = '检查输入格式') =>
    new AppError(400, 'VALIDATION_FAILED', '请求参数校验失败', hint, details),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  setupLocked: () => new AppError(404, 'SETUP_LOCKED', '安装入口已关闭'),
  csrf: () => new AppError(403, 'CSRF_FAILED', 'CSRF 校验失败', '刷新页面后重试'),
  rateLimited: () => new AppError(429, 'RATE_LIMITED', '请求过于频繁', '稍后再试'),
  internal: (message = '服务器内部错误') => new AppError(500, 'INTERNAL', message),
  sshConnect: (message: string) =>
    new AppError(502, 'SSH_CONNECT_FAILED', `SSH 连接失败：${message}`, '检查地址、端口与网络连通性'),
  sshAuth: (message: string) =>
    new AppError(502, 'SSH_AUTH_FAILED', `SSH 认证失败：${message}`, '检查凭据或公钥是否已部署'),
  keyParse: (message: string) =>
    new AppError(400, 'KEY_PARSE_FAILED', `密钥解析失败：${message}`, '支持 OpenSSH 私钥与公钥；口令私钥需提供口令'),
};

export function sendError(reply: FastifyReply, err: unknown): void {
  if (err instanceof AppError) {
    reply.status(err.statusCode).send({
      error: {
        code: err.code,
        message: err.message,
        ...(err.hint ? { hint: err.hint } : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
        ...(ERROR_CODES.includes(err.code)
          ? { docsUrl: `/api/docs#error-${err.code.toLowerCase()}` }
          : {}),
      },
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'unknown error';
  reply.status(500).send({
    error: { code: 'INTERNAL', message, docsUrl: '/api/docs' },
  });
}
