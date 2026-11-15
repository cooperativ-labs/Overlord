import type { Request } from 'express';

import { ApiError } from '../errors.ts';

type QueryRequest = Pick<Request, 'query'>;

/** Trim a string value, treating blanks and non-strings as absent. */
export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function queryString(
  req: QueryRequest,
  name: string,
  { trim = true, first = true }: { trim?: boolean; first?: boolean } = {}
): string | null {
  const value = req.query[name];
  const raw = first && Array.isArray(value) ? value[0] : value;
  return trim ? optionalString(raw) : typeof raw === 'string' ? raw : null;
}

/** A bare flag opts in; only explicit 0 or false opts out. */
export function queryFlag(req: QueryRequest, name: string): boolean {
  const raw = queryString(req, name, { trim: false });
  if (raw === null) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false';
}

/** Also accepts a header value for Last-Event-ID replay. */
export function parseSeqCursor(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export function queryCursor(req: QueryRequest, name: string): number | null {
  return parseSeqCursor(req.query[name]);
}

export function queryEnum<T extends string>(
  req: QueryRequest,
  name: string,
  values: readonly T[],
  fallback: T
): T {
  const value = req.query[name];
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return fallback;
  if (typeof raw === 'string' && (values as readonly string[]).includes(raw)) return raw as T;
  throw new ApiError(400, `${name} must be one of: ${values.join(', ')}`);
}
