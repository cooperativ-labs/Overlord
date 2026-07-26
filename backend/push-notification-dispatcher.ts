import type { DatabaseClient } from '@overlord/database';

import {
  isPushNotificationCategory,
  PUSH_NOTIFICATION_DISPATCH_JOB_TYPE,
  type PushNotificationCategory
} from '../packages/core/service/push-notification-jobs.ts';
import { newId, nowIso } from '../packages/core/service/util.ts';

import {
  type ApnsConfig,
  apnsConfig,
  apnsHostFor,
  isRetiredTokenResponse,
  sendApnsRequest
} from './apns-client.ts';
import { requireDatabaseClient } from './db.ts';
import {
  buildPushNotificationPresentation,
  type PushNotificationPresentation,
  resolveNotificationMode
} from './push-notifications.ts';

const POLL_INTERVAL_MS = 1_500;
const LOCK_TTL_MS = 60_000;
const RETRY_BACKOFF_MS = [15_000, 60_000, 300_000, 900_000, 3_600_000];
/** A stale "awaiting review" ping is noise, so alerts are allowed to expire. */
const ALERT_EXPIRATION_MS = 60 * 60 * 1000;

type WorkerJobRow = {
  id: string;
  payload_json: string;
  attempt_count: number;
  max_attempts: number;
  revision: number;
};

type DeviceTokenRow = {
  id: string;
  device_token: string;
  environment: string;
  bundle_id: string;
};

type JobTarget = {
  profileId: string;
  missionId: string;
  category: PushNotificationCategory;
};

function parseJob(payloadJson: string): JobTarget | null {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    if (typeof payload.profileId !== 'string' || !payload.profileId) return null;
    if (typeof payload.missionId !== 'string' || !payload.missionId) return null;
    if (!isPushNotificationCategory(payload.category)) return null;
    return {
      profileId: payload.profileId,
      missionId: payload.missionId,
      category: payload.category
    };
  } catch {
    return null;
  }
}

/**
 * Builds the APNs body. `silent` sends a content-available background push with
 * no alert dictionary at all, so nothing user-visible can leak from a category
 * the recipient asked to keep quiet.
 */
function apnsBody(
  presentation: PushNotificationPresentation,
  mode: 'alert' | 'silent'
): { body: string } {
  const aps: Record<string, unknown> =
    mode === 'alert'
      ? {
          alert: { title: presentation.title, body: presentation.body },
          sound: 'default',
          badge: presentation.badge,
          'thread-id': presentation.missionId
        }
      : {
          'content-available': 1,
          badge: presentation.badge,
          'thread-id': presentation.missionId
        };
  return {
    body: JSON.stringify({
      aps,
      data: {
        missionId: presentation.missionId,
        category: presentation.category,
        deepLink: presentation.deepLink
      }
    })
  };
}

async function sendStandardPush({
  token,
  body,
  config,
  mode,
  collapseId
}: {
  token: DeviceTokenRow;
  body: string;
  config: ApnsConfig;
  mode: 'alert' | 'silent';
  collapseId: string;
}) {
  const headers: Record<string, string> = {
    // The plain bundle-id topic — never the `.push-type.liveactivity` suffix.
    'apns-topic': token.bundle_id,
    'apns-push-type': mode === 'alert' ? 'alert' : 'background',
    'apns-priority': mode === 'alert' ? '10' : '5',
    'apns-collapse-id': collapseId
  };
  if (mode === 'alert') {
    headers['apns-expiration'] = String(Math.floor((Date.now() + ALERT_EXPIRATION_MS) / 1000));
  }
  return sendApnsRequest({
    token: token.device_token,
    body,
    config,
    headers,
    // Per-registration environment wins over OVERLORD_APNS_ENV so a debug or
    // TestFlight install is never sent through the production APNs host.
    host: apnsHostFor(token.environment === 'sandbox' ? 'sandbox' : 'production')
  });
}

class PushNotificationDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private readonly workerId = `push-notification:${process.pid}:${newId().slice(0, 8)}`;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  pollNow(): void {
    void this.poll();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const db = requireDatabaseClient();
      const job = await claimNextJob(db, this.workerId);
      if (job) await this.processJob(db, job);
    } catch (error) {
      console.error('[push-notification-dispatcher] poll failed', error);
    } finally {
      this.polling = false;
    }
  }

  private async processJob(db: DatabaseClient, job: WorkerJobRow): Promise<void> {
    const target = parseJob(job.payload_json);
    if (!target) {
      await finishJob(db, job.id, 'failed', 'Malformed push notification payload');
      return;
    }

    try {
      const mode = await resolveNotificationMode(db, target.profileId, target.category);
      if (mode === 'off') {
        await finishJob(db, job.id, 'succeeded', null);
        return;
      }
      const tokens = await db.all<DeviceTokenRow>(
        `SELECT id, device_token, environment, bundle_id
           FROM device_push_tokens WHERE profile_id = ?`,
        [target.profileId]
      );
      if (tokens.length === 0) {
        await finishJob(db, job.id, 'succeeded', null);
        return;
      }
      const presentation = await buildPushNotificationPresentation({
        db,
        profileId: target.profileId,
        missionId: target.missionId,
        category: target.category
      });
      if (!presentation) {
        // The mission was deleted, reassigned, or is no longer readable by the
        // recipient; dropping the queued notification is the correct outcome.
        await finishJob(db, job.id, 'succeeded', null);
        return;
      }
      const { body } = apnsBody(presentation, mode);
      // One collapse id per (mission, category): a rapid re-delivery replaces the
      // previous banner instead of stacking, and distinct categories never merge.
      const collapseId = `${target.category}:${target.missionId}`.slice(0, 64);
      const config = apnsConfig();
      for (const token of tokens) {
        if (!config) continue; // Local development stays functional without APNs credentials.
        const response = await sendStandardPush({ token, body, config, mode, collapseId });
        if (isRetiredTokenResponse(response)) {
          await db.run(`DELETE FROM device_push_tokens WHERE id = ?`, [token.id]);
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`APNs ${response.status}: ${response.body || 'unknown response'}`);
        }
        const now = nowIso();
        await db.run(
          `UPDATE device_push_tokens SET last_sent_at = ?, updated_at = ? WHERE id = ?`,
          [now, now, token.id]
        );
      }
      await finishJob(db, job.id, 'succeeded', null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (job.attempt_count >= job.max_attempts) {
        await finishJob(db, job.id, 'failed', message);
      } else {
        const delay =
          RETRY_BACKOFF_MS[Math.min(job.attempt_count - 1, RETRY_BACKOFF_MS.length - 1)]!;
        await db.run(
          `UPDATE worker_jobs SET status = 'queued', run_after = ?, last_error = ?, locked_by = NULL,
             locked_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?`,
          [new Date(Date.now() + delay).toISOString(), message, nowIso(), job.id]
        );
      }
    }
  }
}

async function claimNextJob(db: DatabaseClient, workerId: string): Promise<WorkerJobRow | null> {
  return db.transaction(async tx => {
    const now = nowIso();
    await tx.run(
      `UPDATE worker_jobs SET status = 'queued', locked_by = NULL, locked_until = NULL, updated_at = ?, revision = revision + 1
       WHERE type = ? AND status = 'running' AND deleted_at IS NULL AND locked_until < ?`,
      [now, PUSH_NOTIFICATION_DISPATCH_JOB_TYPE, now]
    );
    const lock = tx.dialect === 'postgres' ? 'FOR UPDATE SKIP LOCKED' : '';
    const candidate = await tx.get<WorkerJobRow>(
      `SELECT id, payload_json, attempt_count, max_attempts, revision FROM worker_jobs
        WHERE type = ? AND status = 'queued' AND deleted_at IS NULL AND run_after <= ?
        ORDER BY priority ASC, run_after ASC LIMIT 1 ${lock}`,
      [PUSH_NOTIFICATION_DISPATCH_JOB_TYPE, now]
    );
    if (!candidate) return null;
    const updated = await tx.run(
      `UPDATE worker_jobs SET status = 'running', attempt_count = attempt_count + 1, locked_by = ?, locked_until = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND status = 'queued' AND revision = ?`,
      [
        workerId,
        new Date(Date.parse(now) + LOCK_TTL_MS).toISOString(),
        now,
        candidate.id,
        candidate.revision
      ]
    );
    return updated.changes === 0
      ? null
      : {
          ...candidate,
          attempt_count: candidate.attempt_count + 1,
          revision: candidate.revision + 1
        };
  });
}

async function finishJob(
  db: DatabaseClient,
  id: string,
  status: 'succeeded' | 'failed',
  lastError: string | null
): Promise<void> {
  await db.run(
    `UPDATE worker_jobs SET status = ?, last_error = ?, locked_by = NULL, locked_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?`,
    [status, lastError, nowIso(), id]
  );
}

export const pushNotificationDispatcher = new PushNotificationDispatcher();
/** Exported for tests: drives one claim/deliver cycle synchronously. */
export const __testables = { apnsBody, claimNextJob, PushNotificationDispatcher };
