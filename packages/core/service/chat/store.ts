import {
  CHAT_DEFAULT_LIMITS,
  type ChatBlockDto,
  type ChatErrorCode,
  type ChatEventDto,
  type ChatKnowledgebaseWriteDto,
  type ChatMessageDto,
  type ChatQuestionDto,
  type ChatRunDto,
  type ChatSourceLocatorDto,
  type ChatThreadDto
} from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import type { Selectable } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type {
  ChatEvents,
  ChatMessages,
  ChatQuestions,
  ChatRuns,
  ChatSourceRefs,
  ChatThreads
} from '../../types/db.js';
import { ServiceError } from '../errors.js';

import { appendDiagnostic } from './diagnostics.js';
import { storedKnowledgebaseWrite } from './knowledgebase-writes.js';
import { chatSpan, chatSpanElapsed } from './performance.js';

export type ThreadRow = Selectable<ChatThreads>;
export type RunRow = Selectable<ChatRuns>;
export type MessageRow = Selectable<ChatMessages>;
export type QuestionRow = Selectable<ChatQuestions>;
export type EventRow = Selectable<ChatEvents>;
export type SourceRow = Selectable<ChatSourceRefs>;
export type EventPayload = ChatEventDto extends infer E
  ? E extends ChatEventDto
    ? Omit<E, 'threadId' | 'seq' | 'createdAt'>
    : never
  : never;
export interface ChatOwner {
  profileId: string;
  organizationId: string;
}
export type SourceChecker = (
  owner: ChatOwner,
  source: ChatSourceLocatorDto,
  signal: AbortSignal
) => Promise<'authorized' | 'revoked' | 'unknown'>;
export interface ChatAssignmentCatalog {
  agents: Record<
    string,
    {
      models: { id: string; reasoningOptions: string[]; enabled?: boolean }[];
      defaultModel: string | null;
      defaultReasoningEffort: string | null;
    }
  >;
}
export interface ChatOptions {
  assignmentCatalog?: (workspaceId: string) => Promise<ChatAssignmentCatalog>;
  /**
   * Checks a submitted Knowledgebase write grant against the owner's stored connection
   * (v154). Without it every grant is refused; execution re-checks the live connection.
   */
  authorizeKnowledgebaseWrite?: (
    owner: ChatOwner,
    grant: ChatKnowledgebaseWriteDto
  ) => Promise<'authorized' | 'invalid' | 'reauthorization_required'>;
  now?: () => number;
  checkSource?: SourceChecker;
  limits?: Partial<{ [K in keyof typeof CHAT_DEFAULT_LIMITS]: number }>;
}
export class ChatError extends ServiceError {
  /**
   * @param detail Optional specific reason for the assistant's own tool results (for example
   * which resource key is not registered). It is never part of an HTTP error body.
   */
  constructor(
    code: ChatErrorCode,
    readonly detail?: string
  ) {
    const status =
      code === 'not_found' || code === 'chat_unavailable' || code === 'provider_not_available'
        ? 404
        : code === 'invalid_request'
          ? 400
          : code === 'limit_exceeded'
            ? 429
            : code === 'provider_not_ready'
              ? 503
              : code === 'credential_rejected'
                ? 422
                : code === 'provider_unavailable'
                  ? 502
                  : 409;
    super(code.replaceAll('_', ' '), code, status);
  }
}
export const requiredText = (value: unknown, max: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new ChatError('invalid_request');
  return value;
};
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ChatError('invalid_request');
  return Number(value);
}
export function messageDto(r: MessageRow): ChatMessageDto {
  return {
    id: r.id!,
    threadId: r.thread_id,
    role: r.role as ChatMessageDto['role'],
    state: r.state as ChatMessageDto['state'],
    blocks: JSON.parse(r.blocks_json),
    runId: r.run_id,
    answersQuestionId: r.answers_question_id,
    clientRequestId: r.client_request_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revision: r.revision
  };
}
export function questionDto(r: QuestionRow): ChatQuestionDto {
  return {
    id: r.id!,
    threadId: r.thread_id,
    runId: r.run_id,
    ordinal: r.ordinal,
    state: r.state as ChatQuestionDto['state'],
    prompt: r.prompt,
    options: JSON.parse(r.options_json),
    allowFreeText: Boolean(r.allow_free_text),
    answerMessageId: r.answer_message_id,
    createdAt: r.created_at,
    answeredAt: r.answered_at,
    revision: r.revision
  };
}
export function runDto(r: RunRow, continueAvailable = false): ChatRunDto {
  return {
    id: r.id!,
    threadId: r.thread_id,
    triggerMessageId: r.trigger_message_id!,
    state: r.state as ChatRunDto['state'],
    outcome: r.outcome as ChatRunDto['outcome'],
    failureCode: r.failure_code as ChatRunDto['failureCode'],
    continuedFromRunId: r.continued_from_run_id,
    continueAvailable,
    knowledgebaseWrite: storedKnowledgebaseWrite(r.knowledgebase_write_json),
    usage: {
      toolCalls: r.tool_call_count,
      activeProcessingMs: r.active_processing_ms,
      gatheredContentBytes: r.gathered_content_bytes
    },
    cancelRequestedAt: r.cancel_requested_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    revision: r.revision
  };
}
export const unavailableBlocks = (): ChatBlockDto[] => [
  {
    id: 'unavailable',
    kind: 'unavailable',
    reason: 'source_access_lost',
    regenerable: true,
    fallbackText: 'Source access is no longer available.'
  }
];

