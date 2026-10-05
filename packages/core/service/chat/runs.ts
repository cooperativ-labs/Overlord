import type {
  ChatBlockDto,
  ChatEvidenceDto,
  ChatQuestionOptionDto,
  ChatRunFailureCode,
  ChatSourceLocatorDto
} from '@overlord/contract';
import { bindBool } from '@overlord/database';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { proposalDto } from './proposals.js';
import {
  ChatError,
  ChatStore,
  messageDto,
  type MessageRow,
  questionDto,
  type QuestionRow,
  requiredText,
  runDto,
  type RunRow
} from './store.js';

export interface RuntimeIdentity {
  provider: string;
  model: string;
  configDigest: string;
  checkpointVersion: number;
}
export interface ChatAttempt {
  id: string;
  runId: string;
  threadId: string;
  fence: number;
  recoveryMode: 'initial' | 'checkpoint' | 'fresh_generation';
  identity: RuntimeIdentity;
}
export interface PrivateCheckpoint {
  phase: 'tool_requested' | 'tool_results_joined';
  payload: unknown;
  dependencySetId: string | null;
}
export interface ToolRequest {
  operationId: string;
  providerCallId: string;
  toolId: string;
  arguments: unknown;
  order: number;
}
export interface ToolReceipt {
  id: string;
  operationId: string;
  providerCallId: string;
  toolId: string;
  arguments: unknown;
  state: string;
  result: unknown;
  order: number;
  turnIndex: number;
  createdAt: string;
}
/** Source and excerpt metadata a tool result drew on (see `ChatToolSource`). */
export interface EvidenceInput {
  scopeKey: string;
  locator: ChatSourceLocatorDto;
  label: string;
  excerpt: string | null;
  truncated: boolean;
  revision: string | null;
  observedAt: string;
}
/** A citable evidence row: `ref` is the thread-local citation label shown to the model. */
export interface RecordedEvidence {
  ref: string;
  evidenceId: string;
  label: string;
}
export interface ThreadSummary {
  text: string;
  decisions: string[];
  openQuestions: string[];
  evidenceRefs: string[];
}
/**
 * Display text for `tool.updated`. A fixed vocabulary: the tool name of an undeclared call is
 * chosen by the model (possibly steered by content it read), so it is never echoed to clients.
 */
export function toolProgressLabel(toolId: string): string {
  switch (toolId) {
    case 'overlord_list_projects':
      return 'Listing projects';
    case 'overlord_list_execution_targets':
      return 'Checking machines';
    case 'overlord_search_missions':
      return 'Searching missions';
    case 'overlord_get_mission':
      return 'Reading a mission';
    case 'repository_read':
      return 'Inspecting a repository';
    case 'prepare_proposal':
      return 'Preparing a proposal';
    case 'ask_user':
      return 'Asking a question';
  }
  const note = /^kb_[0-9a-f]{12}_([a-z_]{1,48})$/.exec(toolId)?.[1];
  if (note === 'search') return 'Searching notes';
  if (note === 'read_file' || note === 'read_resource') return 'Reading a note';
  if (note) return 'Browsing notes';
  return 'Unavailable tool';
}

export class StaleChatAttempt extends Error {
  constructor() {
    super('Chat attempt is no longer leased');
  }
}

