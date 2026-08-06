import type { DatabaseClient } from '@overlord/database';

import { LIVE_ACTIVITY_DISPATCH_JOB_TYPE } from '../packages/core/service/live-activity-jobs.ts';
import { newId, nowIso } from '../packages/core/service/util.ts';
import {
  type ClaimedWorkerJob,
  claimNextWorkerJob,
  finishWorkerJob,
  retryWorkerJob
} from '../packages/core/service/worker-jobs.ts';

import { type ApnsConfig, apnsConfig, type ApnsResult, sendApnsRequest } from './apns-client.ts';
import { requireDatabaseClient } from './db.ts';
import {
  buildLiveActivityContentState,
  liveActivityContentHash,
  type LiveActivityContentState
} from './live-activities.ts';

const POLL_INTERVAL_MS = 1_500;
const UNCHANGED_MIN_INTERVAL_MS = 5 * 60 * 1000;
const COMPLETION_DISMISSAL_MS = 10 * 60 * 1000;
type WorkerJobRow = ClaimedWorkerJob;

type TokenRow = {
  id: string;
  activity_id: string;
  push_token: string;
  last_content_hash: string | null;
  last_sent_at: string | null;
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

/** ActivityKit delivery: the liveactivity topic suffix and push type are mandatory. */
async function sendApns({
  token,
  body,
  config
}: {
  token: string;
  body: string;
  config: ApnsConfig;
}): Promise<ApnsResult> {
  return sendApnsRequest({
    token,
    body,
    config,
    headers: {
      'apns-topic': `${config.bundleId}.push-type.liveactivity`,
      'apns-push-type': 'liveactivity',
      'apns-priority': '5'
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
      const message = error instanceof Error ? error.message : String(error);
      if (job.attempt_count >= job.max_attempts) {
        await finishWorkerJob(db, job.id, 'failed', message);
      } else {
        await retryWorkerJob(db, job.id, job.attempt_count, message);
      }
    }
  }
}

export const liveActivityDispatcher = new LiveActivityDispatcher();
export const __testables = { apnsPayload, LiveActivityDispatcher };