/** All reads and writes serialize on the thread row, including PG snapshots at READ COMMITTED. */
export class ChatStore {
  readonly limits;
  constructor(
    readonly db: DatabaseClient,
    readonly options: ChatOptions = {}
  ) {
    this.limits = { ...CHAT_DEFAULT_LIMITS, ...options.limits };
  }
  now() {
    return this.options.now?.() ?? Date.now();
  }
  timestamp() {
    return new Date(this.now()).toISOString();
  }
  /** Diagnostic observations may record late provider failures after a lease ends. */
  async diagnostic(
    threadId: string,
    kind: string,
    payload: unknown,
    runId: string | null = null,
    attemptId: string | null = null
  ): Promise<void> {
    const started = performance.now();
    await chatSpan('diagnostic.transaction', () =>
      this.db.transaction(async tx => {
        chatSpanElapsed('diagnostic.admission', started);
        const store = new ChatStore(tx, this.options);
        await store.lockForDiagnostic(threadId);
        await appendDiagnostic(tx, threadId, kind, payload, store.timestamp(), runId, attemptId);
      })
    );
  }
  private async lockForDiagnostic(id: string): Promise<void> {
    // Diagnostics need the same per-thread writer lock, but do not consume the
    // thread DTO. The UPDATE both acquires the lock and confirms the FK owner row.
    const result = await chatSpan('thread.lock', () =>
      this.db.run('UPDATE chat_threads SET id = id WHERE id = ?', [id])
    );
    if (!result.changes) throw new ChatError('not_found');
  }
  async access(owner: ChatOwner): Promise<void> {
    const member = await this.db.get(
      `SELECT wu.id FROM workspace_users wu JOIN workspaces w ON w.id = wu.workspace_id JOIN organizations o ON o.id = w.organization_id WHERE wu.profile_id = ? AND w.organization_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL AND w.deleted_at IS NULL AND o.deleted_at IS NULL LIMIT 1`,
      [owner.profileId, owner.organizationId]
    );
    if (!member) throw new ChatError('not_found');
  }
  async generationDependencies(threadId: string, setId: string | null): Promise<string | null> {
    const sets = await this.db.all<{ id: string }>(
      'SELECT id FROM chat_dependency_sets WHERE thread_id = ? AND invalidated_at IS NULL',
      [threadId]
    );
    return sets.length || setId
      ? this.dependencySet(threadId, [], [...sets.map(s => s.id), ...(setId ? [setId] : [])])
      : null;
  }
  async createdAt(table: 'chat_runs' | 'chat_messages', threadId: string): Promise<string> {
    const last = await this.db.get<{ created_at: string }>(
      `SELECT created_at FROM ${table} WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1`,
      [threadId]
    );
    // Preserve insertion order even when successive writes share one millisecond.
    return new Date(Math.max(this.now(), last ? Date.parse(last.created_at) + 1 : 0)).toISOString();
  }
  async thread(id: string, owner?: ChatOwner): Promise<ThreadRow> {
    const row = await this.db.get<ThreadRow>(
      `SELECT * FROM chat_threads WHERE id = ?${owner ? ' AND owner_profile_id = ? AND organization_id = ?' : ''}`,
      owner ? [id, owner.profileId, owner.organizationId] : [id]
    );
    if (!row) throw new ChatError('not_found');
    return row;
  }
  async lock(id: string, owner?: ChatOwner) {
    if (owner) await this.access(owner);
    // The owner predicate prevents an unauthorized request from locking another person's thread.
    const result = await chatSpan('thread.lock', () =>
      this.db.run(
        `UPDATE chat_threads SET id = id WHERE id = ?${owner ? ' AND owner_profile_id = ? AND organization_id = ?' : ''}`,
        owner ? [id, owner.profileId, owner.organizationId] : [id]
      )
    );
    if (!result.changes) throw new ChatError('not_found');
    return this.thread(id, owner);
  }
  async run(id: string): Promise<RunRow> {
    const r = await this.db.get<RunRow>('SELECT * FROM chat_runs WHERE id = ?', [id]);
    if (!r) throw new ChatError('not_found');
    return r;
  }
  async threadDto(r: ThreadRow): Promise<ChatThreadDto> {
    const active = await this.db.get<RunRow>(
      "SELECT * FROM chat_runs WHERE thread_id = ? AND state IN ('queued','running','waiting_user')",
      [r.id]
    );
    return {
      id: r.id!,
      organizationId: r.organization_id,
      title: r.title,
      titleSource: r.title_source as ChatThreadDto['titleSource'],
      archivedAt: r.archived_at,
      lastActivityAt: r.last_activity_at,
      activeRunState: (active?.state as ChatThreadDto['activeRunState']) ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      revision: r.revision
    };
  }
  async append(
    threadId: string,
    payload: EventPayload,
    dependencySetId: string | null = null,
    attempt?: { runId: string; id: string; fence: number }
  ): Promise<number> {
    await this.db.run(
      'UPDATE chat_threads SET last_event_seq = last_event_seq + 1, last_activity_at = ? WHERE id = ?',
      [this.timestamp(), threadId]
    );
    const t = await this.thread(threadId);
    await this.db.run(
      `INSERT INTO chat_events (id, thread_id, seq, kind, run_id, attempt_id, fence, payload_json, dependency_set_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        threadId,
        t.last_event_seq,
        payload.kind,
        attempt?.runId ?? null,
        attempt?.id ?? null,
        attempt?.fence ?? null,
        JSON.stringify(payload),
        dependencySetId,
        this.timestamp()
      ]
    );
    const runId =
      attempt?.runId ??
      ('run' in payload ? payload.run.id : 'runId' in payload ? payload.runId : null);
    const run = runId ? await this.run(runId) : null;
    const attempts = runId
      ? await this.db.all(
          'SELECT * FROM chat_run_attempts WHERE run_id = ? ORDER BY attempt_number',
          [runId]
        )
      : [];
    const tool =
      'toolCallId' in payload
        ? await this.db.get('SELECT * FROM chat_tool_calls WHERE id = ?', [payload.toolCallId])
        : null;
    await appendDiagnostic(
      this.db,
      threadId,
      payload.kind,
      { event: payload, eventSeq: t.last_event_seq, run, attempts, tool },
      this.timestamp(),
      runId,
      attempt?.id ?? null
    );
    await this.retain(threadId);
    return t.last_event_seq;
  }
  async retain(id: string) {
    const t = await this.thread(id);
    const oldest = await this.db.get<{ seq: number }>(
      'SELECT seq FROM chat_events WHERE thread_id = ? AND created_at >= ? ORDER BY seq LIMIT 1',
      [id, new Date(this.now() - this.limits.eventRetentionMs).toISOString()]
    );
    const boundary = Math.max(
      t.retained_from_seq,
      oldest?.seq ?? t.last_event_seq + 1,
      t.last_event_seq - this.limits.eventRetentionCount + 1
    );
    await this.db.run('DELETE FROM chat_events WHERE thread_id = ? AND seq < ?', [id, boundary]);
    await this.db.run('UPDATE chat_threads SET retained_from_seq = ? WHERE id = ?', [boundary, id]);
  }
  async authorized(setId: string | null): Promise<boolean> {
    if (!setId) return true;
    const set = await this.db.get<{ invalidated_at: string | null }>(
      'SELECT invalidated_at FROM chat_dependency_sets WHERE id = ?',
      [setId]
    );
    return Boolean(set && !set.invalidated_at);
  }
  async projectMessage(r: MessageRow): Promise<ChatMessageDto> {
    const dto = messageDto(r);
    if (r.invalidated_at || !(await this.authorized(r.dependency_set_id)))
      dto.blocks = unavailableBlocks();
    return dto;
  }
  /**
   * Registers source identities for a thread (upsert by stable scope key) and returns their ids.
   * A Knowledgebase locator's display path may differ between results for the same node, so
   * identity is compared without it; every other locator must match exactly.
   */
  async registerSources(
    owner: ChatOwner,
    threadId: string,
    sources: { scopeKey: string; locator: ChatSourceLocatorDto }[]
  ): Promise<string[]> {
    const ids: string[] = [];
    const identity = (l: ChatSourceLocatorDto) =>
      l.kind === 'knowledgebase' ? { ...l, path: null } : l;
    for (const source of sources) {
      requiredText(source.scopeKey, 1000);
      const now = this.timestamp();
      // Index Knowledgebase sources by the owner's connection, so losing that connection
      // can invalidate every thread that cites it. A foreign id is never linked.
      const connection =
        source.locator.kind === 'knowledgebase'
          ? await this.db.get<{ id: string }>(
              'SELECT id FROM account_connections WHERE id = ? AND owner_profile_id = ? AND organization_id = ?',
              [source.locator.connectionId, owner.profileId, owner.organizationId]
            )
          : undefined;
      await this.db.run(
        `INSERT INTO chat_source_refs (id, thread_id, source_kind, scope_key, connection_id, locator_json, access_state, access_checked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?) ON CONFLICT (thread_id, scope_key) DO NOTHING`,
        [
          randomUUID(),
          threadId,
          source.locator.kind,
          source.scopeKey,
          connection?.id ?? null,
          JSON.stringify(source.locator),
          now,
          now,
          now
        ]
      );
      const row = await this.db.get<{ id: string; locator_json: string }>(
        'SELECT id, locator_json FROM chat_source_refs WHERE thread_id = ? AND scope_key = ?',
        [threadId, source.scopeKey]
      );
      if (!isDeepStrictEqual(identity(JSON.parse(row!.locator_json)), identity(source.locator)))
        throw new ChatError('invalid_request');
      ids.push(row!.id);
    }
    return ids;
  }
  async checkSources(threadId: string, onlyIds?: readonly string[]): Promise<void> {
    return chatSpan('source.authorization', () => this.checkSourcesMeasured(threadId, onlyIds));
  }
  private async checkSourcesMeasured(threadId: string, onlyIds?: readonly string[]): Promise<void> {
    const t = await this.thread(threadId);
    const owner = { profileId: t.owner_profile_id, organizationId: t.organization_id };
    try {
      await this.access(owner);
    } catch {
      const runs = await this.db.all<RunRow>(
        "SELECT * FROM chat_runs WHERE thread_id = ? AND state IN ('queued','running','waiting_user')",
        [threadId]
      );
      for (const r of runs) await this.finish(r, 'failed', null, 'source_access_lost');
      return;
    }
    const sources = (
      await this.db.all<SourceRow>('SELECT * FROM chat_source_refs WHERE thread_id = ?', [threadId])
    ).filter(source => !onlyIds || onlyIds.includes(source.id!));
    for (const source of sources) {
      let state: 'authorized' | 'revoked' | 'unknown' = 'unknown';
      const checkSource = this.options.checkSource;
      if (checkSource) {
        const signal = AbortSignal.timeout(3000);
        try {
          state = await chatSpan('source.checker', () =>
            Promise.race([
              checkSource(owner, JSON.parse(source.locator_json), signal),
              new Promise<'unknown'>(resolve =>
                signal.addEventListener('abort', () => resolve('unknown'), { once: true })
              )
            ])
          );
        } catch {
          /* Fail closed, without leaking adapter errors. */
        }
      }
      await this.db.run(
        'UPDATE chat_source_refs SET access_state = ?, access_checked_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        [state, this.timestamp(), this.timestamp(), source.id]
      );
      if (state !== 'authorized') await this.invalidate(threadId, source.id!);
    }
  }
  /** Rechecks one thread's sources under its row lock, e.g. after a connection loses access. */
  async revalidate(threadId: string): Promise<void> {
    await this.db.transaction(async tx => {
      const s = new ChatStore(tx, this.options);
      await s.lock(threadId);
      await s.checkSources(threadId);
    });
  }
  /** Rechecks every thread that cites a source obtained through `connectionId`. */
  async revalidateConnection(connectionId: string): Promise<void> {
    const threads = await this.db.all<{ thread_id: string }>(
      'SELECT DISTINCT thread_id FROM chat_source_refs WHERE connection_id = ?',
      [connectionId]
    );
    for (const { thread_id } of threads) await this.revalidate(thread_id);
  }
  async invalidate(threadId: string, sourceId: string): Promise<void> {
    const sets = await this.db.all<{ id: string }>(
      `SELECT s.id FROM chat_dependency_sets s JOIN chat_dependency_set_members m ON m.dependency_set_id = s.id WHERE s.thread_id = ? AND m.source_ref_id = ? AND s.invalidated_at IS NULL`,
      [threadId, sourceId]
    );
    if (!sets.length) return;
    const messageIds: string[] = [],
      proposalIds: string[] = [];
    for (const { id } of sets) {
      await this.db.run('UPDATE chat_dependency_sets SET invalidated_at = ? WHERE id = ?', [
        this.timestamp(),
        id
      ]);
      messageIds.push(
        ...(
          await this.db.all<{ id: string }>(
            'SELECT id FROM chat_messages WHERE dependency_set_id = ?',
            [id]
          )
        ).map(r => r.id)
      );
      proposalIds.push(
        ...(
          await this.db.all<{ proposal_id: string }>(
            'SELECT proposal_id FROM chat_work_proposal_revisions WHERE dependency_set_id = ?',
            [id]
          )
        ).map(r => r.proposal_id)
      );
      for (const table of [
        'chat_messages',
        'chat_thread_summaries',
        'chat_provider_checkpoints',
        'chat_work_proposal_revisions'
      ])
        await this.db.run(`UPDATE ${table} SET invalidated_at = ? WHERE dependency_set_id = ?`, [
          this.timestamp(),
          id
        ]);
      const questions = await this.db.all<QuestionRow>(
        "SELECT * FROM chat_questions WHERE dependency_set_id = ? AND state = 'open'",
        [id]
      );
      for (const q of questions) {
        await this.db.run(
          "UPDATE chat_questions SET state = 'superseded', revision = revision + 1, updated_at = ? WHERE id = ?",
          [this.timestamp(), q.id]
        );
        await this.append(
          threadId,
          {
            kind: 'question.closed',
            question: questionDto({ ...q, state: 'superseded', revision: q.revision + 1 })
          },
          id
        );
      }
    }
    await this.db.run(
      'UPDATE chat_threads SET authorization_revision = authorization_revision + 1 WHERE id = ?',
      [threadId]
    );
    await this.append(threadId, {
      kind: 'content.invalidated',
      messageIds: [...new Set(messageIds)],
      proposalIds: [...new Set(proposalIds)]
    });
    // Conservatively fence every unfinished generation in this thread: any may have inherited this source.
    const runs = await this.db.all<RunRow>(
      "SELECT * FROM chat_runs WHERE thread_id = ? AND state IN ('running','waiting_user')",
      [threadId]
    );
    for (const r of runs) await this.finish(r, 'failed', null, 'source_access_lost');
  }
  async dependencySet(
    threadId: string,
    sourceIds: string[],
    inherited: string[] = []
  ): Promise<string> {
    const union = new Set(sourceIds);
    for (const setId of inherited) {
      const set = await this.db.get<{ thread_id: string }>(
        'SELECT thread_id FROM chat_dependency_sets WHERE id = ?',
        [setId]
      );
      if (set?.thread_id !== threadId || !(await this.authorized(setId)))
        throw new ChatError('source_access_lost');
      for (const row of await this.db.all<{ source_ref_id: string }>(
        'SELECT source_ref_id FROM chat_dependency_set_members WHERE dependency_set_id = ?',
        [setId]
      ))
        union.add(row.source_ref_id);
    }
    const ids = [...union].sort();
    for (const id of ids) {
      const source = await this.db.get<SourceRow>(
        'SELECT * FROM chat_source_refs WHERE id = ? AND thread_id = ?',
        [id, threadId]
      );
      if (!source || source.access_state !== 'authorized')
        throw new ChatError('source_access_lost');
    }
    const authorizationRevision = (await this.thread(threadId)).authorization_revision;
    const digest = createHash('sha256')
      .update(JSON.stringify({ ids, authorizationRevision }))
      .digest('hex');
    const old = await this.db.get<{ id: string; invalidated_at: string | null }>(
      'SELECT id, invalidated_at FROM chat_dependency_sets WHERE thread_id = ? AND digest = ?',
      [threadId, digest]
    );
    if (old?.invalidated_at) throw new ChatError('source_access_lost');
    if (old) return old.id;
    const id = randomUUID();
    await this.db.run(
      'INSERT INTO chat_dependency_sets (id, thread_id, digest, created_at) VALUES (?, ?, ?, ?)',
      [id, threadId, digest, this.timestamp()]
    );
    for (const sourceId of ids)
      await this.db.run(
        'INSERT INTO chat_dependency_set_members (dependency_set_id, source_ref_id) VALUES (?, ?)',
        [id, sourceId]
      );
    return id;
  }
  async finish(
    r: RunRow,
    state: 'completed' | 'failed' | 'cancelled',
    outcome: ChatRunDto['outcome'] = null,
    failure: ChatRunDto['failureCode'] = null
  ) {
    const now = this.timestamp();
    await this.db.run(
      `UPDATE chat_run_attempts SET state = ?, ended_at = ? WHERE run_id = ? AND state = 'leased'`,
      [
        state === 'completed' ? 'succeeded' : state === 'cancelled' ? 'cancelled' : 'fenced',
        now,
        r.id
      ]
    );
    await this.db.run(
      `UPDATE chat_runs SET state = ?, outcome = ?, failure_code = ?, completed_at = ?, active_attempt_id = NULL, current_fence = current_fence + 1, updated_at = ?, revision = revision + 1 WHERE id = ?`,
      [state, outcome, failure, now, now, r.id]
    );
    const questions = await this.db.all<QuestionRow>(
      "SELECT * FROM chat_questions WHERE run_id = ? AND state = 'open'",
      [r.id]
    );
    await this.db.run(
      "UPDATE chat_questions SET state = 'cancelled', updated_at = ?, revision = revision + 1 WHERE run_id = ? AND state = 'open'",
      [now, r.id]
    );
    await this.db.run(
      "UPDATE chat_tool_calls SET state = 'cancelled', completed_at = ?, updated_at = ? WHERE run_id = ? AND state IN ('requested','executing')",
      [now, now, r.id]
    );
    const partials = await this.db.all<MessageRow>(
      "SELECT * FROM chat_messages WHERE run_id = ? AND state = 'streaming'",
      [r.id]
    );
    await this.db.run(
      "UPDATE chat_messages SET state = 'interrupted', updated_at = ?, revision = revision + 1 WHERE run_id = ? AND state = 'streaming'",
      [now, r.id]
    );
    for (const message of partials)
      await this.append(
        r.thread_id,
        {
          kind: 'message.completed',
          message: messageDto({
            ...message,
            state: 'interrupted',
            updated_at: now,
            revision: message.revision + 1
          })
        },
        message.dependency_set_id
      );
    for (const q of questions)
      await this.append(
        r.thread_id,
        {
          kind: 'question.closed',
          question: questionDto({
            ...q,
            state: 'cancelled',
            revision: q.revision + 1,
            updated_at: now
          })
        },
        q.dependency_set_id
      );
    await this.db.run('DELETE FROM chat_provider_checkpoints WHERE run_id = ?', [r.id]);
    const updated = await this.run(r.id!);
    const seq = await this.append(r.thread_id, {
      kind: 'run.updated',
      run: runDto(updated, outcome === 'allowance_exhausted')
    });
    if (state !== 'cancelled') await this.notification(updated, seq);
    return runDto(updated, outcome === 'allowance_exhausted');
  }
  async notification(r: RunRow, seq: number, question?: QuestionRow) {
    const t = await this.thread(r.thread_id);
    await this.db.run(
      `INSERT INTO chat_notifications (id, owner_profile_id, organization_id, thread_id, run_id, question_id, type, transition_key, event_seq, state, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT (owner_profile_id, thread_id, run_id, type, transition_key) DO NOTHING`,
      [
        randomUUID(),
        t.owner_profile_id,
        t.organization_id,
        t.id,
        r.id,
        question?.id ?? null,
        question ? 'chat_needs_answer' : 'chat_finished',
        question ? `question:${question.ordinal}` : `terminal:${r.state}`,
        seq,
        new Date(this.now() + this.limits.notificationGraceMs).toISOString(),
        this.timestamp(),
        this.timestamp()
      ]
    );
  }
}
