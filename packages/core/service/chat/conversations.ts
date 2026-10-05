import type {
  AnswerChatQuestionBody,
  ChatEventDto,
  ChatEventPageDto,
  ChatSourceLocatorDto,
  ChatThreadListResponse,
  ChatThreadSnapshotDto,
  CreateChatThreadResponse,
  SubmitChatMessageBody,
  SubmitChatMessageResponse,
  UpdateChatThreadBody
} from '@overlord/contract';
import { randomUUID } from 'node:crypto';

import { ChatProposals, proposalDto } from './proposals.js';
import {
  ChatError,
  type ChatOwner,
  ChatStore,
  type EventPayload,
  type EventRow,
  messageDto,
  type MessageRow,
  questionDto,
  type QuestionRow,
  requiredText,
  revision,
  runDto,
  type RunRow
} from './store.js';

export class Conversations extends ChatStore {
  private async transaction<T>(
    owner: ChatOwner,
    threadId: string,
    fn: (store: Conversations) => Promise<T>
  ): Promise<T> {
    // Authorization changes are durable even when the requested action later conflicts.
    await this.db.transaction(async tx => {
      const s = new Conversations(tx, this.options);
      await s.lock(threadId, owner);
      await s.checkSources(threadId);
      await s.retain(threadId);
    });
    return this.db.transaction(async tx => {
      const store = new Conversations(tx, this.options);
      await store.lock(threadId, owner);
      return fn(store);
    });
  }
  async create(
    owner: ChatOwner,
    message?: SubmitChatMessageBody
  ): Promise<CreateChatThreadResponse> {
    if (
      message !== undefined &&
      (!message || typeof message !== 'object' || Array.isArray(message))
    )
      throw new ChatError('invalid_request');
    return this.db.transaction(async tx => {
      const s = new Conversations(tx, this.options),
        id = randomUUID(),
        now = s.timestamp();
      await s.access(owner);
      await tx.run(
        'INSERT INTO chat_threads (id, owner_profile_id, organization_id, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, owner.profileId, owner.organizationId, now, now, now]
      );
      const submission = message ? await s.submitLocked(owner, id, message) : null;
      return {
        thread: await s.threadDto(await s.thread(id)),
        message: submission?.message ?? null,
        run: submission?.run ?? null
      };
    });
  }
  async list(owner: ChatOwner, archived = false, cursor?: string): Promise<ChatThreadListResponse> {
    await this.access(owner);
    let before: { at: string; id: string } | undefined;
    if (cursor) {
      try {
        before = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      } catch {
        throw new ChatError('invalid_request');
      }
      if (!before || typeof before.at !== 'string' || typeof before.id !== 'string')
        throw new ChatError('invalid_request');
    }
    const rows = await this.db.all<import('./store.js').ThreadRow>(
      `SELECT * FROM chat_threads WHERE owner_profile_id = ? AND organization_id = ? ${archived ? '' : 'AND archived_at IS NULL'} ${before ? 'AND (last_activity_at < ? OR (last_activity_at = ? AND id < ?))' : ''} ORDER BY last_activity_at DESC, id DESC LIMIT 51`,
      [owner.profileId, owner.organizationId, ...(before ? [before.at, before.at, before.id] : [])]
    );
    const page = rows.slice(0, 50),
      last = page.at(-1);
    return {
      items: await Promise.all(page.map(row => this.threadDto(row))),
      nextCursor:
        rows.length > 50 && last
          ? Buffer.from(JSON.stringify({ at: last.last_activity_at, id: last.id })).toString(
              'base64url'
            )
          : null
    };
  }
  async update(owner: ChatOwner, id: string, body: UpdateChatThreadBody) {
    revision(body.expectedRevision);
    if (body.title === undefined && body.archived === undefined)
      throw new ChatError('invalid_request');
    if (body.title !== undefined) requiredText(body.title, this.limits.titleMaxChars);
    if (body.archived !== undefined && typeof body.archived !== 'boolean')
      throw new ChatError('invalid_request');
    return this.transaction(owner, id, async s => {
      const t = await s.thread(id);
      if (t.revision !== body.expectedRevision) throw new ChatError('stale_revision');
      await s.db.run(
        'UPDATE chat_threads SET title = ?, title_source = ?, archived_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        [
          body.title?.trim() ?? t.title,
          body.title === undefined ? t.title_source : 'user',
          body.archived === undefined ? t.archived_at : body.archived ? s.timestamp() : null,
          s.timestamp(),
          id
        ]
      );
      const thread = await s.threadDto(await s.thread(id));
      await s.append(id, { kind: 'thread.updated', thread });
      return thread;
    });
  }
  async submit(
    owner: ChatOwner,
    id: string,
    body: SubmitChatMessageBody
  ): Promise<SubmitChatMessageResponse> {
    return this.transaction(owner, id, s => s.submitLocked(owner, id, body));
  }
  private async submitLocked(
    owner: ChatOwner,
    id: string,
    body: SubmitChatMessageBody,
    question?: QuestionRow
  ): Promise<SubmitChatMessageResponse> {
    requiredText(body.clientRequestId, 200);
    const old = await this.db.get<MessageRow>(
      'SELECT * FROM chat_messages WHERE thread_id = ? AND client_request_id = ?',
      [id, body.clientRequestId]
    );
    if (old)
      return {
        message: await this.projectMessage(old),
        run: runDto(await this.run(old.run_id!)),
        replayed: true
      };
    requiredText(body.text, this.limits.messageMaxChars);
    const active = await this.db.get<RunRow>(
      "SELECT * FROM chat_runs WHERE thread_id = ? AND state IN ('queued','running','waiting_user')",
      [id]
    );
    if (active && active.state !== 'waiting_user') throw new ChatError('run_in_progress');
    if (active) {
      const q =
        question ??
        (await this.db.get<QuestionRow>(
          "SELECT * FROM chat_questions WHERE run_id = ? AND state = 'open'",
          [active.id]
        ));
      if (!q || !(await this.authorized(q.dependency_set_id)))
        throw new ChatError('stale_revision');
      question = q;
      const options = questionDto(q).options;
      const chosen = body.optionId && options.find(o => o.id === body.optionId);
      if (body.optionId && !chosen) throw new ChatError('invalid_request');
      if (!q.allow_free_text && !chosen) throw new ChatError('invalid_request');
    } else {
      // Serialize the owner limit across different threads and different backend instances.
      await this.db.run('UPDATE profiles SET id = id WHERE id = ?', [owner.profileId]);
      const count = await this.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM chat_runs r JOIN chat_threads t ON t.id = r.thread_id WHERE t.owner_profile_id = ? AND r.state IN ('queued','running','waiting_user')`,
        [owner.profileId]
      );
      if (Number(count?.n) >= this.limits.concurrentRunsPerOwner)
        throw new ChatError('limit_exceeded');
    }
    const messageId = randomUUID(),
      runId = active?.id ?? randomUUID(),
      now = this.timestamp();
    const messageCreatedAt = await this.createdAt('chat_messages', id);
    const blocks = [
      { id: randomUUID(), kind: 'text', text: body.text, fallbackText: body.text, evidenceIds: [] }
    ];
    await this.db.run(
      `INSERT INTO chat_messages (id, thread_id, role, state, blocks_json, answers_question_id, client_request_id, created_at, updated_at) VALUES (?, ?, 'user', 'complete', ?, ?, ?, ?, ?)`,
      [
        messageId,
        id,
        JSON.stringify(blocks),
        question?.id ?? null,
        body.clientRequestId,
        messageCreatedAt,
        now
      ]
    );
    if (active) {
      await this.db.run(
        "UPDATE chat_questions SET state = 'answered', answer_message_id = ?, answered_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'open'",
        [messageId, now, now, question!.id]
      );
      await this.db.run(
        "UPDATE chat_runs SET state = 'queued', updated_at = ?, revision = revision + 1 WHERE id = ?",
        [now, runId]
      );
      const q = await this.db.get<QuestionRow>('SELECT * FROM chat_questions WHERE id = ?', [
        question!.id
      ]);
      await this.append(
        id,
        { kind: 'question.closed', question: questionDto(q!) },
        q!.dependency_set_id
      );
    } else {
      await this.db.run(
        `INSERT INTO chat_runs (id, thread_id, trigger_message_id, state, limits_json, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
        [
          runId,
          id,
          messageId,
          JSON.stringify(this.limits),
          await this.createdAt('chat_runs', id),
          now
        ]
      );
    }
    await this.db.run('UPDATE chat_messages SET run_id = ? WHERE id = ?', [runId, messageId]);
    const thread = await this.thread(id);
    if (thread.title_source === 'pending') {
      await this.db.run(
        "UPDATE chat_threads SET title = ?, title_source = 'generated', revision = revision + 1, updated_at = ? WHERE id = ?",
        [body.text.trim().replace(/\s+/g, ' ').slice(0, this.limits.titleMaxChars), now, id]
      );
      await this.append(id, {
        kind: 'thread.updated',
        thread: await this.threadDto(await this.thread(id))
      });
    }
    const row = await this.db.get<MessageRow>('SELECT * FROM chat_messages WHERE id = ?', [
      messageId
    ]);
    const message = messageDto(row!),
      run = runDto(await this.run(runId!));
    await this.append(id, { kind: 'message.created', message });
    await this.append(id, { kind: 'run.updated', run });
    return { message, run, replayed: false };
  }
  async answer(owner: ChatOwner, id: string, body: AnswerChatQuestionBody) {
    revision(body.expectedRevision);
    const q = await this.db.get<QuestionRow>('SELECT * FROM chat_questions WHERE id = ?', [id]);
    if (!q) throw new ChatError('not_found');
    return this.transaction(owner, q.thread_id, async s => {
      await s.checkSources(q.thread_id);
      const current = await s.db.get<QuestionRow>('SELECT * FROM chat_questions WHERE id = ?', [
        id
      ]);
      if (current!.state !== 'open' || current!.revision !== body.expectedRevision)
        throw new ChatError('stale_revision');
      const option = questionDto(current!).options.find(o => o.id === body.optionId);
      const text = body.text ?? option?.label ?? '';
      return s.submitLocked(
        owner,
        q.thread_id,
        {
          clientRequestId: body.clientRequestId,
          text,
          ...(body.optionId !== undefined ? { optionId: body.optionId } : {})
        },
        current!
      );
    });
  }
  async cancel(owner: ChatOwner, id: string, clientRequestId: string) {
    requiredText(clientRequestId, 200);
    const r = await this.run(id);
    return this.transaction(owner, r.thread_id, async s => {
      const current = await s.run(id);
      if (['completed', 'failed', 'cancelled'].includes(current.state)) return runDto(current);
      await s.db.run('UPDATE chat_runs SET cancel_requested_at = ? WHERE id = ?', [
        s.timestamp(),
        id
      ]);
      return s.finish(current, 'cancelled');
    });
  }
  async continue(owner: ChatOwner, id: string, clientRequestId: string) {
    requiredText(clientRequestId, 200);
    const r = await this.run(id);
    return this.transaction(owner, r.thread_id, async s => {
      const existing = await s.db.get<RunRow>(
        'SELECT * FROM chat_runs WHERE continued_from_run_id = ?',
        [id]
      );
      if (existing) return { run: runDto(existing), replayed: true };
      const latest = await s.db.get<RunRow>(
        'SELECT * FROM chat_runs WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
        [r.thread_id]
      );
      if (
        latest?.id !== id ||
        latest.state !== 'completed' ||
        latest.outcome !== 'allowance_exhausted'
      )
        throw new ChatError('continue_not_available');
      await s.db.run('UPDATE profiles SET id = id WHERE id = ?', [owner.profileId]);
      const count = await s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM chat_runs r JOIN chat_threads t ON t.id = r.thread_id WHERE t.owner_profile_id = ? AND r.state IN ('queued','running','waiting_user')`,
        [owner.profileId]
      );
      if (Number(count?.n) >= s.limits.concurrentRunsPerOwner)
        throw new ChatError('limit_exceeded');
      const newId = randomUUID();
      await s.db.run(
        `INSERT INTO chat_runs (id, thread_id, trigger_message_id, continued_from_run_id, state, limits_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
        [
          newId,
          r.thread_id,
          r.trigger_message_id,
          id,
          JSON.stringify(s.limits),
          await s.createdAt('chat_runs', r.thread_id),
          s.timestamp()
        ]
      );
      const run = runDto(await s.run(newId));
      await s.append(r.thread_id, { kind: 'run.updated', run });
      return { run, replayed: false };
    });
  }
  createProposal(
    owner: ChatOwner,
    id: string,
    body: { clientRequestId?: unknown; expectedRevision?: unknown }
  ) {
    return new ChatProposals(this.db, this.options).create(owner, id, body);
  }
  async snapshot(owner: ChatOwner, id: string, before?: string): Promise<ChatThreadSnapshotDto> {
    return this.transaction(owner, id, async s => {
      await s.checkSources(id);
      const thread = await s.thread(id);
      const messages = await s.db.all<MessageRow>(
        `SELECT * FROM chat_messages WHERE thread_id = ? ${before ? 'AND (created_at < (SELECT created_at FROM chat_messages WHERE id = ? AND thread_id = ?) OR (created_at = (SELECT created_at FROM chat_messages WHERE id = ? AND thread_id = ?) AND id < ?))' : ''} ORDER BY created_at DESC, id DESC LIMIT 101`,
        [id, ...(before ? [before, id, before, id, before] : [])]
      );
      const active = await s.db.get<RunRow>(
        "SELECT * FROM chat_runs WHERE thread_id = ? AND state IN ('queued','running','waiting_user')",
        [id]
      );
      const latest = await s.db.get<RunRow>(
        "SELECT * FROM chat_runs WHERE thread_id = ? AND state IN ('completed','failed','cancelled') ORDER BY created_at DESC, id DESC LIMIT 1",
        [id]
      );
      const question = await s.db.get<QuestionRow>(
        "SELECT * FROM chat_questions WHERE thread_id = ? AND state = 'open'",
        [id]
      );
      const projected = await Promise.all(
        messages
          .slice(0, 100)
          .reverse()
          .map(r => s.projectMessage(r))
      );
      const referencedIds = [
        ...new Set(
          projected.flatMap(m =>
            m.blocks.flatMap(b => (b.kind === 'proposal' ? [b.proposalId] : []))
          )
        )
      ];
      const continued =
        latest &&
        (await s.db.get('SELECT id FROM chat_runs WHERE continued_from_run_id = ?', [latest.id]));
      return {
        thread: await s.threadDto(thread),
        messages: projected,
        hasEarlierMessages: messages.length > 100,
        activeRun: active ? runDto(active) : null,
        latestRun: latest
          ? runDto(latest, !active && !continued && latest.outcome === 'allowance_exhausted')
          : null,
        openQuestion:
          question && (await s.authorized(question.dependency_set_id))
            ? questionDto(question)
            : null,
        openProposals: await Promise.all(
          (
            await s.db.all<Parameters<typeof proposalDto>[1]>(
              "SELECT * FROM chat_work_proposals WHERE thread_id = ? AND state = 'open' ORDER BY created_at, id",
              [id]
            )
          ).map(p => proposalDto(s, p))
        ),
        referencedProposals: referencedIds.length
          ? await Promise.all(
              (
                await s.db.all<Parameters<typeof proposalDto>[1]>(
                  `SELECT * FROM chat_work_proposals WHERE thread_id = ? AND state <> 'open' AND id IN (${referencedIds.map(() => '?').join(', ')}) ORDER BY created_at, id`,
                  [id, ...referencedIds]
                )
              ).map(p => proposalDto(s, p))
            )
          : [],
        eventCursor: thread.last_event_seq,
        retainedFromSeq: thread.retained_from_seq
      };
    });
  }
  async events(owner: ChatOwner, id: string, after: number): Promise<ChatEventPageDto> {
    if (!Number.isSafeInteger(after) || after < 0) throw new ChatError('invalid_request');
    return this.transaction(owner, id, async s => {
      await s.checkSources(id);
      await s.retain(id);
      const t = await s.thread(id);
      if (after < t.retained_from_seq - 1) throw new ChatError('snapshot_required');
      if (after > t.last_event_seq) throw new ChatError('invalid_request');
      const rows = await s.db.all<EventRow>(
        'SELECT * FROM chat_events WHERE thread_id = ? AND seq > ? ORDER BY seq ASC LIMIT 201',
        [id, after]
      );
      const events: ChatEventDto[] = [];
      for (const row of rows.slice(0, 200)) {
        const payload: EventPayload = JSON.parse(row.payload_json);
        const safe = await s.authorized(row.dependency_set_id);
        events.push({
          ...(safe
            ? payload
            : {
                kind: 'content.invalidated',
                messageIds:
                  'message' in payload
                    ? [payload.message.id]
                    : 'messageId' in payload
                      ? [payload.messageId]
                      : [],
                proposalIds: 'proposal' in payload ? [payload.proposal.id] : []
              }),
          threadId: id,
          seq: row.seq,
          createdAt: row.created_at
        } as ChatEventDto);
      }
      return { events, cursor: events.at(-1)?.seq ?? after, hasMore: rows.length > 200 };
    });
  }
  /** Internal seam for context gateways: source identities and inherited dependency union. */
  async sources(
    owner: ChatOwner,
    threadId: string,
    sources: { scopeKey: string; locator: ChatSourceLocatorDto }[],
    inherited: string[] = []
  ): Promise<string> {
    return this.transaction(owner, threadId, async s => {
      const ids = await s.registerSources(owner, threadId, sources);
      await s.checkSources(threadId);
      return s.dependencySet(threadId, ids, inherited);
    });
  }
}
export { ChatError, type ChatOptions, type ChatOwner, type SourceChecker } from './store.js';
export type { EventPayload };
