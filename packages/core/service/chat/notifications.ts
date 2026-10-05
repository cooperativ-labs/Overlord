import type {
  AckChatEventsBody,
  ChatAckDto,
  ChatNotificationDto,
  ChatNotificationListResponse,
  ChatNotificationType,
  ChatPresenceDto,
  MarkChatNotificationReadBody,
  UpdateChatPresenceBody
} from '@overlord/contract';
import type { Selectable } from 'kysely';

import type { ChatNotifications as ChatNotificationsTable } from '../../types/db.js';

import { ChatError, type ChatOwner, ChatStore, requiredText, revision } from './store.js';

export type ChatNotificationRow = Selectable<ChatNotificationsTable>;

const PLATFORMS = ['ios', 'web', 'desktop'] as const;
const HISTORY_LIMIT = 100;
/** How long a dispatcher owns a claimed candidate before another worker may reclaim it. */
export const CHAT_NOTIFICATION_LEASE_MS = 60 * 1000;
const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];

export function chatNotificationDto(r: ChatNotificationRow): ChatNotificationDto {
  return {
    id: r.id!,
    type: r.type as ChatNotificationType,
    organizationId: r.organization_id,
    threadId: r.thread_id,
    runId: r.run_id,
    questionId: r.question_id,
    threadTitle: r.thread_title ?? '',
    createdAt: r.created_at,
    dispatchedAt: r.dispatched_at!,
    readAt: r.read_at,
    revision: r.revision
  };
}

/** Outcome of the dispatch-time recheck; only `deliver` reaches the push transport. */
export type ChatNotificationRecheck =
  | { action: 'deliver'; row: ChatNotificationRow; threadTitle: string | null }
  | { action: 'cancel'; reason: string };

/**
 * Foreground presence, rendered-event acknowledgements, and the owner-addressed
 * conversation notification lifecycle (contract v152). Candidates are written by
 * `ChatStore.notification` inside each qualifying run transition; this class only
 * suppresses, claims, rechecks, and finalizes them.
 *
 * Presence and acknowledgement never run upstream source checks: they publish no
 * content, and a source check per render would put a third-party round trip on the
 * acknowledgement path. They do recheck live owner membership through `lock`.
 */
export class ChatNotifications extends ChatStore {
  async presence(
    owner: ChatOwner,
    threadId: string,
    body: UpdateChatPresenceBody
  ): Promise<ChatPresenceDto> {
    const clientId = requiredText(body?.clientId, 200);
    if (!PLATFORMS.includes(body.platform)) throw new ChatError('invalid_request');
    if (body.state !== 'foreground' && body.state !== 'released')
      throw new ChatError('invalid_request');
    return this.db.transaction(async tx => {
      const s = new ChatNotifications(tx, this.options);
      await s.lock(threadId, owner);
      const now = s.timestamp();
      const expiresAt =
        body.state === 'foreground'
          ? new Date(s.now() + s.limits.presenceTtlMs).toISOString()
          : now;
      const releasedAt = body.state === 'released' ? now : null;
      await tx.run(
        `INSERT INTO chat_presence (thread_id, client_id, platform, expires_at, released_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (thread_id, client_id) DO UPDATE SET platform = excluded.platform, expires_at = excluded.expires_at, released_at = excluded.released_at, updated_at = excluded.updated_at`,
        [threadId, clientId, body.platform, expiresAt, releasedAt, now, now]
      );
      return { clientId, expiresAt: body.state === 'foreground' ? expiresAt : null };
    });
  }