/** Private runtime seam. Provider state never flows through DTOs or exceptions. */
export class ChatRuns extends ChatStore {
  private async mutate<T>(a: ChatAttempt, fn: (s: ChatRuns, r: RunRow) => Promise<T>): Promise<T> {
    // Commit invalidation separately so a stale-worker rejection cannot roll it back.
    await this.db.transaction(async tx => {
      const s = new ChatRuns(tx, this.options);
      await s.lock(a.threadId);
      await s.checkSources(a.threadId);
    });
    return this.db.transaction(async tx => {
      const s = new ChatRuns(tx, this.options);
      await s.lock(a.threadId);
      const r = await s.assertLease(a);
      return fn(s, r);
    });
  }
  /** Periodic metadata-only retention sweep, including threads with no connected client. */
  async retainExpired() {
    const threads = await this.db.all<{ id: string }>(
      `SELECT t.id FROM chat_threads t WHERE EXISTS (SELECT 1 FROM chat_events e WHERE e.thread_id = t.id AND e.created_at < ?) OR t.last_event_seq - t.retained_from_seq + 1 > ? ORDER BY t.last_activity_at LIMIT 100`,
      [
        new Date(this.now() - this.limits.eventRetentionMs).toISOString(),
        this.limits.eventRetentionCount
      ]
    );
    for (const t of threads)
      await this.db.transaction(async tx => {
        const s = new ChatRuns(tx, this.options);
        await s.lock(t.id);
        await s.retain(t.id);
      });
  }
  async assertLease(a: ChatAttempt): Promise<RunRow> {
    const r = await this.run(a.runId);
    const attempt = await this.db.get<{ lease_expires_at: string; state: string }>(
      'SELECT lease_expires_at, state FROM chat_run_attempts WHERE id = ? AND run_id = ?',
      [a.id, a.runId]
    );
    if (
      r.thread_id !== a.threadId ||
      r.state !== 'running' ||
      r.cancel_requested_at ||
      r.current_fence !== a.fence ||
      r.active_attempt_id !== a.id ||
      attempt?.state !== 'leased' ||
      attempt.lease_expires_at <= this.timestamp()
    )
      throw new StaleChatAttempt();
    return r;
  }
  async claim(workerId: string, identity: RuntimeIdentity): Promise<ChatAttempt | null> {
    const candidates = await this.db.all<RunRow>(
      `SELECT r.* FROM chat_runs r LEFT JOIN chat_run_attempts a ON a.id = r.active_attempt_id WHERE r.state = 'queued' OR (r.state = 'running' AND (a.lease_expires_at <= ? OR a.id IS NULL)) ORDER BY r.created_at, r.id LIMIT 20`,
      [this.timestamp()]
    );
    for (const candidate of candidates) {
      const a = await this.db.transaction(async tx => {
        const s = new ChatRuns(tx, this.options);
        await s.lock(candidate.thread_id);
        await s.checkSources(candidate.thread_id);
        const r = await s.run(candidate.id!);
        if (r.state !== 'queued' && r.state !== 'running') return null;
        const old =
          r.active_attempt_id &&
          (await tx.get<{ lease_expires_at: string; started_at: string }>(
            'SELECT lease_expires_at, started_at FROM chat_run_attempts WHERE id = ?',
            [r.active_attempt_id]
          ));
        if (old && old.lease_expires_at > s.timestamp()) return null;
        if (r.state === 'running') {
          // Charge only the time for which the old worker had a lease.
          const elapsed = old
            ? Math.max(
                0,
                Math.min(s.now(), Date.parse(old.lease_expires_at)) - Date.parse(r.updated_at)
              )
            : 0;
          await tx.run(
            "UPDATE chat_run_attempts SET state = 'fenced', ended_at = ? WHERE run_id = ? AND state = 'leased'",
            [s.timestamp(), r.id]
          );
          await tx.run(
            'UPDATE chat_runs SET active_processing_ms = active_processing_ms + ? WHERE id = ?',
            [elapsed, r.id]
          );
        }
        const cp = await tx.get<{
          schema_version: number;
          provider: string;
          model: string;
          config_digest: string;
          invalidated_at: string | null;
          dependency_set_id: string | null;
        }>('SELECT * FROM chat_provider_checkpoints WHERE run_id = ?', [r.id]);
        const previous = await tx.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM chat_run_attempts WHERE run_id = ?',
          [r.id]
        );
        const compatible =
          cp &&
          !cp.invalidated_at &&
          cp.schema_version === identity.checkpointVersion &&
          cp.provider === identity.provider &&
          cp.model === identity.model &&
          cp.config_digest === identity.configDigest &&
          (await s.authorized(cp.dependency_set_id));
        const recoveryMode = compatible
          ? 'checkpoint'
          : Number(previous?.n)
            ? 'fresh_generation'
            : 'initial';
        if (!compatible && Number(previous?.n)) {
          await tx.run('DELETE FROM chat_provider_checkpoints WHERE run_id = ?', [r.id]);
          await tx.run(
            "UPDATE chat_tool_calls SET state = 'cancelled', completed_at = ?, updated_at = ? WHERE run_id = ? AND state IN ('requested','executing')",
            [s.timestamp(), s.timestamp(), r.id]
          );
          const partials = await tx.all<MessageRow>(
            "SELECT * FROM chat_messages WHERE run_id = ? AND state = 'streaming'",
            [r.id]
          );
          for (const m of partials) {
            await tx.run(
              "UPDATE chat_messages SET state = 'interrupted', updated_at = ?, revision = revision + 1 WHERE id = ?",
              [s.timestamp(), m.id]
            );
            await s.append(
              r.thread_id,
              {
                kind: 'message.completed',
                message: messageDto({ ...m, state: 'interrupted', revision: m.revision + 1 })
              },
              m.dependency_set_id
            );
          }
        }
        const id = randomUUID(),
          fence = r.current_fence + 1,
          now = s.timestamp();
        await tx.run(
          "UPDATE chat_runs SET state = 'running', current_fence = ?, active_attempt_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
          [fence, id, now, r.id]
        );
        await tx.run(
          `INSERT INTO chat_run_attempts (id, run_id, attempt_number, fence, state, recovery_mode, provider, model, config_digest, lease_owner, lease_expires_at, started_at) VALUES (?, ?, ?, ?, 'leased', ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            r.id,
            Number(previous?.n) + 1,
            fence,
            recoveryMode,
            identity.provider,
            identity.model,
            identity.configDigest,
            workerId,
            new Date(s.now() + s.limits.attemptLeaseMs).toISOString(),
            now
          ]
        );
        // Reads interrupted while executing may be retried with the original operation id.
        await tx.run(
          "UPDATE chat_tool_calls SET state = 'requested', writer_fence = ?, updated_at = ? WHERE run_id = ? AND state = 'executing'",
          [fence, now, r.id]
        );
        const attempt: ChatAttempt = {
          id,
          runId: r.id!,
          threadId: r.thread_id,
          fence,
          recoveryMode,
          identity
        };
        await s.append(
          r.thread_id,
          { kind: 'run.updated', run: runDto(await s.run(r.id!)) },
          null,
          attempt
        );
        return attempt;
      });
      if (a) return a;
    }
    return null;
  }
  async heartbeat(a: ChatAttempt): Promise<boolean> {
    return this.mutate(a, async (s, r) => {
      const now = s.timestamp(),
        elapsed = Math.max(0, s.now() - Date.parse(r.updated_at));
      await s.db.run('UPDATE chat_run_attempts SET lease_expires_at = ? WHERE id = ?', [
        new Date(s.now() + s.limits.attemptLeaseMs).toISOString(),
        a.id
      ]);
      await s.db.run(
        'UPDATE chat_runs SET active_processing_ms = active_processing_ms + ?, updated_at = ? WHERE id = ?',
        [elapsed, now, a.runId]
      );
      const current = await s.run(a.runId),
        limits = JSON.parse(current.limits_json);
      if (
        current.active_processing_ms >=
        (limits.activeProcessingMsPerRun ?? s.limits.activeProcessingMsPerRun)
      ) {
        await s.finish(current, 'completed', 'allowance_exhausted');
        return false;
      }
      return true;
    });
  }
  async input(a: ChatAttempt) {
    return this.mutate(a, async s => {
      const messages = await s.db.all<MessageRow>(
        'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 100',
        [a.threadId]
      );
      messages.reverse();
      const checkpoint = await s.checkpointLocked(a);
      const receipts = await s.receiptsLocked(a);
      const summary = await s.db.get<{
        summary_json: string;
        dependency_set_id: string | null;
        invalidated_at: string | null;
        covers_through_message_id: string | null;
      }>(
        'SELECT summary_json, dependency_set_id, invalidated_at, covers_through_message_id FROM chat_thread_summaries WHERE thread_id = ? ORDER BY summary_revision DESC LIMIT 1',
        [a.threadId]
      );
      const run = await s.run(a.runId);
      const questions = await s.db.all<QuestionRow>(
        'SELECT * FROM chat_questions WHERE thread_id = ? ORDER BY created_at, ordinal',
        [a.threadId]
      );
      const turn = await s.db.get<{ n: number | null }>(
        'SELECT MAX(turn_index) AS n FROM chat_tool_calls WHERE run_id = ?',
        [a.runId]
      );
      const visibleQuestions = [];
      for (const q of questions)
        if (await s.authorized(q.dependency_set_id)) visibleQuestions.push(questionDto(q));
      const summaryUsable =
        summary && !summary.invalidated_at && (await s.authorized(summary.dependency_set_id));
      return {
        summary: summaryUsable ? JSON.parse(summary.summary_json) : null,
        summaryCoversMessageId: summaryUsable ? summary.covers_through_message_id : null,
        messages: await Promise.all(messages.map(m => s.projectMessage(m))),
        checkpoint,
        receipts,
        questions: visibleQuestions,
        proposals: await Promise.all(
          (
            await s.db.all<Parameters<typeof proposalDto>[1]>(
              "SELECT * FROM chat_work_proposals WHERE thread_id = ? AND state = 'open' ORDER BY created_at, id",
              [a.threadId]
            )
          ).map(p => proposalDto(s, p))
        ),
        run: {
          triggerMessageId: run.trigger_message_id!,
          continuedFromRunId: run.continued_from_run_id,
          toolCalls: run.tool_call_count,
          activeProcessingMs: run.active_processing_ms,
          gatheredContentBytes: run.gathered_content_bytes,
          limits: JSON.parse(run.limits_json) as Record<string, number>
        },
        nextTurn: turn?.n === null || turn?.n === undefined ? 0 : Number(turn.n) + 1
      };
    });
  }
  /** The adapter must use this gate before each provider request; recovery reads use input(). */
  async providerInput(a: ChatAttempt) {
    const input = await this.input(a);
    if (
      input.checkpoint?.phase === 'tool_requested' ||
      input.receipts.some(c => ['requested', 'executing'].includes(c.state))
    )
      throw new ChatError('invalid_request');
    return input;
  }
  private async checkpointLocked(a: ChatAttempt): Promise<PrivateCheckpoint | null> {
    const cp = await this.db.get<{
      phase: PrivateCheckpoint['phase'];
      payload_json: string;
      dependency_set_id: string | null;
      invalidated_at: string | null;
    }>(
      'SELECT phase, payload_json, dependency_set_id, invalidated_at FROM chat_provider_checkpoints WHERE run_id = ?',
      [a.runId]
    );
    if (!cp || cp.invalidated_at || !(await this.authorized(cp.dependency_set_id))) return null;
    return {
      phase: cp.phase,
      payload: JSON.parse(cp.payload_json),
      dependencySetId: cp.dependency_set_id
    };
  }
  private async saveCheckpoint(a: ChatAttempt, cp: PrivateCheckpoint) {
    if (!(await this.authorized(cp.dependencySetId))) throw new ChatError('source_access_lost');
    cp = {
      ...cp,
      dependencySetId: await this.generationDependencies(a.threadId, cp.dependencySetId)
    };
    const payload = JSON.stringify(cp.payload);
    if (Buffer.byteLength(payload) > 2 * 1024 * 1024) throw new ChatError('limit_exceeded');
    await this.db.run(
      `INSERT INTO chat_provider_checkpoints (run_id, attempt_id, fence, schema_version, provider, model, config_digest, phase, payload_json, dependency_set_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id) DO UPDATE SET attempt_id = excluded.attempt_id, fence = excluded.fence, schema_version = excluded.schema_version, provider = excluded.provider, model = excluded.model, config_digest = excluded.config_digest, phase = excluded.phase, payload_json = excluded.payload_json, dependency_set_id = excluded.dependency_set_id, invalidated_at = NULL, updated_at = excluded.updated_at, revision = chat_provider_checkpoints.revision + 1`,
      [
        a.runId,
        a.id,
        a.fence,
        a.identity.checkpointVersion,
        a.identity.provider,
        a.identity.model,
        a.identity.configDigest,
        cp.phase,
        payload,
        cp.dependencySetId,
        this.timestamp(),
        this.timestamp()
      ]
    );
  }
  async requestTools(a: ChatAttempt, turn: number, requests: ToolRequest[], cp: PrivateCheckpoint) {
    return this.mutate(a, async (s, r) => {
      if (
        !Number.isSafeInteger(turn) ||
        turn < 0 ||
        cp.phase !== 'tool_requested' ||
        !requests.length ||
        requests.some((c, i) => c.order !== i) ||
        new Set(requests.map(c => c.providerCallId)).size !== requests.length
      )
        throw new ChatError('invalid_request');
      const old = await s.db.all<{
        operation_id: string;
        provider_call_id: string;
        tool_id: string;
        arguments_json: string;
      }>(
        'SELECT operation_id, provider_call_id, tool_id, arguments_json FROM chat_tool_calls WHERE run_id = ? AND turn_index = ? ORDER BY call_order',
        [a.runId, turn]
      );
      if (old.length) {
        if (
          !isDeepStrictEqual(
            old.map(o => [
              o.operation_id,
              o.provider_call_id,
              o.tool_id,
              JSON.parse(o.arguments_json)
            ]),
            requests.map(c => [c.operationId, c.providerCallId, c.toolId, c.arguments])
          )
        )
          throw new ChatError('invalid_request');
        if (!(await s.checkpointLocked(a))) await s.saveCheckpoint(a, cp);
        return true;
      }
      const previousCheckpoint = await s.checkpointLocked(a);
      if (previousCheckpoint?.phase === 'tool_requested') throw new ChatError('invalid_request');
      const limits = JSON.parse(r.limits_json);
      if (
        r.active_processing_ms + Math.max(0, s.now() - Date.parse(r.updated_at)) >=
          (limits.activeProcessingMsPerRun ?? s.limits.activeProcessingMsPerRun) ||
        r.tool_call_count + requests.length > (limits.toolCallsPerRun ?? s.limits.toolCallsPerRun)
      ) {
        await s.finish(r, 'completed', 'allowance_exhausted');
        return false;
      }
      cp = {
        ...cp,
        dependencySetId: await s.generationDependencies(a.threadId, cp.dependencySetId)
      };
      await s.saveCheckpoint(a, cp);
      for (const req of requests) {
        requiredText(req.operationId, 200);
        requiredText(req.toolId, 200);
        requiredText(req.providerCallId, 200);
        const args = JSON.stringify(req.arguments);
        if (Buffer.byteLength(args) > 64 * 1024) throw new ChatError('limit_exceeded');
        const callId = randomUUID();
        await s.db.run(
          `INSERT INTO chat_tool_calls (id, run_id, attempt_id, operation_id, turn_index, call_order, provider_call_id, tool_id, policy_version, arguments_json, state, requested_fence, writer_fence, dependency_set_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'requested', ?, ?, ?, ?, ?)`,
          [
            callId,
            a.runId,
            a.id,
            req.operationId,
            turn,
            req.order,
            req.providerCallId,
            req.toolId,
            args,
            a.fence,
            a.fence,
            cp.dependencySetId,
            s.timestamp(),
            s.timestamp()
          ]
        );
      }
      for (const receipt of (await s.receiptsLocked(a)).filter(c => c.turnIndex === turn))
        await s.toolEvent(a, receipt, 'requested', cp.dependencySetId);
      await s.db.run('UPDATE chat_runs SET tool_call_count = tool_call_count + ? WHERE id = ?', [
        requests.length,
        a.runId
      ]);
      return true;
    });
  }
  private async receiptsLocked(a: ChatAttempt): Promise<ToolReceipt[]> {
    const rows = await this.db.all<{
      id: string;
      operation_id: string;
      provider_call_id: string;
      tool_id: string;
      arguments_json: string;
      state: string;
      result_json: string | null;
      call_order: number;
      turn_index: number;
      dependency_set_id: string | null;
      created_at: string;
    }>('SELECT * FROM chat_tool_calls WHERE run_id = ? ORDER BY turn_index, call_order', [a.runId]);
    const out: ToolReceipt[] = [];
    for (const row of rows) {
      if (!(await this.authorized(row.dependency_set_id))) continue;
      out.push({
        id: row.id,
        operationId: row.operation_id,
        providerCallId: row.provider_call_id,
        toolId: row.tool_id,
        arguments: JSON.parse(row.arguments_json),
        state: row.state,
        result: row.result_json ? JSON.parse(row.result_json) : null,
        order: row.call_order,
        turnIndex: row.turn_index,
        createdAt: row.created_at
      });
    }
    return out;
  }
  private async toolEvent(
    a: ChatAttempt,
    receipt: ToolReceipt,
    state: 'requested' | 'executing' | 'completed' | 'failed',
    deps: string | null
  ) {
    await this.append(
      a.threadId,
      {
        kind: 'tool.updated',
        runId: a.runId,
        toolCallId: receipt.id,
        label: toolProgressLabel(receipt.toolId),
        state
      },
      deps,
      a
    );
  }
  async toolResult(
    a: ChatAttempt,
    operationId: string,
    result: unknown,
    errorCode: string | null = null
  ) {
    return this.mutate(a, async s => {
      const call = await s.db.get<{ state: string; dependency_set_id: string | null }>(
        'SELECT state, dependency_set_id FROM chat_tool_calls WHERE operation_id = ? AND run_id = ?',
        [operationId, a.runId]
      );
      if (!call || !(await s.authorized(call.dependency_set_id)))
        throw new ChatError('source_access_lost');
      if (['completed', 'failed'].includes(call.state)) return;
      const payload = JSON.stringify(result),
        bytes = Buffer.byteLength(payload);
      if (bytes > 128 * 1024) throw new ChatError('limit_exceeded');
      await s.db.run(
        `UPDATE chat_tool_calls SET state = ?, result_json = ?, result_bytes = ?, writer_fence = ?, executions = executions + 1, error_code = ?, completed_at = ?, updated_at = ? WHERE operation_id = ? AND run_id = ?`,
        [
          errorCode ? 'failed' : 'completed',
          payload,
          bytes,
          a.fence,
          errorCode,
          s.timestamp(),
          s.timestamp(),
          operationId,
          a.runId
        ]
      );
      await s.db.run(
        'UPDATE chat_runs SET gathered_content_bytes = gathered_content_bytes + ? WHERE id = ?',
        [bytes, a.runId]
      );
      const receipt = (await s.receiptsLocked(a)).find(c => c.operationId === operationId)!;
      await s.toolEvent(a, receipt, errorCode ? 'failed' : 'completed', call.dependency_set_id);
    });
  }
  /** Invocation gate: renew/fence check immediately before calling an injected reviewed read. */
  async executeTool(
    a: ChatAttempt,
    operationId: string,
    read: (receipt: ToolReceipt) => Promise<unknown>
  ) {
    const receipt = await this.mutate(a, async s => {
      const call = (await s.receiptsLocked(a)).find(r => r.operationId === operationId);
      if (!call) throw new ChatError('invalid_request');
      if (['completed', 'failed'].includes(call.state)) return call;
      const checkpoint = await s.checkpointLocked(a);
      if (!checkpoint || checkpoint.phase !== 'tool_requested')
        throw new ChatError('invalid_request');
      const count = await s.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM chat_tool_calls WHERE run_id = ? AND state = 'executing'",
        [a.runId]
      );
      if (call.state === 'executing' || Number(count?.n) >= s.limits.concurrentTargetReadsPerRun)
        throw new ChatError('limit_exceeded');
      await s.db.run(
        "UPDATE chat_tool_calls SET state = 'executing' , writer_fence = ?, updated_at = ? WHERE operation_id = ? AND run_id = ?",
        [a.fence, s.timestamp(), operationId, a.runId]
      );
      await s.toolEvent(a, call, 'executing', checkpoint.dependencySetId);
      return call;
    });
    if (['completed', 'failed'].includes(receipt.state)) return receipt.result;
    let result: unknown;
    try {
      result = await read(receipt);
    } catch {
      await this.toolResult(a, operationId, { error: 'Read failed' }, 'read_failed');
      return null;
    }
    await this.toolResult(a, operationId, result);
    return result;
  }
  async joinTools(a: ChatAttempt, turn: number, cp: PrivateCheckpoint, orderedCallIds: string[]) {
    return this.mutate(a, async s => {
      const calls = await s.db.all<{ state: string; provider_call_id: string }>(
        'SELECT state, provider_call_id FROM chat_tool_calls WHERE run_id = ? AND turn_index = ? ORDER BY call_order',
        [a.runId, turn]
      );
      if (
        cp.phase !== 'tool_results_joined' ||
        !calls.length ||
        calls.some(c => !['completed', 'failed'].includes(c.state)) ||
        JSON.stringify(calls.map(c => c.provider_call_id)) !== JSON.stringify(orderedCallIds)
      )
        throw new ChatError('invalid_request');
      await s.saveCheckpoint(a, cp);
    });
  }
  async text(
    a: ChatAttempt,
    text: string,
    dependencySetId: string | null = null,
    messageId?: string
  ) {
    requiredText(text, this.limits.messageMaxChars);
    return this.mutate(a, async s => {
      if (!(await s.authorized(dependencySetId))) throw new ChatError('source_access_lost');
      const inherited = await s.db.all<{ dependency_set_id: string }>(
        'SELECT DISTINCT dependency_set_id FROM chat_messages WHERE thread_id = ? AND dependency_set_id IS NOT NULL AND invalidated_at IS NULL',
        [a.threadId]
      );
      const sets = [
        ...inherited.map(m => m.dependency_set_id),
        ...(dependencySetId ? [dependencySetId] : [])
      ];
      const deps = sets.length ? await s.dependencySet(a.threadId, [], sets) : null;
      const old =
        messageId &&
        (await s.db.get<MessageRow>(
          "SELECT * FROM chat_messages WHERE id = ? AND run_id = ? AND role = 'assistant' AND state = 'streaming'",
          [messageId, a.runId]
        ));
      if (messageId && !old) throw new ChatError('invalid_request');
      const id = old ? old.id! : randomUUID();
      const blocks: ChatBlockDto[] = old
        ? JSON.parse(old.blocks_json)
        : [{ id: randomUUID(), kind: 'text', text: '', evidenceIds: [], fallbackText: '' }];
      const block = blocks[0];
      if (!block || block.kind !== 'text') throw new ChatError('invalid_request');
      if (block.text.length + text.length > s.limits.messageMaxChars)
        throw new ChatError('limit_exceeded');
      block.text += text;
      block.fallbackText = block.text;
      if (old)
        await s.db.run(
          'UPDATE chat_messages SET blocks_json = ?, dependency_set_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
          [JSON.stringify(blocks), deps, s.timestamp(), id]
        );
      else
        await s.db.run(
          `INSERT INTO chat_messages (id, thread_id, role, state, blocks_json, run_id, dependency_set_id, created_at, updated_at) VALUES (?, ?, 'assistant', 'streaming', ?, ?, ?, ?, ?)`,
          [
            id,
            a.threadId,
            JSON.stringify(blocks),
            a.runId,
            deps,
            await s.createdAt('chat_messages', a.threadId),
            s.timestamp()
          ]
        );
      const message = await s.db.get<MessageRow>('SELECT * FROM chat_messages WHERE id = ?', [id]);
      await s.append(
        a.threadId,
        old
          ? { kind: 'message.delta', messageId: id, blockId: block.id, text }
          : { kind: 'message.created', message: messageDto(message!) },
        deps,
        a
      );
      return id;
    });
  }
  async question(
    a: ChatAttempt,
    prompt: string,
    options: ChatQuestionOptionDto[] = [],
    allowFreeText = true,
    dependencySetId: string | null = null
  ) {
    requiredText(prompt, 4000);
    if (options.length > 20 || new Set(options.map(o => o.id)).size !== options.length)
      throw new ChatError('invalid_request');
    for (const o of options) {
      requiredText(o.id, 200);
      requiredText(o.label, 1000);
    }
    if (!allowFreeText && !options.length) throw new ChatError('invalid_request');
    return this.mutate(a, async (s, r) => {
      if (!(await s.authorized(dependencySetId))) throw new ChatError('source_access_lost');
      dependencySetId = await s.generationDependencies(a.threadId, dependencySetId);
      const n = await s.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM chat_questions WHERE run_id = ?',
        [a.runId]
      );
      const id = randomUUID(),
        now = s.timestamp();
      await s.db.run(
        `INSERT INTO chat_questions (id, thread_id, run_id, ordinal, state, prompt, options_json, allow_free_text, dependency_set_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
        [
          id,
          a.threadId,
          a.runId,
          Number(n?.n) + 1,
          prompt,
          JSON.stringify(options),
          bindBool(s.db.dialect, allowFreeText),
          dependencySetId,
          now,
          now
        ]
      );
      await s.db.run("UPDATE chat_run_attempts SET state = 'released', ended_at = ? WHERE id = ?", [
        now,
        a.id
      ]);
      await s.db.run(
        "UPDATE chat_runs SET state = 'waiting_user', active_attempt_id = NULL, active_processing_ms = active_processing_ms + ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
        [Math.max(0, s.now() - Date.parse(r.updated_at)), now, a.runId]
      );
      const q = await s.db.get<QuestionRow>('SELECT * FROM chat_questions WHERE id = ?', [id]);
      const seq = await s.append(
        a.threadId,
        { kind: 'question.opened', question: questionDto(q!) },
        dependencySetId,
        a
      );
      await s.append(a.threadId, {
        kind: 'run.updated',
        run: runDto(await s.run(a.runId))
      });
      await s.notification(await s.run(a.runId), seq, q!);
      return questionDto(q!);
    });
  }
  /** Conservative dependency union for the next generation: every authorized set in the thread. */
  async dependencies(a: ChatAttempt): Promise<string | null> {
    return this.mutate(a, s => s.generationDependencies(a.threadId, null));
  }
  /**
   * Registers the sources a tool result drew on, checks them live, and records one evidence
   * row per source. The tool call's dependency set becomes the union of its request context
   * and these sources, so recovery and replay of its result are authorized with them. When a
   * source cannot be verified the result is withheld (`unverified`) and nothing is recorded.
   */
  async recordEvidence(
    a: ChatAttempt,
    operationId: string,
    sources: EvidenceInput[]
  ): Promise<{ evidence: RecordedEvidence[]; unverified: boolean }> {
    if (sources.length > 50) throw new ChatError('limit_exceeded');
    return this.mutate(a, async s => {
      const call = await s.db.get<{ id: string; dependency_set_id: string | null }>(
        'SELECT id, dependency_set_id FROM chat_tool_calls WHERE operation_id = ? AND run_id = ?',
        [operationId, a.runId]
      );
      if (!call) throw new ChatError('invalid_request');
      if (!sources.length) return { evidence: [], unverified: false };
      const t = await s.thread(a.threadId);
      const owner = { profileId: t.owner_profile_id, organizationId: t.organization_id };
      const ids = await s.registerSources(owner, a.threadId, sources);
      await s.checkSources(a.threadId, ids);
      const states = await s.db.all<{ id: string; access_state: string }>(
        `SELECT id, access_state FROM chat_source_refs WHERE thread_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
        [a.threadId, ...ids]
      );
      if (states.some(r => r.access_state !== 'authorized'))
        return { evidence: [], unverified: true };
      const set = await s.dependencySet(
        a.threadId,
        ids,
        call.dependency_set_id ? [call.dependency_set_id] : []
      );
      await s.db.run(
        'UPDATE chat_tool_calls SET dependency_set_id = ?, writer_fence = ?, updated_at = ? WHERE id = ?',
        [set, a.fence, s.timestamp(), call.id]
      );
      const count = await s.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM chat_evidence WHERE thread_id = ?',
        [a.threadId]
      );
      const evidence: RecordedEvidence[] = [];
      for (const [i, source] of sources.entries()) {
        const evidenceId = randomUUID();
        await s.db.run(
          `INSERT INTO chat_evidence (id, thread_id, run_id, tool_call_id, source_ref_id, label, excerpt, excerpt_truncated, source_revision, observed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            evidenceId,
            a.threadId,
            a.runId,
            call.id,
            ids[i],
            requiredText(source.label.slice(0, 300), 300),
            source.excerpt?.slice(0, 2000) ?? null,
            bindBool(s.db.dialect, source.truncated),
            source.revision?.slice(0, 200) ?? null,
            new Date(Date.parse(source.observedAt) || s.now()).toISOString(),
            s.timestamp()
          ]
        );
        evidence.push({ ref: `E${Number(count?.n) + i + 1}`, evidenceId, label: source.label });
      }
      return { evidence, unverified: false };
    });
  }
  /**
   * Attaches cited evidence to an assistant message of this run: the text block's
   * `evidenceIds` and an `evidence` block. Only authorized evidence of this thread is
   * attached; the message's dependency set grows to include the cited sources.
   */
  async attachCitations(a: ChatAttempt, messageId: string, evidenceIds: string[]) {
    return this.mutate(a, async s => {
      const m = await s.db.get<MessageRow>(
        "SELECT * FROM chat_messages WHERE id = ? AND run_id = ? AND role = 'assistant'",
        [messageId, a.runId]
      );
      if (!m) throw new ChatError('invalid_request');
      const rows = evidenceIds.length
        ? await s.db.all<{
            id: string;
            source_ref_id: string;
            label: string;
            excerpt: string | null;
            excerpt_truncated: number | boolean;
            source_revision: string | null;
            observed_at: string;
            locator_json: string;
            access_state: string;
          }>(
            `SELECT e.*, r.locator_json, r.access_state FROM chat_evidence e JOIN chat_source_refs r ON r.id = e.source_ref_id WHERE e.thread_id = ? AND e.id IN (${evidenceIds.map(() => '?').join(', ')})`,
            [a.threadId, ...evidenceIds]
          )
        : [];
      // One entry per source: a note searched and then read is cited once.
      const seen = new Set<string>();
      const usable = evidenceIds
        .map(id => rows.find(r => r.id === id))
        .filter((r): r is (typeof rows)[number] => Boolean(r && r.access_state === 'authorized'))
        .filter(r => !seen.has(r.source_ref_id) && Boolean(seen.add(r.source_ref_id)));
      if (!usable.length) return [];
      const blocks: ChatBlockDto[] = JSON.parse(m.blocks_json);
      const text = blocks.find(b => b.kind === 'text');
      if (!text || text.kind !== 'text') throw new ChatError('invalid_request');
      text.evidenceIds = usable.map(r => r.id);
      const staleBefore = s.now() - 15 * 60 * 1000;
      const evidence: ChatEvidenceDto[] = usable.map(r => ({
        id: r.id,
        source: JSON.parse(r.locator_json),
        sourceRevision: r.source_revision,
        observedAt: r.observed_at,
        label: r.label,
        excerpt: r.excerpt,
        truncated: Boolean(r.excerpt_truncated),
        stale: Date.parse(r.observed_at) < staleBefore
      }));
      const others: ChatBlockDto[] = blocks.filter(b => b.kind !== 'evidence');
      others.push({
        id: randomUUID(),
        kind: 'evidence',
        evidence,
        fallbackText: `Sources: ${evidence.map(e => e.label).join('; ')}`.slice(0, 4000)
      });
      const deps = await s.dependencySet(
        a.threadId,
        [...new Set(usable.map(r => r.source_ref_id))],
        m.dependency_set_id ? [m.dependency_set_id] : []
      );
      await s.db.run(
        'UPDATE chat_messages SET blocks_json = ?, dependency_set_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        [JSON.stringify(others), deps, s.timestamp(), messageId]
      );
      return evidence.map(e => e.id);
    });
  }
  /** Writes the next compact thread summary, dependent on everything the generation could see. */
  async summarize(a: ChatAttempt, summary: ThreadSummary) {
    const json = JSON.stringify(summary);
    if (Buffer.byteLength(json) > 16 * 1024) throw new ChatError('limit_exceeded');
    return this.mutate(a, async s => {
      const deps = await s.generationDependencies(a.threadId, null);
      const last = await s.db.get<{ n: number | null }>(
        'SELECT MAX(summary_revision) AS n FROM chat_thread_summaries WHERE thread_id = ?',
        [a.threadId]
      );
      const latest = await s.db.get<{ id: string }>(
        'SELECT id FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
        [a.threadId]
      );
      await s.db.run(
        'INSERT INTO chat_thread_summaries (id, thread_id, summary_revision, summary_json, covers_through_message_id, dependency_set_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          randomUUID(),
          a.threadId,
          Number(last?.n ?? 0) + 1,
          json,
          latest?.id ?? null,
          deps,
          s.timestamp()
        ]
      );
    });
  }
  /** The newest question of this run opened at or after `since`, with its projected answer. */
  async questionSince(a: ChatAttempt, since: string) {
    return this.mutate(a, async s => {
      const q = await s.db.get<QuestionRow>(
        'SELECT * FROM chat_questions WHERE run_id = ? AND created_at >= ? ORDER BY ordinal DESC LIMIT 1',
        [a.runId, since]
      );
      if (!q) return null;
      const answer =
        q.answer_message_id &&
        (await s.db.get<MessageRow>('SELECT * FROM chat_messages WHERE id = ?', [
          q.answer_message_id
        ]));
      const projected = answer ? await s.projectMessage(answer) : null;
      const block = projected?.blocks[0];
      return {
        question: questionDto(q),
        answer: block ? (block.kind === 'text' ? block.text : block.fallbackText) : null
      };
    });
  }
  async complete(a: ChatAttempt, outcome: 'answered' | 'allowance_exhausted' = 'answered') {
    return this.mutate(a, async (s, r) => {
      const checkpoint = await s.checkpointLocked(a);
      const pending = await s.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM chat_tool_calls WHERE run_id = ? AND state IN ('requested','executing')",
        [a.runId]
      );
      if (outcome === 'answered' && (checkpoint?.phase === 'tool_requested' || Number(pending?.n)))
        throw new ChatError('invalid_request');
      const messages = await s.db.all<MessageRow>(
        "SELECT * FROM chat_messages WHERE run_id = ? AND state = 'streaming'",
        [a.runId]
      );
      for (const m of messages) {
        await s.db.run(
          "UPDATE chat_messages SET state = 'complete', updated_at = ?, revision = revision + 1 WHERE id = ?",
          [s.timestamp(), m.id]
        );
        await s.append(
          a.threadId,
          {
            kind: 'message.completed',
            message: messageDto({
              ...m,
              state: 'complete',
              revision: m.revision + 1,
              updated_at: s.timestamp()
            })
          },
          m.dependency_set_id,
          a
        );
      }
      await s.db.run(
        'UPDATE chat_runs SET active_processing_ms = active_processing_ms + ? WHERE id = ?',
        [Math.max(0, s.now() - Date.parse(r.updated_at)), a.runId]
      );
      const current = await s.run(a.runId),
        limits = JSON.parse(current.limits_json);
      return s.finish(
        current,
        'completed',
        current.active_processing_ms >=
          (limits.activeProcessingMsPerRun ?? s.limits.activeProcessingMsPerRun)
          ? 'allowance_exhausted'
          : outcome
      );
    });
  }
  async fail(a: ChatAttempt, code: ChatRunFailureCode) {
    return this.mutate(a, (s, r) => s.finish(r, 'failed', null, code));
  }
}
