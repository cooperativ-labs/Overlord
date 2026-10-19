import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';

import type { ChatAttempt, ChatRuns } from '../../packages/core/service/chat/runs.ts';

import { GeminiChatRuntime, type GeminiRuntimeOptions } from './gemini-runtime.ts';

/** Test-only collector; the evaluation runner creates a mode-0700 private directory. */
export class EvaluationGeminiRuntime extends GeminiChatRuntime {
  constructor(options: GeminiRuntimeOptions) {
    super({
      ...options,
      ...(process.env.CHAT_EVAL_FILE
        ? {
            performanceInstrumentation: process.env.CHAT_EVAL_MODE !== 'off'
          }
        : {})
    });
  }
  override async execute(attempt: ChatAttempt, runs: ChatRuns, signal: AbortSignal) {
    if (!process.env.CHAT_EVAL_FILE) return super.execute(attempt, runs, signal);
    const started = performance.now();
    try {
      return await super.execute(attempt, runs, signal);
    } finally {
      const durationMs = performance.now() - started;
      const rows = await runs.db.all<{
        seq: number;
        kind: string;
        payload_json: string;
        attempt_id: string | null;
      }>(
        'SELECT seq, kind, payload_json, attempt_id FROM chat_diagnostics WHERE thread_id = ? ORDER BY seq',
        [attempt.threadId]
      );
      // Display is never enabled in this harness. Every retained row is still ordered and gap-free.
      rows.forEach((row, i) => assert.equal(Number(row.seq), i + 1));
      const observations = rows
        .filter(r => r.kind === 'performance.attempt' && r.attempt_id === attempt.id)
        .map(r => JSON.parse(r.payload_json));
      const current = observations.at(-1);
      // No raw content, identity, arguments or error messages leave the isolated fixture.
      appendFileSync(
        process.env.CHAT_EVAL_FILE,
        JSON.stringify({
          adapter: runs.db.dialect,
          durationMs,
          metrics: process.env.CHAT_EVAL_MODE === 'off' ? null : (current ?? null),
          diagnosticRows: rows.length
        }) + '\n',
        { mode: 0o600 }
      );
    }
  }
}
