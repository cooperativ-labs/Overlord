import { createHash } from 'node:crypto';

/** Shared by the SQLite and Postgres migration runners so both agree on file naming and ledger identity. */
export const MIGRATION_FILE_PATTERN = /^\d+_[a-z0-9_]+\.sql$/;

export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function migrationComponent(fileName: string): string {
  const match = fileName.match(/^\d+_ext_([a-z0-9_]+)_/);
  return match ? `ext:${match[1]}` : 'core';
}
