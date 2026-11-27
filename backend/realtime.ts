import { PERMISSIONS } from '@overlord/auth';
import type { EntityChangeDto, SyncChangesDto } from '@overlord/contract';
import type { Response } from 'express';
import { once } from 'node:events';

import { subscribePostgres } from './execution/pg-listen.ts';
import {
  currentMaxSeq,
  getActiveTokenProjectIds,
  getAuthorizedWorkspacesContext,
  readCommittedFeedBounds,
  requireDatabaseClient,
  withCommittedFeed
} from './db.ts';
import { PollLoop } from './poll-loop.ts';
import { actorCan } from './rbac.ts';

const CHANGE_BATCH_LIMIT = 500;
const REPLAY_PENDING_BATCH_LIMIT = 100;
const REPLAY_PENDING_BYTE_LIMIT = 1024 * 1024;
const POSTGRES_WAKE_CHANNEL = 'overlord_entity_changes';
const POLL_INTERVAL_MS = 500;
const RECONCILIATION_MS = 5_000;
const LISTENER_RETRY_MS = 5_000;
const AUTHORIZATION_CHANGE_ENTITY_TYPES = new Set([
  'role_assignment',
  'user_token',
  'user_token_workspace',
  'workspace',
  'workspace_user'
]);

export interface ChangeRow {
  seq: number;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  operation: EntityChangeDto['operation'];
  project_id: string | null;
  mission_id: string | null;
  objective_id: string | null;
  changed_fields_json: string | null;
  occurred_at: string;
}

const SELECT_CHANGES_SQL = `
  SELECT seq, workspace_id, entity_type, entity_id, operation, project_id, mission_id, objective_id,
         changed_fields_json, occurred_at
    FROM entity_changes
   WHERE seq > ?
   ORDER BY seq ASC
   LIMIT ?
`;

export function parseChangedFields(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((field): field is string => typeof field === 'string');
  } catch {
    return [];
  }
}

export function entityChangeDtoFromRow(row: ChangeRow): EntityChangeDto {
  return {
    seq: row.seq,
    workspaceId: row.workspace_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    projectId: row.project_id,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    changedFields: parseChangedFields(row.changed_fields_json),
    occurredAt: row.occurred_at
  };
}

export type ChangeFeedBatch = SyncChangesDto;

export class ExpiredChangeCursor extends Error {
  constructor(public readonly cursor: number) {
    super('Change-feed cursor expired; refresh authorized state.');
  }
}

/**
 * Select every workspace in the authentication boundary's immutable request
 * snapshot where the caller may read projects. Token consent and live
 * membership were already intersected while building this snapshot, and the
 * cached role keys let this aggregate gate avoid rebuilding either here.
 */
export async function readableChangeFeedWorkspaceIds(): Promise<string[]> {
  const authorized = getAuthorizedWorkspacesContext();
  if (!authorized) return [];
  const checked = await Promise.all(
    authorized.workspaces.map(async workspace => ({
      workspaceId: workspace.workspaceId,
      allowed: await actorCan(PERMISSIONS.PROJECT_READ, {
        workspaceId: workspace.workspaceId,
        workspaceUserId: workspace.workspaceUserId
      })
    }))
  );
  return checked.filter(workspace => workspace.allowed).map(workspace => workspace.workspaceId);
}

