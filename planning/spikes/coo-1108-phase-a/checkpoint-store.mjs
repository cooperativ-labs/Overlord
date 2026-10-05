// coo:1108 Phase A proof store. Mirrors the planned persistence boundary: every write
// is fenced by the run's current attempt fence, inside one SQLite transaction.

import { DatabaseSync } from 'node:sqlite';

export class StaleFenceError extends Error {}

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY, scenario TEXT NOT NULL, state TEXT NOT NULL,
      active_attempt TEXT, fence INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      final_text TEXT, recovery_mode TEXT
    );
    CREATE TABLE IF NOT EXISTS provider_checkpoints (
      run_id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, fence INTEGER NOT NULL,
      phase TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tool_receipts (
      operation_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, call_id TEXT NOT NULL,
      provider_call_id TEXT, call_order INTEGER NOT NULL, name TEXT NOT NULL, args TEXT NOT NULL,
      state TEXT NOT NULL, executions INTEGER NOT NULL DEFAULT 0, result TEXT,
      requested_fence INTEGER NOT NULL, completed_fence INTEGER, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL, seq INTEGER NOT NULL, fence INTEGER NOT NULL, kind TEXT NOT NULL,
      data TEXT NOT NULL, PRIMARY KEY (run_id, seq)
    );
  `);

  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const assertFence = (runId, fence) => {
    const row = db.prepare('SELECT fence FROM runs WHERE run_id = ?').get(runId);
    if (!row || row.fence !== fence) throw new StaleFenceError(`stale fence ${fence}`);
  };
  const now = () => new Date().toISOString();

  return {
    db,
    claimAttempt(runId, attemptId, scenario) {
      return tx(() => {
        db.prepare(
          `INSERT INTO runs (run_id, scenario, state) VALUES (?, ?, 'running')
           ON CONFLICT(run_id) DO NOTHING`
        ).run(runId, scenario);
        // The proof claims unconditionally (the previous worker is known dead). Production
        // claims only after lease expiry; the fence increment is identical.
        db.prepare(
          `UPDATE runs SET fence = fence + 1, attempts = attempts + 1, active_attempt = ?, state = 'running'
           WHERE run_id = ?`
        ).run(attemptId, runId);
        return db.prepare('SELECT fence FROM runs WHERE run_id = ?').get(runId).fence;
      });
    },
    loadCheckpoint(runId) {
      const row = db.prepare('SELECT payload FROM provider_checkpoints WHERE run_id = ?').get(runId);
      return row ? JSON.parse(row.payload) : null;
    },
    saveCheckpoint(runId, fence, payload, phase) {
      tx(() => {
        assertFence(runId, fence);
        db.prepare(
          `INSERT INTO provider_checkpoints (run_id, schema_version, fence, phase, payload, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(run_id) DO UPDATE SET schema_version = excluded.schema_version,
             fence = excluded.fence, phase = excluded.phase, payload = excluded.payload,
             updated_at = excluded.updated_at`
        ).run(runId, payload.schemaVersion, fence, phase, JSON.stringify(payload), now());
      });
    },
    recordToolRequest(runId, fence, operationId, call) {
      tx(() => {
        assertFence(runId, fence);
        db.prepare(
          `INSERT INTO tool_receipts (operation_id, run_id, call_id, provider_call_id, call_order, name,
             args, state, requested_fence)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?) ON CONFLICT(operation_id) DO NOTHING`
        ).run(operationId, runId, call.callId, call.providerCallId, call.order, call.name,
          JSON.stringify(call.args), fence);
      });
    },
    markToolStarted(runId, fence, operationId) {
      tx(() => {
        assertFence(runId, fence);
        db.prepare(
          `UPDATE tool_receipts SET executions = executions + 1 WHERE operation_id = ? AND state = 'requested'`
        ).run(operationId);
      });
    },
    recordToolResult(runId, fence, operationId, result) {
      tx(() => {
        assertFence(runId, fence);
        db.prepare(
          `UPDATE tool_receipts SET state = 'completed', result = ?, completed_fence = ?, completed_at = ?
           WHERE operation_id = ? AND state = 'requested'`
        ).run(JSON.stringify(result), fence, now(), operationId);
      });
    },
    getToolReceipt(operationId) {
      const row = db.prepare('SELECT * FROM tool_receipts WHERE operation_id = ?').get(operationId);
      return row ? { ...row, result: row.result ? JSON.parse(row.result) : null } : null;
    },
    appendEvent(runId, fence, kind, data) {
      tx(() => {
        assertFence(runId, fence);
        const { next } = db.prepare(
          'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_events WHERE run_id = ?'
        ).get(runId);
        db.prepare('INSERT INTO run_events (run_id, seq, fence, kind, data) VALUES (?, ?, ?, ?, ?)')
          .run(runId, next, fence, kind, JSON.stringify(data));
      });
    },
    completeRun(runId, fence, finalText, recoveryMode = 'checkpoint') {
      tx(() => {
        assertFence(runId, fence);
        db.prepare(
          `UPDATE runs SET state = 'completed', final_text = ?, active_attempt = NULL,
             recovery_mode = COALESCE(recovery_mode, ?) WHERE run_id = ?`
        ).run(finalText, recoveryMode, runId);
      });
    }
  };
}
