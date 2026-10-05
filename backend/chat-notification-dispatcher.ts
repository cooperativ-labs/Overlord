import {
  CHAT_NOTIFICATION_CATALOG,
  CHAT_NOTIFICATION_DEEP_LINK,
  type ChatNotificationType
} from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import { randomUUID } from 'node:crypto';

import {
  type ChatNotificationRow,
  ChatNotifications
} from '../packages/core/service/chat/notifications.ts';
import type { ChatOptions } from '../packages/core/service/chat/store.ts';

import { sendToProfileDevices } from './push-notification-dispatcher.ts';
import { resolveNotificationMode, unreadBadgeCount } from './push-notifications.ts';
import { presentationTitle } from './text-presentation.ts';

const FALLBACK_TITLE = 'Assistant conversation';

export type ChatPushMode = 'alert' | 'silent';

/** Everything a conversation push may carry: ids, a fixed verb, a bounded title, a badge. */
export interface ChatPushPresentation {
  type: ChatNotificationType;
  threadId: string;
  runId: string;
  threadTitle: string;
  badge: number;
  deepLink: string;
}

export function chatThreadTitle(title: string | null): string {
  return (title && presentationTitle(title)) || FALLBACK_TITLE;
}

/**
 * Builds the APNs body. Only the type, sanitized thread title, ids, badge, and
 * deep link are read; question, answer, transcript, Knowledgebase and repository
 * content never reach this function. `silent` omits the alert dictionary.
 */
export function chatApnsBody(p: ChatPushPresentation, mode: ChatPushMode): string {
  const aps: Record<string, unknown> =
    mode === 'alert'
      ? {
          alert: {
            title: p.threadTitle,
            body: `The assistant ${CHAT_NOTIFICATION_CATALOG[p.type].verb}.`
          },
          sound: 'default',
          badge: p.badge,
          'thread-id': p.threadId
        }
      : { 'content-available': 1, badge: p.badge, 'thread-id': p.threadId };
  return JSON.stringify({
    aps,
    data: { category: p.type, threadId: p.threadId, runId: p.runId, deepLink: p.deepLink }
  });
}

export type ChatPushSender = (input: {
  db: DatabaseClient;
  profileId: string;
  body: string;
  mode: ChatPushMode;
  collapseId: string;
}) => Promise<void>;

/**
 * Drives `chat_notifications` candidates from `pending` to `dispatched`,
 * `cancelled`, or (after retries) `failed`. Suppression by a foreground
 * acknowledgement happens on the acknowledgement path, never here; a candidate
 * that is still pending at `due_at` is delivered even if a stream to the owner
 * still appears open.
 *
 * Delivery is at-least-once: the row stays `dispatching` while APNs is called and
 * becomes `dispatched` afterwards, so a crash in between re-sends under the same
 * per-notification collapse id rather than losing the alert.
 */
export class ChatNotificationDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  readonly workerId = `chat-notifications:${randomUUID()}`;
  constructor(
    private readonly db: () => DatabaseClient,
    private readonly options: ChatOptions = {},
    private readonly send: ChatPushSender = sendToProfileDevices,
    private readonly intervalMs = 1000
  ) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  /** One claim/deliver pass. Returns how many candidates it processed. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const db = this.db();
      const store = new ChatNotifications(db, this.options);
      const claimed = await store.claimDue(this.workerId);
      for (const row of claimed) await this.process(db, store, row);
      return claimed.length;
    } catch (error) {
      console.error('[chat-notifications] dispatch pass failed', (error as Error).message);
      return 0;
    } finally {
      this.running = false;
    }
  }
  private async process(db: DatabaseClient, store: ChatNotifications, row: ChatNotificationRow) {
    try {
      const check = await store.recheck(row);
      if (check.action === 'cancel') {
        await store.markCancelled(row, this.workerId, check.reason);
        return;
      }
      const type = row.type as ChatNotificationType;
      // The master switch turns every transport off. A type is delivered to history
      // when either its push or its in-app transport is on; push only when APNs is.
      const apns = await resolveNotificationMode(db, row.owner_profile_id, type, 'apns');
      const inApp = await resolveNotificationMode(db, row.owner_profile_id, type, 'in_app');
      if (apns === 'off' && inApp === 'off') {
        await store.markCancelled(row, this.workerId, 'preferences_off');
        return;
      }
      const threadTitle = chatThreadTitle(check.threadTitle);
      if (apns !== 'off') {
        const presentation: ChatPushPresentation = {
          type,
          threadId: row.thread_id,
          runId: row.run_id,
          threadTitle,
          // This row joins the unread history once dispatched.
          badge: (await unreadBadgeCount(db, row.owner_profile_id)) + 1,
          deepLink: CHAT_NOTIFICATION_DEEP_LINK.replace(':threadId', row.thread_id)
        };
        await this.send({
          db,
          profileId: row.owner_profile_id,
          body: chatApnsBody(presentation, apns),
          mode: apns,
          collapseId: `chat:${row.id}`
        });
      }
      await store.markDispatched(row, this.workerId, threadTitle);
    } catch (error) {
      await store
        .markFailedAttempt(row, this.workerId, (error as Error).message || 'dispatch failed')
        .catch(() => undefined);
    }
  }
}