export async function readChangesAfter(
  afterSeq: number,
  workspaceIds: readonly string[],
  limit = CHANGE_BATCH_LIMIT,
  projectIds: readonly string[] | null = getActiveTokenProjectIds()
): Promise<ChangeFeedBatch> {
  const normalizedAfter = Number.isFinite(afterSeq) && afterSeq > 0 ? Math.floor(afterSeq) : 0;
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : CHANGE_BATCH_LIMIT;
  const normalizedLimit = Math.max(1, Math.min(requestedLimit, CHANGE_BATCH_LIMIT));
  const client = requireDatabaseClient();
  return withCommittedFeed(client, async client => {
    // Snapshot the global high-water mark before the filtered read. When the
    // visible page is exhausted, advancing to this value skips unauthorized
    // gaps without skipping a row committed after the snapshot.
    const { highWaterMark, retainedThrough } = await readCommittedFeedBounds(client);
    const scanThroughSeq = Math.max(normalizedAfter, highWaterMark);
    if (normalizedAfter < retainedThrough) throw new ExpiredChangeCursor(scanThroughSeq);
    const authorizedWorkspaceIds = [...new Set(workspaceIds.filter(Boolean))];
    if (authorizedWorkspaceIds.length === 0 || scanThroughSeq === normalizedAfter) {
      return { changes: [], cursor: scanThroughSeq, hasMore: false };
    }
    const workspacePlaceholders = authorizedWorkspaceIds.map(() => '?').join(', ');
    if (projectIds !== null && projectIds.length === 0) {
      return { changes: [], cursor: scanThroughSeq, hasMore: false };
    }
    const projectPredicate =
      projectIds === null ? '' : ` AND project_id IN (${projectIds.map(() => '?').join(', ')})`;
    const rows = await client.all<ChangeRow>(
      `SELECT seq, workspace_id, entity_type, entity_id, operation, project_id, mission_id,
            objective_id, changed_fields_json, occurred_at
       FROM entity_changes
      WHERE seq > ? AND seq <= ? AND workspace_id IN (${workspacePlaceholders})${projectPredicate}
      ORDER BY seq ASC
      LIMIT ?`,
      [
        normalizedAfter,
        scanThroughSeq,
        ...authorizedWorkspaceIds,
        ...(projectIds ?? []),
        normalizedLimit + 1
      ]
    );
    const hasMore = rows.length > normalizedLimit;
    const returnedRows = hasMore ? rows.slice(0, normalizedLimit) : rows;
    const changes = returnedRows.map(entityChangeDtoFromRow);
    const cursor = hasMore ? changes[changes.length - 1]!.seq : scanThroughSeq;

    return { changes, cursor, hasMore };
  });
}

interface RealtimeClient {
  response: Response;
  workspaceIds: Set<string>;
  projectIds: Set<string> | null;
  lastCursor: number;
  replaying: boolean;
  pending: Array<{ changes: EntityChangeDto[]; cursor: number; bytes: number }>;
  pendingBytes: number;
  refreshPending: boolean;
  closed: AbortController;
  onClose: () => void;
}

export interface AddRealtimeClientOptions {
  afterSeq?: number;
  signalReplayCompletion?: boolean;
  workspaceIds: readonly string[];
  projectIds?: readonly string[] | null;
}

/**
 * Tracks SSE subscribers and turns `entity_changes` rows into realtime deltas.
 *
 * Two detection paths keep the UI honest no matter who wrote to the database:
 *  1. The `entity_changes` seq cursor catches every mutation the web server and
 *     the CLI service layer record (the normal path) and forwards the deltas.
 *  2. `PRAGMA data_version` changes on any *external* connection commit; if it
 *     moves without new feed rows (a tool wrote a table directly), we emit a
 *     coarse `refresh` so clients refetch rather than miss the change.
 */
export class RealtimeHub extends PollLoop {
  private readonly clients = new Map<Response, RealtimeClient>();
  private cursor = 0;
  private lastDataVersion: number | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private postgres = false;
  private wakePending = false;
  private lastPassAt = 0;
  private stopListening: (() => Promise<void>) | null = null;
  private listenerRetry: NodeJS.Timeout | null = null;
  private listenerAttempt: Promise<void> | null = null;

  constructor(private readonly connectionString = process.env.DATABASE_URL?.trim()) {
    super({ intervalMs: POLL_INTERVAL_MS, logPrefix: 'realtime' });
  }

