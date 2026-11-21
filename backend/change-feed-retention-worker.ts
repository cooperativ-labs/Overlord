import { pruneChangeFeedBatch } from '../packages/core/service/change-feed-retention.ts';
import { requireDatabaseClient } from './db.ts';
import { PollLoop } from './poll-loop.ts';

/** Disabled unless explicitly enabled after every client can recover. */
export class ChangeFeedRetentionWorker extends PollLoop {
  private nextScanAt = 0;

  constructor() {
    super({ intervalMs: 5_000, logPrefix: 'change-feed-retention', unref: true });
  }

  protected async runOnce(): Promise<void> {
    if (process.env.OVERLORD_CHANGE_FEED_PRUNING_ENABLED !== 'true') return;
    if (Date.now() < this.nextScanAt) return;
    const db = requireDatabaseClient();
    if (db.dialect !== 'postgres') return;
    const result = await pruneChangeFeedBatch(db);
    // Once caught up, avoid taking the feed lock every five seconds when the
    // next prefix cannot yet be old enough to remove.
    if (result.deleted < 1000) this.nextScanAt = Date.now() + 60 * 60 * 1000;
    if (result.deleted) console.info('[change-feed-retention]', result);
  }
}
