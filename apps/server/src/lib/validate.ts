import type { ZodType } from 'zod';
import { errors } from './errors.js';

export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw errors.validation(result.error.flatten(), '检查请求体字段');
  }
  return result.data;
}

export function parseQuery<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw errors.validation(result.error.flatten(), '检查查询参数');
  }
  return result.data;
}