  override async start(): Promise<void> {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 25_000);
    this.postgres = requireDatabaseClient().dialect === 'postgres';
    if (this.postgres) {
      // Bootstrap before the HTTP server admits streams. A failed baseline
      // leaves the prior cursor in place so the first subscriber can recover.
      const epoch = this.heartbeatTimer;
      if (this.clients.size === 0) {
        try {
          const baseline = await currentMaxSeq();
          if (this.heartbeatTimer === epoch && this.clients.size === 0) this.cursor = baseline;
        } catch (error) {
          this.onPollError(error);
        }
      }
      if (this.heartbeatTimer !== epoch) return;
      super.start();
      if (this.connectionString) this.connectListener(this.connectionString);
    } else {
      void this.initializeCursor().catch(error => this.onPollError(error));
      super.start();
    }
  }

  override async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.listenerRetry) clearTimeout(this.listenerRetry);
    this.listenerRetry = null;
    const close = this.stopListening;
    this.stopListening = null;
    await Promise.all([super.stop(), close?.(), this.listenerAttempt]);
  }

  private connectListener(connectionString: string): void {
    const epoch = this.heartbeatTimer;
    if (!epoch) return;
    const retry = () => {
      if (this.heartbeatTimer !== epoch || this.listenerRetry) return;
      this.listenerRetry = setTimeout(() => {
        this.listenerRetry = null;
        this.connectListener(connectionString);
      }, LISTENER_RETRY_MS);
      this.listenerRetry.unref();
    };
    this.listenerAttempt = subscribePostgres({
      connectionString,
      channel: POSTGRES_WAKE_CHANNEL,
      onWake: () => {
        if (this.heartbeatTimer === epoch) void this.pollNow();
      },
      onDisconnect: () => {
        if (this.heartbeatTimer !== epoch) return;
        this.stopListening = null;
        retry();
        void this.pollNow();
      }
    })
      .then(async close => {
        if (this.heartbeatTimer !== epoch) {
          await close();
          return;
        }
        this.stopListening = close;
        // LISTEN only sees subsequent commits. Read after it is armed to catch
        // rows committed during startup or while the connection was down.
        void this.pollNow();
      })
      .catch(retry);
  }

  override async pollNow(): Promise<void> {
    if (this.postgres) this.wakePending = true;
    await super.pollNow();
  }

  protected override shouldPoll(): boolean {
    if (!this.postgres) return true;
    return (
      this.clients.size > 0 &&
      (this.wakePending ||
        !this.stopListening ||
        performance.now() - this.lastPassAt >= RECONCILIATION_MS)
    );
  }

  addClient(res: Response, options: AddRealtimeClientOptions): void {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');
    const client: RealtimeClient = {
      response: res,
      workspaceIds: new Set(options.workspaceIds),
      projectIds:
        options.projectIds === null || options.projectIds === undefined
          ? null
          : new Set(options.projectIds),
      lastCursor: options.afterSeq ?? this.cursor,
      replaying: options.afterSeq !== undefined,
      pending: [],
      pendingBytes: 0,
      refreshPending: false,
      closed: new AbortController(),
      onClose: () => this.removeClient(res)
    };
    const firstClient = this.clients.size === 0;
    this.clients.set(res, client);
    res.once('close', client.onClose);
    // Opted-in resume clients use the greeting to acknowledge replay, including empty pages.
    const signalReplayCompletion = options.signalReplayCompletion && client.replaying;
    if (!signalReplayCompletion) this.send(res, 'hello', { type: 'hello', cursor: this.cursor });
    if (options.afterSeq !== undefined) {
      void this.sendCatchUp(client, Boolean(signalReplayCompletion)).catch(error => {
        if (client.closed.signal.aborted) return;
        if (error instanceof ExpiredChangeCursor) {
          this.send(res, 'snapshot_required', {
            type: 'snapshot_required',
            cursor: error.cursor
          });
        } else {
          this.onPollError(error);
        }
        this.removeClient(res);
        res.end();
      });
    }
    if (firstClient && this.postgres) void this.pollNow();
  }

  removeClient(res: Response): void {
    const client = this.clients.get(res);
    if (!client) return;
    this.clients.delete(res);
    res.off('close', client.onClose);
    client.pending.length = 0;
    client.closed.abort();
  }

  /**
   * Force every subscriber to refetch. Used for server-state changes that do not
   * write to `entity_changes` — notably switching the active workspace, which
   * changes what every scoped query returns.
   */
  refreshAll(): void {
    for (const client of this.clients.values()) {
      if (client.projectIds === null) this.sendRefresh(client);
    }
  }

  private async initializeCursor(): Promise<void> {
    const client = requireDatabaseClient();
    this.cursor = await currentMaxSeq(client);
    this.lastDataVersion = (await client.sqliteDataVersion?.()) ?? null;
  }

  /** One feed pass; `pollNow()` runs it right after a local mutation for snappy echoes. */
  protected async runOnce(): Promise<void> {
    this.wakePending = false;
    this.lastPassAt = performance.now();
    const client = requireDatabaseClient();
    if (this.clients.size === 0) {
      // Keep the cursor moving even with no subscribers so a later client does
      // not get flooded with backlog it does not need.
      this.cursor = await currentMaxSeq(client);
      this.lastDataVersion = (await client.sqliteDataVersion?.()) ?? null;
      return;
    }

    const pass = await withCommittedFeed(client, async tx => {
      const { highWaterMark, retainedThrough } = await readCommittedFeedBounds(tx);
      if (this.cursor < retainedThrough) {
        return { expired: true as const, retainedThrough, cursor: highWaterMark };
      }
      return {
        expired: false as const,
        cursor: this.cursor,
        rows: await tx.all<ChangeRow>(SELECT_CHANGES_SQL, [this.cursor, CHANGE_BATCH_LIMIT])
      };
    });
    if (pass.expired) {
      for (const { response, lastCursor } of [...this.clients.values()]) {
        if (this.postgres && lastCursor >= pass.retainedThrough) continue;
        this.send(response, 'snapshot_required', {
          type: 'snapshot_required',
          cursor: pass.cursor
        });
        this.removeClient(response);
        response.end();
      }
      this.cursor = this.clients.size > 0 ? pass.retainedThrough : pass.cursor;
      if (this.clients.size > 0) setImmediate(() => void this.pollNow()).unref();
      return;
    }
    const rows = pass.rows;
    if (rows.length > 0) {
      this.cursor = rows[rows.length - 1]!.seq;
      // The authorization set is immutable for a request. End each stream
      // before broadcasting a row that can change that set; the client's
      // automatic reconnect passes through authentication again and rebuilds
      // token consent, live memberships, and role keys atomically. Catch-up
      // resumes from the client's last cursor, so no authorized row is lost.
      if (rows.some(row => AUTHORIZATION_CHANGE_ENTITY_TYPES.has(row.entity_type))) {
        this.reconnectClientsForAuthorizationChange();
      } else {
        this.broadcastChanges(rows, this.cursor);
      }
    }
    if (this.postgres && (rows.length === CHANGE_BATCH_LIMIT || this.wakePending)) {
      // A full page can span many commits summarized by a single wake. Yield
      // between pages so a backlog never monopolizes the event loop.
      setImmediate(() => void this.pollNow()).unref();
    }

    // SQLite-only external-write net: `sqliteDataVersion()` returns null on
    // Postgres, so this branch never fires there (the feed is the sole detector).
    const version = (await client.sqliteDataVersion?.()) ?? null;
    if (version !== null && version !== this.lastDataVersion) {
      this.lastDataVersion = version;
      if (rows.length === 0) {
        // External write that did not (or has not yet) produced feed rows.
        for (const client of this.clients.values()) {
          if (client.projectIds === null) this.sendRefresh(client);
        }
      }
    }
  }

  private heartbeat(): void {
    for (const { response } of this.clients.values()) {
      if (!response.writableNeedDrain) response.write(': ping\n\n');
    }
  }

  private broadcastChanges(rows: ChangeRow[], cursor: number): void {
    for (const client of this.clients.values()) {
      const changes = rows
        .filter(
          row =>
            row.seq > client.lastCursor &&
            client.workspaceIds.has(row.workspace_id) &&
            (client.projectIds === null ||
              (row.project_id !== null && client.projectIds.has(row.project_id)))
        )
        .map(entityChangeDtoFromRow);
      if (changes.length > 0) {
        const res = client.response;
        if (client.replaying) {
          const bytes = Buffer.byteLength(JSON.stringify(changes));
          if (
            client.pending.length >= REPLAY_PENDING_BATCH_LIMIT ||
            client.pendingBytes + bytes > REPLAY_PENDING_BYTE_LIMIT
          ) {
            this.removeClient(res);
            res.destroy();
          } else {
            client.pending.push({ changes, cursor, bytes });
            client.pendingBytes += bytes;
          }
        } else if (res.writableNeedDrain) {
          // A live delta is durable. Reconnect from the applied cursor instead
          // of piling more pages behind the socket's outstanding write.
          this.removeClient(res);
          res.destroy();
        } else {
          client.lastCursor = cursor;
          this.send(res, 'change', { type: 'change', changes, cursor });
        }
      }
    }
  }

  private reconnectClientsForAuthorizationChange(): void {
    for (const { response } of [...this.clients.values()]) {
      this.removeClient(response);
      if (response.writableNeedDrain) response.destroy();
      else response.end();
    }
  }

  private async sendCatchUp(
    client: RealtimeClient,
    signalReplayCompletion: boolean
  ): Promise<void> {
    const { response: res, closed, workspaceIds, projectIds } = client;
    const workspaces = [...workspaceIds];
    const projects = projectIds === null ? null : [...projectIds];
    while (true) {
      while (res.writableNeedDrain && !closed.signal.aborted)
        await once(res, 'drain', { signal: closed.signal });
      if (closed.signal.aborted) return;
      const batch = await readChangesAfter(
        client.lastCursor,
        workspaces,
        CHANGE_BATCH_LIMIT,
        projects
      );
      // A concurrent poll may have ended this stream because its authorization
      // snapshot changed while the filtered query was in flight.
      while (res.writableNeedDrain && !closed.signal.aborted)
        await once(res, 'drain', { signal: closed.signal });
      if (closed.signal.aborted) return;
      if (batch.changes.length > 0) {
        this.send(res, 'change', { type: 'change', changes: batch.changes, cursor: batch.cursor });
      }
      client.lastCursor = batch.cursor;
      // Polling can see the same committed rows as replay. Release covered
      // queue entries now so they cannot consume the next drain's budget.
      while (client.pending[0] && client.pending[0].cursor <= batch.cursor) {
        client.pendingBytes -= client.pending.shift()!.bytes;
      }
      if (!batch.hasMore) break;
    }
    while (true) {
      while (res.writableNeedDrain && !closed.signal.aborted)
        await once(res, 'drain', { signal: closed.signal });
      if (closed.signal.aborted) return;
      const pending = client.pending.shift();
      if (!pending) break;
      client.pendingBytes -= pending.bytes;
      const changes = pending.changes.filter(change => change.seq > client.lastCursor);
      if (changes.length > 0)
        this.send(res, 'change', { type: 'change', changes, cursor: pending.cursor });
      client.lastCursor = Math.max(client.lastCursor, pending.cursor);
    }
    client.replaying = false;
    if (signalReplayCompletion) {
      this.send(res, 'hello', { type: 'hello', cursor: client.lastCursor, replayComplete: true });
    }
  }

  private sendRefresh(client: RealtimeClient): void {
    const { response: res, closed } = client;
    if (!res.writableNeedDrain) {
      this.send(res, 'refresh', { type: 'refresh' });
    } else if (!client.refreshPending) {
      client.refreshPending = true;
      void once(res, 'drain', { signal: closed.signal })
        .then(() => {
          client.refreshPending = false;
          if (!closed.signal.aborted) this.sendRefresh(client);
        })
        .catch(error => {
          if (!closed.signal.aborted) this.onPollError(error);
        });
    }
  }

  private send(res: Response, event: string, data: unknown): void {
    const cursor =
      typeof data === 'object' && data && 'cursor' in data
        ? Number((data as { cursor?: unknown }).cursor)
        : NaN;
    const id = Number.isFinite(cursor) && event === 'change' ? `id: ${cursor}\n` : '';
    res.write(`event: ${event}\n${id}data: ${JSON.stringify(data)}\n\n`);
  }
}

export const realtime = new RealtimeHub();
