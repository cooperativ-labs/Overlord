import type { DatabaseClient } from '@overlord/database';

import {
  LIVE_ACTIVITY_DISPATCH_JOB_TYPE,
  LIVE_ACTIVITY_START_JOB_TYPE
} from '../packages/core/service/live-activity-jobs.ts';
import { newId, nowIso } from '../packages/core/service/util.ts';
import {
  type ClaimedWorkerJob,
  claimNextWorkerJob,
  finishWorkerJob,
  retryWorkerJob
} from '../packages/core/service/worker-jobs.ts';

import {
  type ApnsConfig,
  apnsConfig,
  apnsHostFor,
  type ApnsResult,
  isRetiredTokenResponse,
  sendApnsRequest
} from './apns-client.ts';
import { requireDatabaseClient } from './db.ts';
import {
  buildLiveActivityContentState,
  LIVE_ACTIVITY_ACCOUNT_LABEL,
  liveActivityContentHash,
  type LiveActivityContentState
} from './live-activities.ts';

const POLL_INTERVAL_MS = 1_500;
const UNCHANGED_MIN_INTERVAL_MS = 5 * 60 * 1000;
const COMPLETION_DISMISSAL_MS = 10 * 60 * 1000;
/**
 * How long a sent start is assumed to be in flight. The device answers a start
 * by registering the new activity's update token, but that round trip is not
 * instantaneous, so a second start within the window would produce a duplicate
 * Lock Screen activity.
 */
const START_COOLDOWN_MS = 5 * 60 * 1000;
const STALE_DATE_MS = 30 * 60 * 1000;
type WorkerJobRow = ClaimedWorkerJob;

type TokenRow = {
  id: string;
  activity_id: string;
  push_token: string;
  last_content_hash: string | null;
  last_sent_at: string | null;
};

type StartTokenRow = {
  id: string;
  start_token: string;
  environment: string;
  bundle_id: string;
  activity_type: string;
  last_started_at: string | null;
};

function apnsPayload(state: LiveActivityContentState | null): {
  event: 'update' | 'end';
  body: string;
} {
  const now = Date.now();
  const completionHold = state && state.running.length === 0 && state.recentCompletion !== null;
  const event = state?.running.length ? 'update' : 'end';
  const finalState: LiveActivityContentState = state ?? {
    running: [],
    recentCompletion: null,
    updatedAt: new Date(now).toISOString()
  };
  const aps: Record<string, unknown> = {
    timestamp: Math.floor(now / 1000),
    event,
    'content-state': finalState
  };
  if (event === 'update') aps['stale-date'] = Math.floor((now + 30 * 60 * 1000) / 1000);
  if (event === 'end')
    aps['dismissal-date'] = Math.floor(
      (now + (completionHold ? COMPLETION_DISMISSAL_MS : 0)) / 1000
    );
  return { event, body: JSON.stringify({ aps }) };
}

/**
 * The push-to-start body. `event: "start"` additionally requires the attributes
 * type and the static attributes, because APNs — not the app — is constructing
 * the activity. The alert dictionary is what lets iOS surface the new activity
 * on a locked device; it carries the same bounded presentation text the Lock
 * Screen widget already shows and nothing more.
 */
function apnsStartPayload(state: LiveActivityContentState, activityType: string): string {
  const now = Date.now();
  const primary = state.running[0] ?? state.recentCompletion;
  return JSON.stringify({
    aps: {
      timestamp: Math.floor(now / 1000),
      event: 'start',
      'stale-date': Math.floor((now + STALE_DATE_MS) / 1000),
      'attributes-type': activityType,
      attributes: { accountLabel: LIVE_ACTIVITY_ACCOUNT_LABEL },
      'content-state': state,
      alert: {
        title: primary ? primary.title : LIVE_ACTIVITY_ACCOUNT_LABEL,
        body: primary ? `${primary.projectName} · ${primary.displayId}` : 'Mission running'
      }
    }
  });
}

/** ActivityKit delivery: the liveactivity topic suffix and push type are mandatory. */
async function sendApns({
  token,
  body,
  config,
  priority = '5',
  bundleId,
  host
}: {
  token: string;
  body: string;
  config: ApnsConfig;
  /** Starts go out at 10; ordinary content updates stay at 5. */
  priority?: '5' | '10';
  /** Per-registration bundle id, so a debug build is never sent a prod topic. */
  bundleId?: string;
  host?: string;
}): Promise<ApnsResult> {
  return sendApnsRequest({
    token,
    body,
    config,
    host,
    headers: {
      'apns-topic': `${bundleId ?? config.bundleId}.push-type.liveactivity`,
      'apns-push-type': 'liveactivity',
      'apns-priority': priority
    }
  });
}

class LiveActivityDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private readonly workerId = `live-activity:${process.pid}:${newId().slice(0, 8)}`;

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
      const job = await claimNextWorkerJob({
        db,
        jobType: LIVE_ACTIVITY_DISPATCH_JOB_TYPE,
        workerId: this.workerId
      });
      if (job) await this.processJob(db, job);
      const startJob = await claimNextWorkerJob({
        db,
        jobType: LIVE_ACTIVITY_START_JOB_TYPE,
        workerId: this.workerId
      });
      if (startJob) await this.processStartJob(db, startJob);
    } catch (error) {
      console.error('[live-activity-dispatcher] poll failed', error);
    } finally {
      this.polling = false;
    }
  }

  private async processJob(db: DatabaseClient, job: WorkerJobRow): Promise<void> {
    let profileId: string;
    try {
      const payload = JSON.parse(job.payload_json) as { profileId?: unknown };
      if (typeof payload.profileId !== 'string' || !payload.profileId) throw new Error('profileId');
      profileId = payload.profileId;
    } catch {
      await finishWorkerJob(db, job.id, 'failed', 'Malformed profile payload');
      return;
    }

    try {
      const tokens = await db.all<TokenRow>(
        `SELECT id, activity_id, push_token, last_content_hash, last_sent_at
           FROM live_activity_push_tokens WHERE profile_id = ?`,
        [profileId]
      );
      if (tokens.length === 0) {
        await finishWorkerJob(db, job.id, 'succeeded', null);
        return;
      }
      const state = await buildLiveActivityContentState(db, profileId);
      const hash = liveActivityContentHash(state);
      const payload = apnsPayload(state);
      const config = apnsConfig();
      for (const token of tokens) {
        const sentAt = token.last_sent_at ? Date.parse(token.last_sent_at) : NaN;
        if (
          payload.event === 'update' &&
          token.last_content_hash === hash &&
          Number.isFinite(sentAt) &&
          Date.now() - sentAt < UNCHANGED_MIN_INTERVAL_MS
        ) {
          continue;
        }
        if (!config) continue; // Local development remains fully functional without APNs credentials.
        const response = await sendApns({ token: token.push_token, body: payload.body, config });
        if (response.status === 400 || response.status === 410) {
          await db.run(`DELETE FROM live_activity_push_tokens WHERE id = ?`, [token.id]);
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`APNs ${response.status}: ${response.body || 'unknown response'}`);
        }
        if (payload.event === 'end') {
          await db.run(`DELETE FROM live_activity_push_tokens WHERE id = ?`, [token.id]);
        } else {
          const now = nowIso();
          await db.run(
            `UPDATE live_activity_push_tokens SET last_content_hash = ?, last_sent_at = ?, updated_at = ? WHERE id = ?`,
            [hash, now, now, token.id]
          );
        }
      }
      await finishWorkerJob(db, job.id, 'succeeded', null);
    } catch (error) {
      await this.failOrRetry(db, job, error);
    }
  }

  /**
   * Push-to-start: ask APNs to create the activity on the assigned account's
   * devices when a desktop-launched mission starts executing.
   *
   * A start is only ever correct when the account has nothing on screen, so this
   * is a no-op when an update registration already exists — whether the user
   * started that activity in the app or an earlier push started it — and while a
   * previous start is still in flight. Once the device answers by registering the
   * new activity's update token, the ordinary dispatch job owns every later
   * update and the end.
   */
  private async processStartJob(db: DatabaseClient, job: WorkerJobRow): Promise<void> {
    let profileId: string;
    try {
      const payload = JSON.parse(job.payload_json) as { profileId?: unknown };
      if (typeof payload.profileId !== 'string' || !payload.profileId) throw new Error('profileId');
      profileId = payload.profileId;
    } catch {
      await finishWorkerJob(db, job.id, 'failed', 'Malformed profile payload');
      return;
    }

    try {
      // No push-to-start registration means the account never consented to (or
      // cannot support) desktop-initiated activities. That is a success, not a
      // failure: local starts remain the fallback.
      const startTokens = await db.all<StartTokenRow>(
        `SELECT id, start_token, environment, bundle_id, activity_type, last_started_at
           FROM live_activity_start_tokens WHERE profile_id = ?`,
        [profileId]
      );
      if (startTokens.length === 0) {
        await finishWorkerJob(db, job.id, 'succeeded', null);
        return;
      }
      const live = await db.get<{ id: string }>(
        `SELECT id FROM live_activity_push_tokens WHERE profile_id = ? LIMIT 1`,
        [profileId]
      );
      if (live) {
        await finishWorkerJob(db, job.id, 'succeeded', null);
        return;
      }
      const state = await buildLiveActivityContentState(db, profileId);
      // A bare completion hold is not worth interrupting for; only an actually
      // running mission earns a new Lock Screen activity.
      if (!state || state.running.length === 0) {
        await finishWorkerJob(db, job.id, 'succeeded', null);
        return;
      }
      const config = apnsConfig();
      const startedAtCutoff = Date.now() - START_COOLDOWN_MS;
      for (const token of startTokens) {
        const lastStarted = token.last_started_at ? Date.parse(token.last_started_at) : NaN;
        if (Number.isFinite(lastStarted) && lastStarted > startedAtCutoff) continue;
        if (!config) continue; // Local development remains functional without APNs credentials.
        const response = await sendApns({
          token: token.start_token,
          body: apnsStartPayload(state, token.activity_type),
          config,
          priority: '10',
          bundleId: token.bundle_id,
          host: apnsHostFor(token.environment === 'sandbox' ? 'sandbox' : 'production')
        });
        if (isRetiredTokenResponse(response)) {
          await db.run(`DELETE FROM live_activity_start_tokens WHERE id = ?`, [token.id]);
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`APNs ${response.status}: ${response.body || 'unknown response'}`);
        }
        const now = nowIso();
        await db.run(
          `UPDATE live_activity_start_tokens SET last_started_at = ?, updated_at = ? WHERE id = ?`,
          [now, now, token.id]
        );
      }
      await finishWorkerJob(db, job.id, 'succeeded', null);
    } catch (error) {
      await this.failOrRetry(db, job, error);
    }
  }

  private async failOrRetry(db: DatabaseClient, job: WorkerJobRow, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (job.attempt_count >= job.max_attempts) {
      await finishWorkerJob(db, job.id, 'failed', message);
    } else {
      await retryWorkerJob(db, job.id, job.attempt_count, message);
    }
  }
}

export const liveActivityDispatcher = new LiveActivityDispatcher();
export const __testables = { apnsPayload, apnsStartPayload, LiveActivityDispatcher };
