import type { SqlDialect } from '@overlord/database';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const SESSION_KEY_PREFIX = 'sess_';

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length > 0 ? base : 'project';
}

export function initialTitleFromInstruction(instruction: string): string {
  const firstLine = instruction.split('\n')[0]?.trim() ?? instruction.trim();
  if (firstLine.length <= 80) return firstLine;
  return `${firstLine.slice(0, 77)}...`;
}

export function generateSessionKey(): { rawKey: string; prefix: string; hash: string } {
  const rawKey = SESSION_KEY_PREFIX + randomBytes(24).toString('base64url');
  const prefix = rawKey.slice(0, SESSION_KEY_PREFIX.length + 8);
  const hash = createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, prefix, hash };
}

export function hashSessionKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function sessionKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 'sess_'.length + 8);
}

/**
 * Extract a scalar JSON field as text on either supported database adapter.
 * PostgreSQL stores these columns as jsonb, which cannot be compared with text
 * operators such as LIKE, so it uses `->>`; SQLite uses json_extract.
 * `column` and `field` are interpolated verbatim and must be trusted identifiers.
 */
export function jsonTextFieldSql(column: string, field: string, dialect: SqlDialect): string {
  return dialect === 'postgres'
    ? `${column}->>'${field}'`
    : `json_extract(${column}, '$.${field}')`;
}
