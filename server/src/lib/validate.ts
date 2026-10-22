import type { ZodType, ZodTypeDef } from 'zod';
import { badRequest } from './errors.js';

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');
    throw badRequest(field ? `${field}: ${issue.message}` : issue.message);
  }
  return result.data;
}

export function idParam(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Некорректный идентификатор');
  return id;
}
