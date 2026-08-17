import type { DatabaseClient } from '@overlord/database';

import {
  isPushNotificationCategory,
  PUSH_NOTIFICATION_DISPATCH_JOB_TYPE,
  type PushNotificationCategory
} from '../packages/core/service/push-notification-jobs.ts';
import { nowIso } from '../packages/core/service/util.ts';
import type { ClaimedWorkerJob } from '../packages/core/service/worker-jobs.ts';

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
import { WorkerJobPoller } from './worker-job-poller.ts';

/** A stale "awaiting review" ping is noise, so alerts are allowed to expire. */
const ALERT_EXPIRATION_MS = 60 * 60 * 1000;

type WorkerJobRow = ClaimedWorkerJob;

type DeviceTokenRow = {
  id: string;
  device_token: string;
  environment: string;
  bundle_id: string;
};

type JobTarget = {
  profileId: string;
  missionId: string;
  /** Objective the event was raised for; absent on older queued jobs. */
  objectiveId: string | null;
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
      objectiveId: typeof payload.objectiveId === 'string' ? payload.objectiveId : null,
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
        objectiveId: presentation.objectiveId,
        objectiveDisplayId: presentation.objectiveDisplayId,
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

/**
 * The standard-device-token transport. It intentionally accepts an already
 * resolved mode so the durable notification dispatcher can own policy while
 * this module stays responsible only for the existing APNs delivery path.
 */
export async function deliverStandardPush({
  db,
  profileId,
  missionId,
  objectiveId = null,
  category,
  mode
}: {
  db: DatabaseClient;
  profileId: string;
  missionId: string;
  objectiveId?: string | null;
  category: PushNotificationCategory;
  mode: 'alert' | 'silent';
}): Promise<void> {
  const tokens = await db.all<DeviceTokenRow>(
    `SELECT id, device_token, environment, bundle_id
         FROM device_push_tokens WHERE profile_id = ?`,
    [profileId]
  );
  if (tokens.length === 0) return;
  const presentation = await buildPushNotificationPresentation({
    db,
    profileId,
    missionId,
    objectiveId,
    category
  });
  if (!presentation) {
    // The mission was deleted, reassigned, or is no longer readable by the
    // recipient; dropping the queued notification is the correct outcome.
    return;
  }
  const { body } = apnsBody(presentation, mode);
  // One collapse id per (objective, category) — falling back to the mission for
  // mission-scoped events. Keying on the mission alone would let two runs of the
  // same mission replace each other's banners once they identify objectives.
  const collapseId = `${category}:${presentation.objectiveId ?? missionId}`.slice(0, 64);
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
    await db.run(`UPDATE device_push_tokens SET last_sent_at = ?, updated_at = ? WHERE id = ?`, [
      now,
      now,
      token.id
    ]);
  }
}

class PushNotificationDispatcher extends WorkerJobPoller {
  constructor() {
    super({
      workerIdPrefix: 'push-notification',
      jobTypes: [PUSH_NOTIFICATION_DISPATCH_JOB_TYPE],
      logPrefix: 'push-notification-dispatcher'
    });
  }

  protected databaseClient(): DatabaseClient {
    return requireDatabaseClient();
  }

  protected async processJob(db: DatabaseClient, job: WorkerJobRow): Promise<void> {
    const target = parseJob(job.payload_json);
    if (!target) {
      await this.finishJob(db, job, 'failed', 'Malformed push notification payload');
      return;
    }

    const mode = await resolveNotificationMode(db, target.profileId, target.category, 'apns');
    if (mode !== 'off') {
      await deliverStandardPush({
        db,
        profileId: target.profileId,
        missionId: target.missionId,
        objectiveId: target.objectiveId,
        category: target.category,
        mode
      });
    }
    await this.finishJob(db, job);
  }
}

export const pushNotificationDispatcher = new PushNotificationDispatcher();
/** Exported for tests: drives one claim/deliver cycle synchronously. */
export const __testables = { apnsBody, PushNotificationDispatcher, deliverStandardPush };
