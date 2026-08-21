import type { DatabaseClient } from '@overlord/database';

import { nowIso } from './util.js';

/**
 * Async, adapter-agnostic runner-queue primitives built on {@link DatabaseClient}.
 *
 * The existing queue logic in `execution-requests.ts` runs synchronously on
 * `better-sqlite3`. These functions are the Postgres-capable counterparts the
 * hosted backend uses: the same claim/recovery state transitions expressed
 * against the async client, with the one genuinely dialect-specific concern —
 * safe multi-writer claiming — handled by `FOR UPDATE SKIP LOCKED` on Postgres
 * and by the SQLite client's serialized transactions locally. Claiming stays a
 * single service-layer transaction; provider adapters never touch the rows
 * directly (Database/REST contract).
 */

const DEFAULT_CLAIM_TTL_MS = 15 * 60 * 1000;

export interface ClaimedExecutionRequest {
  id: string;
  workspaceId: string;
  executionTargetId: string;
  status: 'claimed';
  claimExpiresAt: string;
  revision: number;
}

interface CandidateRow {
  id: string;
  revision: number;
}

/**
 * Atomically claim the oldest queued execution request visible to a target.
 *
 * Returns the claimed request, or `null` when nothing is claimable. Two runners
 * racing for the same queue never claim the same row: on Postgres the candidate
 * row is locked with `FOR UPDATE SKIP LOCKED` so a concurrent claimer skips it
 * and takes the next one; on SQLite the client serializes transactions, so the
 * loser sees no queued row. The revision-guarded `UPDATE` is the final safety
 * net — a `0` row count means another writer won the row first.
 */
export async function claimNextQueuedRequest(
  client: DatabaseClient,
  options: {
    workspaceId: string;
    executionTargetId: string;
    projectId?: string | null;
    now?: string;
    claimTtlMs?: number;
  }
): Promise<ClaimedExecutionRequest | null> {
  const { workspaceId, executionTargetId } = options;
  const now = options.now ?? nowIso();
  const claimTtlMs = options.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;

  return client.transaction(async tx => {
    const conditions = [
      'workspace_id = ?',
      "status = 'queued'",
      'deleted_at IS NULL',
      '(execution_target_id IS NULL OR execution_target_id = ?)'
    ];
    const params: Array<string> = [workspaceId, executionTargetId];
    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }

    // `FOR UPDATE SKIP LOCKED` only exists on Postgres; SQLite relies on the
    // serialized transaction for the same single-claimer guarantee.
    const lockClause = tx.dialect === 'postgres' ? 'FOR UPDATE SKIP LOCKED' : '';
    const candidate = await tx.get<CandidateRow>(
      `SELECT id, revision FROM execution_requests
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at ASC
        LIMIT 1 ${lockClause}`,
      params
    );
    if (!candidate) return null;

    const revision = candidate.revision + 1;
    const claimExpiresAt = new Date(Date.parse(now) + claimTtlMs).toISOString();
    const updated = await tx.run(
      `UPDATE execution_requests
          SET status = 'claimed',
              claimed_by_execution_target_id = ?,
              claimed_at = ?,
              claim_expires_at = ?,
              attempt_count = attempt_count + 1,
              updated_at = ?,
              revision = ?
        WHERE id = ? AND status = 'queued' AND revision = ?`,
      [executionTargetId, now, claimExpiresAt, now, revision, candidate.id, candidate.revision]
    );
    if (updated.changes === 0) return null;

    return {
      id: candidate.id,
      workspaceId,
      executionTargetId,
      status: 'claimed',
      claimExpiresAt,
      revision
    };
  });
}