  /**
   * Records that `clientId` rendered every event through `seq`. Monotonic and
   * idempotent; a lower `seq` keeps the stored value. Pending candidates for this
   * thread at or below the acknowledged sequence are suppressed only when the
   * client holds live foreground presence at this moment.
   */
  async ack(owner: ChatOwner, threadId: string, body: AckChatEventsBody): Promise<ChatAckDto> {
    const clientId = requiredText(body?.clientId, 200);
    if (!Number.isSafeInteger(body.seq) || body.seq < 0) throw new ChatError('invalid_request');
    return this.db.transaction(async tx => {
      const s = new ChatNotifications(tx, this.options);
      const thread = await s.lock(threadId, owner);
      // A client cannot acknowledge an event that was never published.
      if (body.seq > Number(thread.last_event_seq)) throw new ChatError('invalid_request');
      const now = s.timestamp();
      await tx.run(
        `INSERT INTO chat_event_acks (thread_id, client_id, acked_seq, acked_at, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (thread_id, client_id) DO UPDATE SET acked_seq = excluded.acked_seq, acked_at = excluded.acked_at
         WHERE excluded.acked_seq > chat_event_acks.acked_seq`,
        [threadId, clientId, body.seq, now, now]
      );
      const stored = await tx.get<{ acked_seq: number }>(
        'SELECT acked_seq FROM chat_event_acks WHERE thread_id = ? AND client_id = ?',
        [threadId, clientId]
      );
      const ackedSeq = Number(stored!.acked_seq);
      const foreground = await tx.get(
        'SELECT client_id FROM chat_presence WHERE thread_id = ? AND client_id = ? AND released_at IS NULL AND expires_at > ?',
        [threadId, clientId, now]
      );
      if (!foreground) return { clientId, ackedSeq, suppressedNotificationIds: [] };
      const pending = await tx.all<{ id: string }>(
        "SELECT id FROM chat_notifications WHERE thread_id = ? AND state = 'pending' AND event_seq <= ? ORDER BY event_seq, id",
        [threadId, ackedSeq]
      );
      const suppressed: string[] = [];
      for (const { id } of pending) {
        const result = await tx.run(
          "UPDATE chat_notifications SET state = 'suppressed', suppressed_by_client_id = ?, suppressed_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'pending'",
          [clientId, now, now, id]
        );
        if (result.changes) suppressed.push(id);
      }
      return { clientId, ackedSeq, suppressedNotificationIds: suppressed };
    });
  }

