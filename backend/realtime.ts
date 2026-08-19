import { PERMISSIONS } from '@overlord/auth';
import type { Response } from 'express';

import type { EntityChangeDto, SyncChangesDto } from '../webapp/shared/contract.ts';

import { currentMaxSeq, getAuthorizedWorkspacesContext, requireDatabaseClient } from './db.ts';
import { actorCan } from './rbac.ts';

const CHANGE_BATCH_LIMIT = 500;
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
  limit = CHANGE_BATCH_LIMIT
): Promise<ChangeFeedBatch> {
  const normalizedAfter = Number.isFinite(afterSeq) && afterSeq > 0 ? Math.floor(afterSeq) : 0;
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : CHANGE_BATCH_LIMIT;
  const normalizedLimit = Math.max(1, Math.min(requestedLimit, CHANGE_BATCH_LIMIT));
  const client = requireDatabaseClient();
  // Snapshot the global high-water mark before the filtered read. When the
  // visible page is exhausted, advancing to this value skips unauthorized
  // gaps without skipping a row committed after the snapshot.
  const scanThroughSeq = Math.max(normalizedAfter, await currentMaxSeq(client));
  const authorizedWorkspaceIds = [...new Set(workspaceIds.filter(Boolean))];
  if (authorizedWorkspaceIds.length === 0 || scanThroughSeq === normalizedAfter) {
    return { changes: [], cursor: scanThroughSeq, hasMore: false };
  }
  const workspacePlaceholders = authorizedWorkspaceIds.map(() => '?').join(', ');
  const rows = await client.all<ChangeRow>(
    `SELECT seq, workspace_id, entity_type, entity_id, operation, project_id, mission_id,
            objective_id, changed_fields_json, occurred_at
       FROM entity_changes
      WHERE seq > ? AND seq <= ? AND workspace_id IN (${workspacePlaceholders})
      ORDER BY seq ASC
      LIMIT ?`,
    [normalizedAfter, scanThroughSeq, ...authorizedWorkspaceIds, normalizedLimit + 1]
  );
  const hasMore = rows.length > normalizedLimit;
  const returnedRows = hasMore ? rows.slice(0, normalizedLimit) : rows;
  const changes = returnedRows.map(entityChangeDtoFromRow);
  const cursor = hasMore ? changes[changes.length - 1]!.seq : scanThroughSeq;

  return { changes, cursor, hasMore };
}

interface RealtimeClient {
  response: Response;
  workspaceIds: Set<string>;
}

export interface AddRealtimeClientOptions {
  afterSeq?: number;
  workspaceIds: readonly string[];
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
export class RealtimeHub {
  private readonly clients = new Map<Response, RealtimeClient>();
  private cursor = 0;
  private lastDataVersion: number | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.pollTimer) return;
    void this.initializeCursor();
    this.pollTimer = setInterval(() => void this.poll(), 500);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 25_000);
  }

  addClient(res: Response, options: AddRealtimeClientOptions): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');
    const client: RealtimeClient = {
      response: res,
      workspaceIds: new Set(options.workspaceIds)
    };
    this.clients.set(res, client);
    this.send(res, 'hello', { type: 'hello', cursor: this.cursor });
    if (options.afterSeq !== undefined && options.afterSeq < this.cursor) {
      void this.sendCatchUp(res, options.afterSeq);
    }
  }

  removeClient(res: Response): void {
    this.clients.delete(res);
  }

  /** Run a poll immediately — used right after a local mutation for snappy echoes. */
  pollNow(): Promise<void> {
    return this.poll();
  }

  /**
   * Force every subscriber to refetch. Used for server-state changes that do not
   * write to `entity_changes` — notably switching the active workspace, which
   * changes what every scoped query returns.
   */
  refreshAll(): void {
    this.broadcast('refresh', { type: 'refresh' });
  }

  private async initializeCursor(): Promise<void> {
    const client = requireDatabaseClient();
    this.cursor = await currentMaxSeq(client);
    this.lastDataVersion = (await client.sqliteDataVersion?.()) ?? null;
  }

  private async poll(): Promise<void> {
    const client = requireDatabaseClient();
    if (this.clients.size === 0) {
      // Keep the cursor moving even with no subscribers so a later client does
      // not get flooded with backlog it does not need.
      this.cursor = await currentMaxSeq(client);
      this.lastDataVersion = (await client.sqliteDataVersion?.()) ?? null;
      return;
    }

    const rows = await client.all<ChangeRow>(SELECT_CHANGES_SQL, [this.cursor, CHANGE_BATCH_LIMIT]);
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

    // SQLite-only external-write net: `sqliteDataVersion()` returns null on
    // Postgres, so this branch never fires there (the feed is the sole detector).
    const version = (await client.sqliteDataVersion?.()) ?? null;
    if (version !== null && version !== this.lastDataVersion) {
      this.lastDataVersion = version;
      if (rows.length === 0) {
        // External write that did not (or has not yet) produced feed rows.
        this.broadcast('refresh', { type: 'refresh' });
      }
    }
  }

  private heartbeat(): void {
    for (const { response } of this.clients.values()) response.write(': ping\n\n');
  }

  private broadcast(event: string, data: unknown): void {
    for (const { response } of this.clients.values()) this.send(response, event, data);
  }

  private broadcastChanges(rows: ChangeRow[], cursor: number): void {
    for (const client of this.clients.values()) {
      const changes = rows
        .filter(row => client.workspaceIds.has(row.workspace_id))
        .map(entityChangeDtoFromRow);
      if (changes.length > 0) {
        this.send(client.response, 'change', { type: 'change', changes, cursor });
      }
    }
  }

  private reconnectClientsForAuthorizationChange(): void {
    for (const { response } of [...this.clients.values()]) {
      this.removeClient(response);
      response.end();
    }
  }

  private async sendCatchUp(res: Response, afterSeq: number): Promise<void> {
    let cursor = afterSeq;
    while (this.clients.has(res)) {
      const client = this.clients.get(res)!;
      const batch = await readChangesAfter(cursor, [...client.workspaceIds]);
      // A concurrent poll may have ended this stream because its authorization
      // snapshot changed while the filtered query was in flight.
      if (!this.clients.has(res)) return;
      if (batch.changes.length > 0) {
        this.send(res, 'change', { type: 'change', changes: batch.changes, cursor: batch.cursor });
      }
      cursor = batch.cursor;
      if (!batch.hasMore) return;
    }
  }

  private send(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\n`);
    const cursor =
      typeof data === 'object' && data && 'cursor' in data
        ? Number((data as { cursor?: unknown }).cursor)
        : NaN;
    if (Number.isFinite(cursor)) res.write(`id: ${cursor}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

export const realtime = new RealtimeHub();
