import type { DatabaseClient } from '@overlord/database';
import { createSign } from 'node:crypto';
import http2 from 'node:http2';

import { LIVE_ACTIVITY_DISPATCH_JOB_TYPE } from '../packages/core/service/live-activity-jobs.ts';
import { newId, nowIso } from '../packages/core/service/util.ts';

import { requireDatabaseClient } from './db.ts';
import {
  buildLiveActivityContentState,
  liveActivityContentHash,
  type LiveActivityContentState
} from './live-activities.ts';

const POLL_INTERVAL_MS = 1_500;
const LOCK_TTL_MS = 60_000;
const UNCHANGED_MIN_INTERVAL_MS = 5 * 60 * 1000;
const COMPLETION_DISMISSAL_MS = 10 * 60 * 1000;
const RETRY_BACKOFF_MS = [15_000, 60_000, 300_000, 900_000, 3_600_000];

type WorkerJobRow = {
  id: string;
  payload_json: string;
  attempt_count: number;
  max_attempts: number;
  revision: number;
};

type TokenRow = {
  id: string;
  activity_id: string;
  push_token: string;
  last_content_hash: string | null;
  last_sent_at: string | null;
};

type ApnsResult = { status: number; body: string };

function liveActivityConfig(): {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  host: string;
} | null {
  const teamId = process.env.OVERLORD_APNS_TEAM_ID?.trim();
  const keyId = process.env.OVERLORD_APNS_KEY_ID?.trim();
  const privateKey = process.env.OVERLORD_APNS_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const bundleId = process.env.OVERLORD_IOS_BUNDLE_ID?.trim();
  if (!teamId || !keyId || !privateKey || !bundleId) return null;
  return {
    teamId,
    keyId,
    privateKey,
    bundleId,
    host:
      process.env.OVERLORD_APNS_ENV === 'sandbox'
        ? 'https://api.sandbox.push.apple.com'
        : 'https://api.push.apple.com'
  };
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function apnsJwt(config: NonNullable<ReturnType<typeof liveActivityConfig>>): string {
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }))}.${b64url(
    JSON.stringify({ iss: config.teamId, iat: now })
  )}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({ key: config.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(signature)}`;
}

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

async function sendApns({
  token,
  body,
  config
}: {
  token: string;
  body: string;
  config: NonNullable<ReturnType<typeof liveActivityConfig>>;
}): Promise<ApnsResult> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(config.host);
    let settled = false;
    const finish = (result: ApnsResult) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(result);
    };
    client.once('error', error => {
      if (settled) return;
      settled = true;
      client.close();
      reject(error);
    });
    const request = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsJwt(config)}`,
      'apns-topic': `${config.bundleId}.push-type.liveactivity`,
      'apns-push-type': 'liveactivity',
      'apns-priority': '5',
      'content-type': 'application/json'
    });
    let status = 0;
    let response = '';
    request.on('response', headers => {
      status = Number(headers[':status'] ?? 0);
    });
    request.setEncoding('utf8');
    request.on('data', chunk => {
      response += chunk;
    });
    request.once('end', () => finish({ status, body: response.slice(0, 512) }));
    request.once('error', reject);
    request.end(body);
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
      const job = await claimNextJob(db, this.workerId);
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
      await finishJob(db, job.id, 'failed', 'Malformed profile payload');
      return;
    }

    try {
      const tokens = await db.all<TokenRow>(
        `SELECT id, activity_id, push_token, last_content_hash, last_sent_at
           FROM live_activity_push_tokens WHERE profile_id = ?`,
        [profileId]
      );
      if (tokens.length === 0) {
        await finishJob(db, job.id, 'succeeded', null);
        return;
      }
      const state = await buildLiveActivityContentState(db, profileId);
      const hash = liveActivityContentHash(state);
      const payload = apnsPayload(state);
      const config = liveActivityConfig();
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
      [now, LIVE_ACTIVITY_DISPATCH_JOB_TYPE, now]
    );
    const lock = tx.dialect === 'postgres' ? 'FOR UPDATE SKIP LOCKED' : '';
    const candidate = await tx.get<WorkerJobRow>(
      `SELECT id, payload_json, attempt_count, max_attempts, revision FROM worker_jobs
        WHERE type = ? AND status = 'queued' AND deleted_at IS NULL AND run_after <= ?
        ORDER BY priority ASC, run_after ASC LIMIT 1 ${lock}`,
      [LIVE_ACTIVITY_DISPATCH_JOB_TYPE, now]
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

export const liveActivityDispatcher = new LiveActivityDispatcher();
