import type { DatabaseClient } from '@overlord/database';

export const TERMINAL_PROBE_TIMEOUT_MS = 10_000;
export const TERMINAL_PROBE_RESULT_REUSE_MS = 5_000;
export const TERMINAL_PROBE_RETENTION_MS = 15 * 60_000;
const ABANDONED_PROBE_RETENTION_MS = 60 * 60_000;
const LEGACY_PROBE_RETENTION_MS = 21 * 24 * 60 * 60_000;

/**
 * These internal jobs never had feed or timeline entries. Delete terminal
 * results after the retry grace period, and reclaim abandoned work separately.
 */
export async function pruneTerminalProbes(db: DatabaseClient, now = Date.now()): Promise<number> {
  const lock = db.dialect === 'postgres' ? 'FOR UPDATE SKIP LOCKED' : '';
  const result = await db.run(
    `DELETE FROM execution_requests AS probe WHERE id IN (
       SELECT er.id FROM execution_requests er
        WHERE er.background_probe_key IS NOT NULL AND er.updated_at < ?
          AND (er.status NOT IN ('claimed', 'launching') OR er.updated_at < ?)
        ORDER BY er.updated_at, er.id LIMIT 1000 ${lock}
     ) AND NOT EXISTS (
       SELECT 1 FROM entity_changes c WHERE c.entity_type = 'execution_request' AND c.entity_id = probe.id
     )`,
    [
      new Date(now - TERMINAL_PROBE_RETENTION_MS).toISOString(),
      new Date(now - ABANDONED_PROBE_RETENTION_MS).toISOString()
    ]
  );
  return result.changes;
}

/** Legacy observer jobs were visible in replay. Keep them while any cursor can see them. */
export async function pruneLegacyTerminalProbes(
  db: DatabaseClient,
  now = Date.now()
): Promise<number> {
  const result = await db.run(
    `DELETE FROM execution_requests AS probe WHERE id IN (
       SELECT er.id FROM execution_requests er
        WHERE er.requested_source = 'local_target_mutation'
          AND er.idempotency_key LIKE 'terminal-observe:%'
          AND er.metadata_json->'overlord.localTargetMutation'->>'capability' = 'inspectLatchSession'
          AND er.status IN ('launched', 'failed', 'cancelled', 'cleared', 'expired')
          AND er.updated_at < ?
        ORDER BY er.updated_at, er.id LIMIT 1000 FOR UPDATE SKIP LOCKED
     ) AND NOT EXISTS (
       SELECT 1 FROM entity_changes c WHERE c.entity_type = 'execution_request' AND c.entity_id = probe.id
     )`,
    [new Date(now - LEGACY_PROBE_RETENTION_MS).toISOString()]
  );
  return result.changes;
}