  /** Dispatched, non-dismissed history for this owner in this organization, newest first. */
  async history(owner: ChatOwner): Promise<ChatNotificationListResponse> {
    await this.access(owner);
    const rows = await this.db.all<ChatNotificationRow>(
      `SELECT * FROM chat_notifications WHERE owner_profile_id = ? AND organization_id = ? AND state = 'dispatched' AND deleted_at IS NULL ORDER BY dispatched_at DESC, id DESC LIMIT ${HISTORY_LIMIT}`,
      [owner.profileId, owner.organizationId]
    );
    const unread = await this.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chat_notifications WHERE owner_profile_id = ? AND organization_id = ? AND state = 'dispatched' AND deleted_at IS NULL AND read_at IS NULL",
      [owner.profileId, owner.organizationId]
    );
    return { items: rows.map(chatNotificationDto), unreadCount: Number(unread?.n ?? 0) };
  }

  /** Revision-checked; marking an already-read entry at its current revision is a no-op. */
  async markRead(
    owner: ChatOwner,
    id: string,
    body: MarkChatNotificationReadBody
  ): Promise<ChatNotificationDto> {
    const expected = revision(body?.expectedRevision);
    await this.access(owner);
    return this.db.transaction(async tx => {
      const row = await tx.get<ChatNotificationRow>(
        "SELECT * FROM chat_notifications WHERE id = ? AND owner_profile_id = ? AND organization_id = ? AND state = 'dispatched' AND deleted_at IS NULL",
        [id, owner.profileId, owner.organizationId]
      );
      if (!row) throw new ChatError('not_found');
      if (row.revision !== expected) throw new ChatError('stale_revision');
      if (row.read_at) return chatNotificationDto(row);
      const now = this.timestamp();
      const result = await tx.run(
        'UPDATE chat_notifications SET read_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?',
        [now, now, id, expected]
      );
      if (!result.changes) throw new ChatError('stale_revision');
      return chatNotificationDto({ ...row, read_at: now, updated_at: now, revision: expected + 1 });
    });
  }

  /**
   * Claims up to `limit` due candidates: pending rows past `due_at`, plus rows a
   * crashed dispatcher left in `dispatching` past their lease. The state-guarded
   * update makes a concurrent suppression or second dispatcher lose cleanly.
   */
  async claimDue(workerId: string, limit = 20): Promise<ChatNotificationRow[]> {
    const now = this.timestamp();
    const due = await this.db.all<ChatNotificationRow>(
      `SELECT * FROM chat_notifications WHERE (state = 'pending' AND due_at <= ?) OR (state = 'dispatching' AND locked_until <= ?) ORDER BY due_at, id LIMIT ${Math.max(1, Math.floor(limit))}`,
      [now, now]
    );
    const claimed: ChatNotificationRow[] = [];
    const lockedUntil = new Date(this.now() + CHAT_NOTIFICATION_LEASE_MS).toISOString();
    for (const row of due) {
      const result = await this.db.run(
        `UPDATE chat_notifications SET state = 'dispatching', locked_by = ?, locked_until = ?, attempt_count = attempt_count + 1, updated_at = ?, revision = revision + 1
          WHERE id = ? AND ((state = 'pending' AND due_at <= ?) OR (state = 'dispatching' AND locked_until <= ?))`,
        [workerId, lockedUntil, now, row.id, now, now]
      );
      if (result.changes)
        claimed.push(
          (await this.db.get<ChatNotificationRow>('SELECT * FROM chat_notifications WHERE id = ?', [
            row.id
          ]))!
        );
    }
    return claimed;
  }

  /**
   * Dispatch-time recheck of a claimed candidate: the thread still belongs to the
   * addressed owner, the owner is still an active member of the organization, the
   * run reached the addressed transition, and a `chat_needs_answer` question is
   * still open on a waiting run. Preferences are checked by the caller, which
   * owns the shared preference catalog.
   */
  async recheck(row: ChatNotificationRow): Promise<ChatNotificationRecheck> {
    const thread = await this.db.get<{
      owner_profile_id: string;
      organization_id: string;
      title: string | null;
    }>('SELECT owner_profile_id, organization_id, title FROM chat_threads WHERE id = ?', [
      row.thread_id
    ]);
    if (
      !thread ||
      thread.owner_profile_id !== row.owner_profile_id ||
      thread.organization_id !== row.organization_id
    )
      return { action: 'cancel', reason: 'thread_unavailable' };
    try {
      await this.access({ profileId: row.owner_profile_id, organizationId: row.organization_id });
    } catch {
      return { action: 'cancel', reason: 'access_revoked' };
    }
    if (row.type === 'chat_needs_answer') {
      const open = await this.db.get(
        "SELECT q.id FROM chat_questions q JOIN chat_runs r ON r.id = q.run_id WHERE q.id = ? AND q.run_id = ? AND q.state = 'open' AND r.state = 'waiting_user'",
        [row.question_id, row.run_id]
      );
      if (!open) return { action: 'cancel', reason: 'question_closed' };
    }
    return { action: 'deliver', row, threadTitle: thread.title };
  }

  /** Unread dispatched conversation notifications across the owner's organizations. */
  async unreadForProfile(profileId: string): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chat_notifications WHERE owner_profile_id = ? AND state = 'dispatched' AND deleted_at IS NULL AND read_at IS NULL",
      [profileId]
    );
    return Number(row?.n ?? 0);
  }

  /** Finalizers apply only while this worker still holds the claim. */
  async markDispatched(row: ChatNotificationRow, workerId: string, threadTitle: string) {
    const now = this.timestamp();
    return this.finalize(
      row,
      workerId,
      "state = 'dispatched', dispatched_at = ?, thread_title = ?, last_error = NULL",
      [now, threadTitle]
    );
  }
  async markCancelled(row: ChatNotificationRow, workerId: string, reason: string) {
    return this.finalize(row, workerId, "state = 'cancelled', last_error = ?", [reason]);
  }
  /** Transient failure: back to pending with backoff until `max_attempts`, then `failed`. */
  async markFailedAttempt(row: ChatNotificationRow, workerId: string, error: string) {
    const message = error.slice(0, 500);
    if (row.attempt_count >= row.max_attempts)
      return this.finalize(row, workerId, "state = 'failed', last_error = ?", [message]);
    const delay =
      RETRY_BACKOFF_MS[Math.min(row.attempt_count - 1, RETRY_BACKOFF_MS.length - 1)] ?? 5_000;
    return this.finalize(row, workerId, "state = 'pending', due_at = ?, last_error = ?", [
      new Date(this.now() + delay).toISOString(),
      message
    ]);
  }
  private async finalize(
    row: ChatNotificationRow,
    workerId: string,
    assignments: string,
    params: unknown[]
  ): Promise<boolean> {
    const now = this.timestamp();
    const result = await this.db.run(
      `UPDATE chat_notifications SET ${assignments}, locked_by = NULL, locked_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'dispatching' AND locked_by = ?`,
      [...params, now, row.id, workerId]
    );
    return Boolean(result.changes);
  }
}
