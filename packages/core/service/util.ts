import type { CreatedByKind } from '@overlord/contract';
import type { SqlDialect } from '@overlord/database';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const SESSION_KEY_PREFIX = 'sess_';

/** SQLite stores booleans as 0/1 while Postgres returns real booleans. */
export function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1;
}

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

// `created_by_kind` is NOT NULL in both tables, so the null branch only fires
// for a projection that did not select the column. Falling back to 'human'
// keeps `createdByKind` non-optional on the wire, which is what lets every
// client render provenance without a null branch. Biasing an unknown value to
// 'human' is also the safe direction: it under-claims rather than misattributes.
export function toCreatedByKind(value: string | null | undefined): CreatedByKind {
  return value === 'agent' || value === 'automation' ? value : 'human';
}

/** `?, ?, ...` list for an `IN (...)` clause of `count` bound values. */
export function sqlPlaceholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}
